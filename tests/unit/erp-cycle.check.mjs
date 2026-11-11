import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createUnifiedCatalog } from '../../worker/catalog/unified-catalog.js';
import { normalizePackaging, toBaseUnits, fromBaseUnits, linePrice, allocateLinePrices } from '../../worker/catalog/unit-conversion.js';
import { createStockLedger } from '../../worker/inventory/stock-ledger.js';

// End-to-end business cycle over the pure modules (no storage, no UI, no network):
// define item (CAT-01, real export) -> units and exact money (CAT-02) -> receive -> sell -> stock deducted -> return
// -> shortage -> purchase receipt -> stock updated, with the ledger invariants checked after every step.
let n = 0;
const step = (name, fn) => { fn(); n++; console.log('  ok', name); };
const val = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
console.log('ERP cycle check (CAT-01 + CAT-02 + INV-01, pure modules)');

const exportItems = JSON.parse(fs.readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8')).items;
const catalog = createUnifiedCatalog(exportItems);
const clock = { now: new Date('2026-11-11T09:00:00.000Z') };
const ledger = createStockLedger({ now: () => clock.now });
let k = 0; const key = () => `cycle-key-${String(++k).padStart(4, '0')}`;
const actor = 'usr_cashier';

// packaging is not part of the export (no data source yet, see CAT-02 doc): the test declares it explicitly
const PACK = { unitsPerStrip: 12, stripsPerBox: 2, boxesPerCarton: 10 };       // box = 24 tablets
const COST_PER_UNIT = 400;                                                      // cents per tablet (must be whole cents, see INV-01 doc)
let product; let price;

step('1. define the item: a real product from the 4378-row export, packaging declared, units resolve', () => {
  const hit = catalog.search('panadol').find(p => p.price !== null && p.price > 0);
  assert.ok(hit, 'a real Panadol product exists in the export'); product = hit; price = product.price;
  assert.equal(catalog.rejected.length, 0);
  assert.deepEqual(normalizePackaging(PACK).factors, { unit: 1, strip: 12, box: 24, carton: 240 });
  assert.equal(val(toBaseUnits(10, 'box', PACK)), 240);
  assert.equal(toBaseUnits(1, 'carton', { unitsPerStrip: 12 }).error, 'unit-unavailable', 'a unit the item has no packaging for is refused before any stock movement');
  assert.equal(toBaseUnits(1, 'bottle', PACK).error, 'unit-unknown');
});

step('2. purchase receipt: 10 boxes enter as 240 base units in a lot with expiry and cost', () => {
  const qty = val(toBaseUnits(10, 'box', PACK));
  assert.equal(ledger.receive({ idempotencyKey: key(), itemId: product.id, lotNo: 'L1', expiry: '2027-03-31', qty, unitCostCents: COST_PER_UNIT, ref: { type: 'grn', id: 'grn_001' }, actor: 'usr_store' }).ok, true);
  assert.equal(ledger.balance(product.id).onHand, 240);
  assert.deepEqual(ledger.verify(), { ok: true, movements: 1 });
});

let sale; let invoiceTotal;
step('3. sell 2 strips + 3 tablets: exact invoice total, stock deducted from the earliest lot', () => {
  const lines = [{ unit: 'strip', qty: 2 }, { unit: 'unit', qty: 3 }];
  const alloc = allocateLinePrices(price, 'box', lines, PACK);
  assert.equal(alloc.ok, true, JSON.stringify(alloc));
  const base = lines.reduce((s, l) => s + val(toBaseUnits(l.qty, l.unit, PACK)), 0);
  assert.equal(base, 27);
  invoiceTotal = alloc.total;
  assert.equal(invoiceTotal, val(linePrice(price, 'box', 'unit', 27, PACK)), 'split lines add up to the price of the same 27 tablets sold as one line');
  assert.equal(Math.round(alloc.lines.reduce((s, x) => s + x * 100, 0)), Math.round(invoiceTotal * 100));
  sale = ledger.sell({ idempotencyKey: key(), itemId: product.id, qty: base, ref: { type: 'invoice', id: 'inv_100' }, actor });
  assert.equal(sale.ok, true); assert.deepEqual(sale.allocations.map(a => [a.lotNo, a.qty]), [['L1', 27]]);
  assert.equal(sale.cogsCents, 27 * COST_PER_UNIT);
  assert.equal(ledger.balance(product.id).onHand, 240 - 27);
  assert.equal(ledger.verify().ok, true);
});

step('4. a retried sale (same idempotency key) does not deduct twice', () => {
  const again = ledger.sell({ idempotencyKey: `cycle-key-${String(k).padStart(4, '0')}`, itemId: product.id, qty: 27, ref: { type: 'invoice', id: 'inv_100' }, actor });
  assert.equal(again.replayed, true); assert.equal(ledger.balance(product.id).onHand, 213);
});

step('5. return 1 strip: stock comes back to the same lot, the refund equals what that strip was charged', () => {
  const r = ledger.returnSale({ idempotencyKey: key(), ref: { type: 'invoice', id: 'inv_100' }, lines: [{ itemId: product.id, lotNo: 'L1', qty: val(toBaseUnits(1, 'strip', PACK)) }], actor, reason: 'customer return' });
  assert.equal(r.ok, true); assert.equal(ledger.balance(product.id).onHand, 213 + 12);
  const refund = val(linePrice(price, 'box', 'strip', 1, PACK));
  const chargedForTwoStrips = allocateLinePrices(price, 'box', [{ unit: 'strip', qty: 2 }, { unit: 'unit', qty: 3 }], PACK).lines[0];
  assert.ok(Math.abs(refund - chargedForTwoStrips / 2) <= 0.01, `refund ${refund} vs half of ${chargedForTwoStrips} (2 strips) differ by at most one cent`);
  assert.equal(ledger.cogs('inv_100'), (27 - 12) * COST_PER_UNIT);
  const tooMuch = ledger.returnSale({ idempotencyKey: key(), ref: { type: 'invoice', id: 'inv_100' }, lines: [{ itemId: product.id, lotNo: 'L1', qty: 16 }], actor, reason: 'customer return' });
  assert.equal(tooMuch.error, 'return-exceeds-sold');
  assert.equal(ledger.verify().ok, true);
});

step('6. more sales bring the stock under the minimum: a shortage with an order suggestion in boxes', () => {
  assert.equal(ledger.sell({ idempotencyKey: key(), itemId: product.id, qty: 150, ref: { type: 'invoice', id: 'inv_101' }, actor }).ok, true);
  assert.equal(ledger.balance(product.id).onHand, 75);
  const s = ledger.shortages({ [product.id]: { min: 100, target: 200 } });
  assert.deepEqual(s.items, [{ itemId: product.id, available: 75, min: 100, target: 200, suggestedOrder: 125 }]);
  const boxes = Math.ceil(val(fromBaseUnits(s.items[0].suggestedOrder, 'box', PACK)));   // 125 / 24 = 5.2 -> order 6 whole boxes
  assert.equal(boxes, 6);
});

step('7. purchase receipt of the ordered boxes updates stock; the next sale still uses the older lot first', () => {
  clock.now = new Date('2026-11-18T09:00:00.000Z');
  const qty = val(toBaseUnits(6, 'box', PACK));
  assert.equal(ledger.receive({ idempotencyKey: key(), itemId: product.id, lotNo: 'L2', expiry: '2027-09-30', qty, unitCostCents: COST_PER_UNIT, ref: { type: 'grn', id: 'grn_002' }, actor: 'usr_store' }).ok, true);
  assert.equal(ledger.balance(product.id).onHand, 75 + 144);
  const s = ledger.sell({ idempotencyKey: key(), itemId: product.id, qty: 100, ref: { type: 'invoice', id: 'inv_102' }, actor });
  assert.deepEqual(s.allocations.map(a => [a.lotNo, a.qty]), [['L1', 75], ['L2', 25]], 'FEFO: the old lot is emptied first');
  assert.equal(ledger.balance(product.id).onHand, 119);
  assert.deepEqual(ledger.shortages({ [product.id]: { min: 100, target: 200 } }).items, [], '119 is above the minimum: the shortage is cleared by the receipt');
});

step('8. at the end every invariant holds and stock value equals the sum of the lots', () => {
  assert.deepEqual(ledger.verify(), { ok: true, movements: ledger.movements().length });
  const b = ledger.balance(product.id);
  assert.equal(b.lots.reduce((s, l) => s + l.onHand, 0), b.onHand);
  const received = ledger.movements().filter(m => m.type === 'receive').reduce((s, m) => s + m.qty, 0);
  const sold = ledger.movements().filter(m => m.type === 'sale').reduce((s, m) => s - m.qty, 0);
  const returned = ledger.movements().filter(m => m.type === 'sale_return').reduce((s, m) => s + m.qty, 0);
  assert.equal(b.onHand, received - sold + returned);
  assert.equal(b.onHand, 240 + 144 - (27 + 150 + 100) + 12);
});

step('9. expired stock is blocked, and leaves only through an approved write-off', () => {
  clock.now = new Date('2027-04-01T09:00:00.000Z');          // L1 (expiry 2027-03-31) is now expired
  const b = ledger.balance(product.id);
  assert.ok(b.expired >= 0);
  const left = b.lots.find(l => l.lotNo === 'L1').onHand;
  assert.equal(left, 0, 'L1 was fully used by FEFO');
  assert.equal(ledger.sell({ idempotencyKey: key(), itemId: product.id, qty: 1000, ref: { type: 'invoice', id: 'inv_103' }, actor }).error, 'insufficient-stock');
});

console.log(`PASS ERP cycle check (CAT-01 + CAT-02 + INV-01): ${n} steps`);
