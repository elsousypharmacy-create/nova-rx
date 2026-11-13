// N98 SEC-03: tenant + branch isolation for the backend Worker. Flag NOVA_TENANT_ISOLATION, default OFF.
// tenantId/branchId come ONLY from the authenticated session claims; any client-named tenant/branch must match.
// Every query/export/file key goes through the scoped helpers; callers never write SQL.
import {
  createIsolationContext, checkRequestScope, createScopedRepository, scopedKey,
} from '../../../worker/security/tenant-scope.js';

export const isolationEnabled = (env) => !!env && String(env.NOVA_TENANT_ISOLATION) === '1';

const MESSAGES = {
  SEC_TENANT_MISMATCH: ['TENANT_MISMATCH', 'غير مسموح بالوصول إلى بيانات جهة أخرى.', 403],
  SEC_BRANCH_FORBIDDEN: ['BRANCH_FORBIDDEN', 'غير مسموح بالوصول إلى هذا الفرع.', 403],
  SEC_CROSS_TENANT_TRANSFER_DENIED: ['BRANCH_FORBIDDEN', 'غير مسموح بالوصول إلى هذا الفرع.', 403],
  'not-found': ['NOT_FOUND', 'العنصر غير موجود.', 404],
};

// Maps an internal failure to a stable code + Arabic message + requestId. Never echoes tenant data.
export function isolationError(failure, requestId) {
  const m = MESSAGES[failure && failure.error];
  const [code, message_ar, status] = m || ['SCOPE_INVALID', 'جلسة غير صالحة أو نطاق غير صالح.', 401];
  return { ok: false, status, code, message_ar, requestId };
}

// session = verified claims from auth (SEC-01). Returns { ok, scope } or an error response body.
export function scopeFromSession(session, request, requestId) {
  const c = createIsolationContext(session);
  if (!c.ok) return isolationError(c, requestId);
  const s = checkRequestScope(c.context, request);
  if (!s.ok) return isolationError(s, requestId);
  return { ok: true, ctx: c.context, tenantId: s.tenantId, branchId: s.branchId };
}

// Scoped DB helper over a D1-style executor: execute(sql, params, 'read'|'write').
export function scopedDb(ctx, execute, schema, branchId) {
  return createScopedRepository(ctx, execute, schema, branchId === undefined ? {} : { branchId });
}

// Export: rows always read through the scoped repo, so another tenant's rows can never be in the file.
export async function scopedExport(repo, table, where = {}) {
  const r = await repo.select(table, where, { limit: 1000 });
  return r.ok ? { ok: true, table, count: r.rows.length, rows: r.rows } : r;
}

// File/object keys (R2-style) are prefixed by tenant+branch; a client path can never escape its prefix.
export function scopedFileKey(ctx, clientName) {
  if (typeof clientName !== 'string' || !clientName || /(^|[\\/])\.\.?([\\/]|$)|[\\/]/.test(clientName)) {
    return { ok: false, error: 'file-name-invalid' };
  }
  return { ok: true, key: scopedKey(ctx, 'cache', 'file:' + clientName) };
}
export const ownsFileKey = (ctx, key) =>
  typeof key === 'string' && key.startsWith(`t:${ctx.tenantId}:b:${ctx.activeBranchId ?? '*'}:`);
