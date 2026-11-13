import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { deliveryEnabled } from '../../backend/src/delivery.js';
import { handle } from '../../backend/src/index.js';
import { sha256Hex } from '../../backend/src/auth/auth.js';

const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async first() { return db.prepare(sql).get(...a) ?? null; },
  async run() { db.prepare(sql).run(...a); return { success: true }; },
}) }) };
const kvm = new Map();
const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const now = () => Math.floor(Date.now() / 1000);
async function session(token, extra) {
  await KV.put('sess:' + (await sha256Hex(token)), JSON.stringify({ user: 'u1', role: 'staff', expires: now() + 600, refreshExpires: now() + 600, reauthAt: now(), ...extra }));
}
const T1 = 'a'.repeat(40), T2 = 'b'.repeat(40), TM = 'c'.repeat(40);
await session(T1, { tenantId: 't1', roles: ['Cashier'], tenantBranchIds: ['b1'], assignedBranchIds: ['b1'], activeBranchId: 'b1' });
await session(TM, { user: 'mgr', tenantId: 't1', roles: ['Pharmacist'], tenantBranchIds: ['b1'], assignedBranchIds: ['b1'], activeBranchId: 'b1' });
await session(T2, { tenantId: 't2', roles: ['Cashier'], tenantBranchIds: ['b9'], assignedBranchIds: ['b9'], activeBranchId: 'b9' });
const env = { NOVA_DELIVERY: '1', DB: D1, KV };
const call = async (method, path, body, tok = T1, e = env) => {
  const r = await handle(new Request('https://x.test/api/v1/delivery/' + path, { method, headers: { ...(tok ? { Authorization: 'Bearer ' + tok } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), e);
  return [r.status, await r.json()];
};

// flag default OFF
assert.equal(deliveryEnabled({}), false);
let [s, j] = await call('GET', 'orders', null, T1, { DB: D1, KV });
assert.equal(s, 404); assert.equal(j.code, 'DELIVERY_DISABLED'); assert.match(j.requestId, /^req_/);
[s] = await call('GET', 'orders', null, null); assert.equal(s, 401);

// happy path
[s, j] = await call('POST', 'create', { id: 'd1', customer: 'منى', address: 'شارع ١', amount: 120, now: 1 }); assert.equal(s, 200); assert.equal(j.delivery.status, 'new');
[s, j] = await call('POST', 'create', { id: 'd1', address: 'x' }); assert.equal(s, 409);
[s, j] = await call('POST', 'create', { id: 'd9' }); assert.equal(s, 400); assert.equal(j.code, 'DELIVERY_BAD_REQUEST');
[s, j] = await call('POST', 'pickup', { id: 'd1', now: 2 }); assert.equal(s, 409); assert.equal(j.code, 'DELIVERY_BAD_STATE');
[s, j] = await call('POST', 'assign', { id: 'd1', now: 2 }); assert.equal(s, 400);
[s, j] = await call('POST', 'assign', { id: 'd1', courier: 'علي', now: 2 }); assert.equal(j.delivery.status, 'assigned');
await call('POST', 'pickup', { id: 'd1', now: 3 });
[s, j] = await call('POST', 'collect', { id: 'd1', now: 4 }); assert.equal(s, 409);
await call('POST', 'deliver', { id: 'd1', now: 4 });
[s, j] = await call('POST', 'collect', { id: 'd1', now: 5 }); assert.equal(j.delivery.status, 'collected');

// failure + reassign
await call('POST', 'create', { id: 'd2', address: 'ش٢', now: 1 });
await call('POST', 'assign', { id: 'd2', courier: 'علي', now: 2 });
await call('POST', 'pickup', { id: 'd2', now: 3 });
[s, j] = await call('POST', 'fail', { id: 'd2', reason: 'bogus' }); assert.equal(s, 400);
[s, j] = await call('POST', 'fail', { id: 'd2', reason: 'no_answer', now: 4 }); assert.equal(j.delivery.failureReason, 'no_answer');
[s, j] = await call('POST', 'assign', { id: 'd2', courier: 'سعد', now: 5 }); assert.equal(j.delivery.status, 'assigned'); assert.equal(j.delivery.failureReason, null);

// location change needs approval
[s, j] = await call('POST', 'location/request', { id: 'd2', address: 'ش٣', reason: 'العميل انتقل', now: 6 }); assert.equal(j.delivery.address, 'ش٢'); assert.equal(j.delivery.pendingAddress, 'ش٣');
[s, j] = await call('POST', 'location/approve', { id: 'd2', now: 7 }); assert.equal(s, 403); assert.equal(j.code, 'DELIVERY_FORBIDDEN');
[s, j] = await call('POST', 'location/approve', { id: 'd2', now: 7 }, TM); assert.equal(j.delivery.address, 'ش٣'); assert.equal(j.delivery.pendingAddress, null);
[s, j] = await call('POST', 'location/approve', { id: 'd2' }, TM); assert.equal(s, 409);
await call('POST', 'location/request', { id: 'd2', address: 'ش٤', reason: 'x', now: 8 });
[s, j] = await call('POST', 'location/reject', { id: 'd2', now: 9 }, TM); assert.equal(j.delivery.address, 'ش٣');
[s, j] = await call('POST', 'location/request', { id: 'd1', address: 'z', reason: 'x' }); assert.equal(s, 409);

// audit trail
[s, j] = await call('GET', 'history?id=d2');
assert.deepEqual(j.events.map((e) => e.action), ['create', 'assign', 'picked_up', 'failed', 'assign', 'location_requested', 'location_approved', 'location_requested', 'location_rejected']);
assert.equal(j.events.at(-2).actor, 'u1'); assert.equal(j.events[6].actor, 'mgr');
[s, j] = await call('GET', 'orders?status=assigned'); assert.equal(j.deliveries.length, 1);

// adapter (mock) used for orderRef
[s, j] = await call('POST', 'create', { id: 'd3', orderRef: 'O1', now: 1 }); assert.equal(s, 404); assert.equal(j.code, 'DELIVERY_ORDER_NOT_FOUND');

// tenant isolation
[s, j] = await call('GET', 'orders', null, T2); assert.equal(j.deliveries.length, 0);
[s, j] = await call('POST', 'pickup', { id: 'd1' }, T2); assert.equal(s, 404);
console.log('backend-delivery OK');
