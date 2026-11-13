import assert from 'node:assert/strict';
import { handle } from '../../backend/src/index.js';
import * as A from '../../backend/src/auth/auth.js';

function mockKV() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}
const PIN = 'test-pin-123';
const post = (path, body, env, headers = {}) =>
  handle(new Request('https://x.test' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) }), env);

// flag OFF by default
let r = await post('/api/v1/auth/login', { username: 'owner', password: PIN }, { KV: mockKV(), NOVA_API_PIN: PIN });
assert.equal(r.status, 404); assert.equal((await r.json()).code, 'AUTH_DISABLED');
assert.equal(A.authEnabled({}), false); assert.equal(A.authEnabled({ NOVA_AUTH: '1' }), true);

// PBKDF2
const h = await A.hashPassword('pw1', 1000);
assert.ok(await A.verifyPassword('pw1', h)); assert.ok(!(await A.verifyPassword('pw2', h)));
assert.ok(!h.includes('pw1'));

const kv = mockKV();
const env = { NOVA_AUTH: '1', KV: kv, NOVA_API_PIN: PIN };
// wrong pin -> no owner
r = await post('/api/v1/auth/login', { username: 'owner', password: 'nope' }, env);
assert.equal(r.status, 401); let b = await r.json();
assert.equal(b.code, 'AUTH_INVALID_CREDENTIALS'); assert.match(b.requestId, /^req_/); assert.match(b.message_ar, /[؀-ۿ]/);
assert.ok(!kv.m.has('owner:exists'));

// bootstrap
r = await post('/api/v1/auth/login', { username: 'owner', password: PIN, device_id: 'dev-1', trust_device: true }, env);
assert.equal(r.status, 200); b = await r.json();
assert.ok(b.ok && b.access_token && b.refresh_token && b.trusted_device);
for (const [k, v] of kv.m) assert.ok(!String(v).includes(b.access_token) && !k.includes(b.access_token) && !k.includes(b.refresh_token), 'raw token stored');
assert.ok(kv.m.has('owner:exists'));
assert.ok(kv.m.has('dev:owner:dev-1'));

// bootstrap closed: PIN no longer creates anything for another account / after owner exists
r = await post('/api/v1/auth/login', { username: 'mallory', password: PIN }, env);
assert.equal(r.status, 401);
kv.m.delete('user:owner');
r = await post('/api/v1/auth/login', { username: 'owner', password: PIN }, env);
assert.equal(r.status, 401, 'bootstrap must stay closed once owner existed');

// restore: fresh env, login, authenticate, refresh rotation, logout
const kv2 = mockKV(); const env2 = { NOVA_AUTH: '1', KV: kv2, NOVA_API_PIN: PIN };
b = await (await post('/api/v1/auth/login', { username: 'owner', password: PIN }, env2)).json();
assert.equal(b.trusted_device, false);
const authReq = (t) => new Request('https://x.test/x', { headers: { Authorization: 'Bearer ' + t } });
assert.ok((await A.authenticate(authReq(b.access_token), env2)).session);
assert.ok((await A.authenticate(new Request('https://x.test/x'), env2)).fail);

r = await post('/api/v1/auth/refresh', { refresh_token: b.refresh_token }, env2);
assert.equal(r.status, 200); const b2 = await r.json();
assert.notEqual(b2.access_token, b.access_token);
assert.ok((await A.authenticate(authReq(b.access_token), env2)).fail, 'old access revoked on rotate');
r = await post('/api/v1/auth/refresh', { refresh_token: b.refresh_token }, env2);
assert.equal(r.status, 401, 'refresh token single-use');

// re-auth
let a = await A.authenticate(authReq(b2.access_token), env2);
assert.ok(A.requireReauth(a.session).ok);
const later = { now: () => Math.floor(Date.now() / 1000) + A.REAUTH_MAX_AGE_S + 10 };
assert.equal(A.requireReauth(a.session, later).fail.code, 'REAUTH_REQUIRED');
r = await post('/api/v1/auth/reauth', { password: 'bad' }, env2, { Authorization: 'Bearer ' + b2.access_token });
assert.equal(r.status, 401);
r = await post('/api/v1/auth/reauth', { password: PIN }, env2, { Authorization: 'Bearer ' + b2.access_token });
assert.equal(r.status, 200);

// expiry
const exp = { now: () => Math.floor(Date.now() / 1000) + A.ACCESS_TTL_S + 5 };
assert.equal((await A.authenticate(authReq(b2.access_token), env2, exp)).fail.code, 'AUTH_EXPIRED');

// logout
r = await post('/api/v1/auth/logout', {}, env2, { Authorization: 'Bearer ' + b2.access_token });
assert.equal(r.status, 200);
assert.ok((await A.authenticate(authReq(b2.access_token), env2)).fail);
r = await post('/api/v1/auth/logout', {}, env2);
assert.equal(r.status, 401);

// revoke all
b = await (await post('/api/v1/auth/login', { username: 'owner', password: PIN }, env2)).json();
assert.ok(await A.revokeUserSessions(kv2, 'owner') >= 1);
assert.ok((await A.authenticate(authReq(b.access_token), env2)).fail);

// lockout
const kv3 = mockKV(); const env3 = { NOVA_AUTH: '1', KV: kv3, NOVA_API_PIN: PIN };
await post('/api/v1/auth/login', { username: 'owner', password: PIN }, env3);
for (let i = 0; i < A.MAX_FAILS; i++) assert.equal((await post('/api/v1/auth/login', { username: 'owner', password: 'x' }, env3)).status, 401);
r = await post('/api/v1/auth/login', { username: 'owner', password: PIN }, env3);
assert.equal(r.status, 429); assert.equal((await r.json()).code, 'AUTH_LOCKED');

// bad request
assert.equal((await post('/api/v1/auth/login', {}, env3)).status, 400);
console.log('backend-auth.check: PASS');
