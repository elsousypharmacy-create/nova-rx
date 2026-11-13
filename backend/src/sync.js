// N102 sync pull: GET /api/v1/sync/pull?cursor=&limit= . Flag NOVA_SYNC=1 (default OFF) + D1 binding DB.
// Scope (tenant/branch) comes ONLY from the authenticated session; a client-named tenant/branch must match.
// Tombstones are rows with deleted=1 (soft flag); nothing here ever deletes.
import { scopeFromSession } from './security/tenant.js';

export const syncEnabled = (env) => !!env && String(env.NOVA_SYNC) === '1';
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;

// Cursor is the last seq the client has seen, as a decimal string. '' / missing = from the start.
export function parseCursor(v) {
  if (v === null || v === undefined || v === '') return 0;
  return /^\d{1,15}$/.test(v) ? Number(v) : null;
}

export async function pullChanges(db, { tenantId, branchId, cursor, limit }) {
  const n = Math.min(MAX_LIMIT, Math.max(1, limit | 0 || DEFAULT_LIMIT));
  const { results } = await db.prepare(
    'SELECT seq, entity, entity_id, deleted, payload_json, changed_at FROM change_feed WHERE tenant_id = ? AND branch_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?',
  ).bind(tenantId, branchId, cursor, n + 1).all();
  const rows = results || [];
  const hasMore = rows.length > n;
  const page = rows.slice(0, n);
  const changes = page.map((r) => ({
    seq: r.seq, entity: r.entity, id: r.entity_id, deleted: r.deleted === 1,
    data: r.deleted === 1 || !r.payload_json ? null : JSON.parse(r.payload_json), changedAt: r.changed_at,
  }));
  return { changes, nextCursor: String(page.length ? page[page.length - 1].seq : cursor), hasMore };
}

export function registerSyncRoutes(route, { errorResponse }, { authenticate }) {
  route('GET', '/api/v1/sync/pull', async (ctx) => {
    const { env, requestId, url, request } = ctx;
    if (!syncEnabled(env) || !env.DB || !env.KV) return errorResponse('SYNC_DISABLED', 'المزامنة غير مفعّلة.', 404, requestId);
    const a = await authenticate(request, env);
    if (a.fail) return errorResponse(a.fail.code, a.fail.message_ar, a.fail.status, requestId);
    const s = a.session;
    const sc = scopeFromSession({
      actorId: s.user, tenantId: s.tenantId, roles: s.roles || [], tenantBranchIds: s.tenantBranchIds,
      assignedBranchIds: s.assignedBranchIds, activeBranchId: s.activeBranchId,
    }, { query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(request.headers) }, requestId);
    if (!sc.ok) return errorResponse(sc.code, sc.message_ar, sc.status, requestId);
    const cursor = parseCursor(url.searchParams.get('cursor'));
    if (cursor === null) return errorResponse('SYNC_BAD_CURSOR', 'مؤشر المزامنة غير صالح.', 400, requestId);
    const lim = url.searchParams.get('limit');
    if (lim !== null && !/^\d{1,4}$/.test(lim)) return errorResponse('SYNC_BAD_LIMIT', 'حد الصفحة غير صالح.', 400, requestId);
    try {
      const out = await pullChanges(env.DB, { tenantId: sc.tenantId, branchId: sc.branchId, cursor, limit: lim === null ? DEFAULT_LIMIT : Number(lim) });
      return { ok: true, ...out, requestId };
    } catch {
      return errorResponse('SYNC_FAILED', 'تعذّرت المزامنة. حاول مرة أخرى لاحقاً.', 503, requestId);
    }
  });
}
