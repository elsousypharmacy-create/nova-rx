// BUY-05: three-way match PO / goods received / supplier invoice. Pure, integers only (base units, cents).
import assert from 'node:assert/strict';
import { matchInvoice } from '../../worker/procurement/invoice-match.js';

let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const po = { poRef: 'PO-1', lines: [{ productId: 'A', orderedBase: 100, lineTotalCents: 10000 }, { productId: 'B', orderedBase: 50, lineTotalCents: 5000 }] };
const rec = [{ productId: 'A', qtyBase: 100 }, { productId: 'B', qtyBase: 50 }];
const inv = { number: 'INV-9', declaredTotalCents: 15000, lines: [{ productId: 'A', qtyBase: 100, lineTotalCents: 10000 }, { productId: 'B', qtyBase: 50, lineTotalCents: 5000 }] };
const codes = r => r.lines.flatMap(l => l.issues).concat(r.issues).sort();

t('exact match: approve, no issues', () => {
  const r = matchInvoice({ po, receipts: rec, invoice: inv });
  assert.equal(r.ok, true); assert.equal(r.verdict, 'approve'); assert.deepEqual(codes(r), []); assert.equal(r.invoiceTotalCents, 15000);
});
t('invoiced more than received: hold, with the quantity gap', () => {
  const r = matchInvoice({ po, receipts: [{ productId: 'A', qtyBase: 90 }, { productId: 'B', qtyBase: 50 }], invoice: inv });
  assert.equal(r.verdict, 'hold'); const a = r.lines.find(l => l.productId === 'A');
  assert.deepEqual(a.issues, ['invoiced-more-than-received']); assert.equal(a.qtyGapBase, 10);
});
t('received but not invoiced is reported, never silently approved', () => {
  const r = matchInvoice({ po, receipts: rec, invoice: { ...inv, declaredTotalCents: 10000, lines: [inv.lines[0]] } });
  assert.equal(r.verdict, 'hold'); assert.deepEqual(r.lines.find(l => l.productId === 'B').issues, ['received-not-invoiced']);
});
t('product not on the PO: reject', () => {
  const r = matchInvoice({ po, receipts: rec, invoice: { ...inv, declaredTotalCents: 15500, lines: [...inv.lines, { productId: 'Z', qtyBase: 1, lineTotalCents: 500 }] } });
  assert.equal(r.verdict, 'reject'); assert.ok(r.lines.find(l => l.productId === 'Z').issues.includes('not-on-po'));
});
t('price variance is exact: pro-rated PO price for the invoiced quantity, tolerance in cents and basis points', () => {
  const dear = { ...inv, declaredTotalCents: 15100, lines: [{ productId: 'A', qtyBase: 100, lineTotalCents: 10100 }, inv.lines[1]] };
  const r = matchInvoice({ po, receipts: rec, invoice: dear });
  const a = r.lines.find(l => l.productId === 'A'); assert.deepEqual(a.issues, ['price-variance']); assert.equal(a.varianceCents, 100); assert.equal(r.verdict, 'hold');
  assert.equal(matchInvoice({ po, receipts: rec, invoice: dear, tolerance: { cents: 100 } }).verdict, 'approve');
  assert.equal(matchInvoice({ po, receipts: rec, invoice: dear, tolerance: { bps: 100 } }).verdict, 'approve');
  assert.equal(matchInvoice({ po, receipts: rec, invoice: dear, tolerance: { bps: 99 } }).verdict, 'hold');
  const part = matchInvoice({ po, receipts: [{ productId: 'A', qtyBase: 40 }], invoice: { number: 'I2', declaredTotalCents: 4000, lines: [{ productId: 'A', qtyBase: 40, lineTotalCents: 4000 }] } });
  assert.equal(part.verdict, 'approve', 'partial delivery invoiced pro rata matches: 40/100 of 10000 = 4000');
  const odd = matchInvoice({ po: { poRef: 'P', lines: [{ productId: 'A', orderedBase: 3, lineTotalCents: 1000 }] }, receipts: [{ productId: 'A', qtyBase: 1 }], invoice: { number: 'I3', declaredTotalCents: 333, lines: [{ productId: 'A', qtyBase: 1, lineTotalCents: 333 }] } });
  assert.equal(odd.verdict, 'approve', '1000/3 = 333.33 rounds half up to 333 and matches');
});
t('rounding is half up on the pro-rated PO price (2 of 3 at 1000 = 666.67 -> 667) and a cheaper invoice is also a variance', () => {
  const p3 = { poRef: 'P', lines: [{ productId: 'A', orderedBase: 3, lineTotalCents: 1000 }] };
  const mk = c => matchInvoice({ po: p3, receipts: [{ productId: 'A', qtyBase: 2 }], invoice: { number: 'I', declaredTotalCents: c, lines: [{ productId: 'A', qtyBase: 2, lineTotalCents: c }] } });
  assert.equal(mk(667).verdict, 'approve'); assert.equal(mk(666).verdict, 'hold'); assert.equal(mk(666).lines[0].varianceCents, -1);
  assert.deepEqual(mk(600).lines[0].issues, ['price-variance'], 'underpriced invoice flagged too');
});
t('invoiced less than received: hold with the gap (the rest is still owed or unbilled)', () => {
  const r = matchInvoice({ po, receipts: rec, invoice: { number: 'I', declaredTotalCents: 14000, lines: [{ productId: 'A', qtyBase: 90, lineTotalCents: 9000 }, inv.lines[1]] } });
  const a = r.lines.find(l => l.productId === 'A'); assert.ok(a.issues.includes('received-not-fully-invoiced')); assert.equal(a.qtyGapBase, 10); assert.equal(r.verdict, 'hold');
});
t('declared total must equal the sum of the lines', () => {
  const r = matchInvoice({ po, receipts: rec, invoice: { ...inv, declaredTotalCents: 14999 } });
  assert.equal(r.verdict, 'hold'); assert.ok(r.issues.includes('total-mismatch'));
});
t('a repeated invoice number is a duplicate: reject', () => {
  const r = matchInvoice({ po, receipts: rec, invoice: inv, knownInvoiceNumbers: ['Inv-9 '] });
  assert.equal(r.verdict, 'reject'); assert.ok(r.issues.includes('duplicate-invoice'));
});
t('lines of the same product are merged before comparing (receipts and invoice)', () => {
  const r = matchInvoice({ po, receipts: [{ productId: 'A', qtyBase: 60 }, { productId: 'A', qtyBase: 40 }, rec[1]], invoice: { ...inv, lines: [{ productId: 'A', qtyBase: 50, lineTotalCents: 5000 }, { productId: 'A', qtyBase: 50, lineTotalCents: 5000 }, inv.lines[1]] } });
  assert.equal(r.verdict, 'approve');
});
t('invalid input is refused with a typed error, never coerced', () => {
  const bad = [
    { po, receipts: rec, invoice: { ...inv, lines: [{ productId: 'A', qtyBase: 1.5, lineTotalCents: 10 }] } },
    { po, receipts: rec, invoice: { ...inv, lines: [{ productId: 'A', qtyBase: 1, lineTotalCents: -1 }] } },
    { po, receipts: [{ productId: 'A', qtyBase: '5' }], invoice: inv },
    { po, receipts: rec, invoice: { ...inv, number: '' } },
    { po: { poRef: 'P', lines: [] }, receipts: rec, invoice: inv },
    { po, receipts: rec, invoice: { ...inv, declaredTotalCents: 1e20 } },
    { po, receipts: rec, invoice: inv, tolerance: { bps: -1 } },
    { po, receipts: null, invoice: inv },
  ];
  for (const b of bad) { const r = matchInvoice(b); assert.equal(r.ok, false, JSON.stringify(b).slice(0, 80)); assert.equal(typeof r.error, 'string'); }
});
t('the result never releases payment and is frozen', () => {
  const r = matchInvoice({ po, receipts: rec, invoice: inv });
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.lines)); assert.equal('pay' in r, false); assert.equal(r.paymentReleased, false);
});
console.log(`${n} passed`);
