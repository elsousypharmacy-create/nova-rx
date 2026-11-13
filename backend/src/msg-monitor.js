// N118 MSG-05: messaging monitoring. Flag NOVA_MSG_MONITOR=1 (default OFF => routes 404, nothing read).
// No network calls. State lives in KV (binding KV): msg:kill_switch, msg:token_expires_at,
// msg:session_expires_at, msg:webhook_expires_at (ISO timestamps written by the messaging adapters).
// Access: Authorization: Bearer <env.NOVA_STATUS_TOKEN> (secret referenced by NAME only).
import { redact } from './security/hardening.js';

export function msgMonitorEnabled(env) { return !!env && String(env.NOVA_MSG_MONITOR) === '1'; }

export const KILL_KEY = 'msg:kill_switch';
export const EXPIRY_KEYS = Object.freeze({
  token: 'msg:token_expires_at',
  session: 'msg:session_expires_at',
  webhook: 'msg:webhook_expires_at',
});
const MSG_AR = Object.freeze({
  token: { expired: 'انتهت صلاحية رمز الرسائل. جدّد الرمز.', soon: 'رمز الرسائل سينتهي قريبًا.', unknown: 'تعذّر معرفة صلاحية رمز الرسائل.' },
  session: { expired: 'انتهت جلسة الرسائل. أعد ربط الجلسة.', soon: 'جلسة الرسائل ستنتهي قريبًا.', unknown: 'تعذّر معرفة حالة جلسة الرسائل.' },
  webhook: { expired: 'انتهى اشتراك الويب هوك. جدّد الاشتراك.', soon: 'اشتراك الويب هوك سينتهي قريبًا.', unknown: 'تعذّر معرفة حالة اشتراك الويب هوك.' },
});
export const WARN_SECONDS = 3 * 24 * 3600;

// Mask phone numbers (keep last 2 digits) and token-like secrets in any text/object.
export function redactMessaging(value) {
  const mask = (s) => String(s)
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[REDACTED]')
    .replace(/\b(EAA|xox[a-z]-|sk-|bot)[A-Za-z0-9_:\-]{12,}/g, '[REDACTED]')
    .replace(/\b\d{6,9}:[A-Za-z0-9_\-]{20,}\b/g, '[REDACTED]')
    .replace(/\+?\d[\d\s\-()]{7,}\d/g, (m) => {
      const d = m.replace(/\D/g, '');
      return d.length >= 8 ? '[PHONE ***' + d.slice(-2) + ']' : m;
    });
  const walk = (v, depth = 0) => {
    if (depth > 6) return '[depth]';
    if (typeof v === 'string') return mask(v);
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, depth + 1)]));
    return v;
  };
  return walk(redact(value));
}

// Fail-closed: auto-replies are allowed only when the switch is readable AND not engaged.
export async function autoRepliesAllowed(env) {
  if (!env || !env.KV) return false;
  try { return (await env.KV.get(KILL_KEY)) === null; } catch { return false; }
}

export async function collectMsgAlerts(env, now = Date.now()) {
  const alerts = [];
  for (const [kind, key] of Object.entries(EXPIRY_KEYS)) {
    let raw = null;
    let readFailed = false;
    try { raw = env && env.KV ? await env.KV.get(key) : null; } catch { readFailed = true; }
    const t = raw ? Date.parse(raw) : NaN;
    if (readFailed || !Number.isFinite(t)) {
      alerts.push({ kind, level: 'unknown', code: 'MSG_' + kind.toUpperCase() + '_UNKNOWN', message_ar: MSG_AR[kind].unknown });
    } else if (t <= now) {
      alerts.push({ kind, level: 'critical', code: 'MSG_' + kind.toUpperCase() + '_EXPIRED', message_ar: MSG_AR[kind].expired });
    } else if (t - now <= WARN_SECONDS * 1000) {
      alerts.push({ kind, level: 'warning', code: 'MSG_' + kind.toUpperCase() + '_EXPIRING', message_ar: MSG_AR[kind].soon, expiresInSeconds: Math.floor((t - now) / 1000) });
    }
  }
  return alerts;
}

export function registerMsgMonitorRoutes(route, { json, errorResponse }) {
  const guard = (ctx) => {
    if (!msgMonitorEnabled(ctx.env)) return errorResponse('MSG_MONITOR_DISABLED', 'الميزة غير مفعّلة.', 404, ctx.requestId);
    const want = ctx.env.NOVA_STATUS_TOKEN;
    const got = (ctx.request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!want || got !== want) return errorResponse('MSG_MONITOR_UNAUTHORIZED', 'غير مصرح بعرض حالة الرسائل.', 401, ctx.requestId);
    return null;
  };
  route('GET', '/api/v1/msg/health', async (ctx) => {
    const g = guard(ctx); if (g) return g;
    const alerts = await collectMsgAlerts(ctx.env);
    const autoReplies = await autoRepliesAllowed(ctx.env);
    return json(redactMessaging({
      ok: !alerts.some((a) => a.level === 'critical'),
      autoReplies: autoReplies ? 'on' : 'off',
      alerts, requestId: ctx.requestId,
    }), 200, { 'X-Request-Id': ctx.requestId });
  });
  route('POST', '/api/v1/msg/kill-switch', async (ctx) => {
    const g = guard(ctx); if (g) return g;
    let body = null;
    try { body = await ctx.request.json(); } catch { /* handled below */ }
    if (!body || typeof body.engage !== 'boolean') return errorResponse('MSG_BAD_REQUEST', 'طلب غير صالح: الحقل engage مطلوب.', 400, ctx.requestId);
    if (!ctx.env.KV) return errorResponse('MSG_KV_ABSENT', 'التخزين غير متاح.', 503, ctx.requestId);
    try {
      if (body.engage) await ctx.env.KV.put(KILL_KEY, new Date().toISOString());
      else await ctx.env.KV.delete(KILL_KEY);
    } catch { return errorResponse('MSG_KV_ERROR', 'تعذّر تحديث مفتاح الإيقاف.', 503, ctx.requestId); }
    return json({ ok: true, autoReplies: body.engage ? 'off' : 'on', requestId: ctx.requestId }, 200, { 'X-Request-Id': ctx.requestId });
  });
}
