import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handle } from '../../backend/src/index.js';
import * as O from '../../backend/src/observability.js';

const get = (env, h = {}) => handle(new Request('https://x.test/api/v1/status', { headers: h }), env);
const sql = new DatabaseSync(':memory:');
sql.exec('CREATE TABLE sync_ops (op_key TEXT)');
sql.exec("INSERT INTO sync_ops VALUES ('a'),('b')");
const DB = { prepare: (q) => ({ first: async () => sql.prepare(q).get() }) };
const kvm = new Map([['backup:last', new Date(Date.now() - 3600e3).toISOString()]]);
const KV = { get: async (k) => kvm.get(k) ?? null };
const R2 = { head: async () => null };

// flag default OFF
assert.equal(O.observabilityEnabled(undefined), false);
assert.equal(O.observabilityEnabled({ NOVA_OBSERVABILITY: '0' }), false);
let r = await get({ DB, KV, R2, NOVA_STATUS_TOKEN: 't' }, { Authorization: 'Bearer t' });
assert.equal(r.status, 404); assert.equal((await r.json()).code, 'OBSERVABILITY_DISABLED');

const env = { NOVA_OBSERVABILITY: '1', NOVA_STATUS_TOKEN: 'tok-123', DB, KV, R2 };
r = await get(env);
assert.equal(r.status, 401);
b: { const b = await r.json(); assert.equal(b.code, 'STATUS_UNAUTHORIZED'); assert.match(b.message_ar, /[؀-ۿ]/); assert.ok(b.requestId); }
r = await get({ ...env, NOVA_STATUS_TOKEN: undefined }, { Authorization: 'Bearer undefined' });
assert.equal(r.status, 401);

r = await get(env, { Authorization: 'Bearer tok-123' });
let b = await r.json();
assert.equal(r.status, 200); assert.equal(b.ok, true);
assert.equal(b.db, 'ok'); assert.equal(b.kv, 'ok'); assert.equal(b.r2, 'ok');
assert.equal(b.queueDepth, 2);
assert.ok(b.lastBackupAgeSeconds >= 3600 && b.lastBackupAgeSeconds < 3700);
assert.equal(b.errors.STATUS_UNAUTHORIZED, 2);

// degraded + absent bindings
r = await get({ ...env, DB: { prepare: () => ({ first: async () => { throw new Error('boom'); } }) }, KV: undefined, R2: undefined }, { Authorization: 'Bearer tok-123' });
b = await r.json();
assert.equal(b.status, 'degraded'); assert.equal(b.db, 'error'); assert.equal(b.kv, 'absent'); assert.equal(b.queueDepth, null);

// structured logs + redaction
const lines = [];
O.logEvent('info', 'x', { password: 'p', note: 'Bearer abc.def', card: '4111111111111111', n: 1 }, (l) => lines.push(l));
const j = JSON.parse(lines[0]);
assert.equal(j.level, 'info'); assert.equal(j.event, 'x'); assert.equal(j.password, '[REDACTED]');
assert.equal(j.note, 'Bearer [REDACTED]'); assert.equal(j.card, '[REDACTED]'); assert.ok(j.ts);
O.logEvent('info', 'y', { c: (() => { const o = {}; o.o = o; return o; })() }, () => {}); // no throw

// counters
O.resetErrorCounters(); O.countError('A'); O.countError('A');
assert.deepEqual(O.errorCounters(), { A: 2 });
console.log('backend-observability OK');
