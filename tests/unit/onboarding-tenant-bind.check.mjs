// S4-01: onboarding / tenant-admin routes are bound to the session tenant (fail-closed); tenant A cannot touch tenant B;
// only the platform operator (NOVA_PLATFORM_TENANT, unset by default) creates pharmacies. Run: node tests/unit/onboarding-tenant-bind.check.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handle } from '../../backend/src/index.js';
import * as O from '../../backend/src/onboarding.js';
import { sha256Hex } from '../../backend/src/auth/auth.js';

const sql = new DatabaseSync(':memory:');
for (const f of readdirSync('backend/migrations').filter((x) => /^00(01|02|17)_/.test(x)).sort()) {
  sql.exec(readFileSync('backend/migrations/' + f, 'utf8'));
}

const mk = (q) => ({
  args: [],
  bind(...a) {
    this.args = a;
    return this;
  },
  run: async function () {
    return sql.prepare(q).run(...this.args);
  },
  first: async function () {
    return sql.prepare(q).get(...this.args) ?? null;
  },
  all: async function () {
    return { results: sql.prepare(q).all(...this.args) };
  }
});

const DB = { prepare: mk };
const kv = new Map();
const KV = {
  get: async (k) => kv.get(k) ?? null,
  put: async (k, v) => {
    kv.set(k, v);
  }
};

const sess = async (tok, s) =>
  kv.set('sess:' + (await sha256Hex(tok.padEnd(40, 'x'))), JSON.stringify({ expires: 9e12, reauthAt: 9e12, ...s }));

const call = (e, path, body, t, method = 'POST') =>
  handle(
    new Request('https://x.test' + path, {
      method,
      body: body ? JSON.stringify(body) : undefined,
      headers: { Authorization: 'Bearer ' + t.padEnd(40, 'x') } // tokens must be long enough for authenticate()
    }),
    e
  );

await O.createTenant(DB, {
  tenantId: 'ten-a',
  name: 'A',
  branches: ['Main'],
  owner: { username: 'ownera1', password: 'longpassword1' }
});
await O.createTenant(DB, {
  tenantId: 'ten-b',
  name: 'B',
  branches: ['Main'],
  owner: { username: 'ownerb1', password: 'longpassword1' }
});

await sess('tokA', { user: 'ownera1', role: 'owner', tenantId: 'ten-a' });
await sess('tokB', { user: 'ownerb1', role: 'owner', tenantId: 'ten-b' });
await sess('tokNone', { user: 'legacy', role: 'owner' });
await sess('tokP', { user: 'plat', role: 'owner', tenantId: 'platform' });
await sess('tokC', { user: 'cash1', role: 'cashier', tenantId: 'ten-a' });

const env = { NOVA_ONBOARDING: '1', DB, KV };
const envP = { ...env, NOVA_PLATFORM_TENANT: 'platform' };

{
  const r = await call(env, '/api/v1/onboarding/status', null, 'tokNone', 'GET');
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'ONBOARDING_TENANT_REQUIRED');
}

{
  const r = await call(env, '/api/v1/onboarding/status', null, 'tokC', 'GET');
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'PERMISSION_DENIED');
}

{
  const r = await call(env, '/api/v1/onboarding/status', null, 'tokA', 'GET');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.tenant.id, 'ten-a');
}

{
  const r = await call(env, '/api/v1/onboarding/status?tenantId=ten-b', null, 'tokA', 'GET');
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'ONBOARDING_CROSS_TENANT');
}

{
  const before = sql.prepare("SELECT * FROM tenants WHERE id = 'ten-b'").get();
  const r = await call(env, '/api/v1/onboarding/disable', { tenantId: 'ten-b' }, 'tokA', 'POST');
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'ONBOARDING_CROSS_TENANT');
  const after = sql.prepare("SELECT * FROM tenants WHERE id = 'ten-b'").get();
  assert.deepEqual(after, before);
}

{
  const r = await call(env, '/api/v1/onboarding/disable', {}, 'tokA', 'POST');
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'ONBOARDING_CROSS_TENANT');
}

{
  const r = await call(env, '/api/v1/onboarding/import-step', { skipped: true }, 'tokA', 'POST');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
}

{
  const r = await call(env, '/api/v1/onboarding/import-step', { tenantId: 'ten-b', skipped: true }, 'tokA', 'POST');
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'ONBOARDING_CROSS_TENANT');
}

const newTenantC = {
  tenantId: 'ten-c',
  name: 'C',
  branches: ['Main'],
  owner: { username: 'ownerc1', password: 'longpassword1' }
};

{
  const r1 = await call(env, '/api/v1/onboarding/tenants', newTenantC, 'tokA', 'POST');
  assert.equal(r1.status, 403);
  assert.equal((await r1.json()).code, 'ONBOARDING_PLATFORM_ONLY');

  const r2 = await call(envP, '/api/v1/onboarding/tenants', newTenantC, 'tokA', 'POST');
  assert.equal(r2.status, 403);
  assert.equal((await r2.json()).code, 'ONBOARDING_PLATFORM_ONLY');
}

{
  const r = await call(env, '/api/v1/onboarding/tenants', newTenantC, 'tokP', 'POST');
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'ONBOARDING_PLATFORM_ONLY');
}

{
  const r = await call(envP, '/api/v1/onboarding/tenants', newTenantC, 'tokP', 'POST');
  assert.equal(r.status, 201);
  assert.equal((await r.json()).tenantId, 'ten-c');
}

{
  const r = await call(envP, '/api/v1/onboarding/disable', { tenantId: 'ten-b' }, 'tokP', 'POST');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
}

{
  const wrangler = readFileSync('backend/wrangler.toml', 'utf8');
  const idx = wrangler.indexOf('[env.production');
  const prodSection = idx >= 0 ? wrangler.slice(idx) : '';
  assert.equal(/NOVA_ONBOARDING\s*=\s*"1"/.test(prodSection), false);
}

console.log('onboarding-tenant-bind OK');
