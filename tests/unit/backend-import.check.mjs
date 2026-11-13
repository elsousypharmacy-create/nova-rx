import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { importEnabled } from '../../backend/src/import.js';
import { createUser, login } from '../../backend/src/auth/auth.js';
const exp = createRequire(import.meta.url)('../../data-export.js');

const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({
  async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; },
  async first() { return db.prepare(sql).get(...a) || null; } }) }) };
const kvm = new Map();
const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const env = { NOVA_AUTH: '1', NOVA_IMPORT: '1', DB: D1, KV };
const count = () => db.prepare('SELECT (SELECT count(*) FROM sync_master)+(SELECT count(*) FROM sync_ledger) c').get().c;
const call = (e, path, body, h = {}) => handle(new Request('https://x.test/api/v1/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(body) }), e);

assert.equal(importEnabled({ DB: D1 }), false, 'default OFF');
let r = await call({ DB: D1, KV, NOVA_AUTH: '1' }, 'import/dry-run', {});
assert.equal(r.status, 404); assert.equal((await r.json()).code, 'IMPORT_DISABLED');
r = await call(env, 'import/dry-run', {});
assert.equal(r.status, 401);

await createUser(KV, { username: 'owner', password: 'pw-owner-12345', role: 'owner' });
await createUser(KV, { username: 'cash', password: 'pw-cash-123456', role: 'cashier' });
const tk = async (u, p) => { const l = await login(env, { username: u, password: p }); const x = l.ok || l; return { Authorization: 'Bearer ' + (x.access_token || x.accessToken || x.token) }; };
const H = await tk('owner', 'pw-owner-12345'), HC = await tk('cash', 'pw-cash-123456');

const bundle = exp.build({ master: { product: [{ id: 'p1', name: 'بنادول', price: 10 }, { id: 'p2', name: 'x' }] }, ledger: { invoice: [{ id: 'i1', total: 5 }] } });
assert.equal(bundle.format, 'nova-rx-export'); assert.equal(bundle.version, 1);
assert.ok(JSON.parse(exp.serialize(bundle)).master.product.length === 2);

r = await call(env, 'import/dry-run', { bundle }, HC);
assert.equal(r.status, 403);
r = await call(env, 'import/dry-run', { bundle }, H);
assert.equal(r.status, 200);
let j = await r.json();
assert.equal(j.written, 0); assert.match(j.requestId, /^req_/);
assert.deepEqual(j.report.totals, { records: 3, new: 3, identical: 0, different: 0 });
assert.equal(count(), 0, 'dry-run never writes');
r = await call(env, 'import/dry-run', { bundle: { format: 'zzz' } }, H);
assert.equal(r.status, 422); assert.equal((await r.json()).code, 'IMPORT_BAD_FORMAT');

// real import: owner, confirm
r = await call(env, 'import', { bundle }, HC); assert.equal(r.status, 403);
r = await call(env, 'import', { bundle }, H);
assert.equal(r.status, 400); assert.equal((await r.json()).code, 'IMPORT_CONFIRM_REQUIRED');
r = await call(env, 'import', { bundle, confirm: true }, H); assert.equal(r.status, 400);
assert.equal(count(), 0);
r = await call(env, 'import', { bundle, confirm: 'IMPORT' }, H);
assert.equal(r.status, 200); assert.equal((await r.json()).inserted, 3);
assert.equal(count(), 3);

// non-empty tenant refused; dry-run shows reconciliation
r = await call(env, 'import', { bundle, confirm: 'IMPORT' }, H);
assert.equal(r.status, 409); assert.equal((await r.json()).code, 'IMPORT_TENANT_NOT_EMPTY');
assert.equal(count(), 3);
const b2 = exp.build({ master: { product: [{ id: 'p1', name: 'بنادول', price: 10 }, { id: 'p2', name: 'changed' }, { id: 'p3' }] } });
j = await (await call(env, 'import/dry-run', { bundle: b2 }, H)).json();
assert.deepEqual(j.report.totals, { records: 3, new: 1, identical: 1, different: 1 });
assert.equal(j.report.tenantEmpty, false); assert.deepEqual(j.report.entities[0].differentIds, ['p2']);
assert.equal(count(), 3);
console.log('backend-import OK');
