// N44 OFF-05 unit checks: heavy local work queue, health checks, user-facing errors with requestId + health, degraded mode for supplier/AI/printer, and Arabic outage runbook.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const NovaReliability = req('../../local-reliability.js');

let t0 = Date.parse('2026-11-13T00:00:00Z');
let rSeq = 1;
const clock = () => t0;
const rand = () => ((rSeq = (rSeq * 48271) % 0x7fffffff) / 0x7fffffff);

let n = 0;
const t = async (name, fn) => {
  await fn();
  n++;
  console.log('ok', name);
};

await t('health check starts ok with traceable requestId and all components healthy', () => {
  const s = NovaReliability.createMemoryStorage();
  const rel = NovaReliability.create({ storage: s, now: clock, rand });
  const h = rel.checkHealth();
  assert.equal(h.ok, true);
  assert.equal(h.status, 'ok');
  assert.match(h.requestId, /^HLTH-20261113-\d{4}-[0-9A-F]{6}$/);
  assert.equal(h.components.storage.status, 'ok');
  assert.equal(h.components.supplier.status, 'ok');
  assert.equal(h.components.ai.status, 'ok');
  assert.equal(h.components.printer.status, 'ok');
  assert.equal(h.components.queue.status, 'ok');
  assert.equal(h.degradedServices.length, 0);
});

await t('degraded mode for supplier, AI, and printer mocks updates health and provides Arabic fallbacks', () => {
  const s = NovaReliability.createMemoryStorage();
  const rel = NovaReliability.create({ storage: s, now: clock, rand });

  for (const svc of ['supplier', 'ai', 'printer']) {
    const downState = rel.setMockState(svc, 'down', `${svc}-timeout`);
    assert.equal(downState.degraded, true);
    assert.equal(downState.status, 'degraded');
    assert.equal(downState.mockStatus, 'down');
    assert.ok(downState.fallbackAr.length > 15, `${svc} must provide Arabic fallback`);
    assert.ok(downState.fallbackEn.length > 15, `${svc} must provide English fallback`);
    assert.equal(rel.isDegraded(svc), true);

    const h = rel.checkHealth();
    assert.equal(h.ok, false);
    assert.equal(h.status, 'degraded');
    assert.ok(h.degradedServices.some(d => d.id === svc));
  }

  assert.equal(rel.degradedServices().length, 3);

  // Persist across reload
  const relReloaded = NovaReliability.create({ storage: s, now: clock, rand });
  assert.equal(relReloaded.degradedServices().length, 3);

  // Restore all
  for (const svc of ['supplier', 'ai', 'printer']) {
    rel.setMockState(svc, 'ok');
    assert.equal(rel.isDegraded(svc), false);
  }
  assert.equal(rel.checkHealth().status, 'ok');
});

await t('user-facing errors always surface requestId and live health snapshot', () => {
  const s = NovaReliability.createMemoryStorage();
  const surfaced = [];
  const rel = NovaReliability.create({
    storage: s,
    now: clock,
    rand,
    onError: err => surfaced.push(err)
  });

  rel.setMockState('ai', 'down', 'gemini-503');
  const err = rel.reportError({ code: 'ai-down', component: 'ai', detail: 'medication-label' });

  assert.match(err.requestId, /^ERR-20261113-\d{4}-[0-9A-F]{6}$/);
  assert.equal(err.health.status, 'degraded');
  assert.equal(err.health.requestId, err.requestId);
  assert.ok(err.health.degradedServices.includes('ai'));
  assert.ok(err.userTextAr.includes(err.requestId), 'Arabic user error must include requestId');
  assert.ok(err.userTextAr.includes('degraded'), 'Arabic user error must include health status');
  assert.ok(err.userTextEn.includes(err.requestId), 'English user error must include requestId');
  assert.ok(err.userTextEn.includes('degraded'), 'English user error must include health status');
  assert.equal(surfaced.length, 1);
  assert.equal(rel.errors().length, 1);
});

await t('guardService switches to degraded mode on mock failure and runs fallback with requestId + health', async () => {
  const s = NovaReliability.createMemoryStorage();
  const rel = NovaReliability.create({ storage: s, now: clock, rand });

  const out = await rel.guardService(
    'supplier',
    async () => { throw new Error('network-unreachable'); },
    (errRec, st) => ({ mode: 'local-prep-list', requestId: errRec.requestId, health: errRec.health.status, fallbackAr: st.fallbackAr })
  );

  assert.equal(out.ok, false);
  assert.equal(out.degraded, true);
  assert.equal(rel.isDegraded('supplier'), true);
  assert.equal(out.fallback.mode, 'local-prep-list');
  assert.equal(out.fallback.requestId, out.error.requestId);
  assert.equal(out.fallback.health, 'degraded');
});

await t('heavy local work queue processes large batches in chunks, is idempotent by key, and surfaces failed job errors with requestId', async () => {
  const s = NovaReliability.createMemoryStorage();
  const rel = NovaReliability.create({ storage: s, now: clock, rand });

  const items = Array.from({ length: 65 }, (_, i) => ({ code: String(1000 + i), name: `Item ${i}`, total: 10 }));
  const j1 = rel.enqueueHeavyWork({
    key: 'reindex-batch-1',
    type: 'catalog-reindex',
    label: 'فهرسة الكتالوج',
    items,
    chunkSize: 20
  });
  const jDup = rel.enqueueHeavyWork({
    key: 'reindex-batch-1',
    type: 'catalog-reindex',
    label: 'فهرسة مكررة',
    items
  });
  assert.equal(j1.id, jDup.id, 'same key must not enqueue duplicate heavy work');
  assert.match(j1.requestId, /^JOB-20261113-\d{4}-[0-9A-F]{6}$/);

  t0 += 45;
  const run1 = await rel.runNextHeavyJob();
  assert.equal(run1.skipped, false);
  assert.equal(run1.job.status, 'completed');
  assert.equal(run1.job.progress.processed, 65);
  assert.equal(run1.job.progress.chunks, 4);
  assert.deepEqual(run1.job.result, { indexed: 65 });

  // Failing job records error with requestId & health, and can be retried
  let failOnce = true;
  rel.registerHeavyHandler('flaky-export', async () => {
    if (failOnce) {
      failOnce = false;
      throw new Error('disk-busy');
    }
    return { exported: true };
  });
  const j2 = rel.enqueueHeavyWork({ type: 'flaky-export', label: 'تصدير ثقيل' });
  const failedRun = await rel.runNextHeavyJob();
  assert.equal(failedRun.job.status, 'failed');
  assert.equal(failedRun.job.lastError.requestId, j2.requestId);
  assert.equal(rel.checkHealth().components.queue.status, 'degraded');

  rel.retryHeavyJob(j2.id);
  const retryRun = await rel.runNextHeavyJob();
  assert.equal(retryRun.job.status, 'completed');
  assert.deepEqual(retryRun.job.result, { exported: true });
  assert.equal(rel.checkHealth().components.queue.status, 'ok');
});

await t('Arabic outage runbook is frozen and defines owner and alert path both in module and docs/OUTAGE_RUNBOOK.md', () => {
  const rb = NovaReliability.RUNBOOK;
  assert.equal(Object.isFrozen(rb), true);
  assert.equal(Object.isFrozen(rb.owner), true);
  assert.equal(Object.isFrozen(rb.alertPath), true);
  assert.ok(rb.owner.name.includes('أحمد السوسي'), 'runbook must specify owner');
  assert.equal(rb.alertPath.length, 3, 'runbook must define 3-step alert path');
  assert.ok(rb.degradedProcedures.supplier && rb.degradedProcedures.ai && rb.degradedProcedures.printer);

  const md = readFileSync(new URL('../../docs/OUTAGE_RUNBOOK.md', import.meta.url), 'utf8');
  assert.ok(md.includes('د. أحمد السوسي'), 'OUTAGE_RUNBOOK.md must name owner');
  assert.ok(md.includes('مسار الإنذار والتصعيد'), 'OUTAGE_RUNBOOK.md must include Arabic alert path');
  assert.ok(md.includes('requestId') && md.includes('health'), 'OUTAGE_RUNBOOK.md must reference requestId and health');
});

console.log(`local-reliability: ${n} passed`);
