// N123 SAAS-03: per-tenant usage counters + quotas + cost report. Flag NOVA_METERING=1 (default OFF => routes 404, nothing touched).
// Every counter/quota row is keyed by tenant_id, so a hot tenant exhausting its quota never affects another. No network.
import { authenticate } from './auth/auth.js';
import { normalizeRole } from './auth/permissions.js';

export const meteringEnabled = (env) => !!env && String(env.NOVA_METERING) === '1' && !!env.DB;
export const METRICS = ['requests', 'storage_bytes', 'ai_calls', 'jobs'];
// Internal unit prices in minor units per 1 unit (placeholders for the report; no billing is performed).
export const UNIT_PRICE_MINOR = { requests: 0.001, storage_bytes: 0.00000001, ai_calls: 5, jobs: 0.5 };
const TID_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;
const bad = (code, message_ar, status = 400) => ({ ok: false, code, message_ar, status });
export const periodOf = (d = new Date()) => d.toISOString().slice(0, 7);
const changes = (r) => (r && (r.changes ?? r.meta?.changes)) || 0;
const validTenant = (t) => TID_RE.test(String(t || ''));

export async function setQuota(db, tenantId, metric, limit) {
  if (!validTenant(tenantId)) return bad('METERING_BAD_TENANT', 'معرّف المستأجر غير صالح.');
  if (!METRICS.includes(metric)) return bad('METERING_BAD_METRIC', 'نوع الاستهلاك غير معروف.');
  if (!Number.isInteger(limit) || limit < 0) return bad('METERING_BAD_LIMIT', 'قيمة الحصة غير صالحة.');
  await db.prepare("INSERT INTO tenant_quotas (tenant_id, metric, limit_value) VALUES (?,?,?) ON CONFLICT (tenant_id, metric) DO UPDATE SET limit_value = excluded.limit_value, updated_at = datetime('now')")
    .bind(tenantId, metric, limit).run();
  return { ok: true, tenantId, metric, limit };
}

// Atomic consume: a single conditional UPDATE enforces the quota. Over quota => 429, counter unchanged, denied++.
export async function recordUsage(db, tenantId, metric, amount = 1, now = new Date()) {
  if (!validTenant(tenantId)) return bad('METERING_BAD_TENANT', 'معرّف المستأجر غير صالح.');
  if (!METRICS.includes(metric)) return bad('METERING_BAD_METRIC', 'نوع الاستهلاك غير معروف.');
  if (!Number.isInteger(amount) || amount < 0) return bad('METERING_BAD_AMOUNT', 'كمية الاستهلاك غير صالحة.');
  const period = periodOf(now);
  await db.prepare('INSERT OR IGNORE INTO tenant_usage (tenant_id, period, metric, used) VALUES (?,?,?,0)').bind(tenantId, period, metric).run();
  const r = await db.prepare(`UPDATE tenant_usage SET used = used + ?, updated_at = datetime('now')
    WHERE tenant_id = ? AND period = ? AND metric = ?
    AND (SELECT COUNT(*) FROM tenant_quotas q WHERE q.tenant_id = ? AND q.metric = ? AND used + ? > q.limit_value) = 0`)
    .bind(amount, tenantId, period, metric, tenantId, metric, amount).run();
  if (changes(r) === 0) {
    await db.prepare('UPDATE tenant_usage SET denied = denied + 1 WHERE tenant_id = ? AND period = ? AND metric = ?').bind(tenantId, period, metric).run();
    return bad('METERING_QUOTA_EXCEEDED', 'تم تجاوز الحصة المسموحة لهذا المستأجر.', 429);
  }
  return { ok: true, tenantId, metric, period };
}

export async function getUsage(db, tenantId, period = periodOf()) {
  if (!validTenant(tenantId)) return bad('METERING_BAD_TENANT', 'معرّف المستأجر غير صالح.');
  const u = await db.prepare('SELECT metric, used, denied FROM tenant_usage WHERE tenant_id = ? AND period = ?').bind(tenantId, period).all();
  const q = await db.prepare('SELECT metric, limit_value FROM tenant_quotas WHERE tenant_id = ?').bind(tenantId).all();
  const um = Object.fromEntries((u.results || u).map((r) => [r.metric, r]));
  const qm = Object.fromEntries((q.results || q).map((r) => [r.metric, r.limit_value]));
  return { ok: true, tenantId, period, metrics: METRICS.map((m) => ({ metric: m, used: um[m]?.used || 0, denied: um[m]?.denied || 0, limit: qm[m] ?? null })) };
}

export async function costReport(db, tenantId, period = periodOf()) {
  const u = await getUsage(db, tenantId, period);
  if (!u.ok) return u;
  const lines = u.metrics.map((m) => ({ metric: m.metric, used: m.used, unitPriceMinor: UNIT_PRICE_MINOR[m.metric], costMinor: Math.round(m.used * UNIT_PRICE_MINOR[m.metric]) }));
  return { ok: true, tenantId, period, lines, totalMinor: lines.reduce((s, l) => s + l.costMinor, 0) };
}

export function registerMeteringRoutes(route, { json, errorResponse }) {
  async function guard(ctx) {
    const { env, requestId } = ctx;
    if (!meteringEnabled(env)) return { res: errorResponse('METERING_DISABLED', 'الميزة غير مفعّلة.', 404, requestId) };
    const a = await authenticate(ctx.request, env);
    if (a.fail) return { res: errorResponse(a.fail.code, a.fail.message_ar, a.fail.status, requestId) };
    if (normalizeRole(a.session.role) !== 'owner') return { res: errorResponse('PERMISSION_DENIED', 'ليست لديك صلاحية لهذه العملية.', 403, requestId) };
    let body = {}; if (ctx.request.method === 'POST') { try { body = await ctx.request.json(); } catch { body = null; } }
    if (!body || typeof body !== 'object') return { res: errorResponse('METERING_BAD_REQUEST', 'صيغة الطلب غير صالحة.', 400, requestId) };
    return { body };
  }
  const wrap = (fn) => async (ctx) => {
    const g = await guard(ctx); if (g.res) return g.res;
    try {
      const r = await fn(ctx, g.body);
      return r.ok ? json({ ...r, requestId: ctx.requestId }, 200, { 'X-Request-Id': ctx.requestId }) : errorResponse(r.code, r.message_ar, r.status, ctx.requestId);
    } catch { return errorResponse('METERING_FAILED', 'تعذّر تنفيذ العملية.', 500, ctx.requestId); }
  };
  const qs = (ctx, k) => new URL(ctx.request.url).searchParams.get(k);
  const tid = (ctx, b) => String(b.tenantId || qs(ctx, 'tenantId') || '');
  const per = (ctx) => qs(ctx, 'period') || periodOf();
  route('GET', '/api/v1/metering/usage', wrap((ctx, b) => getUsage(ctx.env.DB, tid(ctx, b), per(ctx))));
  route('GET', '/api/v1/metering/cost-report', wrap((ctx, b) => costReport(ctx.env.DB, tid(ctx, b), per(ctx))));
  route('POST', '/api/v1/metering/quota', wrap((ctx, b) => setQuota(ctx.env.DB, tid(ctx, b), b.metric, b.limit)));
}
