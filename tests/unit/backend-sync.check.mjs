import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { syncEnabled, parseCursor } from '../../backend/src/sync.js';
import { handle } from '../../backend/src/index.js';
import { sha256Hex } from '../../backend/src/auth/auth.js';

const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({ async all() { return { results: db.prepare(sql).all(...a) }; } }) }) };
const kvm = new Map();
const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const now = () => Math.floor(Date.now() / 1000);
async function session(token, extra) {
  await KV.put('sess:' + (await sha256Hex(token)), JSON.stringify({ user: 'u1', role: 'staff', expires: now() + 600, refreshExpires: now() + 600, reauthAt: now(), ...extra }));
}
const T1 = 'a'.repeat(40), T2 = 'b'.repeat(40);
await session(T1, { tenantId: 't1', roles: ['Cashier'], tenantBranchIds: ['b1', 'b2'], assignedBranchIds: ['b1'], activeBranchId: 'b1' });
await session(T2, { tenantId: 't2', roles: ['Cashier'], tenantBranchIds: ['b9'], assignedBranchIds: ['b9'], activeBranchId: 'b9' });
const ins = db.prepare('INSERT INTO change_feed (tenant_id,branch_id,entity,entity_id,deleted,payload_json) VALUES (?,?,?,?,?,?)');
for (let i = 1; i <= 5; i++) ins.run('t1', 'b1', 'product', 'p' + i, 0, JSON.stringify({ n: i }));
ins.run('t1', 'b1', 'product', 'p2', 1, null);   // tombstone
ins.run('t1', 'b2', 'product', 'other-branch', 0, '{}');
ins.run('t2', 'b9', 'product', 'other-tenant', 0, '{}');

const env = { NOVA_SYNC: '1', DB: D1, KV };
const get = (qs, tok = T1, e = env, h = {}) => handle(new Request('https://x.test/api/v1/sync/pull' + qs, { headers: { ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...h } }), e);

// flag default OFF
assert.equal(syncEnabled({}), false);
let r = await get('', T1, { DB: D1, KV });
assert.equal(r.status, 404); assert.equal((await r.json()).code, 'SYNC_DISABLED');
assert.equal(parseCursor('12'), 12); assert.equal(parseCursor('x'), null); assert.equal(parseCursor(''), 0);

// auth
r = await get('', null); assert.equal(r.status, 401);

// pagination + tombstone, scoped to tenant/branch
r = await get('?limit=4'); let j = await r.json();
assert.equal(r.status, 200); assert.equal(j.changes.length, 4); assert.equal(j.hasMore, true);
assert.match(j.requestId, /^req_/);
r = await get('?limit=4&cursor=' + j.nextCursor); const j2 = await r.json();
assert.equal(j2.changes.length, 2); assert.equal(j2.hasMore, false);
const all = [...j.changes, ...j2.changes];
assert.deepEqual(all.map((c) => c.id), ['p1', 'p2', 'p3', 'p4', 'p5', 'p2']);
const tomb = all[5];
assert.equal(tomb.deleted, true); assert.equal(tomb.data, null);
assert.deepEqual(all[0].data, { n: 1 });
assert.ok(!all.some((c) => /other/.test(c.id)));
assert.equal(db.prepare('SELECT COUNT(*) c FROM change_feed').get().c, 8, 'no hard delete');
r = await get('?cursor=' + j2.nextCursor); j = await r.json();
assert.equal(j.changes.length, 0); assert.equal(j.nextCursor, j2.nextCursor);

// other tenant sees only own
j = await (await get('', T2)).json();
assert.deepEqual(j.changes.map((c) => c.id), ['other-tenant']);

// client-named tenant/branch must match session
r = await get('?tenantId=t2'); assert.equal(r.status, 403); assert.equal((await r.json()).code, 'TENANT_MISMATCH');
r = await get('?branchId=b2'); assert.equal(r.status, 403); assert.equal((await r.json()).code, 'BRANCH_FORBIDDEN');
r = await get('?branchId=b1'); assert.equal(r.status, 200);

// bad input
r = await get('?cursor=abc'); assert.equal((await r.json()).code, 'SYNC_BAD_CURSOR');
r = await get('?limit=-1'); assert.equal((await r.json()).code, 'SYNC_BAD_LIMIT');

// session without tenant claims fails closed; DB error -> 503 coded
await session('c'.repeat(40), {});
r = await get('', 'c'.repeat(40)); assert.equal(r.status, 401);
r = await get('', T1, { ...env, DB: { prepare() { throw new Error('x'); } } });
assert.equal(r.status, 503); assert.equal((await r.json()).code, 'SYNC_FAILED');
console.log('backend-sync OK');
