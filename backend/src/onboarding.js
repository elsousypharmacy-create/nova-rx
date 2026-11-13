// N121 SAAS-01: tenant onboarding. Flag NOVA_ONBOARDING=1 (default OFF => routes 404, nothing touched).
// Creates tenant + branches + owner + roles + import step; isolated demo sandbox tenant with seed data.
// Rollback = soft-disable (status='disabled'); rows are never deleted. No network.
import { authenticate } from './auth/auth.js';
import { hashPassword } from './auth/auth.js';
import { ROLES, normalizeRole } from './auth/permissions.js';

export const onboardingEnabled = (env) => !!env && String(env.NOVA_ONBOARDING) === '1' && !!env.DB;
export const STEPS = ['tenant', 'branches', 'owner', 'roles', 'import'];
export const SANDBOX_PREFIX = 'demo-';
const ID_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;
const rid = (p) => { const b = new Uint8Array(6); crypto.getRandomValues(b); return p + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); };

async function step(db, tenantId, name, status, detail) {
  await db.prepare("INSERT INTO onboarding_steps (tenant_id, step, status, detail) VALUES (?,?,?,?) ON CONFLICT (tenant_id, step) DO UPDATE SET status = excluded.status, detail = excluded.detail, updated_at = datetime('now')")
    .bind(tenantId, name, status, detail ? JSON.stringify(detail) : null).run();
}

const bad = (code, message_ar, status = 400) => ({ ok: false, code, message_ar, status });

export async function createTenant(db, { tenantId, name, branches, owner, sandbox = false }) {
  if (!ID_RE.test(String(tenantId || ''))) return bad('ONBOARDING_BAD_TENANT', 'معرّف المستأجر غير صالح.');
  if (!name || typeof name !== 'string') return bad('ONBOARDING_BAD_NAME', 'اسم المستأجر مطلوب.');
  const bl = Array.isArray(branches) ? branches.map((b) => String(b || '').trim()).filter(Boolean) : [];
  if (!bl.length || new Set(bl).size !== bl.length) return bad('ONBOARDING_BAD_BRANCHES', 'يلزم فرع واحد على الأقل بأسماء غير مكررة.');
  if (!owner || !/^[a-z0-9._-]{3,40}$/i.test(String(owner.username || '')) || String(owner.password || '').length < 8)
    return bad('ONBOARDING_BAD_OWNER', 'بيانات المالك غير صالحة (اسم مستخدم 3+ وكلمة مرور 8+).');
  if (await db.prepare('SELECT 1 AS x FROM tenants WHERE id = ?').bind(tenantId).first()) return bad('ONBOARDING_TENANT_EXISTS', 'المستأجر موجود مسبقاً.', 409);

  await db.prepare('INSERT INTO tenants (id, name, sandbox) VALUES (?,?,?)').bind(tenantId, name, sandbox ? 1 : 0).run();
  await step(db, tenantId, 'tenant', 'done');
  const branchIds = [];
  for (const b of bl) { const id = rid('br_'); await db.prepare('INSERT INTO branches (id, tenant_id, name) VALUES (?,?,?)').bind(id, tenantId, b).run(); branchIds.push(id); }
  await step(db, tenantId, 'branches', 'done', { count: branchIds.length });
  const roleIds = {};
  for (const r of ROLES) { const id = rid('rl_'); await db.prepare('INSERT INTO roles (id, tenant_id, name) VALUES (?,?,?)').bind(id, tenantId, r).run(); roleIds[r] = id; }
  await step(db, tenantId, 'roles', 'done', { count: ROLES.length });
  const userId = rid('us_');
  await db.prepare('INSERT INTO users (id, tenant_id, branch_id, username, display_name, password_hash) VALUES (?,?,?,?,?,?)')
    .bind(userId, tenantId, branchIds[0], String(owner.username).toLowerCase(), owner.displayName || null, await hashPassword(String(owner.password))).run();
  await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?,?)').bind(userId, roleIds.owner).run();
  await step(db, tenantId, 'owner', 'done');
  await step(db, tenantId, 'import', 'pending');
  return { ok: true, tenantId, branchIds, ownerId: userId, sandbox: !!sandbox, nextStep: 'import' };
}

// Import step: marks it done (data goes through the guarded /api/v1/import path) or skipped.
export async function completeImportStep(db, tenantId, { skipped = false, inserted = 0 } = {}) {
  const t = await db.prepare('SELECT status FROM tenants WHERE id = ?').bind(tenantId).first();
  if (!t) return bad('ONBOARDING_NOT_FOUND', 'المستأجر غير موجود.', 404);
  if (t.status !== 'active') return bad('ONBOARDING_TENANT_DISABLED', 'المستأجر معطّل.', 409);
  await step(db, tenantId, 'import', skipped ? 'skipped' : 'done', { inserted });
  return { ok: true };
}

export async function getStatus(db, tenantId) {
  const t = await db.prepare('SELECT id, name, status, sandbox, disabled_at FROM tenants WHERE id = ?').bind(tenantId).first();
  if (!t) return bad('ONBOARDING_NOT_FOUND', 'المستأجر غير موجود.', 404);
  const rows = await db.prepare('SELECT step, status FROM onboarding_steps WHERE tenant_id = ?').bind(tenantId).all();
  const m = Object.fromEntries((rows.results || rows).map((r) => [r.step, r.status]));
  return { ok: true, tenant: { id: t.id, name: t.name, status: t.status, sandbox: !!t.sandbox, disabledAt: t.disabled_at },
    steps: STEPS.map((s) => ({ step: s, status: m[s] || 'pending' })) };
}

// Rollback = soft-disable: tenant + its users deactivated, all rows kept. Reversible via enableTenant.
export async function disableTenant(db, tenantId) {
  const t = await db.prepare('SELECT status FROM tenants WHERE id = ?').bind(tenantId).first();
  if (!t) return bad('ONBOARDING_NOT_FOUND', 'المستأجر غير موجود.', 404);
  await db.prepare("UPDATE tenants SET status = 'disabled', disabled_at = datetime('now') WHERE id = ?").bind(tenantId).run();
  await db.prepare('UPDATE users SET active = 0 WHERE tenant_id = ?').bind(tenantId).run();
  return { ok: true, status: 'disabled' };
}
export async function enableTenant(db, tenantId) {
  const t = await db.prepare('SELECT status FROM tenants WHERE id = ?').bind(tenantId).first();
  if (!t) return bad('ONBOARDING_NOT_FOUND', 'المستأجر غير موجود.', 404);
  await db.prepare("UPDATE tenants SET status = 'active', disabled_at = NULL WHERE id = ?").bind(tenantId).run();
  await db.prepare('UPDATE users SET active = 1 WHERE tenant_id = ?').bind(tenantId).run();
  return { ok: true, status: 'active' };
}

// Demo sandbox: isolated tenant (own id, own branch) with seed products + batches. Fake data only.
const SEED = [
  { sku: 'DEMO-001', ar: 'باراسيتامول 500 مجم', en: 'Paracetamol 500mg', price: 2500, cost: 1500, qty: 100 },
  { sku: 'DEMO-002', ar: 'أموكسيسيلين 500 مجم', en: 'Amoxicillin 500mg', price: 6000, cost: 4000, qty: 50 },
  { sku: 'DEMO-003', ar: 'فيتامين د 1000', en: 'Vitamin D 1000', price: 9000, cost: 6000, qty: 30 },
];
export async function createSandboxTenant(db, { suffix } = {}) {
  const tenantId = SANDBOX_PREFIX + (suffix || rid('').slice(0, 8));
  const r = await createTenant(db, { tenantId, name: 'صيدلية تجريبية', branches: ['الفرع التجريبي'], sandbox: true,
    owner: { username: 'demo-owner', password: rid('Pw') } });
  if (!r.ok) return r;
  const branch = r.branchIds[0];
  for (const p of SEED) {
    const pid = rid('pr_');
    await db.prepare('INSERT INTO products (id, tenant_id, branch_id, sku, name_ar, name_en, price_minor, cost_minor) VALUES (?,?,?,?,?,?,?,?)').bind(pid, tenantId, branch, p.sku, p.ar, p.en, p.price, p.cost).run();
    await db.prepare('INSERT INTO inventory_batches (id, tenant_id, branch_id, product_id, batch_no, expiry_date, qty_on_hand, cost_minor) VALUES (?,?,?,?,?,?,?,?)').bind(rid('bt_'), tenantId, branch, pid, 'DEMO-B1', '2030-01-01', p.qty, p.cost).run();
  }
  await step(db, tenantId, 'import', 'done', { seeded: SEED.length });
  return { ok: true, tenantId, branchId: branch, seeded: SEED.length, sandbox: true };
}

export function registerOnboardingRoutes(route, { json, errorResponse }) {
  async function guard(ctx) {
    const { env, requestId } = ctx;
    if (!onboardingEnabled(env)) return { res: errorResponse('ONBOARDING_DISABLED', 'الميزة غير مفعّلة.', 404, requestId) };
    const a = await authenticate(ctx.request, env);
    if (a.fail) return { res: errorResponse(a.fail.code, a.fail.message_ar, a.fail.status, requestId) };
    if (normalizeRole(a.session.role) !== 'owner') return { res: errorResponse('PERMISSION_DENIED', 'ليست لديك صلاحية لهذه العملية.', 403, requestId) };
    let body = {}; if (ctx.request.method === 'POST') { try { body = await ctx.request.json(); } catch { body = null; } }
    if (!body || typeof body !== 'object') return { res: errorResponse('ONBOARDING_BAD_REQUEST', 'صيغة الطلب غير صالحة.', 400, requestId) };
    return { body };
  }
  const out = (ctx, r, okStatus = 200) => r.ok
    ? json({ ...r, requestId: ctx.requestId }, okStatus, { 'X-Request-Id': ctx.requestId })
    : errorResponse(r.code, r.message_ar, r.status, ctx.requestId);
  const wrap = (fn, okStatus) => async (ctx) => {
    const g = await guard(ctx); if (g.res) return g.res;
    try { return out(ctx, await fn(ctx, g.body), okStatus); }
    catch { return errorResponse('ONBOARDING_FAILED', 'تعذّر تنفيذ العملية.', 500, ctx.requestId); }
  };
  const tid = (ctx, b) => String(b.tenantId || new URL(ctx.request.url).searchParams.get('tenantId') || '');

  route('POST', '/api/v1/onboarding/tenants', wrap((ctx, b) => createTenant(ctx.env.DB, b), 201));
  route('POST', '/api/v1/onboarding/sandbox', wrap((ctx) => createSandboxTenant(ctx.env.DB), 201));
  route('POST', '/api/v1/onboarding/import-step', wrap((ctx, b) => completeImportStep(ctx.env.DB, tid(ctx, b), b)));
  route('POST', '/api/v1/onboarding/disable', wrap((ctx, b) => disableTenant(ctx.env.DB, tid(ctx, b))));
  route('POST', '/api/v1/onboarding/enable', wrap((ctx, b) => enableTenant(ctx.env.DB, tid(ctx, b))));
  route('GET', '/api/v1/onboarding/status', wrap((ctx, b) => getStatus(ctx.env.DB, tid(ctx, b))));
}
