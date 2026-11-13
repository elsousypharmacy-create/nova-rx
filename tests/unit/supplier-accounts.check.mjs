import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createSupplierAccounts } = createRequire(import.meta.url)('../../supplier-accounts.js');

const DAY = 86400000, T0 = 1700000000000;
function mem() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, raw: m }; }
let T = T0; const mk = (s = mem()) => createSupplierAccounts(s, 'k', { now: () => T });
let n = 0; const t = (name, fn) => { T = T0; fn(); n++; console.log('ok', name); };

t('invoice is idempotent, persists, payment settles oldest first', () => {
  const s = mem(), a = mk(s); a.setSupplier('S1', { termDays: 30 });
  a.addInvoice({ id: 'P1', supplierId: 'S1', amount: 100 }); a.addInvoice({ id: 'P1', supplierId: 'S1', amount: 999 });
  T += DAY; a.addInvoice({ id: 'P2', supplierId: 'S1', amount: 50 });
  assert.equal(mk(s).balance('S1'), 150);
  a.pay({ id: 'PY1', supplierId: 'S1', amount: 120 });
  assert.equal(a.balance('S1'), 30);
  assert.throws(() => a.pay({ id: 'PY2', supplierId: 'S1', amount: 31 }), { code: 'overpayment' });
});
t('bad input and corrupt storage are rejected without overwrite', () => {
  const s = mem(), a = mk(s);
  assert.throws(() => a.addInvoice({ id: 'x', supplierId: 'none', amount: 1 }), { code: 'unknown-supplier' });
  a.setSupplier('S1');
  assert.throws(() => a.addInvoice({ id: 'x', supplierId: 'S1', amount: 1.005 }), { code: 'bad-amount' });
  assert.throws(() => a.setSupplier('S1', { termDays: -1 }), { code: 'bad-terms' });
  assert.throws(() => a.setSupplier('S1', { discount: { pct: 100, days: 5 } }), { code: 'bad-discount' });
  s.setItem('k', '{oops'); assert.throws(() => a.balance('S1'), { code: 'store-corrupt' }); assert.equal(s.raw.k, '{oops');
});
t('early-payment discount applies only inside the window', () => {
  const a = mk(); a.setSupplier('S1', { termDays: 30, discount: { pct: 2, days: 10 } });
  a.addInvoice({ id: 'P1', supplierId: 'S1', amount: 100 });
  assert.deepEqual(a.discountsAvailable('S1'), [{ invoiceId: 'P1', saves: 2 }]);
  a.pay({ id: 'Y1', supplierId: 'S1', amount: 98 });
  assert.equal(a.balance('S1'), 0);
  a.addInvoice({ id: 'P2', supplierId: 'S1', amount: 100 }); T += 11 * DAY;
  assert.deepEqual(a.discountsAvailable('S1'), []);
  assert.throws(() => a.pay({ id: 'Y2', supplierId: 'S1', amount: 101 }), { code: 'overpayment' });
  a.pay({ id: 'Y2', supplierId: 'S1', amount: 98 }); assert.equal(a.balance('S1'), 2);
});
t('aging buckets by due date and reversal restores balance', () => {
  const a = mk(); a.setSupplier('S1', { termDays: 10 });
  a.addInvoice({ id: 'P1', supplierId: 'S1', amount: 10 });
  assert.equal(a.aging('S1').current, 10); T += 25 * DAY; assert.equal(a.aging('S1').d1_30, 10);
  a.pay({ id: 'Y', supplierId: 'S1', amount: 10 }); assert.equal(a.balance('S1'), 0);
  assert.throws(() => a.reverse('P1'), { code: 'invoice-has-payments' });
  a.reverse('Y'); assert.equal(a.balance('S1'), 10);
  assert.throws(() => a.reverse('Y'), { code: 'already-reversed' });
});
t('expense needs document, category, approval by someone else before paying', () => {
  const a = mk();
  assert.throws(() => a.addExpense({ id: 'E', amount: 5, category: 'rent', createdBy: 'u1' }), { code: 'missing-document' });
  assert.throws(() => a.addExpense({ id: 'E', amount: 5, document: 'D1', createdBy: 'u1' }), { code: 'missing-category' });
  assert.throws(() => a.addExpense({ id: 'E', amount: 5, document: 'D1', category: 'zzz', createdBy: 'u1' }), { code: 'bad-category' });
  a.addExpense({ id: 'E', amount: 5, document: 'D1', category: 'rent', createdBy: 'u1' });
  assert.throws(() => a.payExpense('E'), { code: 'not-approved' });
  assert.throws(() => a.approveExpense('E', 'u1'), { code: 'self-approval' });
  a.approveExpense('E', 'u2'); a.payExpense('E');
  assert.equal(a.expenses('paid')[0].amount, 5);
  assert.throws(() => a.rejectExpense('E', 'u2'), { code: 'not-draft' });
});
t('reconcile against mock bank and local purchasing', () => {
  const a = mk(); a.setSupplier('S1');
  a.addInvoice({ id: 'P1', supplierId: 'S1', amount: 100 });
  a.pay({ id: 'Y1', supplierId: 'S1', amount: 100 });
  a.addExpense({ id: 'E1', amount: 20, document: 'D', category: 'rent', createdBy: 'u1' }); a.approveExpense('E1', 'u2'); a.payExpense('E1');
  const purch = [{ id: 'P1', supplierId: 'S1', total: 100 }];
  assert.deepEqual(a.reconcile(purch).diffs.map(d => d.type), ['missing-bank-entry', 'missing-bank-entry']);
  a.addBankEntry({ id: 'B1', amount: 100, ref: 'Y1' }); a.addBankEntry({ id: 'B2', amount: 19, ref: 'E1' }); a.addBankEntry({ id: 'B3', amount: 7 });
  assert.deepEqual(a.reconcile(purch).diffs.map(d => d.type), ['bank-amount-mismatch', 'unmatched-bank-entry']);
  const b = mk(); b.setSupplier('S1'); b.addInvoice({ id: 'P1', supplierId: 'S1', amount: 90 });
  assert.deepEqual(b.reconcile([{ id: 'P1', supplierId: 'S1', total: 100 }, { id: 'P9', supplierId: 'S1', total: 1 }]).diffs.map(d => d.type), ['invoice-amount-mismatch', 'purchase-without-invoice']);
  const c = mk(); c.setSupplier('S1'); c.addInvoice({ id: 'P1', supplierId: 'S1', amount: 100 });
  assert.equal(c.reconcile(purch).ok, true);
});
t('write failure throws and leaves state unchanged', () => {
  const s = mem(), a = mk(s); a.setSupplier('S1'); a.addInvoice({ id: 'A', supplierId: 'S1', amount: 5 });
  s.setItem = () => { throw new Error('quota'); };
  assert.throws(() => a.addInvoice({ id: 'B', supplierId: 'S1', amount: 5 }), { code: 'store-write-failed' });
  assert.equal(a.balance('S1'), 5);
});
console.log(n + ' checks passed');
