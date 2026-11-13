import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createShifts } = createRequire(import.meta.url)('../../finance-shifts.js');
function mem() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } }; }
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const mk = () => { const c = createShifts(mem(), 'k', { now: () => 1 }); c.open({ id: 's1', drawerId: 'd1', cashier: 'amal', float: 500 }); return c; };

t('open validates; one open shift per drawer; duplicate id rejected', () => {
  const c = mk();
  assert.throws(() => c.open({ id: 's2', drawerId: 'd1', cashier: 'x', float: 0 }), { code: 'drawer-already-open' });
  assert.throws(() => c.open({ id: 's1', drawerId: 'd2', cashier: 'x', float: 0 }), { code: 'duplicate-shift' });
  assert.throws(() => c.open({ id: 's3', drawerId: 'd3', cashier: 'x', float: -1 }), { code: 'bad-amount' });
  assert.throws(() => c.open({ id: 's3', drawerId: 'd3', cashier: 'x', float: 1.005 }), { code: 'bad-amount' });
});
t('expected cash = float + cash sales - drops - payouts; card/bank excluded', () => {
  const c = mk();
  c.sale('s1', { method: 'cash', amount: 300.5 }); c.sale('s1', { method: 'card', amount: 200 }); c.sale('s1', { method: 'bank', amount: 50 });
  c.drop('s1', { amount: 400, by: 'mgr' }); c.payout('s1', { amount: 20.25, by: 'amal', reason: 'ice' });
  const v = c.get('s1');
  assert.equal(v.expectedCash, 50000 + 30050 - 40000 - 2025);
  assert.deepEqual(v.totals, { cash: 30050, card: 20000, bank: 5000 });
});
t('drop/payout guard: no overdraw, payout needs reason, bad method', () => {
  const c = mk();
  assert.throws(() => c.drop('s1', { amount: 501, by: 'm' }), { code: 'insufficient-cash' });
  assert.throws(() => c.payout('s1', { amount: 5, by: 'm' }), { code: 'reason-required' });
  assert.throws(() => c.sale('s1', { method: 'crypto', amount: 5 }), { code: 'bad-method' });
  assert.throws(() => c.sale('s1', { method: 'cash', amount: 0 }), { code: 'bad-amount' });
});
t('exact close -> closed; closed shift cannot be edited', () => {
  const c = mk();
  c.sale('s1', { method: 'cash', amount: 100 });
  const v = c.close('s1', { by: 'amal', counted: 600 });
  assert.equal(v.status, 'closed'); assert.equal(v.closing.variance, 0);
  for (const f of [() => c.sale('s1', { method: 'cash', amount: 1 }), () => c.drop('s1', { amount: 1, by: 'm' }),
    () => c.payout('s1', { amount: 1, by: 'm', reason: 'r' }), () => c.count('s1', { counted: 1, by: 'm' }), () => c.close('s1', { by: 'm', counted: 1 })])
    assert.throws(f, { code: 'shift-not-open' });
  c.open({ id: 's2', drawerId: 'd1', cashier: 'x', float: 0 }); // drawer free again
});
t('variance needs approval by a different person, then closes and stays immutable', () => {
  const c = mk();
  const v = c.close('s1', { by: 'amal', counted: 490 });
  assert.equal(v.status, 'pending-approval'); assert.equal(v.closing.variance, -1000);
  assert.throws(() => c.sale('s1', { method: 'cash', amount: 1 }), { code: 'shift-not-open' });
  assert.throws(() => c.approveVariance('s1', { by: 'amal', note: 'ok' }), { code: 'approver-must-differ' });
  assert.throws(() => c.approveVariance('s1', { by: 'mgr' }), { code: 'note-required' });
  assert.equal(c.approveVariance('s1', { by: 'mgr', note: 'counted twice' }).status, 'closed');
  assert.throws(() => c.approveVariance('s1', { by: 'mgr2', note: 'x' }), { code: 'no-variance-pending' });
});
t('intermediate cash count is recorded without closing', () => {
  const c = mk(); const v = c.count('s1', { counted: 500, by: 'amal' });
  assert.equal(v.status, 'open'); assert.equal(v.counts.length, 1);
});
t('reconcile cash/card/bank only after close; reports diffs', () => {
  const c = mk();
  c.sale('s1', { method: 'card', amount: 200 }); c.sale('s1', { method: 'bank', amount: 50 });
  assert.throws(() => c.reconcile('s1', { card: 200, bank: 50 }), { code: 'shift-not-closed' });
  c.close('s1', { by: 'amal', counted: 500 });
  assert.equal(c.reconcile('s1', { card: 200, bank: 50 }).matched, true);
  const r = c.reconcile('s1', { card: 190, bank: 50 });
  assert.equal(r.matched, false); assert.equal(r.card.diff, -1000);
});
t('persistence and corrupt storage', () => {
  const s = mem(); const a = createShifts(s, 'k'); a.open({ id: 's1', drawerId: 'd', cashier: 'a', float: 1 });
  assert.equal(createShifts(s, 'k').list().length, 1);
  s.setItem('bad', '{'); assert.throws(() => createShifts(s, 'bad').list(), { code: 'shifts-corrupt' });
  assert.throws(() => a.get('nope'), { code: 'unknown-shift' });
});
console.log(n + ' tests passed');
