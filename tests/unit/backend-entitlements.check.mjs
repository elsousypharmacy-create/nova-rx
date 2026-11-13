import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handle } from '../../backend/src/index.js';
import * as E from '../../backend/src/entitlements.js';
import * as O from '../../backend/src/onboarding.js';
import { sha256Hex } from '../../backend/src/auth/auth.js';

const sql = new DatabaseSync(':memory:');
for (const f of readdirSync('backend/migrations').filter((x) => /^00(01|02|17|19)_/.test(x)).sort()) sql.exec(readFileSync('backend/migrations/' + f, 'utf8'));
const mk = (q) => ({ args: [], bind(...a) { this.args = a; return this; },
  run: async function () { return sql.prepare(q).run(...this.args); },
  first: async function () { return sql.prepare(q).get(...this.args) ?? null; },
  all: async function () { return { results: sql.prepare(q).all(...this.args) }; } });
const DB = { prepare: mk };
const kv = new Map();
const KV = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } };
const tok = 'a'.repeat(40);
kv.set('sess:' + await sha256Hex(tok), JSON.stringify({ user: 'boss', role: 'owner', expires: 9e12, reauthAt: 9e12 }));
const env = { NOVA_ENTITLEMENTS: '1', DB, KV };
const call = (e, path, body, method = 'POST') => handle(new Request('https://x.test' + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { Authorization: 'Bearer ' + tok } }), e);

// flag default OFF
assert.equal(E.entitlementsEnabled(undefined), false);
assert.equal(E.entitlementsEnabled({ DB }), false);
assert.equal(E.entitlementsEnabled({ NOVA_ENTITLEMENTS: '0', DB }), false);
let r = await call({ DB: null, KV }, '/api/v1/entitlements?tenantId=t', null, 'GET');
assert.equal(r.status, 404); assert.equal((await r.json()).code, 'ENTITLEMENTS_DISABLED');
assert.equal(sql.prepare('SELECT COUNT(*) c FROM plans').get().c, 0);

await O.createTenant(DB, { tenantId: 'acme', name: 'Acme', branches: ['Main'], owner: { username: 'boss1', password: 'longpassword' } });

// default = free plan
let b = await (await call(env, '/api/v1/entitlements?tenantId=acme', null, 'GET')).json();
assert.equal(b.planId, 'free'); assert.equal(b.readOnly, false); assert.ok(b.requestId);

// bad plan / unknown tenant
r = await call(env, '/api/v1/entitlements/subscription', { tenantId: 'acme', planId: 'nope' });
assert.equal((await r.json()).code, 'ENTITLEMENT_BAD_PLAN');
r = await call(env, '/api/v1/entitlements/subscription', { tenantId: 'ghost', planId: 'pro' }); assert.equal(r.status, 404);

// subscribe pro (mock billing), feature checks
const billing = E.createMockBilling();
const ch = await billing.charge('acme', 'pro');
r = await call(env, '/api/v1/entitlements/subscription', { tenantId: 'acme', planId: 'pro', expiresAt: '2999-01-01T00:00:00Z', provider: 'mock', providerRef: ch.providerRef });
assert.equal(r.status, 200);
let ent = await E.getEntitlements(DB, 'acme');
assert.equal(ent.planId, 'pro'); assert.equal(E.checkFeature(ent, 'delivery').ok, true);
assert.equal(E.checkFeature(ent, 'integration_api').code, 'ENTITLEMENT_FEATURE_DENIED');

// limits: free plan allows 1 branch -> reached
const free = await E.getEntitlements(DB, 'nobody');
assert.equal((await E.checkLimit(DB, 'acme', free, 'branches')).code, 'ENTITLEMENT_LIMIT_REACHED');
assert.equal((await E.checkLimit(DB, 'acme', ent, 'branches')).ok, true);
assert.equal((await E.checkLimit(DB, 'acme', ent, 'bogus')).code, 'ENTITLEMENT_BAD_LIMIT');

// expiry => read-only; nothing deleted; export still works
await O.createSandboxTenant(DB, { suffix: 'x' });
await call(env, '/api/v1/entitlements/subscription', { tenantId: 'demo-x', planId: 'pro', expiresAt: '2000-01-01T00:00:00Z' });
const counts = () => ['tenants', 'branches', 'users', 'products', 'inventory_batches'].map((t) => sql.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c);
const before = counts();
ent = await E.getEntitlements(DB, 'demo-x');
assert.equal(ent.expired, true); assert.equal(ent.readOnly, true);
let w = E.checkWrite(ent); assert.equal(w.code, 'ENTITLEMENT_READ_ONLY'); assert.match(w.message_ar, /[؀-ۿ]/);
assert.equal(E.checkFeature(ent, 'delivery').code, 'ENTITLEMENT_READ_ONLY');
assert.equal((await E.checkLimit(DB, 'demo-x', ent, 'products')).code, 'ENTITLEMENT_READ_ONLY');
assert.equal(E.checkFeature(ent, 'export').ok, true);
r = await call(env, '/api/v1/entitlements/export?tenantId=demo-x', null, 'GET'); b = await r.json();
assert.equal(r.status, 200); assert.equal(b.data.products.length, 3); assert.equal(b.data.inventory_batches.length, 3);
assert.deepEqual(counts(), before);

// renewal restores write access
await call(env, '/api/v1/entitlements/subscription', { tenantId: 'demo-x', planId: 'pro', expiresAt: '2999-01-01T00:00:00Z' });
assert.equal(E.checkWrite(await E.getEntitlements(DB, 'demo-x')).ok, true);
console.log('backend-entitlements: OK');
