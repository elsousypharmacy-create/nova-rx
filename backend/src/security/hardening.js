// SEC-05: security headers, CSRF, KV token-bucket rate limits, log redaction, owner data export.
// No network, no deps. Flag NOVA_HARDENING=1 (default OFF => handle() behaves exactly as before).
export function hardeningEnabled(env) { return !!env && String(env.NOVA_HARDENING) === '1'; }

export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-site',
});

export function applySecurityHeaders(response) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) response.headers.set(k, v);
  return response;
}

// ---- CSRF: same-origin check + double-submit token (only when the browser sends the csrf cookie) ----
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_COOKIE = 'nova_csrf';
export const CSRF_HEADER = 'X-CSRF-Token';

function cookieValue(request, name) {
  const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]+)').exec(request.headers.get('Cookie') || '');
  return m ? m[1] : null;
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Returns null if allowed, else {code, message_ar, status}.
export function checkCsrf(request, env) {
  if (SAFE.has(request.method.toUpperCase())) return null;
  const origin = request.headers.get('Origin');
  if (origin) {
    const allowed = String((env && env.CORS_ALLOW_ORIGINS) || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (origin !== new URL(request.url).origin && !allowed.includes(origin)) {
      return { code: 'CSRF_ORIGIN', message_ar: 'مصدر الطلب غير مسموح.', status: 403 };
    }
  }
  const c = cookieValue(request, CSRF_COOKIE);
  if (c) {
    const h = request.headers.get(CSRF_HEADER) || '';
    if (!h || !safeEqual(h, c)) return { code: 'CSRF_TOKEN', message_ar: 'رمز الحماية من التزوير غير صالح.', status: 403 };
  }
  return null;
}

export function newCsrfToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

// ---- Token bucket in KV. Fails open on KV errors (availability), never throws. ----
export const LIMITS = Object.freeze({
  default: { capacity: 120, refillPerSec: 2 },
  login: { capacity: 10, refillPerSec: 10 / 600 },
  export: { capacity: 3, refillPerSec: 3 / 3600 },
});

export async function rateLimit(kv, key, { capacity, refillPerSec }, nowMs = Date.now()) {
  try {
    const k = 'rl:' + key;
    const raw = await kv.get(k);
    let b = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : { tokens: capacity, at: nowMs };
    const tokens = Math.min(capacity, b.tokens + Math.max(0, (nowMs - b.at) / 1000) * refillPerSec);
    const ok = tokens >= 1;
    const next = { tokens: ok ? tokens - 1 : tokens, at: nowMs };
    await kv.put(k, JSON.stringify(next), { expirationTtl: Math.max(60, Math.ceil(capacity / refillPerSec)) });
    return { ok, retryAfter: ok ? 0 : Math.max(1, Math.ceil((1 - tokens) / refillPerSec)) };
  } catch { return { ok: true, retryAfter: 0 }; }
}

export function limitFor(method, path) {
  if (path === '/api/v1/auth/login') return ['login', LIMITS.login];
  if (path === '/api/v1/export') return ['export', LIMITS.export];
  return ['default', LIMITS.default];
}

export function clientId(request) { return request.headers.get('CF-Connecting-IP') || 'anon'; }

// ---- Log redaction ----
const SENSITIVE_KEY = /pass(word)?|pin|secret|token|authorization|cookie|api[_-]?key|hash|otp|card|cvv/i;
export function redact(value, depth = 0) {
  if (depth > 6) return '[depth]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(value)) o[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    return o;
  }
  if (typeof value === 'string') {
    return value.replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer [REDACTED]').replace(/\b\d{13,19}\b/g, '[REDACTED]');
  }
  return value;
}
export function safeLog(entry, sink = console.log) { try { sink(JSON.stringify(redact(entry))); } catch { /* never throw from logging */ } }

// ---- Owner data export (re-auth required). Tables are a fixed whitelist; secrets stripped. ----
export const EXPORT_TABLES = Object.freeze(['tenants', 'branches', 'users', 'roles', 'products', 'customers', 'suppliers', 'sales', 'sale_items', 'payments', 'purchase_orders', 'journal_entries', 'journal_lines']);

export async function buildExport(db) {
  const data = {};
  for (const t of EXPORT_TABLES) {
    try { data[t] = redact((await db.prepare('SELECT * FROM ' + t).all()).results || []); } catch { data[t] = []; }
  }
  return data;
}

export function registerExportRoute(route, { json, errorResponse }, { authenticate, requireReauth, normalizeRole }) {
  route('GET', '/api/v1/export', async (ctx) => {
    if (!hardeningEnabled(ctx.env)) return errorResponse('HARDENING_DISABLED', 'الميزة غير مفعّلة.', 404, ctx.requestId);
    const a = await authenticate(ctx.request, ctx.env);
    if (a.fail) return errorResponse(a.fail.code, a.fail.message_ar, a.fail.status, ctx.requestId);
    if (normalizeRole(a.session.role) !== 'owner') return errorResponse('PERMISSION_DENIED', 'ليست لديك صلاحية لهذه العملية.', 403, ctx.requestId);
    const re = requireReauth(a.session);
    if (re.fail) return errorResponse(re.fail.code, re.fail.message_ar, re.fail.status, ctx.requestId);
    const data = ctx.env.DB ? await buildExport(ctx.env.DB) : {};
    return json({ ok: true, exportedAt: new Date().toISOString(), data, requestId: ctx.requestId }, 200, { 'X-Request-Id': ctx.requestId, 'Content-Disposition': 'attachment; filename="nova-export.json"' });
  });
}
