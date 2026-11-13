import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { audit, auditEnabled, redact, buildRow } from '../../backend/src/audit.js';
import { handle } from '../../backend/src/index.js';

const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({ async run() { db.prepare(sql).run(...a); return {}; } }) }) };
const rows = () => db.prepare('SELECT * FROM audit_logs ORDER BY created_at, rowid').all();

// flag default OFF
assert.equal(auditEnabled({ DB: D1 }), false);
assert.equal(await audit({ DB: D1 }, { action: 'x' }), false);
assert.equal(rows().length, 0);
assert.equal(auditEnabled({ NOVA_AUDIT: '1' }), false, 'needs DB');

// redaction
const env = { NOVA_AUDIT: '1', DB: D1 };
assert.equal(await audit(env, { actor: 'u1', action: 'price.change', entity: 'item', entityId: 'i1', requestId: 'req_1', reason: 'call 0791234567 Bearer abcdef123456',
  before: { price: 1, password: 'hunter2', phone: '0791234567', note: 'tel +962 79 123 4567' }, after: { price: 2, api_token: 'zzz' } }), true);
const r = rows()[0];
assert.equal(r.actor_id, 'u1'); assert.equal(r.request_id, 'req_1'); assert.ok(r.created_at);
const all = JSON.stringify(r);
for (const leak of ['hunter2', '0791234567', '123 4567', 'abcdef123456', 'zzz']) assert.ok(!all.includes(leak), 'leak ' + leak);
assert.deepEqual(JSON.parse(r.before_json).password, '[REDACTED]');
assert.match(JSON.parse(r.before_json).phone, /^\*+4567$/);
assert.equal(JSON.parse(r.after_json).price, 2);
assert.equal(redact(undefined), null);

// append-only
assert.throws(() => db.exec("UPDATE audit_logs SET action='z'"), /append-only/);
assert.throws(() => db.exec('DELETE FROM audit_logs'), /append-only/);

// sink failure never throws
assert.equal(await audit({ NOVA_AUDIT: '1', DB: { prepare() { throw new Error('boom'); } } }, { action: 'x' }), false);
assert.ok(buildRow({ action: 'a' }).id.startsWith('aud_'));

// wired into auth
function mockKV() { const m = new Map(); return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } }; }
const aenv = { NOVA_AUTH: '1', NOVA_AUDIT: '1', DB: D1, KV: mockKV(), NOVA_API_PIN: 'pin-xyz-1' };
const post = (p, b, h = {}) => handle(new Request('https://x.test' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }), aenv);
const n0 = rows().length;
let res = await post('/api/v1/auth/login', { username: 'owner', password: 'bad-password' });
assert.equal(res.status, 401);
let a = rows().slice(n0);
assert.equal(a.length, 1); assert.equal(a[0].action, 'auth.login'); assert.equal(a[0].outcome, 'DENIED');
assert.equal(a[0].reason, 'AUTH_INVALID_CREDENTIALS'); assert.equal(a[0].actor_id, 'owner'); assert.match(a[0].request_id, /^req_/);
assert.ok(!JSON.stringify(a[0]).includes('bad-password'));
res = await post('/api/v1/auth/login', { username: 'owner', password: 'pin-xyz-1' });
const tok = (await res.json()).access_token;
a = rows().slice(n0 + 1); assert.equal(a[0].outcome, 'ALLOWED');
assert.ok(!JSON.stringify(rows()).includes(tok));
// permission denial: stale re-auth is a 403 -> permission.denied; here use missing token on reauth
res = await post('/api/v1/auth/reauth', { password: 'x' });
assert.equal(res.status, 401);
assert.equal(rows().at(-1).action, 'auth.reauth'); assert.equal(rows().at(-1).outcome, 'DENIED');
// flag off: no rows added
const cnt = rows().length;
await handle(new Request('https://x.test/api/v1/auth/login', { method: 'POST', body: '{}' }), { NOVA_AUTH: '1', DB: D1, KV: mockKV() });
assert.equal(rows().length, cnt);
console.log('backend-audit OK');
