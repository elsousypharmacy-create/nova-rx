// N124 SAAS-04: release notes + version, per-tenant flags with gradual rollout, opt-in diagnostics.
// Flag NOVA_RELEASES=1 (default OFF => routes 404, nothing touched). No network.
// Diagnostics store ONLY {kind, app_version, code} from strict allow-lists: no free text, no ids, no customer data.
import { authenticate } from './auth/auth.js';
import { normalizeRole } from './auth/permissions.js';
import { VERSION, getVersionInfo } from './version.js';

export const releasesEnabled = (env) => !!env && String(env.NOVA_RELEASES) === '1' && !!env.DB;
export const RELEASE_NOTES = [
  { version: '0.1.0', date: '2026-11-13', notes_ar: ['الإصدار الأول للواجهة الخلفية (وضع تجريبي).'] },
];
const FLAG_RE = /^[a-z][a-z0-9_]{2,39}$/;
const TENANT_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;
export const DIAG_KINDS = ['error', 'perf', 'sync'];
const CODE_RE = /^[A-Z][A-Z0-9_]{2,39}$/;
const VER_RE = /^\d{1,3}(\.\d{1,3}){1,3}$/;
const bad = (code, message_ar, status = 400) => ({ ok: false, code, message_ar, status });

// Deterministic 0..99 bucket per (tenant, flag): same tenant always lands in the same bucket.
export function bucket(tenantId, flag) {
  let h = 2166136261;
  const s = tenantId + ':' + flag;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h % 100;
}
export const isFlagOn = (row, tenantId) =>
  !!row && row.enabled === 1 && bucket(tenantId, row.flag) < row.rollout_pct;

export async function setFlag(db, tenantId, flag, { enabled, rolloutPct = 100 }) {
  if (!TENANT_RE.test(String(tenantId || ''))) return bad('RELEASES_BAD_TENANT', 'معرّف المستأجر غير صالح.');
  if (!FLAG_RE.test(String(flag || ''))) return bad('RELEASES_BAD_FLAG', 'اسم الميزة غير صالح.');
  if (typeof enabled !== 'boolean' || !Number.isInteger(rolloutPct) || rolloutPct < 0 || rolloutPct > 100)
    return bad('RELEASES_BAD_ROLLOUT', 'قيمة التفعيل أو نسبة الطرح غير صالحة (0-100).');
  await db.prepare("INSERT INTO tenant_flags (tenant_id, flag, enabled, rollout_pct) VALUES (?,?,?,?) ON CONFLICT (tenant_id, flag) DO UPDATE SET enabled = excluded.enabled, rollout_pct = excluded.rollout_pct, updated_at = datetime('now')")
    .bind(tenantId, flag, enabled ? 1 : 0, rolloutPct).run();
  return { ok: true, tenantId, flag, enabled, rolloutPct };
}

// Unknown flag => OFF.
export async function evaluateFlags(db, tenantId) {
  if (!TENANT_RE.test(String(tenantId || ''))) return bad('RELEASES_BAD_TENANT', 'معرّف المستأجر غير صالح.');
  const rows = await db.prepare('SELECT flag, enabled, rollout_pct FROM tenant_flags WHERE tenant_id = ?').bind(tenantId).all();
  const flags = {};
  for (const r of (rows.results || rows)) flags[r.flag] = isFlagOn(r, tenantId);
  return { ok: true, tenantId, flags };
}

export async function setDiagnosticsOptIn(db, tenantId, enabled) {
  if (!TENANT_RE.test(String(tenantId || ''))) return bad('RELEASES_BAD_TENANT', 'معرّف المستأجر غير صالح.');
  if (typeof enabled !== 'boolean') return bad('RELEASES_BAD_REQUEST', 'صيغة الطلب غير صالحة.');
  await db.prepare("INSERT INTO diagnostics_optin (tenant_id, enabled) VALUES (?,?) ON CONFLICT (tenant_id) DO UPDATE SET enabled = excluded.enabled, updated_at = datetime('now')")
    .bind(tenantId, enabled ? 1 : 0).run();
  return { ok: true, tenantId, enabled };
}

// Only allow-listed fields are read from the payload; everything else is dropped.
export async function recordDiagnostic(db, tenantId, ev) {
  if (!TENANT_RE.test(String(tenantId || ''))) return bad('RELEASES_BAD_TENANT', 'معرّف المستأجر غير صالح.');
  const o = await db.prepare('SELECT enabled FROM diagnostics_optin WHERE tenant_id = ?').bind(tenantId).first();
  if (!o || o.enabled !== 1) return bad('DIAGNOSTICS_NOT_OPTED_IN', 'التشخيص غير مفعّل لهذا المستأجر.', 403);
  const e = ev && typeof ev === 'object' ? ev : {};
  if (!DIAG_KINDS.includes(e.kind) || !CODE_RE.test(String(e.code || '')) || !VER_RE.test(String(e.appVersion || '')))
    return bad('DIAGNOSTICS_BAD_EVENT', 'بيانات التشخيص غير صالحة.');
  await db.prepare('INSERT INTO diagnostics_events (tenant_id, kind, app_version, code) VALUES (?,?,?,?)')
    .bind(tenantId, e.kind, e.appVersion, e.code).run();
  return { ok: true };
}

export function registerReleasesRoutes(route, { json, errorResponse }) {
  async function guard(ctx, { owner = false } = {}) {
    const { env, requestId } = ctx;
    if (!releasesEnabled(env)) return { res: errorResponse('RELEASES_DISABLED', 'الميزة غير مفعّلة.', 404, requestId) };
    const a = await authenticate(ctx.request, env);
    if (a.fail) return { res: errorResponse(a.fail.code, a.fail.message_ar, a.fail.status, requestId) };
    if (owner && normalizeRole(a.session.role) !== 'owner') return { res: errorResponse('PERMISSION_DENIED', 'ليست لديك صلاحية لهذه العملية.', 403, requestId) };
    let body = {};
    if (ctx.request.method === 'POST') { try { body = await ctx.request.json(); } catch { body = null; } }
    if (!body || typeof body !== 'object') return { res: errorResponse('RELEASES_BAD_REQUEST', 'صيغة الطلب غير صالحة.', 400, requestId) };
    // Non-owner callers are pinned to their session tenant; owner may target another tenant explicitly.
    const q = new URL(ctx.request.url).searchParams.get('tenantId');
    const tenantId = String((owner && (body.tenantId || q)) || a.session.tenantId || q || '');
    return { body, tenantId };
  }
  const out = (ctx, r, st = 200) => r.ok
    ? json({ ...r, requestId: ctx.requestId }, st, { 'X-Request-Id': ctx.requestId })
    : errorResponse(r.code, r.message_ar, r.status, ctx.requestId);
  const wrap = (opts, fn) => async (ctx) => {
    const g = await guard(ctx, opts); if (g.res) return g.res;
    try { return out(ctx, await fn(ctx, g)); }
    catch { return errorResponse('RELEASES_FAILED', 'تعذّر تنفيذ العملية.', 500, ctx.requestId); }
  };

  route('GET', '/api/v1/releases', wrap({}, (ctx) => ({ ok: true, current: getVersionInfo(ctx.env), latest: VERSION, notes: RELEASE_NOTES })));
  route('GET', '/api/v1/flags', wrap({}, (ctx, g) => evaluateFlags(ctx.env.DB, g.tenantId)));
  route('POST', '/api/v1/flags', wrap({ owner: true }, (ctx, g) => setFlag(ctx.env.DB, g.tenantId, g.body.flag, g.body)));
  route('POST', '/api/v1/diagnostics/optin', wrap({ owner: true }, (ctx, g) => setDiagnosticsOptIn(ctx.env.DB, g.tenantId, g.body.enabled)));
  route('POST', '/api/v1/diagnostics', wrap({}, (ctx, g) => recordDiagnostic(ctx.env.DB, g.tenantId, g.body)));
}
