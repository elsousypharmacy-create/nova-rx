// N126: end-to-end backend suite on node:sqlite (D1 emulation). Local/mock only: no network, no R2.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { createTenant } from '../../backend/src/onboarding.js';
import { createUser, login, sha256Hex } from '../../backend/src/auth/auth.js';
import { createSale, recordStockMovement, stockOnHand, returnSale } from '../../backend/src/sales/service.js';
import { createSnapshot, restoreDrill } from '../../tools/backend/restore-drill.mjs';

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

// flags default OFF (code + wrangler.toml)
const wt = readFileSync(new URL('../../backend/wrangler.toml', import.meta.url), 'utf8');
assert.ok(!/NOVA_(SYNC|AUTH|SALES_WRITES)\s*=\s*"?(1|true|on)/i.test(wt), 'flags default OFF');
let r = await handle(new Request('https://x.test/api/v1/sync/push', { method: 'POST', body: '{"ops":[]}' }), { DB: D1, KV });
assert.equal(r.status, 404); assert.equal((await r.json()).code, 'SYNC_DISABLED');

// 1. bootstrap owner (two tenants)
const boot = async (id, owner) => createTenant(D1, { tenantId: id, name: 'صيدلية ' + id, branches: ['الرئيسي'], owner: { username: owner, password: 'pw-' + owner + '-12345' } });
const A = await boot('ten-a', 'owner-a'), B = await boot('ten-b', 'owner-b');
assert.equal(A.ok, true, JSON.stringify(A)); assert.equal(B.ok, true, JSON.stringify(B));
assert.equal((await boot('ten-a', 'owner-x')).code, 'ONBOARDING_TENANT_EXISTS');

// 2. login
await createUser(KV, { username: 'owner-a', password: 'pw-owner-a-12345', role: 'owner' });
const bad = await login(env, { username: 'owner-a', password: 'wrong-password' });
assert.ok(!bad.ok);
const lg = await login(env, { username: 'owner-a', password: 'pw-owner-a-12345' });
const tok = lg.ok.access_token; assert.ok(tok);
const H = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };

// 3. sale (backend service) in tenant t1
const sc = { tenantId: 'ten-a', branchId: A.branchIds[0] };
const scB = { tenantId: 'ten-b', branchId: B.branchIds[0] };
db.prepare("INSERT INTO products(id,tenant_id,branch_id,sku,name_ar) VALUES('p1',?,?,'S1','دواء'),('q1',?,?,'S9','سري')").run(sc.tenantId, sc.branchId, scB.tenantId, scB.branchId);
assert.equal((await recordStockMovement(env, sc, { kind: 'receipt', productId: 'p1', qtyDelta: 10 }, 'r1')).ok, true);
const sale = await createSale(env, sc, { items: [{ productId: 'p1', qty: 2, unitPriceMinor: 500 }], payments: [{ method: 'cash', amountMinor: 1000 }] }, 'r2');
assert.equal(sale.ok, true); assert.equal(await stockOnHand(env, sc, 'p1'), 8);

// 4. sync push (auth required, idempotent) then pull
r = await handle(new Request('https://x.test/api/v1/sync/push', { method: 'POST', body: '{"ops":[]}' }), env);
assert.equal(r.status, 401);
const push = async (headers, ops) => { const x = await handle(new Request('https://x.test/api/v1/sync/push', { method: 'POST', headers, body: JSON.stringify({ ops }) }), env); assert.equal(x.status, 200); return (await x.json()).results; };
const op = { key: 'sale-1', payload: { id: sale.saleId, total: 1000 } };
assert.equal((await push(H, [op]))[0].status, 'applied');
assert.equal((await push(H, [op]))[0].duplicate, true);
assert.equal(count('sync_ops', "tenant_id='ten-a'"), 1);
// pull: session scoped to tenant; change feed rows for the sale
const sess = async (token, extra) => KV.put('sess:' + (await sha256Hex(token)), JSON.stringify({ user: 'u', role: 'staff', expires: Math.floor(Date.now() / 1000) + 600, refreshExpires: Math.floor(Date.now() / 1000) + 600, reauthAt: Math.floor(Date.now() / 1000), ...extra }));
const T1 = 'a'.repeat(40), T2 = 'b'.repeat(40);
await sess(T1, { tenant: 'ten-a', tenantId: 'ten-a', roles: ['Cashier'], tenantBranchIds: sc.branchId ? [sc.branchId] : [], assignedBranchIds: [sc.branchId], activeBranchId: sc.branchId });
await sess(T2, { tenant: 'ten-b', tenantId: 'ten-b', roles: ['Cashier'], tenantBranchIds: [scB.branchId], assignedBranchIds: [scB.branchId], activeBranchId: scB.branchId });
const ins = db.prepare('INSERT INTO change_feed (tenant_id,branch_id,entity,entity_id,deleted,payload_json) VALUES (?,?,?,?,0,?)');
ins.run('ten-a', sc.branchId, 'sale', sale.saleId, JSON.stringify({ total: 1000 }));
ins.run('ten-b', scB.branchId, 'sale', 'secret-sale', JSON.stringify({ total: 9 }));
const pull = async (tk) => { const x = await handle(new Request('https://x.test/api/v1/sync/pull', { headers: { Authorization: 'Bearer ' + tk } }), env); return { s: x.status, j: await x.json() }; };
let p = await pull(T1);
assert.equal(p.s, 200); assert.deepEqual(p.j.changes.map((c) => c.id), [sale.saleId]);

// 5. backup -> restore drill -> verify (local snapshot tools, no R2)
const snap = JSON.parse(JSON.stringify(createSnapshot(db)));
const fresh = new DatabaseSync(':memory:');
const rep = await restoreDrill(snap, fresh);
assert.equal(rep.ok, true, JSON.stringify(rep.problems));
for (const t of ['tenants', 'users', 'sales', 'sync_ops', 'inventory_movements', 'journal_entries']) {
  assert.equal(fresh.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c, count(t), t);
}
assert.equal(fresh.prepare('SELECT SUM(debit_minor) d, SUM(credit_minor) c FROM journal_lines').get().d, 1000);
const tamper = JSON.parse(JSON.stringify(snap)); tamper.tables.sales.rows[0].id = 'tampered';
assert.equal((await restoreDrill(tamper, new DatabaseSync(':memory:'))).ok, false);

// 6. cross-tenant attacks
// 6a. t2 session pulls: never sees t1 data
p = await pull(T2);
assert.deepEqual(p.j.changes.map((c) => c.id), ['secret-sale']);
// 6b. t2 cannot return/see t1's sale
const siId = db.prepare('SELECT id FROM sale_items').get().id;
assert.equal((await returnSale(env, scB, { saleId: sale.saleId, items: [{ saleItemId: siId, qty: 1 }] }, 'r3')).code, 'NOT_FOUND');
// 6c. t2 cannot sell t1's product: nothing written
const before = [count('sales'), count('inventory_movements')];
const x = await createSale(env, scB, { items: [{ productId: 'p1', qty: 1, unitPriceMinor: 1 }], payments: [{ method: 'cash', amountMinor: 1 }] }, 'r4');
assert.equal(x.ok, false);
assert.deepEqual([count('sales'), count('inventory_movements')], before);
assert.equal(await stockOnHand(env, scB, 'p1'), 0);
// 6d. same op key from t2 is its own op, does not collide with / replay t1's
const H2 = { Authorization: 'Bearer ' + T2, 'Content-Type': 'application/json' };
const res2 = (await push(H2, [op]))[0];
assert.equal(res2.status, 'applied'); assert.ok(!res2.duplicate);
assert.equal(count('sync_ops', "op_key='sale-1'"), 2);
// 6e. client-named foreign tenant in pull query does not widen scope
const q = await handle(new Request('https://x.test/api/v1/sync/pull?tenant_id=ten-b&branch_id=' + scB.branchId, { headers: { Authorization: 'Bearer ' + T1 } }), env);
if (q.status === 200) assert.ok(!(await q.json()).changes.some((c) => c.id === 'secret-sale'));
else assert.ok(q.status >= 400 && q.status < 500);
// 6f. forged/unknown token rejected
assert.equal((await pull('c'.repeat(40))).s, 401);

console.log('backend-e2e OK');
