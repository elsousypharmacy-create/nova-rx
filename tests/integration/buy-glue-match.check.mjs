// Glue: supplier invoice vs PO + what the stock core really received; supplier credit note vs what the core credited on a return.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createStockCore } from '../../worker/inventory/stock-core.js';
import { matchInvoiceForPo, matchCreditNoteForReturn } from '../../worker/inventory/glue.js';

const NOW = new Date('2026-11-12T10:00:00Z');
const day = k => new Date(NOW.getTime() + k * 864e5).toISOString().slice(0, 10);
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };
const B1 = { tenantId: 'T', branchId: 'b1' }, B2 = { tenantId: 'T', branchId: 'b2' };
const fresh = async () => {
  const db = new DatabaseSync(':memory:'); const core = createStockCore(db, { now: () => NOW }); core.install();
  core.registerPurchaseOrder(B1, { poRef: 'PO-1', lines: [{ productId: 'A', orderedBase: 100 }, { productId: 'B', orderedBase: 50 }] });
  return { db, core };
};
const prices = { A: 10000, B: 5000 };
const inv = (lines, total) => ({ number: 'INV-9', declaredTotalCents: total, lines });

console.log('BUY glue checks');
await t('goods received through the core, invoice for exactly that: approve', async () => {
  const { core } = await fresh();
  await core.receiveGoods(B1, { key: 'r1', poRef: 'PO-1', lines: [{ productId: 'A', lot: 'L1', expiry: day(300), qtyBase: 100, costCents: 10000 }, { productId: 'B', lot: 'M1', expiry: day(300), qtyBase: 50, costCents: 5000 }] });
  const r = matchInvoiceForPo(core, B1, { poRef: 'PO-1', prices, invoice: inv([{ productId: 'A', qtyBase: 100, lineTotalCents: 10000 }, { productId: 'B', qtyBase: 50, lineTotalCents: 5000 }], 15000) });
  assert.equal(r.ok, true); assert.equal(r.verdict, 'approve');
});
await t('partial delivery: only what arrived can be billed; billing the whole order is held', async () => {
  const { core } = await fresh();
  await core.receiveGoods(B1, { key: 'r1', poRef: 'PO-1', lines: [{ productId: 'A', lot: 'L1', expiry: day(300), qtyBase: 40, costCents: 4000 }] });
  const full = matchInvoiceForPo(core, B1, { poRef: 'PO-1', prices, invoice: inv([{ productId: 'A', qtyBase: 100, lineTotalCents: 10000 }], 10000) });
  assert.equal(full.verdict, 'hold'); assert.deepEqual(full.lines.find(l => l.productId === 'A').issues, ['invoiced-more-than-received']);
  const part = matchInvoiceForPo(core, B1, { poRef: 'PO-1', prices, invoice: inv([{ productId: 'A', qtyBase: 40, lineTotalCents: 4000 }], 4000) });
  assert.equal(part.verdict, 'approve');
});
await t('PO of another branch or an unknown PO is not found (never matched against foreign data)', async () => {
  const { core } = await fresh();
  const x = matchInvoiceForPo(core, B2, { poRef: 'PO-1', prices, invoice: inv([], 0) }); assert.equal(x.ok, false); assert.equal(x.error, 'po-not-found');
  assert.equal(matchInvoiceForPo(core, B1, { poRef: 'NOPE', prices, invoice: inv([], 0) }).error, 'po-not-found');
});
await t('without prices only quantities and totals are checked; with a wrong price it is held', async () => {
  const { core } = await fresh();
  await core.receiveGoods(B1, { key: 'r1', poRef: 'PO-1', lines: [{ productId: 'A', lot: 'L1', expiry: day(300), qtyBase: 100, costCents: 10000 }] });
  const line = c => inv([{ productId: 'A', qtyBase: 100, lineTotalCents: c }], c);
  assert.equal(matchInvoiceForPo(core, B1, { poRef: 'PO-1', invoice: line(12345) }).verdict, 'approve');
  assert.equal(matchInvoiceForPo(core, B1, { poRef: 'PO-1', prices, invoice: line(12345) }).verdict, 'hold');
});
await t('a repeated invoice number is rejected through the glue', async () => {
  const { core } = await fresh();
  await core.receiveGoods(B1, { key: 'r1', poRef: 'PO-1', lines: [{ productId: 'A', lot: 'L1', expiry: day(300), qtyBase: 100, costCents: 10000 }] });
  const r = matchInvoiceForPo(core, B1, { poRef: 'PO-1', prices, invoice: inv([{ productId: 'A', qtyBase: 100, lineTotalCents: 10000 }], 10000), knownInvoiceNumbers: ['inv-9'] });
  assert.equal(r.verdict, 'reject');
});
await t('credit note: the core credit is authoritative, cumulative returns match their own notes', async () => {
  const { core } = await fresh();
  await core.receiveGoods(B1, { key: 'r1', poRef: 'PO-1', lines: [{ productId: 'A', lot: 'L1', expiry: day(-5), qtyBase: 3, costCents: 1000 }] });
  const ret = i => core.returnToSupplier(B1, { key: `sr${i}`, supplierRef: 'S1', reason: 'expired stock', actor: 'ali', approvedBy: 'mona', lines: [{ productId: 'A', lot: 'L1', qtyBase: 1 }] });
  const r1 = await ret(1), r2 = await ret(2);
  assert.deepEqual([r1.creditCents, r2.creditCents], [333, 334]);
  assert.equal(matchCreditNoteForReturn(r2, { number: 'CN-2', totalCents: 334 }).verdict, 'approve');
  assert.equal(matchCreditNoteForReturn(r2, { number: 'CN-2', totalCents: 333 }).verdict, 'hold', 'a note computed without the cumulative rule is short by one cent and is held');
  assert.deepEqual(matchCreditNoteForReturn(r2, { number: 'CN-2', totalCents: 333 }).issues, ['credit-short']);
  assert.equal(matchCreditNoteForReturn(r2, { number: 'CN-2', totalCents: 334 }, { knownCreditNotes: ['cn-2'] }).verdict, 'reject');
});
await t('a return without cost cannot be auto-approved; a replayed or malformed return result is refused', async () => {
  const { core } = await fresh();
  await core.receiveGoods(B1, { key: 'r1', poRef: 'PO-1', lines: [{ productId: 'A', lot: 'L1', expiry: day(-5), qtyBase: 3, costCents: 0 }] });
  const r = await core.returnToSupplier(B1, { key: 'sr1', supplierRef: 'S1', reason: 'expired stock', actor: 'ali', approvedBy: 'mona', lines: [{ productId: 'A', lot: 'L1', qtyBase: 1 }] });
  assert.equal(r.creditCents, null);
  assert.deepEqual(matchCreditNoteForReturn(r, { number: 'CN-1', totalCents: 100 }).issues, ['plan-needs-cost']);
  assert.equal(matchCreditNoteForReturn(null, { number: 'x', totalCents: 1 }).ok, false);
  assert.equal(matchCreditNoteForReturn({ returnKey: 'k' }, { number: 'x', totalCents: 1 }).ok, false);
  assert.equal(matchCreditNoteForReturn({ creditCents: 100 }, { number: 'x', totalCents: 100 }).ok, false, 'a bare number is not a return result');
  assert.equal(matchCreditNoteForReturn({ returnKey: 'k', creditCents: 1.5 }, { number: 'x', totalCents: 1 }).ok, false);
});
console.log(`PASS buy glue: ${n} cases`);
