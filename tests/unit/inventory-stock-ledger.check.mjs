import assert from 'node:assert/strict';
import { createStockLedger, verifyMovements } from '../../worker/inventory/stock-ledger.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok', name); };
console.log('inventory stock-ledger checks (INV-01 / INV-02 core)');

const TODAY = new Date('2026-11-11T10:00:00.000Z');
let seq = 0;
const key = () => `idem-key-${++seq}`;
const mk = () => createStockLedger({ now: () => TODAY });
const rcv = (l, o = {}) => l.receive({ idempotencyKey: key(), itemId: 'item1', lotNo: 'L1', expiry: '2027-06-30', qty: 100, unitCostCents: 500, ref: { type: 'grn', id: 'grn_1' }, actor: 'usr_1', ...o });
const sell = (l, qty, o = {}) => l.sell({ idempotencyKey: key(), itemId: 'item1', qty, ref: { type: 'invoice', id: 'inv_1' }, actor: 'usr_1', ...o });
const ok = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r; };
const err = (r, code) => { assert.equal(r.ok, false, `expected ${code}: ${JSON.stringify(r)}`); assert.equal(r.error, code); };

t('receive adds a lot; balances are derived from movements, never stored', () => {
  const l = mk(); ok(rcv(l));
  const b = l.balance('item1');
  assert.equal(b.onHand, 100); assert.equal(b.available, 100); assert.equal(b.expired, 0);
  assert.deepEqual(b.lots.map(x => [x.lotNo, x.onHand, x.expiry]), [['L1', 100, '2027-06-30']]);
  assert.equal(l.movements().length, 1);
  assert.deepEqual(l.balance('nothing'), { onHand: 0, available: 0, expired: 0, lots: [] });
});

t('movements are an append-only, frozen log with no way to edit or delete', () => {
  const l = mk(); ok(rcv(l));
  const m = l.movements();
  assert.throws(() => { m[0].qty = 5; }, TypeError);
  assert.throws(() => m.push({}), TypeError);
  assert.throws(() => { m.length = 0; }, TypeError);
  for (const name of ['update', 'delete', 'remove', 'setBalance', 'setOnHand', 'reset', 'clear']) assert.equal(l[name], undefined, name);
  assert.equal(l.movements().length, 1);
  assert.deepEqual(m[0].seq, 1);
});

t('invalid input is refused with a reason, never defaulted', () => {
  const l = mk();
  err(rcv(l, { qty: 0 }), 'quantity-invalid'); err(rcv(l, { qty: -5 }), 'quantity-invalid'); err(rcv(l, { qty: 1.5 }), 'quantity-invalid');
  err(rcv(l, { qty: '10' }), 'quantity-invalid'); err(rcv(l, { qty: 1e10 }), 'quantity-invalid'); err(rcv(l, { qty: NaN }), 'quantity-invalid');
  err(rcv(l, { itemId: 'a b' }), 'itemId-invalid'); err(rcv(l, { lotNo: '' }), 'lotNo-invalid');
  err(rcv(l, { expiry: '2026-02-31' }), 'expiry-invalid'); err(rcv(l, { expiry: 'soon' }), 'expiry-invalid'); err(rcv(l, { expiry: '2026-13-01' }), 'expiry-invalid');
  err(rcv(l, { expiry: '2026-11-10' }), 'already-expired');
  err(rcv(l, { unitCostCents: -1 }), 'cost-invalid'); err(rcv(l, { unitCostCents: 1.5 }), 'cost-invalid');
  err(rcv(l, { idempotencyKey: 'short' }), 'idempotencyKey-invalid'); err(rcv(l, { idempotencyKey: undefined }), 'idempotencyKey-invalid');
  err(rcv(l, { ref: { type: 'GRN', id: 'x' } }), 'ref-invalid'); err(rcv(l, { actor: '' }), 'actor-invalid');
  assert.equal(l.movements().length, 0, 'nothing was recorded');
});

t('a lot cannot silently change its expiry or cost', () => {
  const l = mk(); ok(rcv(l));
  assert.equal(ok(rcv(l, { qty: 50 })).ok, true);
  assert.equal(l.balance('item1').onHand, 150);
  err(rcv(l, { expiry: '2028-01-01' }), 'lot-conflict');
  err(rcv(l, { unitCostCents: 999 }), 'lot-conflict');
  assert.equal(l.balance('item1').onHand, 150);
});

t('FEFO: the earliest expiry is used first, across lots, all-or-nothing', () => {
  const l = mk();
  ok(rcv(l, { lotNo: 'LATE', expiry: '2028-01-31', qty: 50, unitCostCents: 700 }));
  ok(rcv(l, { lotNo: 'SOON', expiry: '2026-12-31', qty: 30, unitCostCents: 400 }));
  ok(rcv(l, { lotNo: 'MID', expiry: '2027-06-30', qty: 40, unitCostCents: 500 }));
  const r = ok(sell(l, 80));
  assert.deepEqual(r.allocations.map(a => [a.lotNo, a.qty]), [['SOON', 30], ['MID', 40], ['LATE', 10]]);
  assert.equal(r.cogsCents, 30 * 400 + 40 * 500 + 10 * 700);
  assert.deepEqual(l.balance('item1').lots.map(x => [x.lotNo, x.onHand]), [['SOON', 0], ['MID', 0], ['LATE', 40]]);
  assert.equal(l.movements().length, 3 + 3);
});

t('oversell leaves nothing behind and reports what is available', () => {
  const l = mk(); ok(rcv(l, { qty: 10 }));
  const before = l.movements().length;
  const r = sell(l, 11); err(r, 'insufficient-stock'); assert.equal(r.available, 10);
  assert.equal(l.movements().length, before); assert.equal(l.balance('item1').onHand, 10);
  err(sell(l, 0), 'quantity-invalid');
  err(l.sell({ idempotencyKey: key(), itemId: 'ghost', qty: 1, ref: { type: 'invoice', id: 'i' }, actor: 'u' }), 'insufficient-stock');
});

t('the last unit can be sold only once', () => {
  const l = mk(); ok(rcv(l, { qty: 1 }));
  ok(sell(l, 1, { ref: { type: 'invoice', id: 'inv_a' } }));
  err(sell(l, 1, { ref: { type: 'invoice', id: 'inv_b' } }), 'insufficient-stock');
  assert.equal(l.balance('item1').onHand, 0);
});

t('expired stock is never sold; it is reported separately and can only leave through an approved write-off', () => {
  const l = mk(); ok(rcv(l, { lotNo: 'OK', expiry: '2027-01-31', qty: 10 }));
  const old = createStockLedger({ now: () => new Date('2026-06-01T00:00:00Z') });
  ok(old.receive({ idempotencyKey: 'idem-old-0001', itemId: 'item1', lotNo: 'OLD', expiry: '2026-09-30', qty: 5, unitCostCents: 100, ref: { type: 'grn', id: 'g' }, actor: 'u' }));
  // time passes: same ledger object, later clock
  let clock = new Date('2026-06-01T00:00:00Z'); const l2 = createStockLedger({ now: () => clock });
  ok(l2.receive({ idempotencyKey: 'idem-a-0001', itemId: 'item1', lotNo: 'OLD', expiry: '2026-09-30', qty: 5, unitCostCents: 100, ref: { type: 'grn', id: 'g' }, actor: 'u' }));
  ok(l2.receive({ idempotencyKey: 'idem-a-0002', itemId: 'item1', lotNo: 'NEW', expiry: '2027-12-31', qty: 3, unitCostCents: 100, ref: { type: 'grn', id: 'g2' }, actor: 'u' }));
  clock = new Date('2026-10-01T00:00:00Z');
  let b = l2.balance('item1'); assert.equal(b.onHand, 8); assert.equal(b.available, 3); assert.equal(b.expired, 5);
  const s = l2.sell({ idempotencyKey: 'idem-a-0003', itemId: 'item1', qty: 4, ref: { type: 'invoice', id: 'i' }, actor: 'u' }); err(s, 'insufficient-stock'); assert.equal(s.available, 3); assert.equal(s.expiredOnHand, 5);
  assert.equal(ok(l2.sell({ idempotencyKey: 'idem-a-0004', itemId: 'item1', qty: 3, ref: { type: 'invoice', id: 'i2' }, actor: 'u' })).allocations[0].lotNo, 'NEW');
  ok(l2.adjust({ idempotencyKey: 'idem-a-0005', itemId: 'item1', lotNo: 'OLD', delta: -5, reason: 'expired write-off', approvedBy: 'usr_boss', actor: 'usr_2', ref: { type: 'writeoff', id: 'wo_1' } }));
  b = l2.balance('item1'); assert.equal(b.onHand, 0); assert.equal(b.expired, 0);
  assert.equal(l2.expiring(0).length, 0);
});

t('the expiry date itself is still sellable; the day after it is not', () => {
  let clock = new Date('2026-11-11T08:00:00Z'); const l = createStockLedger({ now: () => clock });
  ok(l.receive({ idempotencyKey: 'idem-e-0001', itemId: 'item1', lotNo: 'L', expiry: '2026-11-11', qty: 5, unitCostCents: 1, ref: { type: 'grn', id: 'g' }, actor: 'u' }));
  assert.equal(l.balance('item1').available, 5);
  clock = new Date('2026-11-12T00:00:01Z'); assert.equal(l.balance('item1').available, 0); assert.equal(l.balance('item1').expired, 5);
});

t('returns go back to the same lot, never exceed what the invoice sold, and are capped across repeats', () => {
  const l = mk(); ok(rcv(l, { lotNo: 'A', expiry: '2027-01-31', qty: 10 })); ok(rcv(l, { lotNo: 'B', expiry: '2027-06-30', qty: 10 }));
  ok(sell(l, 14, { ref: { type: 'invoice', id: 'inv_9' } })); // 10 from A, 4 from B
  const ret = (lines, o = {}) => l.returnSale({ idempotencyKey: key(), ref: { type: 'invoice', id: 'inv_9' }, lines, actor: 'usr_1', reason: 'customer return', ...o });
  err(ret([{ itemId: 'item1', lotNo: 'B', qty: 5 }]), 'return-exceeds-sold');
  ok(ret([{ itemId: 'item1', lotNo: 'B', qty: 3 }]));
  err(ret([{ itemId: 'item1', lotNo: 'B', qty: 2 }]), 'return-exceeds-sold'); // 3 + 2 > 4
  ok(ret([{ itemId: 'item1', lotNo: 'B', qty: 1 }, { itemId: 'item1', lotNo: 'A', qty: 10 }]));
  err(ret([{ itemId: 'item1', lotNo: 'A', qty: 1 }]), 'return-exceeds-sold');
  err(l.returnSale({ idempotencyKey: key(), ref: { type: 'invoice', id: 'inv_other' }, lines: [{ itemId: 'item1', lotNo: 'A', qty: 1 }], actor: 'u', reason: 'x return' }), 'return-exceeds-sold');
  err(ret([{ itemId: 'item1', lotNo: 'ZZ', qty: 1 }]), 'return-exceeds-sold');
  err(ret([]), 'lines-empty'); err(ret([{ itemId: 'item1', lotNo: 'A', qty: 0 }]), 'quantity-invalid'); err(ret([{ itemId: 'item1', lotNo: 'A', qty: 1 }], { reason: '' }), 'reason-required');
  assert.equal(l.balance('item1').onHand, 20); assert.equal(l.cogs('inv_9'), 0, 'everything came back: no cost of goods left');
});

t('a failed multi-line return changes nothing (atomic)', () => {
  const l = mk(); ok(rcv(l, { lotNo: 'A', qty: 10 })); ok(sell(l, 5, { ref: { type: 'invoice', id: 'inv_1' } }));
  const before = l.movements().length;
  err(l.returnSale({ idempotencyKey: key(), ref: { type: 'invoice', id: 'inv_1' }, lines: [{ itemId: 'item1', lotNo: 'A', qty: 2 }, { itemId: 'item1', lotNo: 'A', qty: 9 }], actor: 'u', reason: 'bad batch' }), 'return-exceeds-sold');
  assert.equal(l.movements().length, before); assert.equal(l.balance('item1').onHand, 5);
});

t('adjustments need a reason and a different approver, never go below zero, and need an existing lot', () => {
  const l = mk(); ok(rcv(l, { qty: 10 }));
  const adj = (o = {}) => l.adjust({ idempotencyKey: key(), itemId: 'item1', lotNo: 'L1', delta: -2, reason: 'count difference', approvedBy: 'usr_boss', actor: 'usr_1', ref: { type: 'count', id: 'c1' }, ...o });
  ok(adj()); assert.equal(l.balance('item1').onHand, 8);
  err(adj({ reason: '' }), 'reason-required'); err(adj({ reason: 'x' }), 'reason-required');
  err(adj({ approvedBy: undefined }), 'approver-required'); err(adj({ approvedBy: 'usr_1' }), 'approver-required');
  err(adj({ delta: -9 }), 'would-go-negative'); err(adj({ delta: 0 }), 'quantity-invalid'); err(adj({ delta: 1.5 }), 'quantity-invalid');
  err(adj({ lotNo: 'NOPE' }), 'lot-unknown');
  ok(adj({ delta: 4 })); assert.equal(l.balance('item1').onHand, 12);
  assert.equal(l.movements().at(-1).approvedBy, 'usr_boss');
});

t('idempotency: the same key and payload replays the same result once; a different payload is refused; failures do not burn the key', () => {
  const l = mk(); ok(rcv(l, { qty: 10 }));
  const req = { idempotencyKey: 'idem-fixed-01', itemId: 'item1', qty: 4, ref: { type: 'invoice', id: 'inv_x' }, actor: 'usr_1' };
  const a = ok(l.sell(req)); const b = l.sell({ ...req, ref: { id: 'inv_x', type: 'invoice' } });
  assert.equal(b.ok, true); assert.equal(b.replayed, true); assert.deepEqual(b.allocations, a.allocations);
  assert.equal(l.balance('item1').onHand, 6, 'sold once');
  err(l.sell({ ...req, qty: 5 }), 'idempotency-conflict'); err(l.sell({ ...req, ref: { type: 'invoice', id: 'inv_y' } }), 'idempotency-conflict');
  assert.equal(l.balance('item1').onHand, 6);
  const big = { ...req, idempotencyKey: 'idem-fixed-02', qty: 99 };
  err(l.sell(big), 'insufficient-stock'); ok(rcv(l, { qty: 200 })); assert.equal(l.sell(big).ok, true, 'the same key works once the stock exists');
  const r1 = rcv(l, { idempotencyKey: 'idem-rcv-0001', lotNo: 'L9', qty: 7 }); const r2 = rcv(l, { idempotencyKey: 'idem-rcv-0001', lotNo: 'L9', qty: 7 });
  assert.equal(r2.replayed, true); assert.equal(l.balance('item1').lots.find(x => x.lotNo === 'L9').onHand, 7);
  err(rcv(l, { idempotencyKey: 'idem-rcv-0001', lotNo: 'L9', qty: 8 }), 'idempotency-conflict');
});

t('shortages: items below the minimum get a suggested order up to the target; expired stock does not count', () => {
  const l = mk(); ok(rcv(l, { itemId: 'A', qty: 3, lotNo: 'x' })); ok(rcv(l, { itemId: 'B', qty: 50, lotNo: 'y' }));
  const r = l.shortages({ A: { min: 5, target: 20 }, B: { min: 10, target: 40 }, C: { min: 2, target: 6 } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.items, [{ itemId: 'A', available: 3, min: 5, target: 20, suggestedOrder: 17 }, { itemId: 'C', available: 0, min: 2, target: 6, suggestedOrder: 6 }]);
  err(l.shortages({ A: { min: 5, target: 4 } }), 'policy-invalid'); err(l.shortages({ A: { min: -1, target: 4 } }), 'policy-invalid'); err(l.shortages({ 'bad id': { min: 1, target: 2 } }), 'policy-invalid');
  err(l.shortages(null), 'policy-invalid');
});

t('expiring lots are listed for alerts', () => {
  const l = mk(); ok(rcv(l, { lotNo: 'S', expiry: '2026-12-01', qty: 4 })); ok(rcv(l, { lotNo: 'F', expiry: '2027-12-01', qty: 4 }));
  assert.deepEqual(l.expiring(30).map(x => x.lotNo), ['S']); assert.deepEqual(l.expiring(400).map(x => x.lotNo), ['S', 'F']);
  assert.deepEqual(l.expiring(-1), []);
});

t('cost of goods follows the lots that were sold, per invoice, minus returns', () => {
  const l = mk(); ok(rcv(l, { lotNo: 'A', expiry: '2027-01-31', qty: 10, unitCostCents: 100 })); ok(rcv(l, { lotNo: 'B', expiry: '2027-06-30', qty: 10, unitCostCents: 300 }));
  ok(sell(l, 15, { ref: { type: 'invoice', id: 'inv_c' } }));
  assert.equal(l.cogs('inv_c'), 10 * 100 + 5 * 300);
  ok(l.returnSale({ idempotencyKey: key(), ref: { type: 'invoice', id: 'inv_c' }, lines: [{ itemId: 'item1', lotNo: 'B', qty: 2 }], actor: 'u', reason: 'wrong item' }));
  assert.equal(l.cogs('inv_c'), 10 * 100 + 3 * 300); assert.equal(l.cogs('unknown'), 0);
});

t('the invariant checker passes a real history and detects each kind of tampering', () => {
  const l = mk(); ok(rcv(l, { lotNo: 'A', qty: 10 })); ok(sell(l, 4, { ref: { type: 'invoice', id: 'i1' } }));
  ok(l.returnSale({ idempotencyKey: key(), ref: { type: 'invoice', id: 'i1' }, lines: [{ itemId: 'item1', lotNo: 'A', qty: 1 }], actor: 'u', reason: 'return' }));
  assert.deepEqual(l.verify(), { ok: true, movements: 3 });
  const base = l.movements().map(m => JSON.parse(JSON.stringify(m)));
  const check = (mutate, code) => { const c = JSON.parse(JSON.stringify(base)); mutate(c); const v = verifyMovements(c); assert.equal(v.ok, false, code); assert.ok(v.errors.some(e => e.includes(code)), `${code} in ${v.errors}`); };
  check(c => { c[1].qty = -20; }, 'negative-lot');
  check(c => { c.splice(0, 1); }, 'seq-gap');
  check(c => { c[2].qty = 9; }, 'return-exceeds-sold');
  check(c => { c[0].qty = -10; }, 'bad-sign');
  check(c => { c[1].qty = 4; }, 'bad-sign');
  check(c => { c[0].expiry = '2030-01-01'; }, 'lot-conflict'); // a later movement of the same lot disagrees
  check(c => { c.push({ ...c[0], seq: 4, expiry: '2030-01-01' }); }, 'lot-conflict');
  check(c => { c[1].unitCostCents = 1; }, 'cost-mismatch');
  assert.equal(verifyMovements('x').ok, false); assert.equal(verifyMovements([null]).ok, false);
});

t('a long mixed history keeps every invariant (1000 operations)', () => {
  const l = mk(); let s = 12345; const rnd = m => (s = (s * 1103515245 + 12345) % 2147483648) % m;
  for (let i = 0; i < 8; i++) ok(rcv(l, { itemId: `it${i % 3}`, lotNo: `L${i}`, expiry: `2027-0${1 + (i % 9)}-15`, qty: 500, unitCostCents: 100 + i }));
  const invoices = [];
  for (let i = 0; i < 1000; i++) {
    const item = `it${rnd(3)}`;
    if (rnd(4) === 0 && invoices.length) { const inv = invoices[rnd(invoices.length)]; l.returnSale({ idempotencyKey: `idem-ret-${i}-xx`, ref: { type: 'invoice', id: inv.id }, lines: [{ itemId: inv.item, lotNo: inv.lot, qty: 1 }], actor: 'u', reason: 'return' }); }
    else { const r = l.sell({ idempotencyKey: `idem-sel-${i}-xx`, itemId: item, qty: 1 + rnd(5), ref: { type: 'invoice', id: `inv_${i}` }, actor: 'u' }); if (r.ok) invoices.push({ id: `inv_${i}`, item, lot: r.allocations[0].lotNo }); }
  }
  const v = l.verify(); assert.equal(v.ok, true, JSON.stringify(v));
  for (const it of ['it0', 'it1', 'it2']) assert.ok(l.balance(it).onHand >= 0);
});

t('sale quantity must be a whole positive number: fractions, text, negatives, NaN and huge values are refused', () => {
  const l = mk(); ok(rcv(l, { qty: 100 }));
  for (const q of [1.5, 0.5, '5', -1, NaN, Infinity, 1e10, null, undefined, [], {}]) err(sell(l, q), 'quantity-invalid');
  assert.equal(l.balance('item1').onHand, 100); assert.equal(l.movements().length, 1);
});

t('shortages ignore expired stock: an item that only looks stocked because of expired lots is a shortage', () => {
  let clock = new Date('2026-06-01T00:00:00Z'); const l = createStockLedger({ now: () => clock });
  ok(l.receive({ idempotencyKey: 'idem-x-0001', itemId: 'X', lotNo: 'OLD', expiry: '2026-09-30', qty: 100, unitCostCents: 1, ref: { type: 'grn', id: 'g' }, actor: 'u' }));
  ok(l.receive({ idempotencyKey: 'idem-x-0002', itemId: 'X', lotNo: 'NEW', expiry: '2027-09-30', qty: 3, unitCostCents: 1, ref: { type: 'grn', id: 'g' }, actor: 'u' }));
  assert.deepEqual(l.shortages({ X: { min: 10, target: 50 } }).items, []);   // 103 usable today
  clock = new Date('2026-10-15T00:00:00Z');
  assert.deepEqual(l.shortages({ X: { min: 10, target: 50 } }).items, [{ itemId: 'X', available: 3, min: 10, target: 50, suggestedOrder: 47 }]);
});

console.log(`PASS inventory stock-ledger checks (INV-01 / INV-02 core): ${n} cases`);
