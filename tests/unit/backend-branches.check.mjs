import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { sha256Hex } from '../../backend/src/auth/auth.js';

const dir = fileURLToPath(new URL('../../backend/migrations', import.meta.url));
const db = new DatabaseSync(':memory:');
const migs = await loadMigrationsFromDir(dir);
assert.ok(migs.some((m) => m.version === 21));
await applyMigrations(db, migs);
// no destructive SQL in 0021
const sql = readFileSync(dir + '/0021_stock_locations.sql', 'utf8').replace(/--.*$/gm, '');
assert.doesNotMatch(sql, /\b(DROP|DELETE|ALTER|UPDATE|TRUNCATE)\b/i);
const D1 = { prepare: (q) => ({ bind: (...a) => ({
  async all() { return { results: db.prepare(q).all(...a) }; },
  async first() { return db.prepare(q).get(...a) ?? null; },
  async run() { db.prepare(q).run(...a); return { success: true }; },
}) }) };
const kvm = new Map();
const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const now = () => Math.floor(Date.now() / 1000);
async function session(token, extra) {
  await KV.put('sess:' + (await sha256Hex(token)), JSON.stringify({ user: 'u1', role: 'owner', roles: ['Owner'], expires: now() + 600, refreshExpires: now() + 600, reauthAt: now(), ...extra }));
}
db.exec("INSERT INTO tenants (id,name) VALUES ('t1','A'),('t2','B')");
db.exec("INSERT INTO branches (id,tenant_id,name) VALUES ('b1','t1','Main'),('b2','t1','Unassigned'),('b9','t2','Other')");
db.exec("INSERT INTO stock_locations (tenant_id,branch_id,id,name,kind) VALUES ('t1','b1','l1','رف','shelf'),('t1','b2','l2','ثلاجة','fridge'),('t2','b9','l9','x','main')");
assert.throws(() => db.exec("INSERT INTO stock_locations (tenant_id,branch_id,id,name,kind) VALUES ('t1','b1','l3','x','bogus')"), /CHECK/i);
const T1 = 'a'.repeat(40), T2 = 'b'.repeat(40);
await session(T1, { tenantId: 't1', tenantBranchIds: ['b1', 'b2'], assignedBranchIds: ['b1'], activeBranchId: 'b1' });
// session claims b9 (other tenant's branch) as assigned+tenant: DB tenant filter must still exclude it
await session(T2, { tenantId: 't2', tenantBranchIds: ['b9', 'b1'], assignedBranchIds: ['b9', 'b1'], activeBranchId: 'b9' });
const env = { NOVA_BRANCHES: '1', DB: D1, KV };
const call = async (path, tok = T1, e = env) => {
  const r = await handle(new Request('https://x.test/api/v1/' + path, { headers: tok ? { Authorization: 'Bearer ' + tok } : {} }), e);
  return [r.status, await r.json()];
};
let [s, j] = await call('branches', T1, { DB: D1, KV });
assert.equal(s, 404); assert.equal(j.code, 'BRANCHES_DISABLED');
[s] = await call('stock-locations', T1, { DB: D1, KV }); assert.equal(s, 404);
[s] = await call('branches', null); assert.equal(s, 401);
[s, j] = await call('branches');
assert.equal(s, 200); assert.deepEqual(j.branches.map((b) => b.id), ['b1']);
[s, j] = await call('stock-locations');
assert.equal(s, 200); assert.deepEqual(j.locations.map((l) => l.id), ['l1']);
[s, j] = await call('stock-locations?branchId=b2');
assert.deepEqual(j.locations, []);
[s, j] = await call('branches', T2);
assert.deepEqual(j.branches.map((b) => b.id), ['b9']);
[s, j] = await call('stock-locations', T2);
assert.deepEqual(j.locations.map((l) => l.id), ['l9']);
console.log('backend-branches OK');
