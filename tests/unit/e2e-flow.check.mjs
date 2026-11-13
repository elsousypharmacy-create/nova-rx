// QA-02: local end-to-end flow — import → purchase → receive → sale → return → collect → close.
// Test-only: composes the existing pure modules; no production logic lives here.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const { createLedger } = req('../../stock-ledger.js');
const { createJournal } = req('../../journal-ledger.js');
const { createCreditLedger } = req('../../credit-ledger.js');
const { createShifts } = req('../../finance-shifts.js');

const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } }; };
let T = 1700000000000;
const now = () => T;
function world() {
  return {
    stock: createLedger(mem(), 'k', () => new Date(T).toISOString()),
    j: createJournal(mem(), 'k', { now }),
    credit: createCreditLedger(mem(), 'k', { now, defaultTermDays: 30 }),
    shifts: createShifts(mem(), 'k', { now }),
  };
}
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('full flow keeps stock, journal, credit and cash drawer consistent', () => {
  const w = world(), CODE = 'PARA500';
  // 1. import opening stock (10 units, cost 5 each)
  w.stock.append({ kind: 'adjustment', code: CODE, qty: 10, ref: 'import-1' });
  assert.equal(w.stock.onHand(CODE), 10);
  // 2-3. purchase 20 units @5 = 100 (60 paid, 40 owed) and receive them
  w.stock.append({ kind: 'receive', code: CODE, qty: 20, ref: 'PO-1', lot: 'L1', expiry: '2028-01-31', cost: 5 });
  w.j.purchase({ id: 'PO-1', total: 100, paid: 60 });
  assert.equal(w.stock.onHand(CODE), 30);
  assert.equal(w.j.balance('inventory'), 100); assert.equal(w.j.balance('cash'), -60); assert.equal(w.j.balance('ap'), -40);
  // 4. open shift, sell 6 units @10: 40 cash + 20 credit
  w.shifts.open({ id: 'SH1', drawerId: 'D1', cashier: 'amal', float: 100 });
  w.stock.append({ kind: 'sale', code: CODE, qty: 6, ref: 'S1' });
  w.j.sale({ id: 'S1', total: 60, cash: 40, credit: 20, cogs: 30 });
  w.credit.charge({ id: 'S1', customerId: 'c1', amount: 20 });
  w.shifts.sale('SH1', { method: 'cash', amount: 40, ref: 'S1' });
  assert.equal(w.stock.onHand(CODE), 24);
  assert.equal(w.j.balance('sales'), -60); assert.equal(w.j.balance('cogs'), 30); assert.equal(w.j.balance('ar'), 20);
  assert.equal(w.credit.balance('c1'), 20);
  // 5. return 2 units (refund 20 cash, cogs back 10)
  w.stock.append({ kind: 'return', code: CODE, qty: 2, ref: 'R1' });
  w.j.saleReturn({ id: 'R1', total: 20, cash: 20, cogs: 10 });
  w.shifts.payout('SH1', { amount: 20, by: 'amal', reason: 'refund R1' });
  assert.equal(w.stock.onHand(CODE), 26);
  assert.equal(w.j.balance('salesReturns'), 20); assert.equal(w.j.balance('inventory'), 100 - 30 + 10);
  // 6. collect the 20 credit balance in cash
  const rc = w.credit.collect({ id: 'C1', customerId: 'c1', amount: 20, method: 'cash' });
  w.j.collection({ id: 'C1', amount: 20, method: 'cash' });
  w.shifts.sale('SH1', { method: 'cash', amount: 20, ref: 'C1' });
  assert.equal(rc.balanceAfter, 0); assert.equal(w.credit.balance('c1'), 0);
  assert.equal(w.j.balance('ar'), 0);
  // payment: cash = -60 +40 -20 +20 = -20 in journal; drawer expected = 100 + 40 - 20 + 20 = 140 (minor units)
  assert.equal(w.j.balance('cash'), -20);
  assert.equal(w.shifts.get('SH1').expectedCash, 14000);
  // 7. close the shift with an exact count
  const closed = w.shifts.close('SH1', { by: 'amal', counted: 140 });
  assert.equal(closed.status, 'closed'); assert.equal(closed.closing.variance, 0);
  // cross-checks
  assert.ok(w.j.trialBalance().balanced); assert.ok(w.j.verify().ok);
  assert.equal(w.stock.movements(CODE).length, 4);
});

t('replaying any step is idempotent and does not skew stock or journal', () => {
  const w = world();
  w.stock.append({ kind: 'receive', code: 'X', qty: 5, ref: 'PO-9' });
  assert.throws(() => w.stock.append({ kind: 'receive', code: 'X', qty: 5, ref: 'PO-9' }), { code: 'duplicate-movement' });
  w.j.purchase({ id: 'PO-9', total: 50, paid: 50 }); w.j.purchase({ id: 'PO-9', total: 50, paid: 50 });
  assert.equal(w.stock.onHand('X'), 5); assert.equal(w.j.balance('inventory'), 50); assert.equal(w.j.list().length, 1);
});

t('overselling a collection or a cash variance is caught, not silently absorbed', () => {
  const w = world();
  w.credit.charge({ id: 'S2', customerId: 'c2', amount: 10 });
  assert.throws(() => w.credit.collect({ id: 'C2', customerId: 'c2', amount: 11 }), { code: 'exceeds-balance' });
  w.shifts.open({ id: 'SH2', drawerId: 'D2', cashier: 'amal', float: 50 });
  w.shifts.sale('SH2', { method: 'cash', amount: 10 });
  assert.equal(w.shifts.close('SH2', { by: 'amal', counted: 55 }).status, 'pending-approval');
});
console.log(n + ' tests passed');
