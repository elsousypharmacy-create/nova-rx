import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createCreditLedger } = createRequire(import.meta.url)('../../credit-ledger.js');

const DAY = 86400000, T0 = 1700000000000;
function mem() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, raw: m }; }
let T = T0; const mk = (s = mem()) => createCreditLedger(s, 'k', { now: () => T, defaultTermDays: 30 });
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('charge is idempotent by sale id and persists across reload', () => {
  const s = mem(), l = mk(s);
  l.charge({ id: 'S1', customerId: 'c1', amount: 100 }); l.charge({ id: 'S1', customerId: 'c1', amount: 999 });
  assert.equal(l.balance('c1'), 100); assert.equal(mk(s).balance('c1'), 100);
});
t('rejects bad input and corrupt storage without overwriting', () => {
  const s = mem(), l = mk(s);
  assert.throws(() => l.charge({ id: 'S', customerId: 'c', amount: 0 }), { code: 'bad-amount' });
  assert.throws(() => l.charge({ id: 'S', customerId: 'c', amount: 1.005 }), { code: 'bad-amount' });
  assert.throws(() => l.charge({ id: 'S', customerId: '', amount: 1 }), { code: 'missing-customer' });
  assert.throws(() => l.charge({ id: '', customerId: 'c', amount: 1 }), { code: 'missing-key' });
  assert.throws(() => l.setLimit('c', -1), { code: 'bad-limit' });
  s.setItem('k', '{oops'); assert.throws(() => l.balance('c'), { code: 'ledger-corrupt' }); assert.equal(s.raw.k, '{oops');
});
t('write failure throws and leaves the ledger unchanged', () => {
  const s = mem(), l = mk(s); l.charge({ id: 'A', customerId: 'c', amount: 5 });
  s.setItem = () => { throw new Error('quota'); };
  assert.throws(() => l.charge({ id: 'B', customerId: 'c', amount: 5 }), { code: 'ledger-write-failed' });
  assert.equal(l.balance('c'), 5);
});
t('credit limit blocks, exact limit passes, override is recorded, null removes it', () => {
  const l = mk(); l.setLimit('c', 100);
  l.charge({ id: 'A', customerId: 'c', amount: 100 });
  assert.throws(() => l.charge({ id: 'B', customerId: 'c', amount: 0.01 }), { code: 'over-limit' });
  assert.equal(l.charge({ id: 'B', customerId: 'c', amount: 5, override: true }).override, true);
  assert.equal(l.limitOf('c'), 100); l.setLimit('c', null); assert.equal(l.limitOf('c'), null);
  l.charge({ id: 'C', customerId: 'c', amount: 1000 });
});
t('limit counts the opening balance', () => {
  const l = mk(); l.setLimit('c', 100); l.openingBalance('c', 80);
  assert.throws(() => l.charge({ id: 'A', customerId: 'c', amount: 30 }), { code: 'over-limit' });
});
t('opening balance: one live per customer; reversible then re-enterable', () => {
  const l = mk(); const o = l.openingBalance('c', 50);
  assert.throws(() => l.openingBalance('c', 10), { code: 'opening-exists' });
  l.reverse(o.id, 'typo'); assert.equal(l.balance('c'), 0); l.openingBalance('c', 60); assert.equal(l.balance('c'), 60);
});
t('partial then full collection, FIFO by due date, receipts numbered', () => {
  const l = mk(); l.charge({ id: 'A', customerId: 'c', amount: 100, due: T0 + 10 * DAY }); l.charge({ id: 'B', customerId: 'c', amount: 50, due: T0 + 5 * DAY });
  const r1 = l.collect({ id: 'R1', customerId: 'c', amount: 70 });
  assert.equal(r1.receiptNo, 'RC-000001'); assert.equal(r1.balanceAfter, 80);
  assert.deepEqual(r1.allocations, [{ chargeId: 'ch-B', amount: 50 }, { chargeId: 'ch-A', amount: 20 }]);
  const r2 = l.collect({ id: 'R2', customerId: 'c', amount: 80 });
  assert.equal(r2.receiptNo, 'RC-000002'); assert.equal(r2.balanceAfter, 0); assert.equal(l.balance('c'), 0);
});
t('collection cannot exceed balance and is idempotent by id', () => {
  const l = mk(); l.charge({ id: 'A', customerId: 'c', amount: 40 });
  assert.throws(() => l.collect({ id: 'R', customerId: 'c', amount: 40.01 }), { code: 'exceeds-balance' });
  const r = l.collect({ id: 'R', customerId: 'c', amount: 10 }), again = l.collect({ id: 'R', customerId: 'c', amount: 10 });
  assert.equal(again.receiptNo, r.receiptNo); assert.equal(l.balance('c'), 30);
});
t('reversing a collection restores the debt with its original due date', () => {
  const l = mk(); l.charge({ id: 'A', customerId: 'c', amount: 100, due: T0 });
  l.collect({ id: 'R', customerId: 'c', amount: 100 }); assert.equal(l.balance('c'), 0);
  l.reverse('co-R', 'wrong customer'); assert.equal(l.balance('c'), 100);
  T = T0 + 40 * DAY; assert.equal(l.aging('c').d31_60, 100); T = T0;
});
t('charge with live collections cannot be reversed until they are; reason required; reversal idempotent', () => {
  const l = mk(); l.charge({ id: 'A', customerId: 'c', amount: 100 }); l.collect({ id: 'R', customerId: 'c', amount: 30 });
  assert.throws(() => l.reverse('ch-A', 'x'), { code: 'has-collections' });
  l.reverse('co-R', 'undo'); assert.throws(() => l.reverse('ch-A', ''), { code: 'reason-required' });
  const a = l.reverse('ch-A', 'cancelled sale'), b = l.reverse('ch-A', 'again');
  assert.equal(a.id, b.id); assert.equal(l.balance('c'), 0);
  assert.throws(() => l.reverse('nope', 'x'), { code: 'unknown-movement' });
  assert.throws(() => l.reverse(a.id, 'x'), { code: 'cannot-reverse-reversal' });
});
t('a reversed charge no longer counts toward the limit and nothing is deleted', () => {
  const l = mk(); l.setLimit('c', 100); l.charge({ id: 'A', customerId: 'c', amount: 100 }); l.reverse('ch-A', 'void');
  l.charge({ id: 'B', customerId: 'c', amount: 100 });
  const st = l.statement('c'); assert.equal(st.length, 3); assert.equal(st[0].reversed, true); assert.equal(st[1].type, 'reversal');
});
t('aging buckets by days past due, boundaries 0/30/31/60/61/90/91', () => {
  const l = mk();
  [[0, 'current'], [-5, 'current'], [1, 'd1_30'], [30, 'd1_30'], [31, 'd31_60'], [60, 'd31_60'], [61, 'd61_90'], [90, 'd61_90'], [91, 'd90_plus']]
    .forEach(([past, bucket], i) => {
      const c = 'c' + i, ll = mk(); ll.charge({ id: 'X', customerId: c, amount: 10, due: T0 - past * DAY });
      const a = ll.aging(c, T0); assert.equal(a[bucket], 10, `${past} -> ${bucket}`); assert.equal(a.total, 10);
    });
  l.charge({ id: 'A', customerId: 'z', amount: 10, due: T0 - 100 * DAY }); l.charge({ id: 'B', customerId: 'z', amount: 5 });
  l.collect({ id: 'R', customerId: 'z', amount: 4 });
  assert.deepEqual(l.aging('z', T0), { total: 11, current: 5, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 6 });
});
t('default due date is charge time + term days', () => {
  assert.equal(mk().charge({ id: 'A', customerId: 'c', amount: 1 }).due, T0 + 30 * DAY);
});
t('reconcile: clean ledger matches sales; detects missing, amount, customer, orphan', () => {
  const l = mk(); const sales = [{ id: 'S1', customerId: 'c', credit: 50 }, { id: 'S2', customerId: 'c', credit: 0 }, { id: 'S3', customerId: 'd', credit: 20 }];
  l.charge({ id: 'S1', customerId: 'c', amount: 50 }); l.charge({ id: 'S3', customerId: 'd', amount: 20 });
  l.collect({ id: 'R', customerId: 'c', amount: 10 }); l.openingBalance('e', 5);
  assert.deepEqual(l.reconcile(sales), { ok: true, diffs: [] });
  assert.deepEqual(l.reconcile(sales.concat([{ id: 'S4', customerId: 'c', credit: 9 }])).diffs, [{ type: 'missing-charge', saleId: 'S4', expected: 9 }]);
  assert.equal(l.reconcile([{ id: 'S1', customerId: 'c', credit: 51 }, sales[2]]).diffs[0].type, 'amount-mismatch');
  assert.equal(l.reconcile([{ id: 'S1', customerId: 'x', credit: 50 }, sales[2]]).diffs[0].type, 'customer-mismatch');
  assert.deepEqual(l.reconcile([sales[0]]).diffs, [{ type: 'orphan-charge', saleId: 'S3', ledger: 20 }]);
  l.reverse('ch-S3', 'sale cancelled'); assert.equal(l.reconcile([sales[0]]).ok, true);
  assert.equal(l.reconcile(sales).diffs[0].type, 'missing-charge');
});
t('totals: outstanding equals charges + openings - collections across customers', () => {
  const l = mk(); l.openingBalance('a', 100.1); l.charge({ id: 'S', customerId: 'b', amount: 0.2 }); l.charge({ id: 'S2', customerId: 'b', amount: 0.1 });
  l.collect({ id: 'R', customerId: 'a', amount: 0.1 });
  assert.equal(l.totalOutstanding(), 100.3); assert.equal(l.customers().length, 2);
});
console.log(n, 'passed');
