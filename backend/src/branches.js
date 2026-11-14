// UX37-14 read-only branches / stock-locations API. Flag NOVA_BRANCHES=1 (default OFF => 404) + D1 binding DB.
// Tenant and branch set come ONLY from the authenticated session: a branch is returned only if it belongs to the
// session tenant AND is in the session's assigned branches. No writes.
import { scopeFromSession } from './security/tenant.js';

export const branchesEnabled = (env) => !!env && String(env.NOVA_BRANCHES) === '1';

const allowedBranches = (s) => {
  const assigned = Array.isArray(s.assignedBranchIds) ? s.assignedBranchIds : [];
  const tenant = Array.isArray(s.tenantBranchIds) ? s.tenantBranchIds : [];
  return assigned.filter((b) => tenant.includes(b));
};
const inList = (ids) => ids.map(() => '?').join(',');

export async function listBranches(db, t, ids) {
  if (!ids.length) return [];
  const { results } = await db.prepare(
    `SELECT id, name FROM branches WHERE tenant_id = ? AND id IN (${inList(ids)}) ORDER BY name ASC, id ASC LIMIT 200`,
  ).bind(t, ...ids).all();
  return (results || []).map((r) => ({ id: r.id, name: r.name }));
}

export async function listStockLocations(db, t, ids, branchId) {
  const use = branchId ? ids.filter((b) => b === branchId) : ids;
  if (!use.length) return [];
  const { results } = await db.prepare(
    `SELECT branch_id, id, name, kind FROM stock_locations WHERE tenant_id = ? AND branch_id IN (${inList(use)}) ORDER BY branch_id ASC, name ASC, id ASC LIMIT 500`,
  ).bind(t, ...use).all();
  return (results || []).map((r) => ({ branchId: r.branch_id, id: r.id, name: r.name, kind: r.kind }));
}

export function registerBranchRoutes(route, { errorResponse }, { authenticate }) {
  const guard = (handler) => async (ctx) => {
    const { env, requestId, request, url } = ctx;
    if (!branchesEnabled(env) || !env.DB || !env.KV) return errorResponse('BRANCHES_DISABLED', 'واجهة الفروع غير مفعّلة.', 404, requestId);
    const a = await authenticate(request, env);
    if (a.fail) return errorResponse(a.fail.code, a.fail.message_ar, a.fail.status, requestId);
    const s = a.session;
    const sc = scopeFromSession({
      actorId: s.user, tenantId: s.tenantId, roles: s.roles || [], tenantBranchIds: s.tenantBranchIds,
      assignedBranchIds: s.assignedBranchIds, activeBranchId: s.activeBranchId,
    }, { query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(request.headers) }, requestId);
    if (!sc.ok) return errorResponse(sc.code, sc.message_ar, sc.status, requestId);
    try {
      return { ok: true, ...(await handler({ db: env.DB, t: sc.tenantId, ids: allowedBranches(s), url })), requestId };
    } catch (e) {
      return errorResponse('BRANCHES_FAILED', 'تعذّر تحميل بيانات الفروع. حاول مرة أخرى لاحقاً.', 503, requestId);
    }
  };
  route('GET', '/api/v1/branches', guard(async ({ db, t, ids }) => ({ branches: await listBranches(db, t, ids) })));
  route('GET', '/api/v1/stock-locations', guard(async ({ db, t, ids, url }) => ({
    locations: await listStockLocations(db, t, ids, url.searchParams.get('branchId')),
  })));
}
