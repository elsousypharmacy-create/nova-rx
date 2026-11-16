// S1-02: sync push applies an invoice as a real sale + stock movements and writes change_feed; /sync/pull returns it.
// Fake data, node:sqlite (D1 emulation), no network. Run: node tests/unit/backend-sync-sales.check.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { createTenant } from '../../backend/src/onboarding.js';
import { createUser, login } from '../../backend/src/auth/auth.js';
import { recordStockMovement, stockOnHand } from '../../backend/src/sales/service.js';
import { invoiceToSaleInput } from '../../backend/src/sync.js';

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const mk = (sql, a = []) => ({ bind: (...x) => mk(sql, x),
  async first() { return db.prepare(sql).get(...a) ?? null; },
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; },
  get sql() { return sql; }, get a() { return a; } });
const D1 = { prepare: (s) => mk(s), async batch(list) {
  db.exec('BEGIN');
  try { for (const s of list) db.prepare(s.sql).run(...s.a); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
} };
const kvm = new Map();
const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const env = { NOVA_AUTH: '1', NOVA_SYNC: '1', NOVA_SALES_WRITES: '1', DB: D1, KV, NOVA_API_PIN: 'pin-xyz-1', NOVA_TENANT_ID: 'ten-a' };
const count = (t, w = '1=1') => db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE ${w}`).get().c;

// pure mapping: POS line -> sale item (major units -> minor units)
const m = invoiceToSaleInput({ id: 'x', lines: [{ code: 'p1', qty: 2, price: 5.25 }], discount: 0.5 });
assert.deepEqual(m.items, [{ productId: 'p1', qty: 2, unitPriceMinor: 525 }]); assert.equal(m.discountMinor, 50);
assert.deepEqual(m.payments, [{ method: 'cash', amountMinor: 1000 }]);
for (const bad of [null, {}, { lines: [] }, { lines: [{ code: 'p1', qty: 0, price: 1 }] }, { lines: [{ code: 'p1', qty: 1.5, price: 1 }] }, { lines: [{ qty: 1, price: 1 }] }, { lines: [{ code: 'p1', qty: 1, price: -1 }] }, { lines: [{ code: 'p1', qty: 1, price: 1 }], discount: 5 }])
  assert.equal(invoiceToSaleInput(bad), null, JSON.stringify(bad));

const A = await createTenant(D1, { tenantId: 'ten-a', name: 'صيدلية', branches: ['الرئيسي'], owner: { username: 'owner-a', password: 'pw-owner-a-12345' } });
assert.equal(A.ok, true, JSON.stringify(A));
await createUser(KV, { username: 'owner-a', password: 'pw-owner-a-12345', role: 'owner' });
const tok = (await login(env, { username: 'owner-a', password: 'pw-owner-a-12345' })).ok.access_token;
const H = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
const sc = { tenantId: 'ten-a', branchId: A.branchIds[0] };
db.prepare("INSERT INTO products(id,tenant_id,branch_id,sku,name_ar) VALUES('p1',?,?,'S1','دواء')").run(sc.tenantId, sc.branchId);
assert.equal((await recordStockMovement(env, sc, { kind: 'receipt', productId: 'p1', qtyDelta: 5 }, 'r1')).ok, true);

const push = async (ops, e = env) => (await (await handle(new Request('https://x.test/api/v1/sync/push', { method: 'POST', headers: H, body: JSON.stringify({ ops }) }), e)).json()).results;
const pull = async (cursor) => (await (await handle(new Request('https://x.test/api/v1/sync/pull?cursor=' + cursor, { headers: H }), env)).json());
const inv = (id, qty) => ({ key: id, payload: { id, number: id, lines: [{ code: 'p1', qty, price: 5 }] } });

// 1. apply: sale + stock movement + ledger + change_feed + sync_ops, all in one batch
let [r1] = await push([inv('inv-1', 2)]);
assert.equal(r1.status, 'applied', JSON.stringify(r1)); assert.ok(r1.saleId);
assert.equal(await stockOnHand(env, sc, 'p1'), 3);
assert.deepEqual([count('sales'), count('sale_items'), count('change_feed'), count('sync_ledger'), count('sync_ops')], [1, 1, 1, 1, 1]);

// 2. pull returns the sale on "another device" (cursor 0), then nothing new
let p = await pull(0);
assert.equal(p.ok, true); assert.equal(p.changes.length, 1);
assert.deepEqual([p.changes[0].entity, p.changes[0].id], ['sale', r1.saleId]);
assert.deepEqual(p.changes[0].data.items, [{ productId: 'p1', qty: 2, unitPriceMinor: 500 }]);
assert.equal((await pull(p.nextCursor)).changes.length, 0);

// 3. idempotent replay: same op.key => stored result, stock and feed unchanged
let [r1b] = await push([inv('inv-1', 2)]);
assert.equal(r1b.duplicate, true); assert.equal(r1b.status, 'applied'); assert.equal(r1b.totalMinor, 1000, 'retry returns the same totalMinor as the first answer'); assert.equal(r1.totalMinor, 1000);
assert.equal(await stockOnHand(env, sc, 'p1'), 3); assert.deepEqual([count('sales'), count('change_feed')], [1, 1]);

// 4. insufficient stock => conflict, nothing written (no partial sale), and NOT cached: it can succeed later
let [r2] = await push([inv('inv-2', 99)]);
assert.deepEqual([r2.status, r2.code], ['conflict', 'SYNC_STOCK_CONFLICT']);
assert.deepEqual([count('sales'), count('change_feed'), count('sync_ledger'), count('sync_ops', "op_key='inv-2'"), await stockOnHand(env, sc, 'p1')], [1, 1, 1, 0, 3]);
assert.equal((await recordStockMovement(env, sc, { kind: 'receipt', productId: 'p1', qtyDelta: 100 }, 'r3')).ok, true);
[r2] = await push([inv('inv-2', 99)]);
assert.equal(r2.status, 'applied'); assert.equal(await stockOnHand(env, sc, 'p1'), 4);

// 5. invalid invoice => rejected, nothing written
const before = [count('sales'), count('change_feed')];
let [r3] = await push([{ key: 'inv-3', payload: { id: 'inv-3', lines: [{ code: 'p1', qty: 0, price: 5 }] } }]);
assert.deepEqual([r3.status, r3.code], ['rejected', 'SYNC_INVOICE_INVALID']); assert.deepEqual([count('sales'), count('change_feed')], before);

// 5b. two concurrent pushes of the same NEW invoice (retry race): exactly one sale, stock decremented once, both answers pplied, same saleId
const sBefore = [count('sales'), count('change_feed'), await stockOnHand(env, sc, 'p1')];
const [ra, rb] = await Promise.all([push([inv('inv-race', 1)]), push([inv('inv-race', 1)])]);
assert.equal(ra[0].status, 'applied', JSON.stringify(ra)); assert.equal(rb[0].status, 'applied', JSON.stringify(rb)); assert.equal(ra[0].saleId, rb[0].saleId);
assert.deepEqual([count('sales'), count('change_feed'), await stockOnHand(env, sc, 'p1')], [sBefore[0] + 1, sBefore[1] + 1, sBefore[2] - 1]);
before[0]++; before[1]++; // the race sale above is now part of the baseline

// 6. an invoice-entity op without `lines` stays a plain ledger record (old behaviour)
let [r4] = await push([{ key: 'plain-1', payload: { id: 'plain-1', note: 'x' } }]);
assert.equal(r4.status, 'applied'); assert.deepEqual([count('sales'), count('change_feed')], before);

// 7. NOVA_SALES_WRITES off => ledger only (no sale, no stock change, no feed row); flags off => 404 as before
const off = { ...env, NOVA_SALES_WRITES: undefined };
const stockBefore = await stockOnHand(env, sc, 'p1');
let [r5] = await push([inv('inv-5', 1)], off);
assert.equal(r5.status, 'applied'); assert.equal(await stockOnHand(env, sc, 'p1'), stockBefore); assert.deepEqual([count('sales'), count('change_feed')], before);
const noSync = await handle(new Request('https://x.test/api/v1/sync/push', { method: 'POST', headers: H, body: '{"ops":[]}' }), { ...env, NOVA_SYNC: undefined });
assert.equal(noSync.status, 404);

console.log('backend-sync-sales OK');
