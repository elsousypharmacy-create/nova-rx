// Opening-balance tool: validation, idempotent keys, and a real push into an in-memory backend (stock appears; a second push adds nothing;
// a synced sale then succeeds instead of waiting for stock). Run: node tests/unit/opening-balance.check.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { createTenant } from '../../backend/src/onboarding.js';
import { createUser, login } from '../../backend/src/auth/auth.js';
import { stockOnHand } from '../../backend/src/sales/service.js';
import { buildOps, parseRows } from '../../tools/backend/opening-balance.mjs';

const csv = 'code,qty,cost,lot,expiry,name\n622100,40,12.5,L1,2028-05-01,Panadol\n6221,0,1,,,bad qty\n622100,5,12.5,L1,,dup\n7001,12,3,,,Plain\nx y,3,1,L 2,,bad lot\n8001,5,2,,2028-13-xx,bad date\n';
const { ops, issues, totals } = buildOps(parseRows(csv, true));
assert.equal(ops.length, 2); assert.equal(totals.units, 52); assert.equal(issues.length, 4, JSON.stringify(issues));
assert.deepEqual(ops.map((o) => o.key), ['open:622100:L1', 'open:7001:OPEN']);
assert.equal(ops[0].payload.lines[0].price, 12.5); assert.equal(ops[0].entity, 'stock_receipt');
assert.deepEqual(buildOps(parseRows('[{"code":"A","qty":3,"cost":1}]', false)).ops.length, 1);

const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const mk = (sql, a = []) => ({ bind: (...x) => mk(sql, x), async first() { return db.prepare(sql).get(...a) ?? null; }, async all() { return { results: db.prepare(sql).all(...a) }; }, async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; }, get sql() { return sql; }, get a() { return a; } });
const D1 = { prepare: (s) => mk(s), async batch(list) { db.exec('BEGIN'); try { for (const s of list) db.prepare(s.sql).run(...s.a); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } } };
const kvm = new Map(); const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const env = { NOVA_AUTH: '1', NOVA_SYNC: '1', NOVA_SALES_WRITES: '1', DB: D1, KV, NOVA_API_PIN: 'pin-xyz-1', NOVA_TENANT_ID: 'ten-a' };
const A = await createTenant(D1, { tenantId: 'ten-a', name: 'x', branches: ['b'], owner: { username: 'owner-a', password: 'pw-owner-a-12345' } });
await createUser(KV, { username: 'owner-a', password: 'pw-owner-a-12345', role: 'owner' });
const tok = (await login(env, { username: 'owner-a', password: 'pw-owner-a-12345' })).ok.access_token;
const H = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }; const sc = { tenantId: 'ten-a', branchId: A.branchIds[0] };
const push = async (o) => (await (await handle(new Request('https://x.test/api/v1/sync/push', { method: 'POST', headers: H, body: JSON.stringify({ ops: o }) }), env)).json()).results;

const sale = { key: 'inv-1', payload: { id: 'inv-1', number: 'inv-1', lines: [{ code: '622100', qty: 3, price: 20 }] } };
assert.equal((await push([sale]))[0].status, 'conflict', 'before the opening stock the sale waits');
const r1 = await push(ops); assert.deepEqual(r1.map((x) => x.status), ['applied', 'applied']);
assert.equal(await stockOnHand(env, sc, '622100'), 40); assert.equal(await stockOnHand(env, sc, '7001'), 12);
const r2 = await push(ops); assert.ok(r2.every((x) => x.duplicate === true)); assert.equal(await stockOnHand(env, sc, '622100'), 40, 'second run adds nothing');
assert.equal((await push([sale]))[0].status, 'applied'); assert.equal(await stockOnHand(env, sc, '622100'), 37);
console.log('opening-balance OK');
