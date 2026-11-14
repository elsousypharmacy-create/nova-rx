import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { transfersEnabled } from '../../backend/src/transfers.js';
import { handle } from '../../backend/src/index.js';
import { sha256Hex } from '../../backend/src/auth/auth.js';

const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async first() { return db.prepare(sql).get(...a) ?? null; },
  async run() { const r = db.prepare(sql).run(...a); return { success: true, meta: { changes: Number(r.changes) } }; },
}) }) };
const kvm = new Map();
const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const now = () => Math.floor(Date.now() / 1000);
async function session(token, extra) {
  await KV.put('sess:' + (await sha256Hex(token)), JSON.stringify({ user: 'u1', role: 'staff', expires: now() + 600, refreshExpires: now() + 600, reauthAt: now(), ...extra }));
}
const TA = 'a'.repeat(40), TB = 'b'.repeat(40), TX = 'c'.repeat(40);
await session(TA, { tenantId: 't1', roles: ['Cashier'], tenantBranchIds: ['b1', 'b2'], assignedBranchIds: ['b1'], activeBranchId: 'b1' });
await session(TB, { tenantId: 't1', roles: ['Cashier'], tenantBranchIds: ['b1', 'b2'], assignedBranchIds: ['b2'], activeBranchId: 'b2' });
await session(TX, { tenantId: 't2', roles: ['Cashier'], tenantBranchIds: ['b1', 'b2'], assignedBranchIds: ['b1'], activeBranchId: 'b1' });
const env = { NOVA_TRANSFERS: '1', DB: D1, KV };
const call = async (method, path, body, tok = TA, e = env) => {
  const r = await handle(new Request('https://x.test/api/v1/transfers/' + path, { method, headers: { ...(tok ? { Authorization: 'Bearer ' + tok } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), e);
  return [r.status, await r.json()];
};
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const P = (id, br, sku) => db.prepare('INSERT INTO products (id, tenant_id, branch_id, sku, name_ar) VALUES (?,?,?,?,?)').run(id, 't1', br, sku, 'دواء');
const B = (id, br, pid, no, exp, q) => { db.prepare('INSERT INTO inventory_batches (id, tenant_id, branch_id, product_id, batch_no, expiry_date, qty_on_hand, cost_minor) VALUES (?,?,?,?,?,?,?,5)').run(id, 't1', br, pid, no, exp, q);
  db.prepare("INSERT INTO inventory_movements (id, tenant_id, branch_id, product_id, batch_id, kind, qty_delta) VALUES (?,?,?,?,?,'receipt',?)").run('seed_' + id, 't1', br, pid, id, q); };
P('p1', 'b1', 'S1'); P('p2', 'b2', 'S1');
B('bx', 'b1', 'p1', 'EXPIRED', day(-5), 100);
B('br', 'b1', 'p1', 'RECALLED', day(10), 100);
db.prepare('INSERT INTO recalled_batches (tenant_id, batch_id, reason) VALUES (?,?,?)').run('t1', 'br', 'test');
B('bl', 'b1', 'p1', 'LATE', day(300), 10);
B('be', 'b1', 'p1', 'EARLY', day(60), 10);

// flag OFF => 404
assert.equal(transfersEnabled({}), false);
let [s, j] = await call('GET', 'list', null, TA, { DB: D1, KV }); assert.equal(s, 404); assert.equal(j.code, 'TRANSFERS_DISABLED');
[s] = await call('GET', 'list', null, null); assert.equal(s, 401);

// validation
[s, j] = await call('POST', 'create', { id: 'x', productId: 'p1', toBranchId: 'b1', qty: 1 }); assert.equal(s, 400); assert.equal(j.code, 'TRANSFER_SAME_BRANCH');
[s, j] = await call('POST', 'create', { id: 'x', productId: 'p1', toBranchId: 'b9', qty: 1 }); assert.equal(s, 403);
[s] = await call('POST', 'create', { id: 'x', productId: 'p1', toBranchId: 'b2', qty: 0 }); assert.equal(s, 400);
[s] = await call('POST', 'create', { id: 'x', productId: 'p1', toBranchId: 'b2', qty: 1, tenantId: 't2' }); assert.equal(s, 403);
[s] = await call('POST', 'create', { id: 'x', productId: 'p1', toBranchId: 'b2', qty: 1 }, TX); assert.equal(s, 404); // t2 has no p1

// create + isolation
[s, j] = await call('POST', 'create', { id: 'tr1', productId: 'p1', toBranchId: 'b2', qty: 4 }); assert.equal(s, 200); assert.equal(j.transfer.status, 'pending');
[s, j] = await call('GET', 'list'); assert.equal(j.transfers.length, 1);
[s, j] = await call('GET', 'list', null, TB); assert.equal(j.transfers.length, 1);
[s, j] = await call('GET', 'list', null, TX); assert.equal(j.transfers.length, 0);
[s] = await call('POST', 'ship', { id: 'tr1' }, TX); assert.equal(s, 404);
[s] = await call('POST', 'cancel', { id: 'tr1' }, TX); assert.equal(s, 404);
[s] = await call('POST', 'ship', { id: 'tr1' }, TB); assert.equal(s, 404); // destination cannot ship
[s] = await call('POST', 'receive', { id: 'tr1' }); assert.equal(s, 404);
[s, j] = await call('POST', 'receive', { id: 'tr1' }, TB); assert.equal(s, 409); // not shipped yet
[s] = await call('GET', 'list?branchId=b2'); assert.equal(s, 403); // not assigned

// ship: FEFO picks EARLY (not expired, not recalled)
[s, j] = await call('POST', 'ship', { id: 'tr1' }); assert.equal(s, 200); assert.equal(j.transfer.status, 'shipped'); assert.equal(j.transfer.batchId, 'be');
assert.equal(db.prepare("SELECT qty_on_hand q FROM inventory_batches WHERE id='be'").get().q, 6);
[s, j] = await call('POST', 'ship', { id: 'tr1' }); assert.equal(s, 409);
[s] = await call('POST', 'cancel', { id: 'tr1' }); assert.equal(s, 409);

// ship cannot exceed balance / use expired or recalled batch (only those cover 50)
[s] = await call('POST', 'create', { id: 'tr2', productId: 'p1', toBranchId: 'b2', qty: 50 });
[s, j] = await call('POST', 'ship', { id: 'tr2' }); assert.equal(s, 409); assert.equal(j.code, 'TRANSFER_INSUFFICIENT_STOCK');
assert.equal(db.prepare("SELECT qty_on_hand q FROM inventory_batches WHERE id IN ('bx','br')").all().every((r) => r.q === 100), true);
assert.equal(db.prepare("SELECT status FROM stock_transfers WHERE id='tr2'").get().status, 'pending');
[s, j] = await call('POST', 'cancel', { id: 'tr2' }, TB); assert.equal(j.transfer.status, 'cancelled');
[s] = await call('POST', 'ship', { id: 'tr2' }); assert.equal(s, 409);

// receive once; twice rejected
[s, j] = await call('POST', 'receive', { id: 'tr1' }, TB); assert.equal(s, 200); assert.equal(j.transfer.status, 'received');
[s, j] = await call('POST', 'receive', { id: 'tr1' }, TB); assert.equal(s, 409);
assert.equal(db.prepare("SELECT qty_on_hand q FROM inventory_batches WHERE branch_id='b2' AND batch_no='EARLY'").get().q, 4);
const mv = db.prepare("SELECT kind, qty_delta, branch_id FROM inventory_movements WHERE ref_id='tr1' ORDER BY kind").all();
assert.deepEqual(mv.map((m) => [m.kind, m.qty_delta, m.branch_id]), [['transfer_in', 4, 'b2'], ['transfer_out', -4, 'b1']]);

console.log('backend-transfers: all checks passed');
