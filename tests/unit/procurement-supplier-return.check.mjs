// BUY-05: supplier return (credit note) against received lots. Pure, integers only.
import assert from 'node:assert/strict';
import { planSupplierReturn, matchCreditNote } from '../../worker/procurement/supplier-return.js';

let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const lots = [
  { productId: 'A', lot: 'L1', expiry: '2026-01-31', receivedBase: 100, onHandBase: 60, lineCostCents: 10000 },
  { productId: 'A', lot: 'L2', expiry: '2027-06-30', receivedBase: 50, onHandBase: 50, lineCostCents: 6000 },
];
const today = '2026-11-12';
const ask = (over = {}) => ({ supplierRef: 'S1', reason: 'expired stock', lines: [{ productId: 'A', lot: 'L1', qtyBase: 20 }], ...over });

t('returns a part of one lot: credit is the pro-rated received cost (20/100 of 10000)', () => {
  const r = planSupplierReturn({ lots, request: ask(), today });
  assert.equal(r.ok, true); assert.equal(r.expectedCreditCents, 2000); assert.equal(r.lines[0].expired, true); assert.equal(r.status, 'ready');
});
t('rounding is half up (1 of 3 at 1000 = 333; 2 of 3 = 667)', () => {
  const l = [{ productId: 'A', lot: 'X', expiry: '2027-01-01', receivedBase: 3, onHandBase: 3, lineCostCents: 1000 }];
  assert.equal(planSupplierReturn({ lots: l, request: ask({ lines: [{ productId: 'A', lot: 'X', qtyBase: 1 }] }), today }).expectedCreditCents, 333);
  assert.equal(planSupplierReturn({ lots: l, request: ask({ lines: [{ productId: 'A', lot: 'X', qtyBase: 2 }] }), today }).expectedCreditCents, 667);
});
t('cannot return more than is on hand in that lot', () => {
  const r = planSupplierReturn({ lots, request: ask({ lines: [{ productId: 'A', lot: 'L1', qtyBase: 61 }] }), today });
  assert.equal(r.ok, false); assert.equal(r.error, 'return-exceeds-on-hand'); assert.equal(r.detail.onHandBase, 60);
});
t('the same lot on two lines is summed before the check', () => {
  const r = planSupplierReturn({ lots, request: ask({ lines: [{ productId: 'A', lot: 'L1', qtyBase: 40 }, { productId: 'A', lot: 'L1', qtyBase: 30 }] }), today });
  assert.equal(r.error, 'return-exceeds-on-hand');
});
t('unknown lot, missing reason, empty request are refused', () => {
  assert.equal(planSupplierReturn({ lots, request: ask({ lines: [{ productId: 'A', lot: 'NOPE', qtyBase: 1 }] }), today }).error, 'lot-not-found');
  assert.equal(planSupplierReturn({ lots, request: ask({ reason: '  ' }), today }).error, 'reason-required');
  assert.equal(planSupplierReturn({ lots, request: ask({ lines: [] }), today }).error, 'request-invalid');
});
t('a lot that was never costed cannot produce an expected credit: needs-cost, not zero', () => {
  const l = [{ productId: 'A', lot: 'L1', expiry: '2027-01-01', receivedBase: 100, onHandBase: 100, lineCostCents: null }];
  const r = planSupplierReturn({ lots: l, request: ask(), today });
  assert.equal(r.ok, true); assert.equal(r.status, 'needs-cost'); assert.equal(r.expectedCreditCents, null);
});
t('non-expired stock is flagged: returning good stock needs the supplier to agree', () => {
  const r = planSupplierReturn({ lots, request: ask({ lines: [{ productId: 'A', lot: 'L2', qtyBase: 5 }] }), today });
  assert.equal(r.lines[0].expired, false); assert.ok(r.warnings.includes('not-expired:A:L2'));
});
t('invalid numbers and dates are refused, never coerced', () => {
  for (const bad of [1.5, 0, -1, '5', 1e12]) assert.equal(planSupplierReturn({ lots, request: ask({ lines: [{ productId: 'A', lot: 'L1', qtyBase: bad }] }), today }).ok, false, String(bad));
  assert.equal(planSupplierReturn({ lots, request: ask(), today: '2026-13-01' }).ok, false);
  assert.equal(planSupplierReturn({ lots: [{ ...lots[0], expiry: 'soon' }], request: ask(), today }).ok, false);
});
t('credit note: exact, short, over, and duplicate numbers', () => {
  const plan = planSupplierReturn({ lots, request: ask(), today });
  const note = c => ({ number: 'CN-1', totalCents: c });
  assert.equal(matchCreditNote({ plan, note: note(2000) }).verdict, 'approve');
  const short = matchCreditNote({ plan, note: note(1500) }); assert.equal(short.verdict, 'hold'); assert.equal(short.differenceCents, -500); assert.deepEqual(short.issues, ['credit-short']);
  const over = matchCreditNote({ plan, note: note(2500) }); assert.deepEqual(over.issues, ['credit-over']); assert.equal(over.verdict, 'hold');
  assert.equal(matchCreditNote({ plan, note: note(2000), knownCreditNotes: ['Cn-1 '] }).verdict, 'reject');
  assert.equal(matchCreditNote({ plan, note: note(2000), tolerance: { cents: 0 } }).verdict, 'approve');
  assert.equal(matchCreditNote({ plan, note: note(1990), tolerance: { cents: 10 } }).verdict, 'approve');
  assert.equal(matchCreditNote({ plan, note: note(1989), tolerance: { cents: 10 } }).verdict, 'hold');
});
t('a plan that needs cost cannot be approved automatically', () => {
  const l = [{ productId: 'A', lot: 'L1', expiry: '2027-01-01', receivedBase: 100, onHandBase: 100, lineCostCents: null }];
  const plan = planSupplierReturn({ lots: l, request: ask(), today });
  const r = matchCreditNote({ plan, note: { number: 'CN-2', totalCents: 500 } });
  assert.equal(r.verdict, 'hold'); assert.deepEqual(r.issues, ['plan-needs-cost']);
});
t('credit note matching never books money and refuses a non-plan', () => {
  const plan = planSupplierReturn({ lots, request: ask(), today });
  const r = matchCreditNote({ plan, note: { number: 'CN-1', totalCents: 2000 } });
  assert.equal(r.creditBooked, false); assert.ok(Object.isFrozen(r));
  assert.equal(matchCreditNote({ plan: { ok: false }, note: { number: 'x', totalCents: 1 } }).ok, false);
  assert.equal(matchCreditNote({ plan, note: { number: '', totalCents: 1 } }).ok, false);
});
t('a lot with more on hand than was ever received is corrupt data: refused', () => {
  assert.equal(planSupplierReturn({ lots: [{ ...lots[0], onHandBase: 101 }], request: ask(), today }).error, 'lot-invalid');
});
console.log(`${n} passed`);
