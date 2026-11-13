import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { handle } from '../../backend/src/index.js';
import * as I from '../../backend/src/integration.js';

const sql = new DatabaseSync(':memory:');
sql.exec(readFileSync('backend/migrations/0014_integration_api.sql', 'utf8'));
const mk = (q) => ({ args: [], bind(...a) { this.args = a; return this; },
  run: async function () { return sql.prepare(q).run(...this.args); },
  first: async function () { return sql.prepare(q).get(...this.args) ?? null; } });
const DB = { prepare: mk };
const SECRET = 'test-secret';
const env = { NOVA_INTEGRATION: '1', NOVA_INGEST_SECRET: SECRET, DB };
const call = (e, path, init) => handle(new Request('https://x.test' + path, init), e);

// flag default OFF
assert.equal(I.integrationEnabled(undefined), false);
assert.equal(I.integrationEnabled({ NOVA_INTEGRATION: '0' }), false);
let r = await call({ DB }, '/api/v1/integration/ping');
assert.equal(r.status, 404); assert.equal((await r.json()).code, 'INTEGRATION_DISABLED');

// keys hashed
const k = await I.createApiKey(DB, { tenantId: 't1', name: 'erp', scopes: ['webhooks:receive'] });
const stored = sql.prepare('SELECT * FROM integration_api_keys').get();
assert.ok(!JSON.stringify(stored).includes(k.key)); assert.equal(stored.key_hash, await I.sha256Hex(k.key));
await assert.rejects(() => I.createApiKey(DB, { tenantId: 't1', name: 'x', scopes: ['bogus'] }));

r = await call(env, '/api/v1/integration/ping', { headers: { 'X-Api-Key': k.key } });
let b = await r.json(); assert.equal(r.status, 200); assert.equal(b.tenantId, 't1'); assert.equal(b.sandbox, false);
r = await call(env, '/api/v1/integration/ping', { headers: { 'X-Api-Key': 'nvk_nope' } });
b = await r.json(); assert.equal(r.status, 401); assert.equal(b.code, 'API_KEY_INVALID'); assert.match(b.message_ar, /[؀-ۿ]/); assert.ok(b.requestId);

// scope check
const ro = await I.createApiKey(DB, { tenantId: 't1', name: 'ro', scopes: ['products:read'] });
const body = JSON.stringify({ event: 'x' });
const send = async (key, over = {}, bd = body, sec = SECRET) => {
  const s = await I.signPayload(sec, bd, over.sign);
  return call(env, '/api/v1/integration/webhook', { method: 'POST', body: bd, headers: {
    'X-Api-Key': key, 'X-Nova-Timestamp': s.timestamp, 'X-Nova-Nonce': s.nonce, 'X-Nova-Signature': s.signature, ...over.h } });
};
r = await send(ro.key); assert.equal(r.status, 403); assert.equal((await r.json()).code, 'API_SCOPE_FORBIDDEN');

// good, replay, tamper, stale, wrong secret
const s = await I.signPayload(SECRET, body);
assert.equal(s.signature, 'v1=' + createHmac('sha256', SECRET).update(`${s.timestamp}.${s.nonce}.${body}`).digest('hex'));
const raw = (sg) => call(env, '/api/v1/integration/webhook', { method: 'POST', body, headers: { 'X-Api-Key': k.key, 'X-Nova-Timestamp': sg.timestamp, 'X-Nova-Nonce': sg.nonce, 'X-Nova-Signature': sg.signature } });
r = await raw(s); assert.equal(r.status, 200);
r = await raw(s); assert.equal(r.status, 409); assert.equal((await r.json()).code, 'REPLAY_DETECTED');
r = await send(k.key, {}, body, 'wrong'); assert.equal((await r.json()).code, 'SIGNATURE_INVALID');
r = await send(k.key, { h: { 'X-Nova-Signature': 'v1=00' } }); assert.equal((await r.json()).code, 'SIGNATURE_INVALID');
r = await send(k.key, { sign: { timestamp: Math.floor(Date.now() / 1000) - 3600 } }); assert.equal((await r.json()).code, 'TIMESTAMP_STALE');
r = await call({ ...env, NOVA_INGEST_SECRET: undefined }, '/api/v1/integration/webhook', { method: 'POST', body, headers: { 'X-Api-Key': k.key } });
assert.equal((await r.json()).code, 'SIGNING_NOT_CONFIGURED');

// revoke
await I.revokeApiKey(DB, k.id);
r = await call(env, '/api/v1/integration/ping', { headers: { 'X-Api-Key': k.key } }); assert.equal(r.status, 401);

// sandbox tenant
const sb = await I.createSandboxKey(DB);
assert.equal(sb.tenantId, 'sandbox');
b = await (await call(env, '/api/v1/integration/ping', { headers: { Authorization: 'Bearer ' + sb.key } })).json();
assert.equal(b.tenantId, 'sandbox'); assert.equal(b.sandbox, true);

// outbound webhook with mock transport
const sent = [];
const fetchImpl = async (url, init) => { sent.push({ url, init }); return { status: 200 }; };
let d = await I.deliverWebhook({ url: 'https://hook.test/in', event: 'e', data: { a: 1 }, secret: SECRET, fetchImpl });
assert.equal(d.ok, true);
const h = sent[0].init.headers;
const v = await I.verifySignature(SECRET, sent[0].init.body, { timestamp: h['X-Nova-Timestamp'], nonce: h['X-Nova-Nonce'], signature: h['X-Nova-Signature'] });
assert.equal(v.ok, true);
assert.equal((await I.deliverWebhook({ url: 'http://x', event: 'e', data: {}, secret: SECRET, fetchImpl })).code, 'URL_NOT_HTTPS');
assert.equal((await I.deliverWebhook({ url: 'https://x', event: 'e', data: {}, secret: SECRET })).code, 'NO_TRANSPORT');
assert.equal((await I.deliverWebhook({ url: 'https://x', event: 'e', data: {}, secret: SECRET, fetchImpl: async () => { throw new Error('n'); } })).code, 'DELIVERY_FAILED');
console.log('backend-integration OK');
