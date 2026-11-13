// N111 INT-02: scoped API keys (hashed), HMAC-SHA256 signed webhooks, timestamp+nonce replay protection.
// Flag NOVA_INTEGRATION=1 (default OFF => routes 404, no DB/KV/network touched).
// Signing secret: env.NOVA_INGEST_SECRET (referenced by NAME only; never logged).
export const integrationEnabled = (env) => !!env && String(env.NOVA_INTEGRATION) === '1';
export const SCOPES = ['products:read', 'sales:read', 'inventory:read', 'webhooks:receive'];
export const SANDBOX_TENANT = 'sandbox';
export const MAX_SKEW_S = 300;

const enc = (s) => new TextEncoder().encode(s);
const hex = (u8) => Array.from(u8, (x) => x.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(t) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc(t)))); }

export async function hmacHex(secret, message) {
  const k = await crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc(message))));
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function rand(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return hex(b); }

// ---- API keys ----
export async function createApiKey(db, { tenantId, name, scopes = [], sandbox = false }) {
  const bad = scopes.filter((s) => !SCOPES.includes(s));
  if (!tenantId || !name || bad.length) throw new Error('invalid key request');
  const id = 'ik_' + rand(6);
  const key = 'nvk_' + rand(24);
  await db.prepare('INSERT INTO integration_api_keys (id, tenant_id, name, key_hash, key_prefix, scopes, sandbox) VALUES (?,?,?,?,?,?,?)')
    .bind(id, sandbox ? SANDBOX_TENANT : tenantId, name, await sha256Hex(key), key.slice(0, 8), scopes.join(','), sandbox ? 1 : 0).run();
  return { id, key, tenantId: sandbox ? SANDBOX_TENANT : tenantId, scopes, sandbox: !!sandbox }; // plaintext returned once
}
export const createSandboxKey = (db, scopes = SCOPES) => createApiKey(db, { tenantId: SANDBOX_TENANT, name: 'sandbox', scopes, sandbox: true });

export async function revokeApiKey(db, id) {
  await db.prepare("UPDATE integration_api_keys SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").bind(id).run();
}

export async function authenticateKey(db, presented, scope) {
  if (!presented || !db) return { ok: false, code: 'API_KEY_INVALID', status: 401 };
  const row = await db.prepare('SELECT id, tenant_id, scopes, sandbox, revoked_at FROM integration_api_keys WHERE key_hash = ?').bind(await sha256Hex(presented)).first();
  if (!row || row.revoked_at) return { ok: false, code: 'API_KEY_INVALID', status: 401 };
  const scopes = String(row.scopes).split(',').filter(Boolean);
  if (scope && !scopes.includes(scope)) return { ok: false, code: 'API_SCOPE_FORBIDDEN', status: 403 };
  return { ok: true, keyId: row.id, tenantId: row.tenant_id, scopes, sandbox: !!row.sandbox };
}

// ---- signing ----
// signature = HMAC-SHA256(secret, `${timestamp}.${nonce}.${body}`), header form `v1=<hex>`.
export async function signPayload(secret, body, { timestamp = Math.floor(Date.now() / 1000), nonce = rand(12) } = {}) {
  const sig = await hmacHex(secret, `${timestamp}.${nonce}.${body}`);
  return { timestamp: String(timestamp), nonce, signature: 'v1=' + sig };
}

export async function verifySignature(secret, body, { timestamp, nonce, signature }, now = Date.now()) {
  if (!secret) return { ok: false, code: 'SIGNING_NOT_CONFIGURED' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || !nonce || !signature) return { ok: false, code: 'SIGNATURE_INVALID' };
  if (Math.abs(now / 1000 - ts) > MAX_SKEW_S) return { ok: false, code: 'TIMESTAMP_STALE' };
  const want = 'v1=' + await hmacHex(secret, `${timestamp}.${nonce}.${body}`);
  return safeEqual(want, signature) ? { ok: true, ts } : { ok: false, code: 'SIGNATURE_INVALID' };
}

// Replay protection: a (key, nonce) pair is accepted once. Returns false on replay.
export async function consumeNonce(db, keyId, nonce, ts, now = Date.now()) {
  await db.prepare('DELETE FROM integration_nonces WHERE ts < ?').bind(Math.floor(now / 1000) - 2 * MAX_SKEW_S).run().catch(() => {});
  try {
    await db.prepare('INSERT INTO integration_nonces (nonce, key_id, ts) VALUES (?,?,?)').bind(nonce, keyId, ts).run();
    return true;
  } catch { return false; }
}

// Outbound webhook. `fetchImpl` is injected (tests use a mock); no default network use.
export async function deliverWebhook({ url, event, data, secret, fetchImpl, now = Date.now() }) {
  if (!fetchImpl) return { ok: false, code: 'NO_TRANSPORT' };
  if (!secret) return { ok: false, code: 'SIGNING_NOT_CONFIGURED' };
  if (!/^https:\/\//i.test(url)) return { ok: false, code: 'URL_NOT_HTTPS' };
  const body = JSON.stringify({ event, data, sentAt: new Date(now).toISOString() });
  const s = await signPayload(secret, body, { timestamp: Math.floor(now / 1000) });
  try {
    const r = await fetchImpl(url, { method: 'POST', body, headers: {
      'Content-Type': 'application/json', 'X-Nova-Timestamp': s.timestamp, 'X-Nova-Nonce': s.nonce, 'X-Nova-Signature': s.signature,
    } });
    return { ok: r.status >= 200 && r.status < 300, status: r.status };
  } catch { return { ok: false, code: 'DELIVERY_FAILED' }; }
}

// ---- routes ----
const MSG = {
  API_KEY_INVALID: ['مفتاح API غير صالح.', 401],
  API_SCOPE_FORBIDDEN: ['المفتاح لا يملك الصلاحية المطلوبة.', 403],
  SIGNATURE_INVALID: ['التوقيع غير صالح.', 401],
  TIMESTAMP_STALE: ['الطلب منتهي الصلاحية.', 401],
  REPLAY_DETECTED: ['تم رفض الطلب لأنه مكرر.', 409],
  SIGNING_NOT_CONFIGURED: ['التوقيع غير مهيأ.', 503],
  INTEGRATION_DISABLED: ['الميزة غير مفعّلة.', 404],
};
export function registerIntegrationRoutes(route, { json, errorResponse }) {
  const fail = (ctx, code) => errorResponse(code, MSG[code][0], MSG[code][1], ctx.requestId);
  const keyOf = (ctx) => (ctx.request.headers.get('X-Api-Key') || (ctx.request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')).trim();

  route('GET', '/api/v1/integration/ping', async (ctx) => {
    if (!integrationEnabled(ctx.env)) return fail(ctx, 'INTEGRATION_DISABLED');
    const a = await authenticateKey(ctx.env.DB, keyOf(ctx), null);
    if (!a.ok) return fail(ctx, a.code);
    return json({ ok: true, tenantId: a.tenantId, sandbox: a.sandbox, scopes: a.scopes, requestId: ctx.requestId }, 200, { 'X-Request-Id': ctx.requestId });
  });

  // Signed inbound webhook: API key (scope webhooks:receive) + HMAC + fresh timestamp + unused nonce.
  route('POST', '/api/v1/integration/webhook', async (ctx) => {
    if (!integrationEnabled(ctx.env)) return fail(ctx, 'INTEGRATION_DISABLED');
    const a = await authenticateKey(ctx.env.DB, keyOf(ctx), 'webhooks:receive');
    if (!a.ok) return fail(ctx, a.code);
    const body = await ctx.request.text();
    const h = ctx.request.headers;
    const v = await verifySignature(ctx.env.NOVA_INGEST_SECRET, body, {
      timestamp: h.get('X-Nova-Timestamp'), nonce: h.get('X-Nova-Nonce'), signature: h.get('X-Nova-Signature'),
    });
    if (!v.ok) return fail(ctx, v.code);
    if (!(await consumeNonce(ctx.env.DB, a.keyId, h.get('X-Nova-Nonce'), v.ts))) return fail(ctx, 'REPLAY_DETECTED');
    return json({ ok: true, accepted: true, tenantId: a.tenantId, sandbox: a.sandbox, requestId: ctx.requestId }, 200, { 'X-Request-Id': ctx.requestId });
  });
}
