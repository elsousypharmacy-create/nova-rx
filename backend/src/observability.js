// N109: GET /api/v1/status + structured JSON logs + error counters.
// Flag NOVA_OBSERVABILITY=1 (default OFF => route 404s, no logging, no counters, no bindings touched).
// Access: Authorization: Bearer <env.NOVA_STATUS_TOKEN> (secret referenced by NAME only).
import { redact } from './security/hardening.js';

export function observabilityEnabled(env) { return !!env && String(env.NOVA_OBSERVABILITY) === '1'; }

const counters = new Map();
export function countError(code) {
  const k = String(code || 'UNKNOWN').slice(0, 64);
  counters.set(k, (counters.get(k) || 0) + 1);
}
export function errorCounters() { return Object.fromEntries(counters); }
export function resetErrorCounters() { counters.clear(); }

// One JSON line per event; secrets/PII redacted; never throws.
export function logEvent(level, event, fields = {}, sink = console.log) {
  try {
    sink(JSON.stringify(redact({ ts: new Date().toISOString(), level, event, ...fields })));
  } catch { /* never throw from logging */ }
}

async function probe(fn) {
  try { await fn(); return 'ok'; } catch { return 'error'; }
}

export async function collectStatus(env, now = Date.now()) {
  const out = { db: 'absent', kv: 'absent', r2: 'absent', queueDepth: null, lastBackupAgeSeconds: null };
  if (env.DB) {
    out.db = await probe(() => env.DB.prepare('SELECT 1 AS x').first());
    if (out.db === 'ok') {
      try {
        const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM sync_ops').first();
        out.queueDepth = row ? Number(row.n) : 0;
      } catch { out.queueDepth = null; }
    }
  }
  if (env.KV) {
    out.kv = await probe(() => env.KV.get('status:probe'));
    if (out.kv === 'ok') {
      try {
        const t = Date.parse(await env.KV.get('backup:last'));
        if (Number.isFinite(t)) out.lastBackupAgeSeconds = Math.max(0, Math.floor((now - t) / 1000));
      } catch { /* leave null */ }
    }
  }
  if (env.R2) out.r2 = await probe(() => env.R2.head('status-probe'));
  return out;
}

export function registerStatusRoute(route, { json, errorResponse }) {
  route('GET', '/api/v1/status', async (ctx) => {
    if (!observabilityEnabled(ctx.env)) return errorResponse('OBSERVABILITY_DISABLED', 'الميزة غير مفعّلة.', 404, ctx.requestId);
    const want = ctx.env.NOVA_STATUS_TOKEN;
    const got = (ctx.request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!want || got !== want) {
      countError('STATUS_UNAUTHORIZED');
      return errorResponse('STATUS_UNAUTHORIZED', 'غير مصرح بعرض الحالة.', 401, ctx.requestId);
    }
    const s = await collectStatus(ctx.env);
    const ok = s.db !== 'error' && s.kv !== 'error' && s.r2 !== 'error';
    return json({ ok, status: ok ? 'healthy' : 'degraded', ...s, errors: errorCounters(), requestId: ctx.requestId }, 200, { 'X-Request-Id': ctx.requestId });
  });
}
