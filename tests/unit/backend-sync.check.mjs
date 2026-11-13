import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { syncEnabled } from '../../backend/src/sync.js';
import { createUser, login } from '../../backend/src/auth/auth.js';

const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({
  async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; },
  async first() { return db.prepare(sql).get(...a) || null; } }) }) };
const kvm = new Map();
const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const env = { NOVA_AUTH: '1', NOVA_SYNC: '1', DB: D1, KV, NOVA_API_PIN: 'pin-xyz-1' };

assert.equal(syncEnabled({ DB: D1 }), false, 'default OFF');
const call = (e, ops, h = {}) => handle(new Request('https://x.test/api/v1/sync/push', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(ops) }), e);
let r = await call({ DB: D1, KV, NOVA_AUTH: '1' }, { ops: [] });
assert.equal(r.status, 404); assert.equal((await r.json()).code, 'SYNC_DISABLED');
assert.equal(db.prepare('SELECT count(*) c FROM sync_ops').get().c, 0);

r = await call(env, { ops: [] });
assert.equal(r.status, 401);

await createUser(KV, { username: 'owner', password: 'pw-owner-12345', role: 'owner' });
const lg = await login(env, { username: 'owner', password: 'pw-owner-12345' });
const tok = (lg.ok || lg).access_token || (lg.ok || lg).accessToken || (lg.ok || lg).token;
assert.ok(tok, 'token ' + JSON.stringify(Object.keys(lg.ok || lg)));
const H = { Authorization: 'Bearer ' + tok };
const push = async (ops) => { const x = await call(env, { ops }, H); assert.equal(x.status, 200); const j = await x.json(); assert.match(j.requestId, /^req_/); return j.results; };

r = await call(env, { nope: 1 }, H);
assert.equal(r.status, 400); assert.equal((await r.json()).code, 'SYNC_BAD_REQUEST');

// outbox-style op: idempotent
const inv = { key: 'inv-1', payload: { id: 'inv-1', total: 5, lines: [{ code: 'A', qty: 1, price: 5 }] } };
let res = await push([inv]);
assert.deepEqual([res[0].key, res[0].status], ['inv-1', 'applied']);
res = await push([inv]);
assert.equal(res[0].status, 'applied'); assert.equal(res[0].duplicate, true);
assert.equal(db.prepare('SELECT count(*) c FROM sync_ledger').get().c, 1);

// ledger append-only: same id different payload rejected, other key
res = await push([{ key: 'inv-1b', kind: 'ledger', entity: 'invoice', id: 'inv-1', payload: { total: 99 } }]);
assert.equal(res[0].status, 'rejected'); assert.equal(res[0].code, 'SYNC_LEDGER_EXISTS'); assert.ok(res[0].message_ar);
assert.throws(() => db.exec('UPDATE sync_ledger SET entity=entity'), /append-only/);
assert.throws(() => db.exec('DELETE FROM sync_ledger'), /append-only/);

// master: version check
const m = (key, payload, baseVersion) => ({ key, kind: 'master', entity: 'product', id: 'p1', payload, baseVersion });
res = await push([m('m1', { price: 1 }, 0)]);
assert.deepEqual([res[0].status, res[0].version], ['applied', 1]);
res = await push([m('m2', { price: 2 }, 1)]);
assert.deepEqual([res[0].status, res[0].version], ['applied', 2]);
res = await push([m('m3', { price: 3 }, 1)]);
assert.equal(res[0].status, 'conflict'); assert.equal(res[0].serverVersion, 2);
assert.equal(JSON.parse(db.prepare('SELECT data_json FROM sync_master').get().data_json).price, 2, 'stale write not applied');
res = await push([m('m4', { price: 4 })]);
assert.deepEqual([res[0].status, res[0].version], ['applied', 3], 'LWW without base');
res = await push([m('m3', { price: 3 }, 1)]);
assert.equal(res[0].duplicate, true); assert.equal(res[0].status, 'conflict', 'replay returns stored result');
res = await push([m('m5', { x: 1 }, 7)].map((o) => ({ ...o, id: 'ghost' })));
assert.equal(res[0].status, 'conflict');

// per-op results, bad ops don't fail batch
res = await push([{ key: 'bad key!', payload: {} }, { key: 'ok-1', payload: { a: 1 } }, null, { key: 'k2', kind: 'zzz', payload: {} }]);
assert.deepEqual(res.map((x) => x.status), ['rejected', 'applied', 'rejected', 'rejected']);
assert.equal(res[0].code, 'SYNC_OP_INVALID');

// too many
r = await call(env, { ops: Array.from({ length: 201 }, (_, i) => ({ key: 'k' + i, payload: {} })) }, H);
assert.equal(r.status, 413);
console.log('backend-sync OK');
