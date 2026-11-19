import { audit } from '../audit.js';
import { d1Usable, tenantExists, findUser, insertUser, ensureTenantWithOwner, scopeFor } from './staff-store.js';
// SEC-01: login + sessions. WebCrypto only, KV storage, no network. Flag NOVA_AUTH=1 (default OFF).
// S1-06: with a D1 binding, staff accounts live in D1 (users/roles/user_roles) so backups restore them; KV keeps only
// sessions, lockouts and the legacy owner record (imported one-way into D1 at its next login, never deleted from KV).
export const PBKDF2_ITERATIONS = 100000; // Workers WebCrypto maximum
export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_S = 12 * 3600;
export const TRUSTED_TTL_S = 30 * 86400;
export const REAUTH_MAX_AGE_S = 300;
export const MAX_FAILS = 5;
export const LOCK_S = 900;

export function authEnabled(env) { return !!env && String(env.NOVA_AUTH) === '1'; }

const hex = (u8) => Array.from(u8, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array((s.match(/../g) || []).map((x) => parseInt(x, 16)));
const enc = (s) => new TextEncoder().encode(s);
const nowS = (o) => (o && o.now ? o.now() : Math.floor(Date.now() / 1000));

export async function sha256Hex(text) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc(text)))); }
export function randomToken(n = 32) { const b = new Uint8Array(n); crypto.getRandomValues(b); return hex(b); }

async function derive(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
export async function hashPassword(password, iter = PBKDF2_ITERATIONS) {
  const salt = new Uint8Array(16); crypto.getRandomValues(salt);
  return `pbkdf2$sha256$${iter}$${hex(salt)}$${hex(await derive(password, salt, iter))}`;
}
export async function verifyPassword(password, stored) {
  const p = String(stored || '').split('$');
  if (p.length !== 5 || p[0] !== 'pbkdf2' || p[1] !== 'sha256') return false;
  const iter = Number(p[2]);
  if (!Number.isInteger(iter) || iter < 1 || iter > PBKDF2_ITERATIONS) return false;
  return safeEq(await derive(String(password), unhex(p[3]), iter), unhex(p[4]));
}

const kget = async (kv, k) => { const v = await kv.get(k); return v ? JSON.parse(v) : null; };
const kput = (kv, k, v, ttl) => kv.put(k, JSON.stringify(v), ttl ? { expirationTtl: Math.max(60, ttl) } : undefined);

function fail(code, message_ar, status) { return { fail: { code, message_ar, status } }; }
const BAD = () => fail('AUTH_INVALID_CREDENTIALS', 'اسم المستخدم أو كلمة المرور غير صحيحة.', 401);

// Create the one-time owner. Only allowed while no owner exists.
export async function createUser(kv, { username, password, role = 'staff' }) {
  const rec = { username, role, password_hash: await hashPassword(password), active: true };
  await kput(kv, 'user:' + username, rec);
  return rec;
}

// S1-06: one user lookup for login / refresh / reauth. In D1 mode D1 is the ONLY authority: a D1 error fails closed (null),
// never falls back to KV. A KV-only legacy user is returned as { legacy } and imported into D1 by login() only AFTER its
// password was verified (same hash, one-way; the KV row is left untouched). A disabled legacy user is never imported.
export async function getUser(env, username) {
  if (await d1Usable(env)) {
    let u;
    try { u = await findUser(env, username); } catch { return null; } // D1 unreachable: fail closed
    if (u) return u;
    const k = await kget(env.KV, 'user:' + username);
    return k && k.active !== false && k.password_hash ? { ...k, legacy: true } : null;
  }
  return kget(env.KV, 'user:' + username);
}

async function importLegacy(env, k) {
  try {
    if (k.role === 'owner' && !(await tenantExists(env))) return await ensureTenantWithOwner(env, k.password_hash);
    if (!(await tenantExists(env))) return null;
    try { await insertUser(env, { username: k.username, passwordHash: k.password_hash, role: k.role === 'staff' ? 'cashier' : k.role }); } catch { /* raced: read it back */ }
    return await findUser(env, k.username);
  } catch { return null; }
}

async function issueSession(kv, user, { deviceId, trust, now, scope }) {
  const t = now;
  const trusted = !!(trust && deviceId);
  const access = randomToken(), refresh = randomToken();
  const ah = await sha256Hex(access), rh = await sha256Hex(refresh);
  const refreshTtl = trusted ? TRUSTED_TTL_S : REFRESH_TTL_S;
  const sess = { user: user.username, role: user.role, deviceId: deviceId || null, trusted,
    created: t, expires: t + ACCESS_TTL_S, refreshExpires: t + refreshTtl, reauthAt: t, refreshHash: rh, ...(scope || {}) };
  await kput(kv, 'sess:' + ah, sess, refreshTtl);
  await kput(kv, 'ref:' + rh, { access: ah }, refreshTtl);
  const idx = (await kget(kv, 'usess:' + user.username)) || [];
  idx.push(ah);
  await kput(kv, 'usess:' + user.username, idx.slice(-50));
  if (trusted) await kput(kv, `dev:${user.username}:${deviceId}`, { since: t }, TRUSTED_TTL_S);
  // SEC-01: the client mirrors the verified username + role so the pharmacist can keep working offline on this device.
  return { access_token: access, refresh_token: refresh, expires_in: ACCESS_TTL_S, refresh_expires_in: refreshTtl, trusted_device: trusted, user: user.username, role: user.role };
}

export async function login(env, body, opts) {
  const kv = env.KV, t = nowS(opts);
  const username = String((body && body.username) || '').trim().toLowerCase();
  const password = String((body && body.password) || '');
  if (!username || !password || username.length > 64 || password.length > 256) return fail('AUTH_BAD_REQUEST', 'اسم المستخدم وكلمة المرور مطلوبان.', 400);
  const lk = 'fails:' + username;
  const f = await kget(kv, lk);
  if (f && f.n >= MAX_FAILS && f.until > t) return fail('AUTH_LOCKED', 'تم قفل الحساب مؤقتاً بسبب محاولات فاشلة. حاول لاحقاً.', 429);
  let user = await getUser(env, username);
  const d1 = await d1Usable(env);
  // First owner (PIN bootstrap, once): only while no owner exists anywhere (KV flag AND, in D1 mode, no tenant in D1 yet).
  if (!user && username === 'owner' && !(await kget(kv, 'owner:exists')) && !(d1 && (await tenantExists(env))) && env.NOVA_API_PIN
      && (await sha256Hex(password)) === (await sha256Hex(String(env.NOVA_API_PIN)))) {
    if (d1) user = await ensureTenantWithOwner(env, await hashPassword(password));
    else user = await createUser(kv, { username: 'owner', password, role: 'owner' });
    await kput(kv, 'owner:exists', { at: t });
  } else if (user) {
    if (user.active === false || !(await verifyPassword(password, user.password_hash))) user = null;
    else if (user.legacy) user = await importLegacy(env, user); // verified legacy KV user -> D1 (null if D1 refuses: fail closed)
  } else {
    await verifyPassword(password, 'pbkdf2$sha256$1$00$00'); // flatten timing
  }
  if (!user) {
    const n = (f && f.until > t ? f.n : 0) + 1;
    await kput(kv, lk, { n, until: t + LOCK_S }, LOCK_S);
    return BAD();
  }
  await kv.delete(lk);
  const trust = !!(body.trust_device && body.device_id);
  const dev = body.device_id ? String(body.device_id).slice(0, 64) : null;
  const scope = user.d1 ? await scopeFor(env, user) : null;
  return { ok: await issueSession(kv, user, { deviceId: dev, trust, now: t, scope }) };
}

export function bearer(request) {
  const m = /^Bearer\s+([A-Za-z0-9]{32,128})$/.exec(request.headers.get('Authorization') || '');
  return m ? m[1] : null;
}

// Returns {session, hash} or {fail}.
export async function authenticate(request, env, opts) {
  const tok = bearer(request);
  if (!tok) return fail('AUTH_REQUIRED', 'يلزم تسجيل الدخول.', 401);
  const hash = await sha256Hex(tok);
  const s = await kget(env.KV, 'sess:' + hash);
  if (!s || s.revoked || s.expires <= nowS(opts)) return fail('AUTH_EXPIRED', 'انتهت الجلسة. سجّل الدخول مرة أخرى.', 401);
  return { session: s, hash };
}

// Re-auth gate for exports / sensitive changes.
export function requireReauth(session, opts) {
  if (nowS(opts) - session.reauthAt > REAUTH_MAX_AGE_S) return fail('REAUTH_REQUIRED', 'هذه العملية حساسة وتتطلب إعادة إدخال كلمة المرور.', 403);
  return { ok: true };
}

async function dropSession(kv, hash, s) {
  await kv.delete('sess:' + hash);
  if (s && s.refreshHash) await kv.delete('ref:' + s.refreshHash);
}

export async function logout(request, env, opts) {
  const a = await authenticate(request, env, opts);
  if (a.fail) return a;
  await dropSession(env.KV, a.hash, a.session);
  return { ok: { loggedOut: true } };
}

// Revoke every session of a user (and trusted devices are not auto-trusted afterwards).
export async function revokeUserSessions(kv, username) {
  const idx = (await kget(kv, 'usess:' + username)) || [];
  for (const h of idx) { const s = await kget(kv, 'sess:' + h); await dropSession(kv, h, s); }
  await kv.delete('usess:' + username);
  return idx.length;
}

export async function refresh(env, body, opts) {
  const kv = env.KV, t = nowS(opts);
  const rt = String((body && body.refresh_token) || '');
  if (!/^[A-Za-z0-9]{32,128}$/.test(rt)) return fail('AUTH_BAD_REQUEST', 'رمز التحديث مطلوب.', 400);
  const rh = await sha256Hex(rt);
  const ref = await kget(kv, 'ref:' + rh);
  const s = ref && (await kget(kv, 'sess:' + ref.access));
  if (!s || s.refreshExpires <= t || s.refreshHash !== rh) return fail('AUTH_EXPIRED', 'انتهت الجلسة. سجّل الدخول مرة أخرى.', 401);
  const user = await getUser(env, s.user);
  await dropSession(kv, ref.access, s); // rotate: old refresh token is single-use
  if (!user || !user.active) return fail('AUTH_EXPIRED', 'انتهت الجلسة. سجّل الدخول مرة أخرى.', 401);
  const scope = user.d1 ? await scopeFor(env, user) : null;
  return { ok: await issueSession(kv, user, { deviceId: s.deviceId, trust: s.trusted, now: t, scope }) };
}

export async function reauth(request, env, body, opts) {
  const a = await authenticate(request, env, opts);
  if (a.fail) return a;
  const user = await getUser(env, a.session.user);
  if (!user || !user.active || !(await verifyPassword(String((body && body.password) || ''), user.password_hash))) return BAD();
  a.session.reauthAt = nowS(opts);
  await kput(env.KV, 'sess:' + a.hash, a.session, Math.max(60, a.session.refreshExpires - nowS(opts)));
  return { ok: { reauthenticated: true, valid_for: REAUTH_MAX_AGE_S } };
}

export function registerAuthRoutes(route, { json, errorResponse }) {
  const wrap = (fn) => async (ctx) => {
    if (!authEnabled(ctx.env)) return errorResponse('AUTH_DISABLED', 'خدمة تسجيل الدخول غير مفعّلة.', 404, ctx.requestId);
    let body = {};
    try { body = await ctx.request.json(); } catch { body = {}; }
    const r = await fn(ctx, body);
    const action = 'auth.' + ctx.url.pathname.split('/').pop();
    let actor = null;
    if (action === 'auth.login') actor = String((body && body.username) || '').trim().toLowerCase().slice(0, 64) || null;
    else if (String(ctx.env.NOVA_AUDIT) === '1') { const a = await authenticate(ctx.request, ctx.env); actor = a.session ? a.session.user : null; }
    const denied = r.fail && (r.fail.status === 403 || r.fail.status === 401 || r.fail.status === 429);
    await audit(ctx.env, { actor, action: r.fail && r.fail.status === 403 ? 'permission.denied' : action, entity: 'auth', requestId: ctx.requestId,
      outcome: r.fail ? (denied ? 'DENIED' : 'FAILED') : 'ALLOWED', reason: r.fail ? r.fail.code : null,
      after: action === 'auth.login' && body && body.device_id ? { device_id: body.device_id } : null });
    if (r.fail) return errorResponse(r.fail.code, r.fail.message_ar, r.fail.status, ctx.requestId);
    return json({ ok: true, ...r.ok, requestId: ctx.requestId }, 200, { 'X-Request-Id': ctx.requestId });
  };
  route('POST', '/api/v1/auth/login', wrap((c, b) => login(c.env, b)));
  route('POST', '/api/v1/auth/logout', wrap((c) => logout(c.request, c.env)));
  route('POST', '/api/v1/auth/refresh', wrap((c, b) => refresh(c.env, b)));
  route('POST', '/api/v1/auth/reauth', wrap((c, b) => reauth(c.request, c.env, b)));
}
