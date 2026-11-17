// S1-03: a finished POS sale writes the stock ledger and the offline outbox; a return writes local stock only.
// Fake storage, no network, no DOM. Also checks index.html carries verbatim copies of the three scripts and the two hooks.
// Run: node tests/unit/pos-outbox-wire.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { invoiceToSaleInput } from '../../backend/src/sync.js';

const req = createRequire(import.meta.url);
const root = (f) => fileURLToPath(new URL('../../' + f, import.meta.url));
const Outbox = req(root('offline-outbox.js')), Ledger = req(root('stock-ledger.js')), Wire = req(root('pos-sync-wire.js'));
let fetched = 0; globalThis.fetch = () => { fetched++; throw new Error('network must not be used'); };

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };
const mk = () => { const s = mem(), outbox = Outbox.createOutbox(s, 'nova.outbox'), ledger = Ledger.createLedger(s, 'nova.stock.ledger'); return { s, outbox, ledger, wire: Wire.create({ outbox, ledger, storage: s }) }; };
const sale = (o = {}) => ({ id: 'sale-1', number: 'INV-1', at: '2026-11-17T10:00:00.000Z', total: 15, lines: [
  { name: 'بنادول', barcode: '622100', unit: 'box', unitFactor: 1, price: 5, qty: 2, discount: 0 },
  { name: 'فيتامين', barcode: '', unit: 'box', unitFactor: 1, price: 5, qty: 1, discount: 0 }], ...o });

// 1. finalize offline: ledger sale movements + ONE pending outbox entry; payload matches the outbox/server contract
{
  const { outbox, ledger, wire } = mk();
  const r = wire.afterSale(sale());
  assert.deepEqual([r.ok, r.movements, r.queued], [true, 2, true]);
  assert.deepEqual(ledger.movements().map((m) => [m.kind, m.code, m.qty, m.delta, m.ref]), [['sale', '622100', 2, -2, 'sale:sale-1'], ['sale', 'فيتامين', 1, -1, 'sale:sale-1']]);
  assert.equal(outbox.all().length, 1); assert.equal(outbox.all()[0].status, 'pending'); assert.equal(outbox.all()[0].key, 'sale-1');
  const p = outbox.all()[0].payload; assert.deepEqual(p.lines, [{ code: '622100', qty: 2, price: 5 }, { code: 'فيتامين', qty: 1, price: 5 }]); assert.equal(p.discount, undefined);
  assert.deepEqual(wire.pending(), { pending: 1, review: 0 });
  // the server maps this exact payload to a sale (S1-02 contract): productId = code, minor units, total equals the POS total
  const si = invoiceToSaleInput(p); assert.deepEqual(si.items, [{ productId: '622100', qty: 2, unitPriceMinor: 500 }, { productId: 'فيتامين', qty: 1, unitPriceMinor: 500 }]);
  assert.equal(si.items.reduce((a, i) => a + i.qty * i.unitPriceMinor, 0) - si.discountMinor, 1500);
  // 2. same sale again (retry / double click): nothing duplicates
  const r2 = wire.afterSale(sale());
  assert.equal(r2.ok, true); assert.equal(outbox.all().length, 1); assert.equal(ledger.movements().length, 2);
}
// 3. invoice discount: sent so the server total equals the POS total
{
  const { outbox, wire } = mk(); wire.afterSale(sale({ id: 's-d', number: 'INV-D', total: 9 }));
  const p = outbox.all()[0].payload; assert.equal(p.discount, 6); // gross 15 - total 9
  const si = invoiceToSaleInput(p); assert.equal(si.items.reduce((a, i) => a + i.qty * i.unitPriceMinor, 0) - si.discountMinor, 900);
}
// 4. the same product twice in one invoice = one movement (ledger rejects duplicate kind+ref+code otherwise)
{
  const { ledger, wire } = mk();
  const r = wire.afterSale(sale({ lines: [{ name: 'a', barcode: 'X1', price: 1, qty: 1 }, { name: 'a', barcode: 'X1', price: 1, qty: 2 }], total: 3 }));
  assert.equal(r.ok, true); assert.deepEqual(ledger.movements().map((m) => [m.code, m.qty]), [['X1', 3]]);
}
// 5. bad lines (non-integer qty, no code, negative price) are skipped, never throw
{
  const { outbox, ledger, wire } = mk();
  const r = wire.afterSale(sale({ lines: [{ name: 'half', price: 1, qty: 1.5 }, { name: '', barcode: '', price: 1, qty: 1 }, { name: 'neg', price: -1, qty: 1 }], total: 0 }));
  assert.equal(r.queued, false); assert.equal(outbox.all().length, 0); assert.deepEqual(ledger.movements().map((m) => m.code), ['neg'], 'a valid-qty line still moves stock even if its price is unusable'); // half-unit and code-less lines are skipped
  assert.equal(wire.afterSale(null).ok, false); assert.equal(wire.afterSale({ id: 'x' }).ok, false);
}
// 5b. other units: counted per unit (own ledger code), never sent to the server as boxes; listed locally, never silently dropped
{
  const { s, outbox, ledger, wire } = mk();
  const r = wire.afterSale(sale({ id: 's-u', number: 'INV-U', total: 8, lines: [{ name: 'x', barcode: '777', unit: 'strip', unitFactor: 10, price: 4, qty: 2 }] }));
  assert.deepEqual([r.ok, r.queued, r.skipped], [true, false, 'unit-mapping']);
  assert.deepEqual(ledger.movements().map((m) => [m.code, m.qty]), [['777#strip', 2]]); assert.equal(outbox.all().length, 0);
  assert.deepEqual(JSON.parse(s.getItem('nova.sync.skipped')).map((x) => [x.id, x.reason]), [['s-u', 'unit-mapping']]);
  wire.afterSale(sale({ id: 's-u', number: 'INV-U', total: 8, lines: [{ name: 'x', barcode: '777', unit: 'strip', unitFactor: 10, price: 4, qty: 2 }] })); // replay
  assert.equal(JSON.parse(s.getItem('nova.sync.skipped')).length, 1);
  // a whole-box line mixed with a strip line: the whole invoice is held back (a partial invoice would give a wrong server total)
  const m2 = mk(); const r2 = m2.wire.afterSale(sale({ id: 's-m', number: 'INV-M', total: 10, lines: [{ name: 'a', barcode: '1', price: 5, qty: 1 }, { name: 'b', barcode: '2', unit: 'strip', price: 5, qty: 1 }] }));
  assert.deepEqual([r2.queued, m2.outbox.all().length, m2.ledger.movements().length], [false, 0, 2]);
}
// 5c. product codes that collide with Object.prototype keys are ordinary codes
{
  const { outbox, ledger, wire } = mk();
  const r = wire.afterSale(sale({ id: 's-p', number: 'INV-P', total: 5, lines: [{ name: 'toString', barcode: '', price: 5, qty: 1 }] }));
  assert.equal(r.ok, true); assert.deepEqual(ledger.movements().map((m) => [m.code, m.qty]), [['toString', 1]]); assert.equal(outbox.all().length, 1);
}
// the printed number may change after the first save: the ledger reference is the stable sale id, so a replay never double-deducts
{
  const { ledger, wire } = mk(); wire.afterSale(sale()); wire.afterSale(sale({ number: 'INV-1-REPRINT' }));
  assert.equal(ledger.movements().length, 2);
}// 6. return / cancel (S2-01): local stock movement + ONE explicit 'return' op after its sale (never invoice-shaped)
{
  const { outbox, ledger, wire } = mk(); const s = sale(); wire.afterSale(s);
  const r = wire.afterReturn(s, { id: 'ret-1', saleId: s.id, lines: [{ idx: 0, qty: 1 }] });
  assert.deepEqual([r.ok, r.movements, r.queued], [true, 1, true]);
  assert.deepEqual(ledger.movements().filter((m) => m.kind === 'return').map((m) => [m.code, m.qty, m.delta, m.ref]), [['622100', 1, 1, 'return:ret-1']]);
  assert.deepEqual(outbox.all().map((e) => [e.key, e.payload.op || 'invoice']), [[s.id, 'invoice'], ['ret:ret-1', 'return']]);
  wire.afterReturn(s, { id: 'ret-1', saleId: s.id, lines: [{ idx: 0, qty: 1 }] }); // replay
  assert.equal(ledger.movements().filter((m) => m.kind === 'return').length, 1);
  assert.equal(outbox.all().length, 2, 'replayed return is not queued twice');
  assert.equal(wire.afterReturn(s, null).ok, false);
}
// 7. a broken outbox / ledger never throws out of the wiring
{
  const bad = { enqueue() { throw Object.assign(new Error('x'), { code: 'outbox-write-failed' }); }, all() { throw new Error('x'); } };
  const w = Wire.create({ outbox: bad, ledger: { append() { throw Object.assign(new Error('x'), { code: 'bad-qty' }); } } });
  const r = w.afterSale(sale()); assert.equal(r.ok, false); assert.deepEqual(w.pending(), { pending: 0, review: 0 });
}
assert.equal(fetched, 0, 'zero network calls');

// index.html: verbatim script copies + the two hooks (sale add, return add)
const html = readFileSync(root('index.html'), 'utf8');
const b = html.indexOf('<!-- S1-03:BEGIN'), e = html.indexOf('<!-- S1-03:END -->');
assert.ok(b > 0 && e > b, 'S1-03 block present');
const block = html.slice(b, e);
for (const f of ['offline-outbox.js', 'stock-ledger.js', 'backend-client.js', 'pos-sync-wire.js']) assert.ok(block.includes('<script>\n' + readFileSync(root(f), 'utf8').replace(/\r?\n$/, '').replace(/\r\n/g, '\n') + '\n</script>'), f + ' is inlined verbatim');
assert.equal(html.split('S1-03:BEGIN').length, 2, 'one block only');
assert.ok(/localStorage\.setItem\(KEY, JSON\.stringify\(all\.slice\(0, MAX\)\)\);\s*try \{ if \(window\.novaSync\) window\.novaSync\.afterSale\(sale\); \} catch/.test(html), 'sale hook after the local save');
assert.ok(/localStorage\.setItem\(RKEY, JSON\.stringify\(all\.slice\(0, 1000\)\)\); try \{ if \(window\.novaSync\) window\.novaSync\.afterReturn\(sale, r\); \} catch/.test(html), 'return hook after the local save');
assert.ok(!/window\.novaSync\.[a-zA-Z]+\([^)]*\)[^;]*fetch\(/.test(html), 'no fetch in the hooks');
console.log('pos-outbox-wire OK');
