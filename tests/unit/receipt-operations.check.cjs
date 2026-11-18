const assert = require('node:assert/strict');
const Ops = require('../../receipt-operations.js');
const PO = require('../../purchase-orders.js');
const Ledger = require('../../stock-ledger.js');
const NOW = '2026-11-18T12:00:00Z';
function memory() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
}
function fixture(linked = true) {
  const storage = memory();
  const ledger = Ledger.createLedger(storage, undefined, () => NOW);
  const store = PO.createStore(storage, ledger, undefined, () => NOW);
  const po = store.create({ supplier: 'Test', lines: [{ code: 'A', qty: 10, cost: 5 }] });
  store.send(po.id, { confirmed: true });
  const line = { code: 'A', key: 'A', name: 'Test A', lot: 'LOT', expiry: '2030-12-31', qty: 4, cost: 5 };
  if (linked) store.receive(po.id, { ref: 'INV', lines: [line] }, { confirmed: true });
  const receipt = { id: 'R1', invoice: 'INV', poId: linked ? po.id : null, supplier: 'Test', at: NOW, pending: false, lines: [line] };
  storage.setItem(Ops.KEYS.receipts, JSON.stringify([receipt]));
  storage.setItem(Ops.KEYS.lots, JSON.stringify([line, { receiptRefs: ['R1/0'] }]));
  const context = { actor: { id: 'u1', name: 'Test operator' }, allowed: true, now: NOW,
    available: () => 4, hasHold: () => false };
  const request = { id: 'C1', receiptId: 'R1', version: 0, quantities: [3], reason: 'Count correction' };
  return { storage, ledger, store, po, receipt, context, request };
}
function read(storage, key) { return JSON.parse(storage.getItem(key) || '[]'); }
for (const linked of [true, false]) {
  const f = fixture(linked);
  Ops.correct(f.storage, f.request, f.context);
  assert.equal(read(f.storage, Ops.KEYS.lots)[0].qty, 3);
  assert.equal(Ops.effectiveLines(read(f.storage, Ops.KEYS.receipts)[0])[0].qty, 3);
  assert.equal(f.ledger.onHand('A'), 3);
  if (linked) assert.equal(f.store.get(f.po.id).lines[0].received, 3);
  const before = f.storage.getItem(Ops.KEYS.lots);
  Ops.correct(f.storage, f.request, f.context);
  assert.equal(f.storage.getItem(Ops.KEYS.lots), before);
  assert.equal(read(f.storage, Ops.KEYS.receipts)[0].corrections.length, 1);
  assert.throws(() => Ops.correct(f.storage, { ...f.request, quantities: [2] }, f.context), /correction-conflict/);
  Ops.correct(f.storage, { ...f.request, id: 'C2', version: 1, quantities: [5] }, f.context);
  assert.equal(f.ledger.onHand('A'), 5);
  assert.equal(read(f.storage, Ops.KEYS.receipts)[0].lines[0].qty, 4, 'original remains intact');
}
for (const [context, error] of [[{ available: () => 0 }, 'insufficient-stock'], [{ hasHold: () => true }, 'stock-reserved'], [{ allowed: false }, 'permission']]) {
  const f = fixture();
  const before = f.storage.getItem(Ops.KEYS.lots);
  assert.throws(() => Ops.correct(f.storage, f.request, { ...f.context, ...context }), new RegExp(error));
  assert.equal(f.storage.getItem(Ops.KEYS.lots), before);
}
for (const request of [{ quantities: [-1] }, { quantities: [1.5] }, { version: 8 }, { reason: '' }, { quantities: [4] }]) {
  const f = fixture();
  assert.throws(() => Ops.correct(f.storage, { ...f.request, ...request }, f.context));
  assert.equal(read(f.storage, Ops.KEYS.receipts)[0].corrections, undefined);
}
// Every persistence boundary is recoverable, including journal creation and journal removal.
for (let failure = 1; failure <= 6; failure++) {
  const f = fixture();
  const write = f.storage.setItem, remove = f.storage.removeItem;
  let attempts = 0;
  f.storage.setItem = (key, value) => { if (++attempts === failure) throw Error('disk'); write(key, value); };
  f.storage.removeItem = key => { if (++attempts === failure) throw Error('disk'); remove(key); };
  assert.throws(() => Ops.correct(f.storage, f.request, f.context), /disk/);
  f.storage.setItem = write; f.storage.removeItem = remove;
  Ops.correct(f.storage, f.request, f.context);
  assert.equal(f.ledger.onHand('A'), 3);
  assert.equal(f.store.get(f.po.id).lines[0].received, 3);
  assert.equal(read(f.storage, Ops.KEYS.lots)[0].qty, 3);
  assert.equal(read(f.storage, Ops.KEYS.receipts)[0].corrections.length, 1);
  assert.equal(f.storage.getItem(Ops.KEYS.journal), null);
}
{
  const f = fixture();
  const version = f.store.get(f.po.id).history.length;
  const request = { id: 'END1', reason: 'Supplier cannot supply', version };
  const before = f.ledger.onHand('A');
  f.store.closeRemaining(f.po.id, request, { confirmed: true, by: 'u1' });
  assert.equal(f.store.get(f.po.id).state, 'closed-short');
  assert.equal(f.store.get(f.po.id).lines[0].cancelledQty, 6);
  assert.equal(f.ledger.onHand('A'), before);
  f.store.closeRemaining(f.po.id, request, { confirmed: true, by: 'u1' });
  assert.equal(f.store.get(f.po.id).history.length, version + 1);
  Ops.correct(f.storage, f.request, f.context);
  assert.equal(f.store.get(f.po.id).state, 'closed-short');
  assert.equal(f.store.get(f.po.id).lines[0].cancelledQty, 7);
  assert.equal(f.store.get(f.po.id).closure.cancelled[0].qty, 6);
}
{
  const f = fixture();
  const lines = [{ code: 'A', qty: 3, cost: 5 }, { code: 'A', qty: 4, cost: 6 }, { code: 'B', qty: 2, cost: 7 }];
  const rows = Ops.review(f.store.get(f.po.id), lines);
  assert.equal(rows[0].quantity, 7);
  assert.equal(rows[0].excess, 1);
  assert.equal(rows[0].costChanged, true);
  assert.equal(rows[1].unordered, true);
  assert.equal(Ops.review(null, lines)[0].ordered, null);
}
console.log('receipt operations passed — review, closures, corrections, permissions and six persistence failures');
