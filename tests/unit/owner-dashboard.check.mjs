import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const D = createRequire(import.meta.url)('../../owner-dashboard.js');

const now = new Date(2026, 10, 13, 12, 0).getTime(), M = 60000;
const sales = { updatedAt: now - M, items: [
  { total: 100, refunded: 10, at: now - 3600000 },
  { total: 50, at: new Date(2026, 10, 2).getTime() },
  { total: 999, at: now - M, voided: true },
  { total: 7, at: new Date(2026, 9, 30).getTime() }] };
const data = { sales, team: { updatedAt: now - 60 * M, items: [{ name: 'أ', net: 90, invoices: 1 }] },
  stock: { updatedAt: now, items: [{ qty: 1, min: 2 }, { qty: 9, min: 2 }] }, alerts: { updatedAt: now, items: ['<b>x</b>'] } };
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('today/month totals and statuses', () => {
  const s = D.build(data, { now });
  assert.deepEqual(s.today.value, { net: 90, invoices: 1 });
  assert.deepEqual(s.month.value, { net: 140, invoices: 2 });
  assert.equal(s.today.status, 'available');
  assert.equal(s.team.status, 'stale');
  assert.deepEqual(s.stock.value, { items: 2, lowCount: 1 });
});
t('missing source is unknown with null value, never 0', () => {
  const s = D.build(data, { now });
  assert.equal(s.shortages.status, 'unknown'); assert.equal(s.shortages.value, null);
  assert.equal(D.build({}, { now }).today.status, 'unknown');
  assert.equal(D.build({ shortages: { items: [] } }, { now }).shortages.status, 'unknown');
});
t('refresh keeps page and period', () => {
  const st = D.createState('team', 'month');
  const r = D.refresh(st, data, { now: now + M });
  assert.deepEqual(r.state, { page: 'team', period: 'month' });
});
t('render is RTL, phone-responsive, escapes content, shows status', () => {
  const html = D.render(D.refresh(D.createState('today', 'day'), data, { now }));
  assert.match(html, /dir="rtl"/); assert.match(html, /auto-fit/);
  assert.match(html, /data-status="unknown"/); assert.match(html, /قديم/);
  assert.ok(!html.includes('<b>x</b>')); assert.match(html, /&lt;b&gt;/);
});
console.log(n + ' passed');
