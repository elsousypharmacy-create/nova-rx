import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { analyze } = createRequire(import.meta.url)('../../bi-inventory.js');
const D = 86400000, now = 1000 * D + 5000;
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const sale = (itemId, day, qty, extra) => Object.assign({ itemId, qty, price: 10, at: day * D + 100 }, extra);
const data = {
  items: [
    { id: 'a', name: 'A', onHand: 30, lots: [{ lot: 'L1', qty: 30, expiresAt: now + 30 * D }] },
    { id: 'b', name: 'B', onHand: 100 },
    { id: 'c', name: 'C', onHand: 10, lots: [{ lot: 'X', qty: 2, expiresAt: now - D }] },
    { id: 'd', name: 'D', onHand: 0 }
  ],
  sales: [
    ...[990, 991, 992, 993, 994, 995, 996, 997, 998, 999].map(d => sale('a', d, 2)),
    sale('a', 1000, 500), sale('a', 995, 900, { promo: true }), sale('a', 996, 900, { voided: true }),
    sale('b', 900, 1, { price: 1 })
  ]
};
t('baseline excludes promo, voided, running day and incomplete days', () => {
  const r = analyze(data, { now, windowDays: 30, incompleteDays: [990 * D] });
  assert.equal(r.usableDays, 29);
  const a = r.items.find(i => i.id === 'a');
  assert.equal(a.baselineQty, 18);
  assert.equal(a.dailyDemand, 0.62);
});
t('ABC, FSN, cover, turnover, shortage', () => {
  const r = analyze(data, { now, windowDays: 30, leadDays: 50 });
  const a = r.items.find(i => i.id === 'a'), b = r.items.find(i => i.id === 'b'), d = r.items.find(i => i.id === 'd');
  assert.equal(a.abc, 'A'); assert.equal(a.fsn, 'F'); assert.equal(b.fsn, 'N'); assert.equal(d.abc, 'C');
  assert.equal(a.daysOfCover, 45); assert.equal(a.shortage, true); assert.equal(a.turnoverPerYear, 8.11);
  assert.equal(b.daysOfCover, null); assert.equal(d.shortage, false);
});
t('dead stock counts any sale incl. promo; b last sold 100 days ago', () => {
  const r = analyze(data, { now, windowDays: 30, deadDays: 90 });
  assert.equal(r.items.find(i => i.id === 'b').deadStock, true);
  assert.equal(r.items.find(i => i.id === 'a').deadStock, false);
});
t('expiry: expired and at-risk lots', () => {
  const r = analyze(data, { now, windowDays: 30, leadDays: 50 });
  assert.equal(r.items.find(i => i.id === 'c').expired.length, 1);
  assert.ok(r.items.find(i => i.id === 'c').recommendations.some(x => x.code === 'expired'));
  const a = r.items.find(i => i.id === 'a');
  assert.equal(a.expiring[0].willSell, false);
  assert.ok(a.recommendations.some(x => x.code === 'expiry-risk'));
});
t('every recommendation explains in Arabic and English', () => {
  analyze(data, { now, windowDays: 30, leadDays: 50 }).items.forEach(i => i.recommendations.forEach(x => { assert.ok(x.ar.length > 10 && x.en.length > 10); }));
});
t('bad now rejected', () => { assert.throws(() => analyze(data, {}), { code: 'bad-now' }); });
console.log(n + ' passed');
