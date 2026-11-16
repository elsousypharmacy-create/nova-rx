// S1-02: tenant + branch scope for sync push/pull. A session that carries scope data (D1 staff sessions, S1-06) goes through
// the normal isolation check and a failure there stays a failure. A KV owner session (today's NOVA_AUTH) has no scope data:
// it acts for env.NOVA_TENANT_ID (as sync push always did) on that tenant's ONLY branch. Zero or several branches => SCOPE_INVALID.
import { scopeFromSession } from './security/tenant.js';

export async function syncScope(env, s, request, requestId) {
  const url = new URL(request.url);
  const sc = scopeFromSession({ actorId: s.user, tenantId: s.tenantId, roles: s.roles || [], tenantBranchIds: s.tenantBranchIds,
    assignedBranchIds: s.assignedBranchIds, activeBranchId: s.activeBranchId },
  { query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(request.headers) }, requestId);
  if (sc.ok || s.tenantId || s.tenantBranchIds) return sc;
  const tenant = String(s.tenant || (env && env.NOVA_TENANT_ID) || 'default');
  try {
    const { results } = await env.DB.prepare('SELECT id FROM branches WHERE tenant_id = ?').bind(tenant).all();
    if ((results || []).length === 1) return { ok: true, tenantId: tenant, branchId: results[0].id };
  } catch { /* no branches table / DB error: fall through to the original refusal */ }
  return sc;
}
