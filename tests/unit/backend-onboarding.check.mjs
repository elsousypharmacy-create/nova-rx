import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handle } from '../../backend/src/index.js';
import * as O from '../../backend/src/onboarding.js';
import { sha256Hex } from '../../backend/src/auth/auth.js';

const sql = new DatabaseSync(':memory:');
for (const f of readdirSync('backend/migrations').filter((x) => /^00(01|02|17)_/.test(x)).sort()) sql.exec(readFileSync('backend/migrations/' + f, 'utf8'));
const mk = (q) => ({ args: [], bind(...a) { this.args = a; return this; },
  run: async function () { return sql.prepare(q).run(...this.args); },
  first: async function () { return sql.prepare(q).get(...this.args) ?? null; },
  all: async function () { return { results: sql.prepare(q).all(...this.args) }; } });
const DB = { prepare: mk };
const kv = new Map();
const KV = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } };
const tok = 'a'.repeat(40);
kv.set('sess:' + await sha256Hex(tok), JSON.stringify({ user: 'boss', role: 'owner', expires: 9e12, reauthAt: 9e12 }));
const tok2 = 'b'.repeat(40);
kv.set('sess:' + await sha256Hex(tok2), JSON.stringify({ user: 'c', role: 'cashier', expires: 9e12 }));
const env = { NOVA_ONBOARDING: '1', DB, KV };
const call = (e, path, body, t = tok, method = 'POST') => handle(new Request('https://x.test' + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { Authorization: 'Bearer ' + t } }), e);

// flag default OFF: 404, no DB touched
assert.equal(O.onboardingEnabled(undefined), false);
assert.equal(O.onboardingEnabled({ DB }), false);
assert.equal(O.onboardingEnabled({ NOVA_ONBOARDING: '0', DB }), false);
let r = await call({ DB: null, KV }, '/api/v1/onboarding/tenants', {});
assert.equal(r.status, 404); assert.equal((await r.json()).code, 'ONBOARDING_DISABLED');

// auth + owner only
r = await handle(new Request('https://x.test/api/v1/onboarding/tenants', { method: 'POST', body: '{}' }), env);
assert.equal(r.status, 401);
r = await call(env, '/api/v1/onboarding/tenants', {}, tok2); assert.equal(r.status, 403);

// validation
r = await call(env, '/api/v1/onboarding/tenants', { tenantId: 'X' }); let b = await r.json();
assert.equal(r.status, 400); assert.equal(b.code, 'ONBOARDING_BAD_TENANT'); assert.ok(b.requestId); assert.match(b.message_ar, /[؀-ۿ]/);

// create tenant
const req = { tenantId: 'acme', name: 'Acme', branches: ['Main', 'Second'], owner: { username: 'Boss1', password: 'longpassword' } };
r = await call(env, '/api/v1/onboarding/tenants', req); b = await r.json();
assert.equal(r.status, 201); assert.equal(b.branchIds.length, 2);
assert.equal(sql.prepare("SELECT COUNT(*) c FROM roles WHERE tenant_id='acme'").get().c, 7);
const u = sql.prepare("SELECT * FROM users WHERE tenant_id='acme'").get();
assert.equal(u.username, 'boss1'); assert.ok(u.password_hash.startsWith('pbkdf2$')); assert.ok(!u.password_hash.includes('longpassword'));
assert.equal(sql.prepare('SELECT COUNT(*) c FROM user_roles').get().c, 1);
r = await call(env, '/api/v1/onboarding/tenants', req); assert.equal(r.status, 409);

// status + import step
b = await (await call(env, '/api/v1/onboarding/status?tenantId=acme', null, tok, 'GET')).json();
assert.deepEqual(b.steps.map((s) => s.status), ['done', 'done', 'done', 'done', 'pending']);
r = await call(env, '/api/v1/onboarding/import-step', { tenantId: 'acme', skipped: true }); assert.equal(r.status, 200);
b = await (await call(env, '/api/v1/onboarding/status?tenantId=acme', null, tok, 'GET')).json();
assert.equal(b.steps[4].status, 'skipped');

// soft-disable: nothing deleted, reversible
const counts = () => ['tenants', 'branches', 'users', 'roles'].map((t) => sql.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c);
const before = counts();
r = await call(env, '/api/v1/onboarding/disable', { tenantId: 'acme' }); assert.equal(r.status, 200);
assert.deepEqual(counts(), before);
assert.equal(sql.prepare("SELECT status FROM tenants WHERE id='acme'").get().status, 'disabled');
assert.equal(sql.prepare("SELECT active FROM users WHERE tenant_id='acme'").get().active, 0);
r = await call(env, '/api/v1/onboarding/import-step', { tenantId: 'acme' }); assert.equal((await r.json()).code, 'ONBOARDING_TENANT_DISABLED');
await call(env, '/api/v1/onboarding/enable', { tenantId: 'acme' });
assert.equal(sql.prepare("SELECT status FROM tenants WHERE id='acme'").get().status, 'active');
r = await call(env, '/api/v1/onboarding/disable', { tenantId: 'nope' }); assert.equal(r.status, 404);

// sandbox: isolated, seeded
r = await call(env, '/api/v1/onboarding/sandbox', {}); b = await r.json();
assert.equal(r.status, 201); assert.ok(b.tenantId.startsWith('demo-')); assert.equal(b.seeded, 3);
assert.equal(sql.prepare('SELECT COUNT(*) c FROM products WHERE tenant_id=?').get(b.tenantId).c, 3);
assert.equal(sql.prepare("SELECT COUNT(*) c FROM products WHERE tenant_id='acme'").get().c, 0);
assert.equal(sql.prepare('SELECT sandbox FROM tenants WHERE id=?').get(b.tenantId).sandbox, 1);
const b2 = await (await call(env, '/api/v1/onboarding/sandbox', {})).json();
assert.notEqual(b2.tenantId, b.tenantId);
console.log('backend-onboarding OK');
