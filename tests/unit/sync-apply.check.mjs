// S1-04: two devices + a mock sync API. A sale on device A appears exactly once on device B (sales list + stock ledger);
// replays are idempotent; a failed push stays queued and flushes later; flag OFF = zero fetches; hidden tab = no cycle.
// Fake storages, mocked fetch (never the network). Run: node tests/unit/sync-apply.check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const req = createRequire(import.meta.url);
const root = (f) => fileURLToPath(new URL('../../' + f, import.meta.url));
const Outbox = req(root('offline-outbox.js')), Ledger = req(root('stock-ledger.js')), Client = req(root('backend-client.js')), Wire = req(root('pos-sync-wire.js'));

assert.ok(Wire.SYNC_POLL_MS >= 5000 && Wire.SYNC_POLL_MS <= 10000, 'poll interval within 5-10 s');

// mock server: push applies (idempotent on op key), pull returns change_feed rows after the cursor
const server = { ops: new Map(), feed: [], stock: new Map(), down: false, calls: 0 };
const res = (body, status = 200) => ({ ok: status < 400, status, async json() { return body; } });
async function fetchMock(url, o) {
  server.calls++;
  if (server.down) throw new Error('offline');
  const u = new URL(url);
  if (u.pathname === '/api/v1/sync/push') {
    const op = JSON.parse(o.body).ops[0];
    if (server.ops.has(op.key)) return res({ ok: true, results: [{ key: op.key, ...server.ops.get(op.key), duplicate: true }] });
    const saleId = 'sale_' + (server.ops.size + 1);
    const items = op.payload.lines.map((l) => ({ productId: l.code, qty: l.qty, unitPriceMinor: Math.round(l.price * 100) }));
    for (const it of items) server.stock.set(it.productId, (server.stock.get(it.productId) || 0) - it.qty);
    server.feed.push({ seq: server.feed.length + 1, entity: 'sale', id: saleId, deleted: false, changedAt: '2026-11-17T12:00:00Z',
      data: { saleId, invoiceId: op.payload.id, items, discountMinor: Math.round((op.payload.discount || 0) * 100) } });
    const r = { status: 'applied', saleId }; server.ops.set(op.key, r);
    return res({ ok: true, results: [{ key: op.key, ...r }] });
  }
  if (u.pathname === '/api/v1/sync/pull') {
    const c = Number(u.searchParams.get('cursor') || 0), changes = server.feed.filter((x) => x.seq > c);
    return res({ ok: true, changes, nextCursor: String(changes.length ? changes[changes.length - 1].seq : c), hasMore: false });
  }
  return res({}, 404);
}

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };
function device(on = true) {
  const s = mem(); if (on) { s.setItem('novaBackend.enabled', 'true'); s.setItem('novaBackend.url', 'https://api.test'); }
  const sales = [], outbox = Outbox.createOutbox(s, 'nova.outbox', { baseMs: 1 }), ledger = Ledger.createLedger(s, 'nova.stock.ledger');
  const wire = Wire.create({ outbox, ledger, storage: s, hasSale: (id) => sales.some((x) => x.id === id), addSale: (r) => { if (!sales.some((x) => x.id === r.id)) sales.unshift(r); return true; } });
  const client = Client.createBackendClient({ storage: s, fetch: fetchMock, outbox, getToken: () => 'tok' });
  let hidden = false;
  const sched = Wire.createScheduler({ client, wire, storage: s, isHidden: () => hidden, isOffline: () => false });
  const sell = (sale) => { sales.unshift(sale); return wire.afterSale(sale); };
  return { s, sales, outbox, ledger, wire, client, sched, sell, hide: (v) => { hidden = v; } };
}
const onHand = (d, code) => d.ledger.movements(code).reduce((a, m) => a + m.delta, 0);
const sale = (id, qty) => ({ id, number: 'INV-' + id, at: '2026-11-17T11:00:00Z', total: 5 * qty, lines: [{ name: 'بنادول', barcode: '622100', unit: 'box', price: 5, qty }] });

const A = device(), B = device();
// 1. sale on A -> one sync on A (push) -> one sync on B (pull + apply): B has it once, with stock
A.sell(sale('a1', 2));
let r = await A.sched.tick(); assert.equal(r.skipped, false); assert.equal(A.outbox.all()[0].status, 'synced', JSON.stringify(A.outbox.all()[0]));
r = await B.sched.tick(); assert.equal(r.applied.applied, 1);
assert.deepEqual(B.sales.map((x) => [x.id, x.source, x.total]), [['a1', 'SYNC', 10]]);
assert.equal(onHand(B, '622100'), -2); assert.equal(B.outbox.all().length, 0, 'a pulled sale is never pushed back');
// 2. idempotent: B syncs again, A pulls its own sale back: nothing doubles
r = await B.sched.tick(); assert.equal(B.sales.length, 1); assert.equal(onHand(B, '622100'), -2);
r = await A.sched.tick(); assert.equal(A.sales.length, 1); assert.equal(onHand(A, '622100'), -2, 'own sale not counted twice');
// even if the feed is replayed from the start (cursor lost), nothing doubles
B.s.setItem('novaBackend.cursor', ''); await B.sched.tick(); assert.equal(B.sales.length, 1); assert.equal(onHand(B, '622100'), -2);
// 3. network down: the sale stays pending; back online: it flushes and reaches B
server.down = true; A.sell(sale('a2', 1)); r = await A.sched.tick();
assert.equal(A.outbox.all().find((e) => e.key === 'a2').status, 'pending'); assert.equal(server.feed.length, 1);
server.down = false; await new Promise((x) => setTimeout(x, 5)); await A.sched.tick();
assert.equal(A.outbox.all().find((e) => e.key === 'a2').status, 'synced'); await B.sched.tick();
assert.deepEqual(B.sales.map((x) => x.id).sort(), ['a1', 'a2']); assert.equal(onHand(B, '622100'), -3);
// 4. flag OFF: zero fetches, the sale stays local; hidden tab: no cycle
const C = device(false); const before = server.calls;
C.sell(sale('c1', 1)); r = await C.sched.tick(); assert.equal(r.skipped, true); assert.equal(server.calls, before, 'flag OFF = zero network');
assert.equal(C.outbox.all()[0].status, 'pending');
B.hide(true); r = await B.sched.tick(); assert.equal(r.hidden, true); assert.equal(server.calls, before); B.hide(false);
// 5. bad / foreign changes are skipped, never throw
assert.deepEqual(B.wire.applyChanges([null, { entity: 'other' }, { entity: 'sale', data: { items: [] } }, { entity: 'sale', deleted: true, data: {} }]), { applied: 0, skipped: 4 });
// 6. a throw while applying never blocks future cycles (busy is always released)
{ const s = mem(); s.setItem('novaBackend.enabled', 'true'); s.setItem('novaBackend.url', 'https://api.test'); s.setItem('novaBackend.feed', JSON.stringify([{ entity: 'sale', data: { invoiceId: 'x', items: [{ productId: 'p', qty: 1, unitPriceMinor: 1 }] } }]));
  const ob = Outbox.createOutbox(s, 'nova.outbox'); let n = 0;
  const sc = Wire.createScheduler({ client: Client.createBackendClient({ storage: s, fetch: fetchMock, outbox: ob }), wire: { applyChanges() { n++; throw new Error('boom'); } }, storage: s });
  let x = await sc.tick(); assert.ok(x.applied.error); x = await sc.tick(); assert.equal(x.skipped, false, 'second cycle still runs'); assert.equal(n, 2); }
console.log('sync-apply OK');
