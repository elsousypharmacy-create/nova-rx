// Per-pharmacy supplier routes (multi-tenant). The pharmacy comes ONLY from the signed-in session (never the body or a header),
// and every pharmacy has its own encrypted supplier sessions in KV (worker/procurement/provider/tenant.js).
// Needs the Worker secret NOVA_SECRET_ENCRYPTION_KEY; without it every route answers 503 (never open).
// Cart / order writes and the stock feed are NOT exposed here (they use shared state; see docs/product/SUPPLIERS_PER_PHARMACY_DESIGN.md).
import { createTenantSupplierApi } from '../../worker/procurement/provider/tenant.js';
import { normalizeRole } from './auth/permissions.js';
import { authenticate } from './auth/auth.js';

const PARTS = ['status', 'list', 'sellers', 'search', 'session'];

export function registerSupplierRoutes(route, { errorResponse }) {
  const tenants = new WeakMap();
  const handles = new WeakMap();
  const handlerFor = (env) => {
    let h = handles.get(env);
    if (!h) {
      h = createTenantSupplierApi({ resolveTenant: async (r) => tenants.get(r) || null, kv: env.KV, env });
      handles.set(env, h);
    }
    return h;
  };

  for (const part of PARTS) {
    const method = part === 'search' || part === 'session' ? 'POST' : 'GET';
    route(method, '/api/v1/suppliers/' + part, async (ctx) => {
      const { request, env, requestId } = ctx;
      if (!env || !env.KV) return errorResponse('SUPPLIERS_NOT_CONFIGURED', 'خدمة الموردين غير مفعّلة.', 503, requestId);
      const a = await authenticate(request, env);
      if (a.fail) return errorResponse(a.fail.code, a.fail.message_ar, a.fail.status, requestId);
      const tenantId = a.session.tenantId;
      if (typeof tenantId !== 'string' || tenantId === '') return errorResponse('SUPPLIERS_TENANT_REQUIRED', 'الجلسة غير مرتبطة بصيدلية.', 403, requestId);
      if (part === 'session' && normalizeRole(a.session.role) !== 'owner') return errorResponse('PERMISSION_DENIED', 'ليست لديك صلاحية لهذه العملية.', 403, requestId);
      const url = new URL(request.url);
      url.pathname = '/api/suppliers/' + part;
      const inner = new Request(url.toString(), { method: request.method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? request.body : undefined, duplex: 'half' });
      tenants.set(inner, tenantId);
      const res = await handlerFor(env)(inner);
      return res || errorResponse('NOT_FOUND', 'المسار غير موجود.', 404, requestId);
    });
  }
}
