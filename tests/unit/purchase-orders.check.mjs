// N29 / BUY-05: local PO + receiving with lot/expiry/cost through the ledger. No network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const L = req('../../stock-ledger.js'), P = req('../../purchase-orders.js');
const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };
const code = f => { try { f(); } catch (e) { return e.code; } return null; };
const NOW = () => '2026-11-12T10:00:00Z';
const mk = () => { const led = L.createLedger(mem(), 'l', NOW); return { led, po: P.createStore(mem(), led, 'p', NOW) }; };
const C = { confirmed: true, by: 'ahmed' };
const draft = () => ({ supplier: 'MOCK', lines: [{ code: 'A', name: 'Panadol', qty: 10, cost: 20 }, { code: 'B', qty: 5, cost: 7.5 }] });
const grnLine = (o = {}) => Object.assign({ code: 'A', lot: 'L1', expiry: '2028-01-31', qty: 10, cost: 20 }, o);

// lifecycle needs explicit confirmation; draft sends nothing
{ const { po, led } = mk(); const d = po.create(draft());
  assert.equal(d.state, 'draft'); assert.equal(code(() => po.send(d.id, {})), 'confirmation-required');
  assert.equal(code(() => po.send(d.id, { confirmed: 'yes' })), 'confirmation-required');
  assert.equal(po.get(d.id).state, 'draft');
  assert.equal(code(() => po.accept(d.id, C)), 'bad-transition');
  assert.equal(po.send(d.id, C).state, 'sent'); assert.equal(po.accept(d.id, C).state, 'accepted');
  assert.equal(code(() => po.receive(d.id, { ref: 'G1', lines: [grnLine()] }, {})), 'confirmation-required');
  assert.equal(led.movements().length, 0, 'nothing in stock before a confirmed receipt'); }

// receiving: lot/expiry/cost reach the ledger, partial then received
{ const { po, led } = mk(); const id = po.create(draft()).id; po.send(id, C); po.accept(id, C);
  let r = po.receive(id, { ref: 'G1', lines: [grnLine({ qty: 4 })] }, C);
  assert.equal(r.po.state, 'partial'); assert.deepEqual(r.warnings, []);
  assert.equal(led.onHand('A'), 4);
  const m = led.movements('A')[0]; assert.equal(m.kind, 'receive'); assert.equal(m.lot, 'L1'); assert.equal(m.expiry, '2028-01-31'); assert.equal(m.cost, 20); assert.equal(m.ref, id + '/G1');
  r = po.receive(id, { ref: 'G2', lines: [grnLine({ qty: 6, lot: 'L2', expiry: '2028-06-30' }), grnLine({ code: 'B', qty: 5, cost: 7.5, lot: 'X' })] }, C);
  assert.equal(r.po.state, 'received'); assert.equal(led.onHand('A'), 10); assert.equal(led.onHand('B'), 5);
  assert.deepEqual(led.lots('A').map(x => [x.lot, x.qty]), [['L1', 4], ['L2', 6]]);
  assert.equal(code(() => po.receive(id, { ref: 'G3', lines: [grnLine()] }, C)), 'bad-transition');
  assert.equal(code(() => po.cancel(id, C)), 'bad-transition'); }

// rejection writes nothing (PO and ledger), whole GRN validated first
{ const { po, led } = mk(); const id = po.create(draft()).id; po.send(id, C);
  const bad = (g, c) => { assert.equal(code(() => po.receive(id, g, C)), c); assert.equal(led.movements().length, 0); assert.equal(po.get(id).grns.length, 0); assert.equal(po.get(id).lines[0].received, 0); };
  bad({ ref: '', lines: [grnLine()] }, 'missing-ref'); bad({ ref: 'G', lines: [] }, 'no-lines');
  bad({ ref: 'G', lines: [grnLine(), grnLine({ code: 'B', lot: '' })] }, 'bad-lot');
  bad({ ref: 'G', lines: [grnLine({ expiry: '' })] }, 'bad-expiry'); bad({ ref: 'G', lines: [grnLine({ expiry: '2028-13-45' })] }, 'bad-expiry');
  bad({ ref: 'G', lines: [grnLine({ qty: 0 })] }, 'bad-qty'); bad({ ref: 'G', lines: [grnLine({ qty: 1.5 })] }, 'bad-qty');
  bad({ ref: 'G', lines: [grnLine({ cost: -1 })] }, 'bad-cost'); bad({ ref: 'G', lines: [grnLine(), grnLine()] }, 'duplicate-lot-line');
  po.receive(id, { ref: 'G1', lines: [grnLine({ qty: 2 })] }, C);
  assert.equal(code(() => po.receive(id, { ref: 'G1', lines: [grnLine({ qty: 2 })] }, C)), 'duplicate-grn');
  assert.equal(led.onHand('A'), 2);
  assert.equal(code(() => po.cancel(id, C)), 'has-receipts'); }

// cancel
{ const { po } = mk(); const id = po.create(draft()).id; po.send(id, C);
  assert.equal(code(() => po.cancel(id, {})), 'confirmation-required');
  assert.equal(po.cancel(id, C).state, 'cancelled');
  assert.equal(code(() => po.receive(id, { ref: 'G', lines: [grnLine()] }, C)), 'bad-transition'); }

// warnings never block, and stock still lands
{ const { po, led } = mk(); const id = po.create(draft()).id; po.send(id, C); po.accept(id, C);
  const r = po.receive(id, { ref: 'G1', invoice: { qty: { A: 12, B: 1 } }, lines: [
    grnLine({ qty: 12, cost: 22 }), grnLine({ code: 'Z', qty: 1, lot: 'Q', expiry: '2026-11-12' }), grnLine({ code: 'B', qty: 1, cost: 7.5, lot: 'S', expiry: '2027-01-01' })] }, C);
  const t = r.warnings.map(w => w.type + ':' + w.code).sort();
  assert.deepEqual(t, ['cost-differs:A', 'expired:Z', 'over-receipt:A', 'short-expiry:B', 'unordered:Z', 'invoice-vs-po:A'].sort());
  assert.equal(led.onHand('A'), 12); assert.equal(r.po.state, 'partial');
  const w = r.warnings.find(x => x.type === 'over-receipt'); assert.deepEqual([w.ordered, w.received], [10, 12]);
  // invoice quantity differs from what was received
  const q = mk(); const i2 = q.po.create(draft()).id; q.po.send(i2, C);
  const r2 = q.po.receive(i2, { ref: 'G', invoice: { qty: { A: 8 } }, lines: [grnLine({ qty: 10 })] }, C);
  assert.deepEqual(r2.warnings, [{ type: 'invoice-vs-grn', code: 'A', invoice: 8, grn: 10 }]); }

// create validation + persistence
{ const { po } = mk(); const s = mem(); const led = L.createLedger(mem(), 'l', NOW);
  assert.equal(code(() => po.create({ supplier: '', lines: [{ code: 'A', qty: 1, cost: 1 }] })), 'bad-supplier');
  assert.equal(code(() => po.create({ supplier: 'S', lines: [] })), 'no-lines');
  assert.equal(code(() => po.create({ supplier: 'S', lines: [{ code: 'A', qty: 0, cost: 1 }] })), 'bad-qty');
  assert.equal(code(() => po.create({ supplier: 'S', lines: [{ code: 'A', qty: 1, cost: 1 }, { code: 'A', qty: 1, cost: 1 }] })), 'duplicate-line');
  const a = P.createStore(s, led, 'p', NOW); a.create(draft()); assert.equal(P.createStore(s, led, 'p', NOW).list().length, 1);
  assert.equal(code(() => P.createStore(Object.assign(mem(), { getItem: () => '{bad' }), led).list()), 'po-store-corrupt'); }

// ledger: lot fields only on receive, validated
{ const led = L.createLedger(mem(), 'l', NOW);
  assert.equal(code(() => led.append({ kind: 'sale', code: 'A', qty: 1, ref: 'I', lot: 'L' })), 'lot-only-on-receive');
  assert.equal(code(() => led.append({ kind: 'receive', code: 'A', qty: 1, ref: 'R', lot: 'L', expiry: 'x', cost: 1 })), 'bad-expiry');
  led.append({ kind: 'receive', code: 'A', qty: 1, ref: 'R', lot: 'L1', expiry: '2028-01-01', cost: 1 });
  led.append({ kind: 'receive', code: 'A', qty: 1, ref: 'R', lot: 'L2', expiry: '2028-01-01', cost: 1 });
  assert.equal(code(() => led.append({ kind: 'receive', code: 'A', qty: 1, ref: 'R', lot: 'L2', expiry: '2028-01-01', cost: 1 })), 'duplicate-movement');
  assert.equal(led.onHand('A'), 2); }
console.log('purchase-orders: all checks passed');
