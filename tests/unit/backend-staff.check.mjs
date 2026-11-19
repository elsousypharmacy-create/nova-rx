// S1-06: staff accounts on D1 (users / roles / user_roles). Owner PIN bootstrap creates tenant + branch + owner in D1; owner/manager
// manage staff; disable is soft and revokes sessions; sessions carry the tenant/branch scope (sync works); a D1 export/restore keeps
// logins (same PBKDF2 hash, no plaintext); a legacy KV owner is imported one-way. Fake data, node:sqlite, no network.
// Run: node tests/unit/backend-staff.check.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { createUser } from '../../backend/src/auth/auth.js';

const MIG = await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url)));
async function mkDb() {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON'); await applyMigrations(db, MIG);
  const mk = (sql, a = []) => ({ bind: (...x) => mk(sql, x), async first() { return db.prepare(sql).get(...a) ?? null; },
    async all() { return { results: db.prepare(sql).all(...a) }; },
    async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; }, get sql() { return sql; }, get a() { return a; } });
  const D1 = { prepare: (s) => mk(s), async batch(list) { db.exec('BEGIN'); try { for (const s of list) db.prepare(s.sql).run(...s.a); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } } };
  return { db, D1 };
}
const mkKV = () => { const m = new Map(); return { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } }; };
const PIN = 'pin-fake-123456';
const { db, D1 } = await mkDb();
const env = { NOVA_AUTH: '1', NOVA_SYNC: '1', DB: D1, KV: mkKV(), NOVA_API_PIN: PIN, NOVA_TENANT_ID: 'ten-s' };
const count = (d, t, w = '1=1') => d.prepare(`SELECT COUNT(*) c FROM ${t} WHERE ${w}`).get().c;
const call = async (method, path, body, token, e = env) => {
  const h = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.0.1' }; if (token) h.Authorization = 'Bearer ' + token;
  const r = await handle(new Request('https://x.test' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), e);
  return [r.status, await r.json()];
};
const login = async (u, p, e = env) => call('POST', '/api/v1/auth/login', { username: u, password: p }, null, e);

// 1. first owner: PIN bootstrap creates tenant + branch + owner IN D1 (hashed), once
let [s, j] = await login('owner', PIN);
assert.equal(s, 200, JSON.stringify(j)); const ownerTok = j.access_token; assert.ok(ownerTok);
assert.deepEqual([count(db, 'tenants'), count(db, 'branches'), count(db, 'users')], [1, 1, 1]);
assert.ok(db.prepare("SELECT password_hash h FROM users WHERE username='owner'").get().h.startsWith('pbkdf2$sha256$'), 'hashed, never plaintext');
assert.ok(!JSON.stringify(db.prepare('SELECT * FROM users').all()).includes(PIN), 'no plaintext PIN in D1');
[s] = await login('owner', 'other-pin-000000'); assert.equal(s, 401, 'bootstrap only once / wrong password');

// 2. owner manages staff
[s, j] = await call('GET', '/api/v1/staff', undefined, ownerTok); assert.equal(s, 200); assert.deepEqual(j.staff.map((x) => [x.username, x.role, x.active]), [['owner', 'owner', true]]);
[s, j] = await call('POST', '/api/v1/staff', { username: 'Nour', password: 'pw-nour-12345', role: 'cashier' }, ownerTok); assert.equal(s, 200, JSON.stringify(j)); assert.equal(j.created.username, 'nour');
[s, j] = await call('POST', '/api/v1/staff', { username: 'nour', password: 'pw-nour-12345', role: 'cashier' }, ownerTok); assert.deepEqual([s, j.code], [409, 'STAFF_EXISTS']);
[s, j] = await call('POST', '/api/v1/staff', { username: 'x1', password: 'short', role: 'cashier' }, ownerTok); assert.equal(s, 400);
[s, j] = await call('POST', '/api/v1/staff', { username: 'x2', password: 'pw-x2-123456', role: 'emperor' }, ownerTok); assert.equal(s, 400);

// 3. cashier logs in; cannot manage staff; the session carries a scope so sync works
[s, j] = await login('nour', 'pw-nour-12345'); assert.equal(s, 200); const nourTok = j.access_token;
// SEC-01: login returns the verified username + role (the client mirrors them for offline work); the REAL token opens the chat history, none => 401
assert.deepEqual([j.user, j.role], ['nour', 'cashier']);
[s, j] = await call('GET', '/api/v1/inbox/history/conversations', undefined, nourTok); assert.equal(s, 200, 'staff session opens history: ' + JSON.stringify(j)); assert.ok(Array.isArray(j.conversations));
[s, j] = await call('GET', '/api/v1/inbox/history/conversations', undefined, undefined); assert.equal(s, 401); assert.equal(j.conversations, undefined);
[s, j] = await call('GET', '/api/v1/staff', undefined, nourTok); assert.deepEqual([s, j.code], [403, 'FORBIDDEN']);
[s, j] = await call('POST', '/api/v1/staff', { username: 'evil', password: 'pw-evil-12345', role: 'owner' }, nourTok); assert.equal(s, 403);
[s, j] = await call('GET', '/api/v1/sync/pull?cursor=0', undefined, nourTok); assert.equal(s, 200, 'staff session scope accepted by sync: ' + JSON.stringify(j));
[s, j] = await call('GET', '/api/v1/sync/pull?cursor=0', undefined, ownerTok); assert.equal(s, 200);

// 4. manager: may create staff, may not create or promote to owner, may not touch an owner
[s] = await call('POST', '/api/v1/staff', { username: 'mona', password: 'pw-mona-12345', role: 'manager' }, ownerTok); assert.equal(s, 200);
[s, j] = await login('mona', 'pw-mona-12345'); const monaTok = j.access_token;
[s] = await call('POST', '/api/v1/staff', { username: 'aly', password: 'pw-aly-123456', role: 'pharmacist' }, monaTok); assert.equal(s, 200);
[s] = await call('POST', '/api/v1/staff', { username: 'boss2', password: 'pw-boss-12345', role: 'owner' }, monaTok); assert.equal(s, 403);
[s] = await call('POST', '/api/v1/staff/role', { username: 'aly', role: 'owner' }, monaTok); assert.equal(s, 403);
[s] = await call('POST', '/api/v1/staff/disable', { username: 'owner' }, monaTok); assert.equal(s, 403);
[s] = await call('POST', '/api/v1/staff/disable', { username: 'mona' }, monaTok); assert.equal(s, 409, 'cannot disable self');
[s] = await call('POST', '/api/v1/staff', { username: 'mgr2', password: 'pw-mgr2-12345', role: 'manager' }, ownerTok); assert.equal(s, 200);
[s] = await call('POST', '/api/v1/staff/disable', { username: 'mgr2' }, monaTok); assert.equal(s, 403, 'a manager cannot disable another manager');
[s] = await call('POST', '/api/v1/staff/role', { username: 'aly', role: 'manager' }, monaTok); assert.equal(s, 403, 'a manager cannot promote to manager');

// 5. disable is soft (row kept, active=0), revokes live sessions, blocks login; enable brings it back
[s, j] = await call('POST', '/api/v1/staff/disable', { username: 'nour' }, ownerTok); assert.equal(s, 200); assert.ok(j.revokedSessions >= 1);
assert.equal(count(db, 'users', "username='nour'"), 1, 'never deleted'); assert.equal(db.prepare("SELECT active a FROM users WHERE username='nour'").get().a, 0);
[s] = await call('GET', '/api/v1/sync/pull?cursor=0', undefined, nourTok); assert.equal(s, 401, 'old session revoked');
[s] = await login('nour', 'pw-nour-12345'); assert.equal(s, 401, 'disabled user cannot log in');
[s] = await call('POST', '/api/v1/staff/enable', { username: 'nour' }, ownerTok); assert.equal(s, 200);
[s] = await login('nour', 'pw-nour-12345'); assert.equal(s, 200);
// role change takes effect at next login
[s] = await call('POST', '/api/v1/staff/role', { username: 'nour', role: 'pharmacist' }, ownerTok); assert.equal(s, 200);
[s, j] = await call('GET', '/api/v1/staff', undefined, ownerTok); assert.equal(j.staff.find((x) => x.username === 'nour').role, 'pharmacist');

// 6. D1 export -> restore into a NEW database (fresh KV): logins still work with the same hash
const R = await mkDb();
for (const t of ['tenants', 'branches', 'roles', 'users', 'user_roles']) {
  for (const row of db.prepare(`SELECT * FROM ${t}`).all()) {
    const k = Object.keys(row); R.db.prepare(`INSERT INTO ${t} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...k.map((x) => row[x]));
  }
}
const env2 = { ...env, DB: R.D1, KV: mkKV() };
assert.equal(R.db.prepare("SELECT password_hash h FROM users WHERE username='nour'").get().h, db.prepare("SELECT password_hash h FROM users WHERE username='nour'").get().h);
[s] = await login('nour', 'pw-nour-12345', env2); assert.equal(s, 200, 'restored D1 keeps the staff login');
[s] = await login('owner', PIN, env2); assert.equal(s, 200, 'restored owner logs in with its password');

// 7. legacy KV-only owner on an empty D1: imported one-way at the next login (same hash), KV row untouched
const L = await mkDb(); const kv3 = mkKV();
await createUser(kv3, { username: 'owner', password: 'legacy-pass-123', role: 'owner' }); await kv3.put('owner:exists', '{"at":1}');
const env3 = { ...env, DB: L.D1, KV: kv3 };
[s] = await login('owner', 'legacy-pass-123', env3); assert.equal(s, 200);
assert.equal(L.db.prepare("SELECT password_hash h FROM users WHERE username='owner'").get().h, JSON.parse(await kv3.get('user:owner')).password_hash);
assert.ok(await kv3.get('user:owner'), 'KV row kept');

// 7b. a DISABLED legacy KV user is never imported; a legacy user is imported only after a correct password; wrong password imports nothing
const L2 = await mkDb(); const kv4 = mkKV(); await L2.D1.prepare("INSERT INTO tenants (id, name) VALUES ('ten-s','x')").bind().run(); await L2.D1.prepare("INSERT INTO branches (id, tenant_id, name) VALUES ('br_x','ten-s','b')").bind().run();
await kv4.put('user:old', JSON.stringify({ ...(await createUser(mkKV(), { username: 'old', password: 'old-pass-12345', role: 'cashier' })), active: false }));
await createUser(kv4, { username: 'leg', password: 'leg-pass-12345', role: 'cashier' });
const env4 = { ...env, DB: L2.D1, KV: kv4 };
[s] = await login('old', 'old-pass-12345', env4); assert.equal(s, 401); assert.equal(count(L2.db, 'users', "username='old'"), 0, 'disabled legacy user not imported');
[s] = await login('leg', 'wrong-pass-0000', env4); assert.equal(s, 401); assert.equal(count(L2.db, 'users', "username='leg'"), 0, 'no import before the password is verified');
[s] = await login('leg', 'leg-pass-12345', env4); assert.equal(s, 200); assert.equal(count(L2.db, 'users', "username='leg'"), 1);
// PIN bootstrap is refused once a tenant exists in D1 (even if the KV flag is missing)
[s] = await login('owner', PIN, env4); assert.equal(s, 401, 'no PIN bootstrap when D1 already has a pharmacy');
// D1 failure fails closed: a broken D1 never falls back to the KV record
const brokenDB = { prepare: (sql) => ({ bind: () => ({ async first() { if (/FROM users LIMIT 1/.test(sql)) return null; throw new Error('d1 down'); }, async all() { throw new Error('d1 down'); }, async run() { throw new Error('d1 down'); } }) }), async batch() { throw new Error('d1 down'); } };
const kv5 = mkKV(); await createUser(kv5, { username: 'leg', password: 'leg-pass-12345', role: 'cashier' });
[s] = await login('leg', 'leg-pass-12345', { ...env, DB: brokenDB, KV: kv5 }); assert.equal(s, 401, 'D1 down: fail closed');

// 8. flags: NOVA_AUTH off -> staff routes 404; no D1 -> 404 (KV auth keeps working as before, see backend-auth.check.mjs)
[s] = await call('GET', '/api/v1/staff', undefined, ownerTok, { ...env, NOVA_AUTH: undefined }); assert.equal(s, 404);
[s] = await call('GET', '/api/v1/staff', undefined, ownerTok, { ...env, DB: undefined }); assert.equal(s, 404);

// 9. never DELETE FROM, never a plaintext password in the code paths
for (const f of ['backend/src/auth/staff-store.js', 'backend/src/auth/staff.js']) assert.ok(!/DELETE\s+FROM/i.test(readFileSync(fileURLToPath(new URL('../../' + f, import.meta.url)), 'utf8')), f + ' has no DELETE');
console.log('backend-staff OK');
