// S1-13 — Stage 1 done gate (CI-safe, no network, nothing live). Two isolated device storages (tablet + phone) run the REAL
// browser modules (offline-outbox, stock-ledger, backend-client, pos-sync-wire) against the REAL backend (handle()) on an
// in-memory D1 with NOVA_AUTH + NOVA_SYNC + NOVA_SALES_WRITES: staff login on both, a sale on the tablet (stock -1 on the
// server), ONE sync cycle on each device -> the same sale (id, total, lines) and the new stock are on the phone; then the
// database is exported and imported into a NEW one: the sale, stock and staff login are recovered.
// Run: node tests/unit/stage1-done.check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { stockOnHand, recordStockMovement } from '../../backend/src/sales/service.js';
import { exportSql, importSql } from '../../tools/backend/restore-drill-sales.mjs';

const req = createRequire(import.meta.url);
const root = (f) => fileURLToPath(new URL('../../' + f, import.meta.url));
const Outbox = req(root('offline-outbox.js')), Ledger = req(root('stock-ledger.js')), Client = req(root('backend-client.js')), Wire = req(root('pos-sync-wire.js'));
const MIG = await loadMigrationsFromDir(root('backend/migrations'));
async function newDb() {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON'); await applyMigrations(db, MIG);
  const mk = (sql, a = []) => ({ bind: (...x) => mk(sql, x), async first() { return db.prepare(sql).get(...a) ?? null; }, async all() { return { results: db.prepare(sql).all(...a) }; },
    async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; }, get sql() { return sql; }, get a() { return a; } });
  return { db, D1: { prepare: (s) => mk(s), async batch(l) { db.exec('BEGIN'); try { for (const s of l) db.prepare(s.sql).run(...s.a); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } } } };
}
const mkKV = () => { const m = new Map(); return { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } }; };
const S = await newDb();
const PIN = 'stage1-pin-12345678';
const env = { NOVA_AUTH: '1', NOVA_SYNC: '1', NOVA_SALES_WRITES: '1', DB: S.D1, KV: mkKV(), NOVA_API_PIN: PIN, NOVA_TENANT_ID: 'pharmacy', CORS_ALLOW_ORIGINS: 'https://preview.test' };
const API = 'https://api.test';
let liveWrites = 0;
const serverFetch = async (url, o = {}) => { // the devices talk to the real backend; anything else is refused
  if (!String(url).startsWith(API)) { if ((o.method || 'GET') !== 'GET') liveWrites++; throw new Error('blocked: ' + url); }
  return handle(new Request(url, o), env);
};
const api = async (method, path, body, tok) => { const h = { 'Content-Type': 'application/json' }; if (tok) h.Authorization = 'Bearer ' + tok; const r = await serverFetch(API + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); return [r.status, await r.json()]; };

// server setup: owner bootstrap (PIN, once), a cashier for the phone, a product with stock
let [s, j] = await api('POST', '/api/v1/auth/login', { username: 'owner', password: PIN }); assert.equal(s, 200, JSON.stringify(j)); const ownerTok = j.access_token;
[s] = await api('POST', '/api/v1/staff', { username: 'phone1', password: 'phone-pass-1234', role: 'cashier' }, ownerTok); assert.equal(s, 200);
const branch = S.db.prepare("SELECT id FROM branches WHERE tenant_id='pharmacy'").get().id, scope = { tenantId: 'pharmacy', branchId: branch };
S.db.prepare("INSERT INTO products(id,tenant_id,branch_id,sku,name_ar) VALUES('622100','pharmacy',?,'622100','بنادول')").run(branch);
assert.equal((await recordStockMovement(env, scope, { kind: 'receipt', productId: '622100', qtyDelta: 10 }, 'r0')).ok, true);

// two devices, each logs in with its own staff account, flag ON pointing at the API
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };
async function device(user, pass) {
  const st = mem(); st.setItem('novaBackend.enabled', 'true'); st.setItem('novaBackend.url', API);
  const [ls, lj] = await api('POST', '/api/v1/auth/login', { username: user, password: pass }); assert.equal(ls, 200, user + ' login');
  const sales = [], outbox = Outbox.createOutbox(st, 'nova.outbox'), ledger = Ledger.createLedger(st, 'nova.stock.ledger');
  const wire = Wire.create({ outbox, ledger, storage: st, hasSale: (id) => sales.some((x) => x.id === id), addSale: (r) => { if (!sales.some((x) => x.id === r.id)) sales.unshift(r); return true; } });
  const client = Client.createBackendClient({ storage: st, fetch: serverFetch, outbox, getToken: () => lj.access_token });
  const sched = Wire.createScheduler({ client, wire, storage: st, isHidden: () => false, isOffline: () => false });
  return { sales, outbox, ledger, wire, sched, sell: (sale) => { sales.unshift(sale); return wire.afterSale(sale); } };
}
const tablet = await device('owner', PIN), phone = await device('phone1', 'phone-pass-1234');
const onHand = (d, code) => d.ledger.movements(code).reduce((a, m) => a + m.delta, 0);

// 1. finalize a sale on the tablet (2 boxes x 25.50, total 51.00)
const sale = { id: 'tab-sale-0001', number: 'T-1', at: '2026-11-17T09:00:00Z', total: 51, lines: [{ name: 'بنادول', barcode: '622100', unit: 'box', price: 25.5, qty: 2, discount: 0 }] };
assert.equal(tablet.sell(sale).queued, true); assert.equal(onHand(tablet, '622100'), -2);
// 2. ONE sync cycle on each device (the "within seconds" bound: SYNC_POLL_MS <= 10 s)
assert.ok(Wire.SYNC_POLL_MS <= 10000);
let r = await tablet.sched.tick(); assert.equal(r.skipped, false); assert.equal(tablet.outbox.all()[0].status, 'synced', JSON.stringify(tablet.outbox.all()[0]));
assert.equal(await stockOnHand(env, scope, '622100'), 8, 'server stock 10 - 2');
r = await phone.sched.tick(); assert.equal(r.applied.applied, 1, JSON.stringify(r));
const got = phone.sales.find((x) => x.id === sale.id);
assert.ok(got, 'the tablet sale is on the phone'); assert.equal(got.total, 51); assert.deepEqual(got.lines.map((l) => [l.barcode, l.qty, l.price]), [['622100', 2, 25.5]]);
assert.equal(onHand(phone, '622100'), -2, 'phone stock moved by the same 2 boxes');
// idempotent: another cycle on both changes nothing
await tablet.sched.tick(); await phone.sched.tick();
assert.equal(phone.sales.length, 1); assert.equal(onHand(phone, '622100'), -2); assert.equal(await stockOnHand(env, scope, '622100'), 8);
assert.equal(tablet.sales.length, 1, 'the tablet does not re-add its own sale'); assert.equal(onHand(tablet, '622100'), -2);

// 3. restore: export the server database, import into a NEW one, everything is recovered
const B = await newDb(); importSql(B.db, exportSql(S.db));
const env2 = { ...env, DB: B.D1, KV: mkKV() };
const saleRow = S.db.prepare('SELECT id,total_minor,status FROM sales').get();
assert.deepEqual(B.db.prepare('SELECT id,total_minor,status FROM sales').get(), saleRow); assert.equal(saleRow.total_minor, 5100);
assert.equal(await stockOnHand(env2, scope, '622100'), 8, 'stock recovered');
const lr = await handle(new Request(API + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'phone1', password: 'phone-pass-1234' }) }), env2);
assert.equal(lr.status, 200, 'staff login recovered');
assert.equal(liveWrites, 0, 'no live write ever left the test');
console.log('stage1-done OK: tablet sale visible on the phone after one sync each; restore recovers sale + stock + staff');
