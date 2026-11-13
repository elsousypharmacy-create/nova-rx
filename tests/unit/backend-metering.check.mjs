import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handle } from '../../backend/src/index.js';
import * as M from '../../backend/src/metering.js';
import { sha256Hex } from '../../backend/src/auth/auth.js';

const sql = new DatabaseSync(':memory:');
for (const f of readdirSync('backend/migrations').filter((x) => /^0018_/.test(x))) sql.exec(readFileSync('backend/migrations/' + f, 'utf8'));
const mk = (q) => ({ args: [], bind(...a) { this.args = a; return this; },
  run: async function () { return sql.prepare(q).run(...this.args); },
  first: async function () { return sql.prepare(q).get(...this.args) ?? null; },
  all: async function () { return { results: sql.prepare(q).all(...this.args) }; } });
const DB = { prepare: mk };
const kv = new Map();
const KV = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } };
const tok = 'a'.repeat(40), tok2 = 'b'.repeat(40);
kv.set('sess:' + await sha256Hex(tok), JSON.stringify({ user: 'boss', role: 'owner', expires: 9e12, reauthAt: 9e12 }));
kv.set('sess:' + await sha256Hex(tok2), JSON.stringify({ user: 'c', role: 'cashier', expires: 9e12 }));
const env = { NOVA_METERING: '1', DB, KV };
const call = (e, path, body, t = tok, method = 'POST') => handle(new Request('https://x.test' + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { Authorization: 'Bearer ' + t } }), e);

// flag default OFF
assert.equal(M.meteringEnabled(undefined), false);
assert.equal(M.meteringEnabled({ DB }), false);
assert.equal(M.meteringEnabled({ NOVA_METERING: '0', DB }), false);
let r = await call({ DB: null, KV }, '/api/v1/metering/usage?tenantId=acme', null, tok, 'GET');
assert.equal(r.status, 404); assert.equal((await r.json()).code, 'METERING_DISABLED');
r = await call({ DB, KV }, '/api/v1/metering/quota', {}); assert.equal(r.status, 404);
assert.equal(sql.prepare('SELECT COUNT(*) c FROM tenant_usage').get().c, 0);

// auth
r = await handle(new Request('https://x.test/api/v1/metering/usage', { method: 'GET' }), env); assert.equal(r.status, 401);
r = await call(env, '/api/v1/metering/usage?tenantId=acme', null, tok2, 'GET'); assert.equal(r.status, 403);

// validation
r = await call(env, '/api/v1/metering/quota', { tenantId: 'X', metric: 'jobs', limit: 1 }); let b = await r.json();
assert.equal(r.status, 400); assert.equal(b.code, 'METERING_BAD_TENANT'); assert.ok(b.requestId); assert.match(b.message_ar, /[؀-ۿ]/);
r = await call(env, '/api/v1/metering/quota', { tenantId: 'hot-1', metric: 'nope', limit: 1 }); assert.equal((await r.json()).code, 'METERING_BAD_METRIC');
r = await call(env, '/api/v1/metering/quota', { tenantId: 'hot-1', metric: 'jobs', limit: -1 }); assert.equal((await r.json()).code, 'METERING_BAD_LIMIT');

// quotas + hot-tenant isolation
r = await call(env, '/api/v1/metering/quota', { tenantId: 'hot-1', metric: 'requests', limit: 5 }); assert.equal(r.status, 200);
r = await call(env, '/api/v1/metering/quota', { tenantId: 'quiet-1', metric: 'requests', limit: 5 }); assert.equal(r.status, 200);
let denied = 0;
for (let i = 0; i < 50; i++) { const x = await M.recordUsage(DB, 'hot-1', 'requests'); if (!x.ok) { denied++; assert.equal(x.status, 429); assert.equal(x.code, 'METERING_QUOTA_EXCEEDED'); } }
assert.equal(denied, 45);
for (let i = 0; i < 5; i++) assert.equal((await M.recordUsage(DB, 'quiet-1', 'requests')).ok, true);
const hot = await M.getUsage(DB, 'hot-1'), quiet = await M.getUsage(DB, 'quiet-1');
assert.deepEqual(hot.metrics.find((m) => m.metric === 'requests'), { metric: 'requests', used: 5, denied: 45, limit: 5 });
assert.deepEqual(quiet.metrics.find((m) => m.metric === 'requests'), { metric: 'requests', used: 5, denied: 0, limit: 5 });
// hot tenant exhausted requests; other metrics and other tenants unaffected, no-quota tenants unlimited
assert.equal((await M.recordUsage(DB, 'hot-1', 'ai_calls', 3)).ok, true);
assert.equal((await M.recordUsage(DB, 'free-1', 'requests', 1000)).ok, true);
// a single over-sized consume is rejected whole
await M.setQuota(DB, 'hot-1', 'storage_bytes', 100);
assert.equal((await M.recordUsage(DB, 'hot-1', 'storage_bytes', 101)).status, 429);
assert.equal((await M.recordUsage(DB, 'hot-1', 'storage_bytes', 100)).ok, true);
// periods are separate
assert.equal((await M.recordUsage(DB, 'hot-1', 'requests', 1, new Date('2031-01-15'))).ok, true);

// endpoints
b = await (await call(env, '/api/v1/metering/usage?tenantId=hot-1', null, tok, 'GET')).json();
assert.equal(b.metrics.length, 4); assert.ok(b.requestId);
b = await (await call(env, '/api/v1/metering/cost-report?tenantId=hot-1', null, tok, 'GET')).json();
assert.equal(b.lines.find((l) => l.metric === 'ai_calls').costMinor, 15);
assert.equal(b.totalMinor, b.lines.reduce((s, l) => s + l.costMinor, 0));
b = await (await call(env, '/api/v1/metering/cost-report?tenantId=free-1', null, tok, 'GET')).json();
assert.equal(b.lines.find((l) => l.metric === 'requests').used, 1000);
console.log('backend-metering: OK');
