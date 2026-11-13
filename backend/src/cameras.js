// N120 OPS-05 cameras as an independent source. Flag NOVA_CAMERAS=1 (default OFF) + D1 binding DB.
// READ-ONLY: saved reports, source status, evidence coverage. Never calls an analysis/AI/camera service, never
// computes a quality score (only raw counts), never touches the camera schedule. Special permission: owner/manager only,
// enforced always (independent of NOVA_PERMISSIONS). Tenant comes ONLY from the authenticated session.
import { scopeFromSession } from './security/tenant.js';
import { normalizeRole } from './auth/permissions.js';

export const camerasEnabled = (env) => !!env && String(env.NOVA_CAMERAS) === '1';
const CAMERA_ROLES = ['owner', 'manager'];
export const canViewCameras = (role) => CAMERA_ROLES.includes(normalizeRole(role));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const toReport = (r) => ({ id: r.id, cameraId: r.camera_id, date: r.report_date, title: r.title, summary: r.summary, evidenceCount: r.evidence_count, createdAt: r.created_at });

export async function listReports(db, t, { from, to, cameraId } = {}) {
  const { results } = await db.prepare(
    'SELECT * FROM camera_reports WHERE tenant_id = ? AND (? IS NULL OR report_date >= ?) AND (? IS NULL OR report_date <= ?) AND (? IS NULL OR camera_id = ?) ORDER BY report_date DESC, id ASC LIMIT 200',
  ).bind(t, from || null, from || null, to || null, to || null, cameraId || null, cameraId || null).all();
  return (results || []).map(toReport);
}

export async function sourceStatus(db, t) {
  const { results } = await db.prepare('SELECT * FROM camera_source_status WHERE tenant_id = ? ORDER BY source_id ASC LIMIT 200').bind(t).all();
  return (results || []).map((r) => ({ sourceId: r.source_id, state: r.state, lastReportAt: r.last_report_at, updatedAt: r.updated_at }));
}

// Raw counts only. No percentage / score is derived.
export async function evidenceCoverage(db, t) {
  const r = await db.prepare(
    'SELECT COUNT(*) AS reports, COALESCE(SUM(CASE WHEN evidence_count > 0 THEN 1 ELSE 0 END),0) AS with_evidence, COALESCE(SUM(evidence_count),0) AS evidence_items, COUNT(DISTINCT report_date) AS days, MIN(report_date) AS first_date, MAX(report_date) AS last_date FROM camera_reports WHERE tenant_id = ?',
  ).bind(t).first();
  return {
    reports: r.reports, reportsWithEvidence: r.with_evidence, reportsWithoutEvidence: r.reports - r.with_evidence,
    evidenceItems: r.evidence_items, days: r.days, firstDate: r.first_date, lastDate: r.last_date,
  };
}

export function registerCameraRoutes(route, { errorResponse }, { authenticate }) {
  const guard = (handler) => async (ctx) => {
    const { env, requestId, request, url } = ctx;
    if (!camerasEnabled(env) || !env.DB || !env.KV) return errorResponse('CAMERAS_DISABLED', 'مصدر الكاميرات غير مفعّل.', 404, requestId);
    const a = await authenticate(request, env);
    if (a.fail) return errorResponse(a.fail.code, a.fail.message_ar, a.fail.status, requestId);
    const s = a.session;
    if (!canViewCameras(s.role) && !(s.roles || []).some((r) => canViewCameras(String(r).toLowerCase()))) {
      return errorResponse('CAMERAS_FORBIDDEN', 'ليست لديك صلاحية عرض الكاميرات.', 403, requestId);
    }
    const sc = scopeFromSession({
      actorId: s.user, tenantId: s.tenantId, roles: s.roles || [], tenantBranchIds: s.tenantBranchIds,
      assignedBranchIds: s.assignedBranchIds, activeBranchId: s.activeBranchId,
    }, { query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(request.headers) }, requestId);
    if (!sc.ok) return errorResponse(sc.code, sc.message_ar, sc.status, requestId);
    try {
      return { ok: true, ...(await handler({ db: env.DB, t: sc.tenantId, url })), requestId };
    } catch (e) {
      if (e && e.code === 'CAMERAS_BAD_REQUEST') return errorResponse(e.code, e.message_ar, 400, requestId);
      return errorResponse('CAMERAS_FAILED', 'تعذّر تحميل بيانات الكاميرات. حاول مرة أخرى لاحقاً.', 503, requestId);
    }
  };
  const date = (v) => {
    if (v === null || v === '') return null;
    if (!DATE.test(v)) throw Object.assign(new Error('bad'), { code: 'CAMERAS_BAD_REQUEST', message_ar: 'صيغة التاريخ غير صالحة.' });
    return v;
  };
  const base = '/api/v1/cameras/';
  route('GET', base + 'reports', guard(async ({ db, t, url }) => ({
    reports: await listReports(db, t, { from: date(url.searchParams.get('from')), to: date(url.searchParams.get('to')), cameraId: url.searchParams.get('cameraId') }),
  })));
  route('GET', base + 'status', guard(async ({ db, t }) => ({ sources: await sourceStatus(db, t) })));
  route('GET', base + 'coverage', guard(async ({ db, t }) => ({
    coverage: await evidenceCoverage(db, t),
    analysis: { calls: 0, note: 'لا تحليل ولا تكلفة من هذه الواجهة؛ عرض للتقارير المحفوظة فقط.' },
  })));
}
