import assert from 'node:assert/strict';
import { handle } from '../../backend/src/index.js';
import * as M from '../../backend/src/msg-monitor.js';

const store = new Map();
const KV = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } };
const call = (env, method, path, h = {}, body) => handle(new Request('https://x.test' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env);
const A = { Authorization: 'Bearer tok-1' };

// flag default OFF
assert.equal(M.msgMonitorEnabled(undefined), false);
assert.equal(M.msgMonitorEnabled({ NOVA_MSG_MONITOR: '0' }), false);
let r = await call({ KV, NOVA_STATUS_TOKEN: 'tok-1' }, 'GET', '/api/v1/msg/health', A);
assert.equal(r.status, 404); assert.equal((await r.json()).code, 'MSG_MONITOR_DISABLED');
r = await call({ KV, NOVA_STATUS_TOKEN: 'tok-1' }, 'POST', '/api/v1/msg/kill-switch', A, { engage: true });
assert.equal(r.status, 404); assert.equal(store.size, 0);

const env = { NOVA_MSG_MONITOR: '1', NOVA_STATUS_TOKEN: 'tok-1', KV };
r = await call(env, 'GET', '/api/v1/msg/health');
assert.equal(r.status, 401);
const b401 = await r.json(); assert.equal(b401.code, 'MSG_MONITOR_UNAUTHORIZED'); assert.match(b401.message_ar, /[؀-ۿ]/); assert.ok(b401.requestId);
assert.equal((await call({ ...env, NOVA_STATUS_TOKEN: undefined }, 'GET', '/api/v1/msg/health', { Authorization: 'Bearer undefined' })).status, 401);

// unknown (nothing recorded) -> alerts, not critical
let b = await (await call(env, 'GET', '/api/v1/msg/health', A)).json();
assert.deepEqual(b.alerts.map((a) => a.level), ['unknown', 'unknown', 'unknown']);
assert.equal(b.autoReplies, 'on');

// expired / expiring / healthy
const now = Date.now();
store.set('msg:token_expires_at', new Date(now - 1000).toISOString());
store.set('msg:session_expires_at', new Date(now + 3600e3).toISOString());
store.set('msg:webhook_expires_at', new Date(now + 30 * 86400e3).toISOString());
b = await (await call(env, 'GET', '/api/v1/msg/health', A)).json();
assert.equal(b.ok, false);
assert.deepEqual(b.alerts.map((a) => a.code), ['MSG_TOKEN_EXPIRED', 'MSG_SESSION_EXPIRING']);
for (const a of b.alerts) assert.match(a.message_ar, /[؀-ۿ]/);

// kill switch: engage / release / validation / fail-closed
r = await call(env, 'POST', '/api/v1/msg/kill-switch', A, { engage: 'yes' });
assert.equal(r.status, 400);
r = await call(env, 'POST', '/api/v1/msg/kill-switch', A, { engage: true });
assert.equal((await r.json()).autoReplies, 'off');
assert.equal(await M.autoRepliesAllowed(env), false);
b = await (await call(env, 'GET', '/api/v1/msg/health', A)).json(); assert.equal(b.autoReplies, 'off');
r = await call(env, 'POST', '/api/v1/msg/kill-switch', A, { engage: false });
assert.equal((await r.json()).autoReplies, 'on');
assert.equal(await M.autoRepliesAllowed(env), true);
assert.equal(await M.autoRepliesAllowed({ KV: { get: async () => { throw new Error('x'); } } }), false);
assert.equal(await M.autoRepliesAllowed({}), false);
assert.equal((await call({ ...env, KV: undefined }, 'POST', '/api/v1/msg/kill-switch', A, { engage: true })).status, 503);

// redaction of phones + tokens
const red = M.redactMessaging({ msg: 'call +20 100 123 4567 now', note: 'Bearer abc.def-123', api_token: 'zzz', tg: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw' });
assert.ok(!/1234567/.test(JSON.stringify(red)) && red.msg.includes('***67'));
assert.equal(red.api_token, '[REDACTED]'); assert.ok(!JSON.stringify(red).includes('abc.def'));
assert.ok(!JSON.stringify(red).includes('AAHdq'));
assert.equal(M.redactMessaging({ n: 'order 12345' }).n, 'order 12345');
console.log('backend-msg-monitor OK');
