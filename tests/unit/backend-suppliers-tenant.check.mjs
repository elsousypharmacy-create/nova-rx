// Backend /api/v1/suppliers/*: pharmacy comes from the session only; A cannot see B; only the owner uploads a session; fail-closed without the key.
// Run: node tests/unit/backend-suppliers-tenant.check.mjs
import { handle } from '../../backend/src/index.js';
import { sha256Hex } from '../../backend/src/auth/auth.js';

let fail = 0; const ck = (n, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) fail++; };
const kv = new Map();
const KV = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } };
const env = { KV, NOVA_SECRET_ENCRYPTION_KEY: 'k-' + 'y'.repeat(40) };
const sess = async (tok, s) => kv.set('sess:' + (await sha256Hex(tok.padEnd(40, 'x'))), JSON.stringify({ expires: 9e12, reauthAt: 9e12, ...s }));
const call = async (e, path, tok, method = 'GET', body) => {
  const r = await handle(new Request('https://x.test' + path, { method, headers: { ...(tok ? { Authorization: 'Bearer ' + tok.padEnd(40, 'x') } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), e);
  return { status: r.status, json: await r.json().catch(() => null) };
};
await sess('ownA', { user: 'a', role: 'owner', tenantId: 'ten-a' });
await sess('cashA', { user: 'c', role: 'cashier', tenantId: 'ten-a' });
await sess('ownB', { user: 'b', role: 'owner', tenantId: 'ten-b' });
await sess('noTen', { user: 'n', role: 'owner' });
const FUT = new Date(Date.now() + 36e5).toISOString();

ck('no token -> 401', (await call(env, '/api/v1/suppliers/status', null)).status === 401);
ck('session without pharmacy -> 403', (await call(env, '/api/v1/suppliers/status', 'noTen')).status === 403);
ck('cashier cannot upload a session', (await call(env, '/api/v1/suppliers/session', 'cashA', 'POST', { supplierId: 'aumet', session: {}, expiresAt: FUT })).status === 403);
ck('owner A uploads', (await call(env, '/api/v1/suppliers/session', 'ownA', 'POST', { supplierId: 'aumet', session: { sellers: [{ id: 1, name: 'x' }] }, expiresAt: FUT })).status === 200);
const aum = (r) => r.json.suppliers.find((s) => s.id === 'aumet').state;
ck('A sees ok', aum(await call(env, '/api/v1/suppliers/status', 'ownA')) === 'ok');
ck('A cashier sees ok (read)', aum(await call(env, '/api/v1/suppliers/status', 'cashA')) === 'ok');
ck('B sees off', aum(await call(env, '/api/v1/suppliers/status', 'ownB')) === 'off');
ck('B sellers empty', (await call(env, '/api/v1/suppliers/sellers', 'ownB')).json.sellers.length === 0);
ck('KV key tenant scoped', kv.has('supplier-session:ten-a:aumet') && !kv.has('supplier-session:aumet'));
ck('no key configured -> 503', (await call({ KV }, '/api/v1/suppliers/status', 'ownA')).status === 503);
console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
