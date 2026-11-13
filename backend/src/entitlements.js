// N122 SAAS-02: plans + entitlements. Flag NOVA_ENTITLEMENTS=1 (default OFF => routes 404, nothing touched).
// Features/limits per tenant; expired subscription => read-only mode (writes blocked, reads + export allowed).
// Data is never deleted. Billing provider is a MOCK adapter only (NEEDS-OWNER: payment provider account).
import { authenticate } from './auth/auth.js';
import { normalizeRole } from './auth/permissions.js';

export const entitlementsEnabled = (env) => !!env && String(env.NOVA_ENTITLEMENTS) === '1' && !!env.DB;
export const PLANS = {
  free: { name_ar: 'مجانية', features: ['pos', 'inventory', 'export'], limits: { branches: 1, users: 3, products: 500 } },
  pro: { name_ar: 'احترافية', features: ['pos', 'inventory', 'export', 'rx_order', 'delivery', 'inbox'], limits: { branches: 5, users: 20, products: 20000 } },
  enterprise: { name_ar: 'مؤسسات', features: ['pos', 'inventory', 'export', 'rx_order', 'delivery', 'inbox', 'integration_api', 'country_adapters'], limits: { branches: -1, users: -1, products: -1 } },
};
const LIMIT_TABLES = { branches: 'branches', users: 'users', products: 'products' };
const bad = (code, message_ar, status = 400) => ({ ok: false, code, message_ar, status });
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

export async function seedPlans(db) {
  for (const [id, p] of Object.entries(PLANS))
    await db.prepare('INSERT OR IGNORE INTO plans (id, name_ar, features, limits) VALUES (?,?,?,?)').bind(id, p.name_ar, JSON.stringify(p.features), JSON.stringify(p.limits)).run();
}

export async function setSubscription(db, tenantId, { planId, expiresAt = null, provider = null, providerRef = null }) {
  const plan = await db.prepare('SELECT id FROM plans WHERE id = ? AND active = 1').bind(String(planId || '')).first();
  if (!plan) return bad('ENTITLEMENT_BAD_PLAN', 'الخطة غير معروفة.');
  if (!(await db.prepare('SELECT 1 AS x FROM tenants WHERE id = ?').bind(tenantId).first())) return bad('ENTITLEMENT_NOT_FOUND', 'المستأجر غير موجود.', 404);
  if (expiresAt != null && Number.isNaN(Date.parse(expiresAt))) return bad('ENTITLEMENT_BAD_DATE', 'تاريخ الانتهاء غير صالح.');
  await db.prepare("INSERT INTO tenant_subscriptions (tenant_id, plan_id, status, expires_at, provider, provider_ref) VALUES (?,?,'active',?,?,?) ON CONFLICT (tenant_id) DO UPDATE SET plan_id = excluded.plan_id, status = 'active', expires_at = excluded.expires_at, provider = excluded.provider, provider_ref = excluded.provider_ref, updated_at = datetime('now')")
    .bind(tenantId, plan.id, expiresAt, provider, providerRef).run();
  return { ok: true, planId: plan.id, expiresAt };
}

// Resolve the tenant's effective entitlement. No subscription row => free plan (never locked out).
export async function getEntitlements(db, tenantId, now = Date.now()) {
  const sub = await db.prepare('SELECT plan_id, status, expires_at FROM tenant_subscriptions WHERE tenant_id = ?').bind(tenantId).first();
  const planId = sub ? sub.plan_id : 'free';
  const row = await db.prepare('SELECT features, limits FROM plans WHERE id = ?').bind(planId).first();
  const base = PLANS[planId] || PLANS.free;
  const features = row ? parse(row.features, base.features) : base.features;
  const limits = row ? parse(row.limits, base.limits) : base.limits;
  const expired = !!(sub && sub.expires_at && Date.parse(sub.expires_at) <= now) || !!(sub && sub.status === 'expired');
  return { planId, features, limits, expired, readOnly: expired, expiresAt: sub ? sub.expires_at : null };
}

export const hasFeature = (ent, feature) => ent.features.includes(feature) && (!ent.expired || feature === 'export');

// Write guard: expired => read-only. Export and reads always stay available.
export function checkWrite(ent) {
  return ent.readOnly ? bad('ENTITLEMENT_READ_ONLY', 'انتهى الاشتراك: الحساب في وضع القراءة فقط. يمكنك تصدير بياناتك.', 402) : { ok: true };
}
export function checkFeature(ent, feature) {
  return hasFeature(ent, feature) ? { ok: true } : bad(ent.expired && ent.features.includes(feature) ? 'ENTITLEMENT_READ_ONLY' : 'ENTITLEMENT_FEATURE_DENIED',
    ent.expired ? 'انتهى الاشتراك: الحساب في وضع القراءة فقط.' : 'هذه الميزة غير متاحة في خطتك.', 402);
}
export async function checkLimit(db, tenantId, ent, limit) {
  const table = LIMIT_TABLES[limit];
  if (!table) return bad('ENTITLEMENT_BAD_LIMIT', 'حد غير معروف.');
  const w = checkWrite(ent); if (!w.ok) return w;
  const max = ent.limits[limit];
  if (max == null || max < 0) return { ok: true, used: null, max: -1 };
  const used = (await db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE tenant_id = ?`).bind(tenantId).first()).c;
  return used >= max ? bad('ENTITLEMENT_LIMIT_REACHED', 'تم بلوغ الحد الأقصى المسموح في خطتك.', 402) : { ok: true, used, max };
}

// Export: always available (even expired). Read-only dump of the tenant's core tables.
export async function exportTenantData(db, tenantId) {
  const data = {};
  for (const t of ['branches', 'products', 'inventory_batches']) {
    const r = await db.prepare(`SELECT * FROM ${t} WHERE tenant_id = ?`).bind(tenantId).all();
    data[t] = r.results || r;
  }
  return { ok: true, tenantId, exportedAt: new Date().toISOString(), data };
}

// Mock billing adapter: no network. A real provider needs an owner account (flag stays OFF).
export function createMockBilling() {
  const calls = [];
  return { calls, name: 'mock',
    async charge(tenantId, planId) { calls.push({ tenantId, planId }); return { ok: true, providerRef: 'mock_' + tenantId + '_' + planId }; } };
}

export function registerEntitlementRoutes(route, { json, errorResponse }) {
  async function guard(ctx) {
    const { env, requestId } = ctx;
    if (!entitlementsEnabled(env)) return { res: errorResponse('ENTITLEMENTS_DISABLED', 'الميزة غير مفعّلة.', 404, requestId) };
    const a = await authenticate(ctx.request, env);
    if (a.fail) return { res: errorResponse(a.fail.code, a.fail.message_ar, a.fail.status, requestId) };
    if (normalizeRole(a.session.role) !== 'owner') return { res: errorResponse('PERMISSION_DENIED', 'ليست لديك صلاحية لهذه العملية.', 403, requestId) };
    let body = {}; if (ctx.request.method === 'POST') { try { body = await ctx.request.json(); } catch { body = null; } }
    if (!body || typeof body !== 'object') return { res: errorResponse('ENTITLEMENT_BAD_REQUEST', 'صيغة الطلب غير صالحة.', 400, requestId) };
    return { body };
  }
  const out = (ctx, r) => r.ok ? json({ ...r, requestId: ctx.requestId }, 200, { 'X-Request-Id': ctx.requestId }) : errorResponse(r.code, r.message_ar, r.status, ctx.requestId);
  const wrap = (fn) => async (ctx) => {
    const g = await guard(ctx); if (g.res) return g.res;
    try { await seedPlans(ctx.env.DB); return out(ctx, await fn(ctx, g.body)); }
    catch { return errorResponse('ENTITLEMENT_FAILED', 'تعذّر تنفيذ العملية.', 500, ctx.requestId); }
  };
  const tid = (ctx, b) => String(b.tenantId || new URL(ctx.request.url).searchParams.get('tenantId') || '');
  route('GET', '/api/v1/entitlements', wrap(async (ctx, b) => ({ ok: true, ...(await getEntitlements(ctx.env.DB, tid(ctx, b))) })));
  route('POST', '/api/v1/entitlements/subscription', wrap((ctx, b) => setSubscription(ctx.env.DB, tid(ctx, b), b)));
  route('GET', '/api/v1/entitlements/export', wrap((ctx, b) => exportTenantData(ctx.env.DB, tid(ctx, b))));
}
