// UX406: Web Push notifications for new inbound WhatsApp customer messages (free: Web Push + VAPID, no push vendor).
// Subscriptions live in KV (wapush:<tenant>:<sha256(endpoint)[0..32]>), one per browser/device, 90-day TTL.
// Routes share the history gate (checkPin: pinless on staging/preview, PIN elsewhere):
//   GET  /api/v1/inbox/history/push/key          -> { enabled, publicKey }
//   POST /api/v1/inbox/history/push/subscribe    -> store { endpoint, keys:{p256dh, auth} }
//   POST /api/v1/inbox/history/push/unsubscribe  -> delete by endpoint
// Sending: notifyInbound() is scheduled with ctx.waitUntil AFTER the message rows are written; it never blocks or
// fails the ingest. Payloads are encrypted per RFC 8291 (aes128gcm) and authorised per RFC 8292 (VAPID, ES256).
// Secrets by NAME only: VAPID_PUBLIC_KEY (base64url, 65-byte uncompressed P-256 point), VAPID_PRIVATE_KEY (base64url, 32-byte d),
// optional VAPID_SUBJECT. Values are never logged or returned (the public key is public by design).
import { sha256Hex } from './auth/auth.js';
import { checkPin, historyTenant } from './inbox-history.js';

export const SUB_PREFIX = 'wapush:';
export const SUB_TTL_S = 90 * 24 * 3600;
export const MAX_SUBS = 30;
export const MAX_ENDPOINT = 1024;
export const PUSH_TTL_S = 6 * 3600;
// Only real browser push services (no SSRF to arbitrary hosts).
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)$/i;

const te = new TextEncoder();
export function b64u(bytes) {
  let s = '';
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(s) {
  const t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const cat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };

export function pushConfigured(env) {
  try {
    return !!env && unb64u(env.VAPID_PUBLIC_KEY).length === 65 && unb64u(env.VAPID_PRIVATE_KEY).length === 32;
  } catch { return false; }
}

// Validates a PushSubscription JSON; returns a clean copy or null.
export function cleanSubscription(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const ep = typeof sub.endpoint === 'string' ? sub.endpoint : '';
  if (!ep || ep.length > MAX_ENDPOINT) return null;
  let u;
  try { u = new URL(ep); } catch { return null; }
  if (u.protocol !== 'https:' || !PUSH_HOSTS.test(u.hostname) || u.username || u.password) return null;
  const k = sub.keys || {};
  try {
    if (unb64u(k.p256dh).length !== 65 || unb64u(k.auth).length !== 16) return null;
  } catch { return null; }
  return { endpoint: ep, keys: { p256dh: String(k.p256dh), auth: String(k.auth) } };
}

export const subKey = async (tenant, endpoint) => SUB_PREFIX + tenant + ':' + (await sha256Hex(endpoint)).slice(0, 32);

export async function saveSubscription(kv, tenant, sub, now = Date.now()) {
  const key = await subKey(tenant, sub.endpoint);
  if (!(await kv.get(key))) {
    const l = await kv.list({ prefix: SUB_PREFIX + tenant + ':', limit: MAX_SUBS + 1 });
    if ((l.keys || []).length >= MAX_SUBS) return { ok: false, code: 'PUSH_LIMIT' };
  }
  await kv.put(key, JSON.stringify({ ...sub, at: now }), { expirationTtl: SUB_TTL_S });
  return { ok: true };
}
export async function removeSubscription(kv, tenant, endpoint) { await kv.delete(await subKey(tenant, endpoint)); return { ok: true }; }
export async function listSubscriptions(kv, tenant) {
  const l = await kv.list({ prefix: SUB_PREFIX + tenant + ':', limit: MAX_SUBS + 10 });
  const out = [];
  for (const k of l.keys || []) {
    try { const v = JSON.parse((await kv.get(k.name)) || 'null'); if (v && cleanSubscription(v)) out.push({ key: k.name, sub: v }); } catch { /* skip corrupt */ }
  }
  return out;
}

// Notification payload (shown by sw.js). fresh: [{ cid, name, text, at }] inbound messages just written.
// Small (< 1 KB), text trimmed; one chat => that customer's name + last text, several chats => a summary.
export function pushPayload(fresh) {
  const items = (Array.isArray(fresh) ? fresh : []).filter((f) => f && f.cid);
  if (!items.length) return null;
  const chats = [...new Set(items.map((f) => f.cid))];
  const last = items[items.length - 1];
  const clip = (s, n) => { const a = Array.from(String(s || '').replace(/\s+/g, ' ').trim()); return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
  const one = chats.length === 1;
  return {
    v: 1, kind: 'wa-in',
    title: one ? clip(last.name || 'عميل واتساب', 60) : 'رسائل واتساب جديدة',
    body: one ? (items.length > 1 ? '(' + items.length + ') ' : '') + clip(last.text, 120) : items.length + ' رسائل جديدة من ' + chats.length + ' محادثات',
    chat: one ? chats[0] : null, chats: chats.slice(0, 20), count: items.length, at: Number(last.at) || 0,
    tag: one ? 'nova-wa-' + chats[0] : 'nova-wa',
  };
}

async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}

// RFC 8291 aes128gcm body for one subscription. opts (tests only): { salt, asKeyPair }.
export async function encryptPayload(sub, plaintext, opts = {}) {
  const ua = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const as = opts.asKeyPair || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, secret, cat(te.encode('WebPush: info\0'), ua, asPub), 32);
  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const data = typeof plaintext === 'string' ? te.encode(plaintext) : plaintext;
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(data, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

// RFC 8292 VAPID Authorization header value for an endpoint.
export async function vapidAuth(env, endpoint, now = Date.now()) {
  const pub = unb64u(env.VAPID_PUBLIC_KEY), d = env.VAPID_PRIVATE_KEY;
  const jwk = { kty: 'EC', crv: 'P-256', d: String(d), x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = (o) => b64u(te.encode(JSON.stringify(o)));
  const sub = typeof env.VAPID_SUBJECT === 'string' && /^(mailto:|https:)/.test(env.VAPID_SUBJECT) ? env.VAPID_SUBJECT : 'https://nova-rx-preview.elsousypharmacy.workers.dev';
  const unsigned = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub });
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(unsigned)));
  return 'vapid t=' + unsigned + '.' + b64u(sig) + ', k=' + env.VAPID_PUBLIC_KEY;
}

// Sends one payload to every stored subscription of the tenant. Gone (404/410) subscriptions are removed.
// Never throws; returns counts only (no endpoints, no keys, no text).
export async function notifyInbound(env, tenant, fresh, now = Date.now()) {
  const res = { sent: 0, failed: 0, removed: 0 };
  try {
    if (!env || !env.KV || !pushConfigured(env)) return { ...res, skipped: 'not_configured' };
    const p = pushPayload(fresh);
    if (!p) return { ...res, skipped: 'empty' };
    const f = env.NOVA_PUSH_FETCH || globalThis.fetch; // injectable (tests)
    const body = JSON.stringify(p);
    for (const { key, sub } of await listSubscriptions(env.KV, tenant)) {
      try {
        const r = await f(sub.endpoint, {
          method: 'POST',
          headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(PUSH_TTL_S), Urgency: 'high', Topic: 'nova-wa', Authorization: await vapidAuth(env, sub.endpoint, now) },
          body: await encryptPayload(sub, body),
        });
        if (r.status === 404 || r.status === 410) { await env.KV.delete(key); res.removed++; } else if (r.status >= 200 && r.status < 300) res.sent++; else res.failed++;
      } catch { res.failed++; }
    }
  } catch { res.failed++; }
  return res;
}

// Fire-and-forget after the response (ctx.waitUntil when the runtime provides it).
export function schedulePush(ctx, env, tenant, fresh) {
  if (!Array.isArray(fresh) || !fresh.length || !pushConfigured(env)) return null;
  const p = notifyInbound(env, tenant, fresh).catch(() => null);
  if (ctx && typeof ctx.waitUntil === 'function') { try { ctx.waitUntil(p); } catch { /* ignore */ } }
  return p;
}

export function registerInboxPushRoutes(route, { errorResponse }) {
  const gate = (handler) => async (ctx) => {
    const { env, requestId, request } = ctx;
    const bad = await checkPin(request, env);
    if (bad) return errorResponse(bad.code, bad.message_ar, bad.status, requestId);
    try { return await handler(ctx); } catch { return errorResponse('PUSH_FAILED', 'تعذّر ضبط الإشعارات. حاول مرة أخرى.', 503, requestId); }
  };
  const body = async (request) => { try { return await request.json(); } catch { return null; } };
  route('GET', '/api/v1/inbox/history/push/key', gate(async ({ env, requestId }) => (
    pushConfigured(env) && env.KV ? { ok: true, enabled: true, publicKey: env.VAPID_PUBLIC_KEY, requestId } : { ok: true, enabled: false, publicKey: null, requestId })));
  route('POST', '/api/v1/inbox/history/push/subscribe', gate(async ({ env, requestId, request }) => {
    if (!pushConfigured(env) || !env.KV) return errorResponse('PUSH_NOT_CONFIGURED', 'إشعارات المتصفح غير مفعّلة على السيرفر.', 503, requestId);
    const b = await body(request), sub = cleanSubscription(b && b.subscription);
    if (!sub) return errorResponse('PUSH_BAD_SUBSCRIPTION', 'بيانات الاشتراك غير صالحة.', 400, requestId);
    const r = await saveSubscription(env.KV, historyTenant(env), sub);
    if (!r.ok) return errorResponse(r.code, 'عدد الأجهزة المشتركة كبير. ألغِ الإشعارات من جهاز قديم.', 409, requestId);
    return { ok: true, subscribed: true, requestId };
  }));
  route('POST', '/api/v1/inbox/history/push/unsubscribe', gate(async ({ env, requestId, request }) => {
    if (!env.KV) return errorResponse('PUSH_NOT_CONFIGURED', 'إشعارات المتصفح غير مفعّلة على السيرفر.', 503, requestId);
    const b = await body(request), ep = b && typeof b.endpoint === 'string' && b.endpoint.length <= MAX_ENDPOINT ? b.endpoint : '';
    if (!ep) return errorResponse('PUSH_BAD_SUBSCRIPTION', 'بيانات الاشتراك غير صالحة.', 400, requestId);
    await removeSubscription(env.KV, historyTenant(env), ep);
    return { ok: true, subscribed: false, requestId };
  }));
}
