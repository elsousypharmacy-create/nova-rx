// Per-pharmacy supplier sessions: tenant A's session is invisible to tenant B; identity only from resolveTenant; unsafe routes fail closed.
// Run: node tests/unit/supplier-tenant-isolation.check.mjs
import { createTenantSupplierApi } from '../../worker/procurement/provider/tenant.js';
import { createSessionStore } from '../../worker/procurement/provider/session-store.js';

let fail = 0; const ck = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) fail++; };
const kvMap = new Map();
const kv = { get: async (k) => kvMap.get(k) ?? null, put: async (k, v) => { kvMap.set(k, v); }, delete: async (k) => { kvMap.delete(k); } };
const env = { NOVA_SECRET_ENCRYPTION_KEY: 'test-key-' + 'x'.repeat(32) };
const FUT = new Date(Date.now() + 3600e3).toISOString();

const handle = createTenantSupplierApi({
  kv, env,
  resolveTenant: async (req) => { const t = req.headers.get('X-Test-Tenant'); return t || null; },
});
const call = (tenant, path, method = 'GET', body) => handle(new Request('https://x.test' + path, {
  method, headers: { ...(tenant ? { 'X-Test-Tenant': tenant } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
}));
const j = async (r) => r.json();

// Unauthenticated: no tenant -> 401, nothing written.
ck('no tenant -> 401', (await call(null, '/api/suppliers/status')).status === 401);
ck('bad tenant id -> 401', (await call('a:b', '/api/suppliers/status')).status === 401);

// Tenant A uploads an Aumet session (no shared secret needed; tenant login is the authorisation).
const up = await call('pharmA', '/api/suppliers/session', 'POST', { supplierId: 'aumet', session: { sellers: [{ id: 7, name: 'مخزن أ' }], searchParams: { pharmacy_id: 1 } }, expiresAt: FUT });
ck('tenant A upload ok', up.status === 200);

const stA = (await j(await call('pharmA', '/api/suppliers/status'))).suppliers.find((s) => s.id === 'aumet');
const stB = (await j(await call('pharmB', '/api/suppliers/status'))).suppliers.find((s) => s.id === 'aumet');
ck('tenant A sees its aumet session', stA.state === 'ok');
ck('tenant B does NOT see tenant A session', stB.state === 'off');
ck('tenant A sellers visible to A', (await j(await call('pharmA', '/api/suppliers/sellers'))).sellers.length === 1);
ck('tenant A sellers hidden from B', (await j(await call('pharmB', '/api/suppliers/sellers'))).sellers.length === 0);

// Keys are tenant scoped and no legacy global key was created.
ck('KV key is tenant scoped', kvMap.has('supplier-session:pharmA:aumet') && !kvMap.has('supplier-session:aumet'));
const legacy = createSessionStore({ kv, secret: env.NOVA_SECRET_ENCRYPTION_KEY });
ck('legacy single-pharmacy store cannot read tenant data', (await legacy.load('aumet', { ignoreExpiry: true })) === null);

// Shared-secret header from the client is not an identity.
const spoof = await handle(new Request('https://x.test/api/suppliers/session', { method: 'POST', headers: { 'X-Ingest-Secret': 'anything', 'Content-Type': 'application/json' }, body: JSON.stringify({ supplierId: 'aumet', session: {}, expiresAt: FUT }) }));
ck('ingest secret header alone is rejected', spoof.status === 401);

// Cart / orders / stock feed are single-pharmacy state: blocked in tenant mode.
for (const p of ['/api/purchases/aumet-cart/apply', '/api/purchases/orders/apply', '/api/purchases/stock']) ck('blocked ' + p, (await call('pharmA', p, 'POST', {})).status === 501);

// Non-supplier routes fall through (null) so other handlers run.
ck('non supplier route -> null', (await handle(new Request('https://x.test/api/other'))) === null);

console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
