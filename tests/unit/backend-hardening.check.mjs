import assert from 'node:assert/strict';
import { handle } from '../../backend/src/index.js';
import * as S from '../../backend/src/security/hardening.js';
import * as A from '../../backend/src/auth/auth.js';

function mockKV() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}
const get = (p, env, h = {}) => handle(new Request('https://x.test' + p, { headers: h }), env);
const post = (p, env, h = {}) => handle(new Request('https://x.test' + p, { method: 'POST', headers: h, body: '{}' }), env);

// flag default OFF: no headers, no CSRF, no limits, export disabled
assert.equal(S.hardeningEnabled(undefined), false);
assert.equal(S.hardeningEnabled({ NOVA_HARDENING: '0' }), false);
let r = await get('/api/v1/health', {});
assert.equal(r.headers.get('Strict-Transport-Security'), null);
r = await post('/api/v1/health', { NOVA_HARDENING: '0' }, { Origin: 'https://evil.test' });
assert.equal(r.status, 405); // reached router, not CSRF
r = await get('/api/v1/export', { NOVA_AUTH: '1', KV: mockKV() });
assert.equal((await r.json()).code, 'HARDENING_DISABLED');

// headers on ON
const kv = mockKV();
const env = { NOVA_HARDENING: '1', NOVA_AUTH: '1', KV: kv, NOVA_API_PIN: 'pin-for-tests-1' };
r = await get('/api/v1/health', env);
for (const h of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options']) assert.ok(r.headers.get(h), h);
assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
r = await get('/nope', env);
assert.equal(r.status, 404); assert.ok(r.headers.get('Content-Security-Policy'));

// CSRF
r = await post('/api/v1/health', env, { Origin: 'https://evil.test' });
let b = await r.json();
assert.equal(r.status, 403); assert.equal(b.code, 'CSRF_ORIGIN'); assert.ok(b.requestId); assert.ok(/[؀-ۿ]/.test(b.message_ar));
r = await post('/api/v1/health', env, { Origin: 'https://x.test' });
assert.equal(r.status, 405);
r = await post('/api/v1/health', { ...env, CORS_ALLOW_ORIGINS: 'https://app.test' }, { Origin: 'https://app.test' });
assert.equal(r.status, 405);
r = await post('/api/v1/health', env, { Cookie: 'nova_csrf=abc123' });
assert.equal((await r.json()).code, 'CSRF_TOKEN');
r = await post('/api/v1/health', env, { Cookie: 'nova_csrf=abc123', 'X-CSRF-Token': 'wrong1' });
assert.equal((await r.json()).code, 'CSRF_TOKEN');
r = await post('/api/v1/health', env, { Cookie: 'nova_csrf=abc123', 'X-CSRF-Token': 'abc123' });
assert.equal(r.status, 405);

// token bucket
const k2 = mockKV();
const cfg = { capacity: 2, refillPerSec: 1 };
assert.ok((await S.rateLimit(k2, 'a', cfg, 1000)).ok);
assert.ok((await S.rateLimit(k2, 'a', cfg, 1000)).ok);
let rl = await S.rateLimit(k2, 'a', cfg, 1000);
assert.equal(rl.ok, false); assert.ok(rl.retryAfter >= 1);
assert.ok((await S.rateLimit(k2, 'a', cfg, 2500)).ok); // refilled
assert.ok((await S.rateLimit({ get() { throw new Error('kv down'); } }, 'a', cfg)).ok); // fail open

// login rate limit via handler
const lenv = { NOVA_HARDENING: '1', NOVA_AUTH: '1', KV: mockKV(), NOVA_API_PIN: 'pin-for-tests-1' };
let last;
for (let i = 0; i < 11; i++) last = await post('/api/v1/auth/login', lenv, { 'CF-Connecting-IP': '1.1.1.1' });
assert.equal(last.status, 429); assert.equal((await last.json()).code, 'RATE_LIMITED'); assert.ok(last.headers.get('Retry-After'));

// redaction
const red = S.redact({ user: 'a', password: 'p', nested: { access_token: 't', note: 'Bearer abc.def123 and 4111111111111111' }, list: [{ pin: '1' }] });
assert.equal(red.password, '[REDACTED]'); assert.equal(red.nested.access_token, '[REDACTED]'); assert.equal(red.list[0].pin, '[REDACTED]');
assert.ok(!JSON.stringify(red).includes('abc.def123') && !JSON.stringify(red).includes('4111111111111111'));
let logged = ''; S.safeLog({ authorization: 'Bearer zzz' }, (s) => { logged = s; });
assert.ok(!logged.includes('zzz'));

// export: owner + re-auth
const eenv = { NOVA_HARDENING: '1', NOVA_AUTH: '1', KV: mockKV(), NOVA_API_PIN: 'pin-for-tests-1',
  DB: { prepare: (q) => ({ async all() { return { results: q.includes('users') ? [{ username: 'owner', password_hash: 'h' }] : [] }; } }) } };
const login = await (await handle(new Request('https://x.test/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username: 'owner', password: 'pin-for-tests-1' }) }), eenv)).json();
assert.ok(login.access_token, 'login');
const auth = { Authorization: 'Bearer ' + login.access_token };
r = await get('/api/v1/export', eenv);
assert.equal(r.status, 401);
// stale reauth
const sessKey = [...eenv.KV.m.keys()].find((k) => k.startsWith('sess:'));
const sess = JSON.parse(eenv.KV.m.get(sessKey)); sess.reauthAt = 0; eenv.KV.m.set(sessKey, JSON.stringify(sess));
r = await get('/api/v1/export', eenv, auth);
assert.equal((await r.json()).code, 'REAUTH_REQUIRED');
sess.reauthAt = Math.floor(Date.now() / 1000); eenv.KV.m.set(sessKey, JSON.stringify(sess));
r = await get('/api/v1/export', eenv, auth);
b = await r.json();
assert.equal(r.status, 200); assert.equal(b.data.users[0].password_hash, '[REDACTED]');
// non-owner denied
sess.role = 'cashier'; eenv.KV.m.set(sessKey, JSON.stringify(sess));
r = await get('/api/v1/export', eenv, { ...auth, 'CF-Connecting-IP': '2.2.2.2' });
assert.equal(r.status, 403);
// export is rate limited per client (3 already used by anon IP)
r = await get('/api/v1/export', eenv, auth);
assert.equal(r.status, 429);
console.log('backend-hardening OK');
