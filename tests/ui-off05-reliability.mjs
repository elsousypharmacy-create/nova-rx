// N44 OFF-05 UI checks: heavy local work queue, health + requestId surfaced on user-facing errors,
// degraded mode for supplier, AI, and printer when mocks are down, and Arabic outage runbook with owner + alert path.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8');

let n = 0;
const t = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    console.log('  FAIL', name, '\n   ', String(e.message).split('\n')[0]);
    process.exit(1);
  }
  n++;
  console.log('  ok', name);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox']
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    return r.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/emergency/stock.json', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: snapshot })
  );

  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.novaReliability && window.novaReceipt && window.NOVA_SUPPLIER_PROVIDER, null, { timeout: 8000 });

  await t('starts with healthy state and hidden degraded/error banners', async () => {
    const state = await page.evaluate(() => {
      const h = window.novaReliability.checkHealth();
      const deg = document.getElementById('novaDegradedBanner');
      const err = document.getElementById('novaErrorBanner');
      return { ok: h.ok, status: h.status, reqId: h.requestId, degHidden: deg.hidden, errHidden: err.hidden };
    });
    assert.equal(state.ok, true);
    assert.equal(state.status, 'ok');
    assert.match(state.reqId, /^HLTH-/);
    assert.equal(state.degHidden, true);
    assert.equal(state.errHidden, true);
  });

  await t('Settings reliability card displays health check, heavy work queue, and Arabic outage runbook with owner and alert path', async () => {
    await page.locator('.nova-tab[data-page="settings"]').click();
    await page.waitForSelector('#novaReliabilityCard');
    const info = await page.evaluate(() => ({
      owner: document.getElementById('novaRunbookOwner')?.textContent || '',
      alertPath: document.getElementById('novaRunbookAlertPath')?.textContent || '',
      runbookContract: window.novaReliability.getRunbook(),
      healthStatus: document.getElementById('novaHealthSummary')?.getAttribute('data-health-status'),
      healthReq: document.getElementById('novaHealthSummary')?.getAttribute('data-health-req')
    }));
    assert.ok(info.owner.includes('أحمد السوسي'), 'runbook UI must display owner');
    assert.ok(info.alertPath.includes('معرف الطلب') && info.alertPath.includes('تصعيد للمسؤول'), 'runbook UI must display alert path');
    assert.ok(info.runbookContract.alertPath[0].detailAr.includes('requestId'), 'runbook contract must reference requestId');
    assert.equal(info.healthStatus, 'ok');
    assert.match(info.healthReq, /^HLTH-/);
  });

  await t('Settings heavy work queue enqueues and completes chunked catalog reindex', async () => {
    await page.click('#novaEnqueueHeavyBtn');
    await page.waitForFunction(() => {
      const q = window.novaReliability.heavyQueue();
      return q.length === 1 && q[0].status === 'completed';
    }, null, { timeout: 5000 });
    const job = await page.evaluate(() => window.novaReliability.heavyQueue()[0]);
    assert.equal(job.status, 'completed');
    assert.ok(job.progress.processed > 0);
    assert.match(job.requestId, /^JOB-/);
  });

  await t('supplier, AI, and printer degraded modes show banner and surface requestId + health on errors', async () => {
    // 1. Toggle Supplier mock down via Settings button
    await page.click('[data-toggle-mock="supplier"]');
    const supBanner = await page.evaluate(() => {
      const deg = document.getElementById('novaDegradedBanner');
      const err = document.getElementById('novaErrorBanner');
      return {
        degHidden: deg.hidden,
        degServices: deg.getAttribute('data-degraded-services'),
        degText: deg.innerText,
        errHidden: err.hidden,
        errReqId: err.getAttribute('data-request-id'),
        errHealth: err.getAttribute('data-health-status'),
        errText: err.innerText
      };
    });
    assert.equal(supBanner.degHidden, false);
    assert.equal(supBanner.degServices, 'supplier');
    assert.ok(supBanner.degText.includes('وضع الموردين المخفض'));
    assert.equal(supBanner.errHidden, false);
    assert.match(supBanner.errReqId, /^ERR-/);
    assert.equal(supBanner.errHealth, 'degraded');
    assert.ok(supBanner.errText.includes(supBanner.errReqId) && supBanner.errText.includes('degraded'));

    // Calling supplier provider while down rejects with requestId + health
    const supCall = await page.evaluate(async () => {
      try {
        await window.NOVA_SUPPLIER_PROVIDER.search('concor');
        return { ok: true };
      } catch (e) {
        return { ok: false, code: e.code, requestId: e.requestId, health: e.health?.status };
      }
    });
    assert.equal(supCall.ok, false);
    assert.equal(supCall.code, 'supplier-down');
    assert.match(supCall.requestId, /^ERR-/);
    assert.equal(supCall.health, 'degraded');

    // 2. Toggle AI mock down -> /api/ai/* returns 503 with requestId + degraded health
    await page.click('[data-toggle-mock="ai"]');
    const aiCall = await page.evaluate(async () => {
      const res = await fetch('/api/ai/purchase', { method: 'POST', body: '{}' });
      const data = await res.json();
      return { status: res.status, data };
    });
    assert.equal(aiCall.status, 503);
    assert.equal(aiCall.data.code, 'AI_DEGRADED_MODE');
    assert.match(aiCall.data.requestId, /^ERR-/);
    assert.equal(aiCall.data.health.status, 'degraded');

    // 3. Toggle Printer mock down -> novaReceipt.print() returns error with requestId + degraded health
    await page.click('[data-toggle-mock="printer"]');
    const prnCall = await page.evaluate(() => window.novaReceipt.print());
    assert.equal(prnCall.ok, false);
    assert.equal(prnCall.error, 'printer-disconnected');
    assert.match(prnCall.requestId, /^ERR-/);
    assert.equal(prnCall.health.status, 'degraded');

    const allDeg = await page.evaluate(() => document.getElementById('novaDegradedBanner').getAttribute('data-degraded-services'));
    assert.equal(allDeg, 'supplier,ai,printer');

    // Restore all services via banner button
    await page.click('#novaRestoreMocksBtn');
    const restored = await page.evaluate(() => ({
      degHidden: document.getElementById('novaDegradedBanner').hidden,
      health: window.novaReliability.checkHealth().status,
      printerConnected: window.novaReceipt.isPrinterConnected()
    }));
    assert.equal(restored.degHidden, true);
    assert.equal(restored.health, 'ok');
    assert.equal(restored.printerConnected, true);
  });

  assert.deepEqual(errors, []);
  console.log(`ui-off05-reliability: ${n} passed`);
} finally {
  await browser.close();
}
