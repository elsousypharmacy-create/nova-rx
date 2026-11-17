// Per-pharmacy supplier API (multi-tenant). Wraps createSupplierApi so every request runs against ONE pharmacy's
// own encrypted sessions (`supplier-session:<tenant>:<supplier>`). Identity comes from resolveTenant(request)
// (the backend session), never from the request body. Anything that is not tenant-safe yet fails closed.
// Dependency-free ES module; runs in Cloudflare Workers and Node 22.
import { createSessionStore } from './session-store.js';
import { createSupplierHub } from './hub.js';
import { createSupplierApi } from './http.js';

// Allowed in tenant mode. Cart/order writes and the stock feed use shared (single-pharmacy) state, so they stay blocked.
const TENANT_ROUTES = new Set([
  '/api/suppliers/session', '/api/suppliers/status', '/api/suppliers/search', '/api/suppliers/list', '/api/suppliers/sellers',
]);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

export function createTenantSupplierApi({ resolveTenant, kv, env = {}, fetch: fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  if (typeof resolveTenant !== 'function') throw new Error('resolveTenant is required');
  const internal = crypto.randomUUID() + crypto.randomUUID();
  const apis = new Map();

  function apiFor(tenant) {
    let api = apis.get(tenant);
    if (!api) {
      const store = createSessionStore({ kv, secret: env.NOVA_SECRET_ENCRYPTION_KEY || '', now, tenant });
      const hub = createSupplierHub({ store, now, fetch: fetchImpl });
      api = createSupplierApi({ hub, store, env: { ...env, NOVA_INGEST_SECRET: internal }, fetch: fetchImpl });
      apis.set(tenant, api);
    }
    return api;
  }

  return async function handle(request) {
    const path = new URL(request.url).pathname;
    const isSupplierRoute = path.startsWith('/api/suppliers/') || path.startsWith('/api/purchases/');
    if (!isSupplierRoute) return null;
    if (!TENANT_ROUTES.has(path)) return json({ error: 'tenant-route-not-enabled' }, 501);
    if (!env.NOVA_SECRET_ENCRYPTION_KEY) return json({ error: 'not-configured' }, 503);
    let tenant = null;
    try { tenant = await resolveTenant(request); } catch { tenant = null; }
    if (typeof tenant !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(tenant)) return json({ error: 'unauthorized' }, 401);
    let req = request;
    if (path === '/api/suppliers/session') {
      // The tenant login already authorises the upload; give the inner handler its private secret instead of the shared one.
      const headers = new Headers(request.headers);
      headers.set('X-Ingest-Secret', internal);
      req = new Request(request, { headers });
    }
    return apiFor(tenant)(req);
  };
}
