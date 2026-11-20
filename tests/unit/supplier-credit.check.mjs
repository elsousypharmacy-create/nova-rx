// SUP-RET (#79): supplier credit notes for returned goods (supplier-accounts.js credit / creditBalance).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSupplierAccounts } = require('../../supplier-accounts.js');

function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

const DAY = 86400000, t = Date.UTC(2026, 0, 1);
const acct = createSupplierAccounts(memStorage(), 'test.sup', { now: () => t });
acct.setSupplier('s1', { name: 'مورد', termDays: 30, discount: { pct: 10, days: 10 } });

// credit settles oldest-due invoices first, never with the early-payment discount
acct.addInvoice({ id: 'inv-1', supplierId: 's1', amount: 100, at: t });
acct.addInvoice({ id: 'inv-2', supplierId: 's1', amount: 60, at: t + 2 * DAY });
assert.equal(acct.credit({ id: 'cr-1', supplierId: 's1', amount: 120, ref: 'SRET-1', reason: 'تالف', at: t + DAY }), 'cr-1');
assert.equal(acct.balance('s1'), 40, '100 on inv-1 + 20 on inv-2, no discount');
assert.equal(acct.creditBalance('s1'), 0);

// idempotent by id
acct.credit({ id: 'cr-1', supplierId: 's1', amount: 120, at: t + DAY });
assert.equal(acct.balance('s1'), 40);

// leftover stays as supplier credit (no overpayment error)
acct.credit({ id: 'cr-2', supplierId: 's1', amount: 75, ref: 'SRET-2', at: t + 3 * DAY });
assert.equal(acct.balance('s1'), 0);
assert.equal(acct.creditBalance('s1'), 35);

// a payment afterwards still fails as overpayment (credit is not cash)
assert.throws(() => acct.pay({ id: 'p-1', supplierId: 's1', amount: 1 }), e => e.code === 'overpayment');

// reversal restores the invoice and removes the leftover
acct.reverse('cr-2', 'غلط');
assert.equal(acct.balance('s1'), 40);
assert.equal(acct.creditBalance('s1'), 0);

// a payment still works alongside credits
acct.pay({ id: 'p-2', supplierId: 's1', amount: 40, at: t + 40 * DAY });
assert.equal(acct.balance('s1'), 0);

for (const bad of [0, -10, NaN, Infinity, 1.234, '10', null]) {
  assert.throws(() => acct.credit({ id: 'bad-' + String(bad), supplierId: 's1', amount: bad }), e => e.code === 'bad-amount', String(bad));
}
assert.throws(() => acct.credit({ id: 'x', supplierId: 'nope', amount: 5 }), e => e.code === 'unknown-supplier');
console.log('supplier-credit.check PASS');
