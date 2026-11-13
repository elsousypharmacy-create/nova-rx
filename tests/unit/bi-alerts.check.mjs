import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const { createAlerts, summarizeRoadmap, renderRoadmap } = createRequire(import.meta.url)('../../bi-alerts.js');
const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const H = 3600000;

t('rule validation', () => {
  const a = createAlerts(mem(), 'k');
  assert.throws(() => a.setRule({ metric: 'm', op: 'gt', threshold: 1 }), { code: 'id-required' });
  assert.throws(() => a.setRule({ id: 'a', metric: 'm', op: 'eq', threshold: 1 }), { code: 'bad-op' });
  assert.throws(() => a.setRule({ id: 'a', metric: 'm', op: 'gt', threshold: 'x' }), { code: 'bad-threshold' });
  assert.throws(() => a.setRule({ id: 'a', metric: 'm', op: 'gt', threshold: 1, cooldownMs: -1 }), { code: 'bad-cooldown' });
  assert.equal(a.setRule({ id: 'a', metric: 'm', op: 'gt', threshold: 1 }).cooldownMs, H);
});
t('does not repeat within cooldown, repeats after it', () => {
  let now = 0; const a = createAlerts(mem(), 'k', { now: () => now });
  a.setRule({ id: 'low', metric: 'stock', op: 'lt', threshold: 10 });
  assert.equal(a.evaluate({ stock: 5 }).length, 1);
  now = H - 1; assert.equal(a.evaluate({ stock: 5 }).length, 0);
  now = H; assert.equal(a.evaluate({ stock: 5 }).length, 1);
});
t('minDelta suppresses unchanged value after cooldown; worsening fires', () => {
  let now = 0; const a = createAlerts(mem(), 'k', { now: () => now });
  a.setRule({ id: 'low', metric: 'stock', op: 'lt', threshold: 10, minDelta: 2 });
  a.evaluate({ stock: 8 });
  now = 2 * H; assert.equal(a.evaluate({ stock: 7 }).length, 0);
  assert.equal(a.evaluate({ stock: 6 }).length, 1);
});
t('re-arms after condition clears; missing metric does not re-arm', () => {
  let now = 0; const a = createAlerts(mem(), 'k', { now: () => now });
  a.setRule({ id: 'hi', metric: 'x', op: 'gte', threshold: 100 });
  assert.equal(a.evaluate({ x: 100 }).length, 1);
  now = 10; assert.equal(a.evaluate({}).length, 0);
  assert.equal(a.evaluate({ x: 100 }).length, 0);
  assert.equal(a.evaluate({ x: 50 }).length, 0);
  assert.equal(a.evaluate({ x: 120 }).length, 1);
});
t('state and rules persist; removeRule clears', () => {
  const s = mem(); let now = 0;
  createAlerts(s, 'k', { now: () => now }).setRule({ id: 'a', metric: 'm', op: 'gt', threshold: 1 });
  const b = createAlerts(s, 'k', { now: () => now });
  assert.equal(b.evaluate({ m: 5 }).length, 1);
  assert.equal(createAlerts(s, 'k', { now: () => now }).evaluate({ m: 5 }).length, 0);
  b.removeRule('a'); assert.equal(b.rules().length, 0);
});
t('roadmap: acceptance separate from build, weighted, needs evidence', () => {
  const s = summarizeRoadmap({ updatedAt: 'u', planVersion: 'p', roadmap: [{ id: 'S', title: 'مرحلة', tasks: [
    { id: 'S-1', weight: 1, status: 'verified', verifiedAt: '2026-11-01T00:00:00Z', verification: { by: 'x' }, evidence: [{ url: 'https://e/1' }] },
    { id: 'S-2', weight: 1, status: 'verified', evidence: [{ url: 'https://e/2' }] },
    { id: 'S-3', weight: 2, status: 'for_review', evidence: [] },
    { id: 'S-4', weight: 4, status: 'queued' }] }] });
  assert.equal(s.acceptancePercent, 12.5); assert.equal(s.buildPercent, 37.5);
  assert.equal(summarizeRoadmap({}).acceptancePercent, null);
});
t('render: RTL, escaped, https evidence only, date shown', () => {
  const html = renderRoadmap(summarizeRoadmap({ roadmap: [{ id: 'S', title: '<b>x</b>', tasks: [
    { id: 'S-1', title: 't', weight: 1, status: 'verified', verifiedAt: '2026-11-01T00:00:00Z', verification: {}, evidence: [{ url: 'https://e/1' }, { url: 'javascript:alert(1)' }] }] }] }));
  assert.ok(html.includes('dir="rtl"')); assert.ok(!html.includes('<b>x</b>')); assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('2026-11-01')); assert.ok(html.includes('https://e/1'));
});
t('real published roadmap summarizes without throwing', () => {
  const s = summarizeRoadmap(JSON.parse(readFileSync(new URL('../../reports/erp-roadmap.json', import.meta.url))));
  assert.ok(s.stages.length > 0); assert.ok(s.buildPercent >= s.acceptancePercent);
  assert.ok(renderRoadmap(s).includes('dir="rtl"'));
});
console.log(n + ' passed');
