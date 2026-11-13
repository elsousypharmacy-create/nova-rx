import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handle } from '../../backend/src/index.js';
import * as R from '../../backend/src/releases.js';
import { sha256Hex } from '../../backend/src/auth/auth.js';

const sql = new DatabaseSync(':memory:');
for (const f of readdirSync('backend/migrations').filter((x) => /^00(01|19)_/.test(x)).sort()) sql.exec(readFileSync('backend/migrations/' + f, 'utf8'));
const mk = (q) => ({ args: [], bind(...a) { this.args = a; return this; },
  run: async function () { return sql.prepare(q).run(...this.args); },
  first: async function () { return sql.prepare(q).get(...this.args) ?? null; },
  all: async function () { return { results: sql.prepare(q).all(...this.args) }; } });
const DB = { prepare: mk };
const kv = new Map();
const KV = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } };
const ses = async (c, role, extra = {}) => { const t = c.repeat(40); kv.set('sess:' + await sha256Hex(t), JSON.stringify({ user: 'u', role, expires: 9e12, reauthAt: 9e12, ...extra })); return t; };
const owner = await ses('a', 'owner'), cashier = await ses('b', 'cashier', { tenantId: 'acme' });
const env = { NOVA_RELEASES: '1', DB, KV };
const call = (e, path, body, t = owner, method = 'POST') => handle(new Request('https://x.test' + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { Authorization: 'Bearer ' + t } }), e);

// default OFF
assert.equal(R.releasesEnabled(undefined), false);
assert.equal(R.releasesEnabled({ DB }), false);
assert.equal(R.releasesEnabled({ NOVA_RELEASES: '0', DB }), false);
let r = await call({ DB: null, KV }, '/api/v1/releases', null, owner, 'GET');
assert.equal(r.status, 404); assert.equal((await r.json()).code, 'RELEASES_DISABLED');
r = await call({ DB, KV }, '/api/v1/flags', { flag: 'new_pos', enabled: true, tenantId: 'acme' });
assert.equal(r.status, 404); assert.equal(sql.prepare('SELECT COUNT(*) c FROM tenant_flags').get().c, 0);

// auth + owner-only writes
r = await handle(new Request('https://x.test/api/v1/releases'), env); assert.equal(r.status, 401);
r = await call(env, '/api/v1/flags', { flag: 'new_pos', enabled: true }, cashier); assert.equal(r.status, 403);

// release notes + version
let b = await (await call(env, '/api/v1/releases', null, cashier, 'GET')).json();
assert.equal(b.latest, '0.1.0'); assert.ok(b.notes.length >= 1); assert.ok(b.requestId); assert.equal(b.current.version, '0.1.0');

// flags: validation, unknown OFF, rollout
r = await call(env, '/api/v1/flags', { tenantId: 'acme', flag: 'Bad Flag', enabled: true }); b = await r.json();
assert.equal(r.status, 400); assert.equal(b.code, 'RELEASES_BAD_FLAG'); assert.match(b.message_ar, /[؀-ۿ]/); assert.ok(b.requestId);
r = await call(env, '/api/v1/flags', { tenantId: 'acme', flag: 'new_pos', enabled: true, rolloutPct: 101 }); assert.equal((await r.json()).code, 'RELEASES_BAD_ROLLOUT');
b = await (await call(env, '/api/v1/flags', null, cashier, 'GET')).json(); assert.deepEqual(b.flags, {});
r = await call(env, '/api/v1/flags', { tenantId: 'acme', flag: 'new_pos', enabled: true, rolloutPct: 100 }); assert.equal(r.status, 200);
await call(env, '/api/v1/flags', { tenantId: 'acme', flag: 'off_one', enabled: false });
await call(env, '/api/v1/flags', { tenantId: 'acme', flag: 'zero', enabled: true, rolloutPct: 0 });
b = await (await call(env, '/api/v1/flags', null, cashier, 'GET')).json();
assert.deepEqual(b.flags, { new_pos: true, off_one: false, zero: false });
// per-tenant isolation
const other = await ses('c', 'cashier', { tenantId: 'beta' });
b = await (await call(env, '/api/v1/flags', null, other, 'GET')).json(); assert.deepEqual(b.flags, {});

// gradual rollout: deterministic, monotonic, roughly proportional
assert.equal(R.bucket('acme', 'x'), R.bucket('acme', 'x'));
let on50 = 0, on10 = 0;
for (let i = 0; i < 1000; i++) {
  const t = 'tenant-' + i;
  const a = R.isFlagOn({ flag: 'x', enabled: 1, rollout_pct: 50 }, t), c = R.isFlagOn({ flag: 'x', enabled: 1, rollout_pct: 10 }, t);
  if (a) on50++; if (c) on10++; if (c) assert.ok(a);
  assert.equal(R.isFlagOn({ flag: 'x', enabled: 1, rollout_pct: 100 }, t), true);
  assert.equal(R.isFlagOn({ flag: 'x', enabled: 1, rollout_pct: 0 }, t), false);
}
assert.ok(on50 > 400 && on50 < 600, 'on50=' + on50); assert.ok(on10 > 50 && on10 < 150, 'on10=' + on10);

// diagnostics: off by default, opt-in, allow-listed, no sensitive data
const ev = { kind: 'error', code: 'SYNC_FAILED', appVersion: '1.2.3' };
r = await call(env, '/api/v1/diagnostics', ev, cashier); assert.equal(r.status, 403); assert.equal((await r.json()).code, 'DIAGNOSTICS_NOT_OPTED_IN');
assert.equal(sql.prepare('SELECT COUNT(*) c FROM diagnostics_events').get().c, 0);
r = await call(env, '/api/v1/diagnostics/optin', { tenantId: 'acme', enabled: true }); assert.equal(r.status, 200);
r = await call(env, '/api/v1/diagnostics', { ...ev, patient: 'Ali', phone: '0501234567', message: 'secret' }, cashier); assert.equal(r.status, 200);
r = await call(env, '/api/v1/diagnostics', { ...ev, code: 'free text with PII' }, cashier); assert.equal(r.status, 400);
r = await call(env, '/api/v1/diagnostics', { ...ev, kind: 'x' }, cashier); assert.equal(r.status, 400);
const rows = sql.prepare('SELECT * FROM diagnostics_events').all();
assert.equal(rows.length, 1); assert.deepEqual(Object.keys(rows[0]).sort(), ['app_version', 'code', 'created_at', 'id', 'kind', 'tenant_id']);
assert.ok(!JSON.stringify(rows).match(/Ali|0501234567|secret/));
await call(env, '/api/v1/diagnostics/optin', { tenantId: 'acme', enabled: false });
r = await call(env, '/api/v1/diagnostics', ev, cashier); assert.equal(r.status, 403);

console.log('backend-releases checks passed');
