// N112 INT-03: opening-balance migration DRY RUN + cutoff approval record. Never writes balances, never overwrites.
// Flag NOVA_BALANCE_MIGRATION=1 (default OFF) + NOVA_AUTH owner session + DB binding. No network.
// Input: {cutoff:'YYYY-MM-DD', products:[{sku,name,unit,qty,cost_minor}], suppliers:[{name,balance_minor}], customers:[{name,credit_minor}]}
import { authenticate, requireReauth } from './auth/auth.js';
import { normalizeRole } from './auth/permissions.js';

export const MAX_ROWS = 5000;
export const CONFIRM_TEXT = 'APPROVE';
export function balanceMigrationEnabled(env) { return !!env && String(env.NOVA_BALANCE_MIGRATION) === '1' && !!env.DB; }

const isInt = (n) => Number.isInteger(n);
const str = (s) => (typeof s === 'string' ? s.trim() : '');

// Pure: validate sample rows. Returns {rows, issues}. issues never throw.
export function validateSample(input) {
  const issues = [];
  const bad = (code, message_ar, extra) => issues.push({ code, message_ar, ...extra });
  const out = { products: [], suppliers: [], customers: [] };
  if (!input || typeof input !== 'object') { bad('BALMIG_BAD_INPUT', 'ملف الأرصدة غير صالح.'); return { rows: out, issues }; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str(input.cutoff))) bad('BALMIG_BAD_CUTOFF', 'تاريخ القطع غير صالح (YYYY-MM-DD).');
  const seen = new Set();
  for (const p of Array.isArray(input.products) ? input.products : []) {
    const sku = str(p && p.sku);
    if (!sku || !str(p.unit) || !isInt(p.qty) || p.qty < 0 || !isInt(p.cost_minor) || p.cost_minor < 0) { bad('BALMIG_BAD_PRODUCT', 'صنف غير صالح (الكود/الوحدة/الكمية/التكلفة).', { sku }); continue; }
    if (seen.has(sku)) { bad('BALMIG_DUPLICATE_SKU', 'كود صنف مكرر.', { sku }); continue; }
    seen.add(sku);
    out.products.push({ sku, name: str(p.name), unit: str(p.unit), qty: p.qty, cost_minor: p.cost_minor });
  }
  for (const [key, field, code] of [['suppliers', 'balance_minor', 'BALMIG_BAD_SUPPLIER'], ['customers', 'credit_minor', 'BALMIG_BAD_CUSTOMER']]) {
    const names = new Set();
    for (const s of Array.isArray(input[key]) ? input[key] : []) {
      const name = str(s && s.name);
      if (!name || !isInt(s[field]) || names.has(name)) { bad(code, 'سجل مورد/عميل غير صالح أو مكرر.', { name }); continue; }
      names.add(name);
      out[key].push({ name, [field]: s[field] });
    }
  }
  if (out.products.length + out.suppliers.length + out.customers.length > MAX_ROWS) bad('BALMIG_TOO_LARGE', 'حجم الملف يتجاوز الحد المسموح.');
  return { rows: out, issues };
}

// Read-only difference report against current D1 state.
export async function buildReport(db, tenant, rows) {
  const q = async (sql, ...b) => (await db.prepare(sql).bind(...b).all()).results || [];
  const prods = await q('SELECT p.sku, p.base_unit, p.cost_minor, COALESCE(SUM(b.qty_on_hand),0) AS qty FROM products p LEFT JOIN inventory_batches b ON b.product_id=p.id WHERE p.tenant_id=? GROUP BY p.id', tenant);
  const bySku = new Map(prods.map((p) => [p.sku, p]));
  const items = { matched: 0, unmatched: [], unit_mismatch: [], stock_diff: [], cost_diff: [] };
  for (const p of rows.products) {
    const ex = bySku.get(p.sku);
    if (!ex) { items.unmatched.push(p.sku); continue; }
    items.matched++;
    if (ex.base_unit !== p.unit) items.unit_mismatch.push({ sku: p.sku, current: ex.base_unit, opening: p.unit });
    if (Number(ex.qty) !== p.qty) items.stock_diff.push({ sku: p.sku, current: Number(ex.qty), opening: p.qty, delta: p.qty - Number(ex.qty) });
    if (ex.cost_minor !== p.cost_minor) items.cost_diff.push({ sku: p.sku, current: ex.cost_minor, opening: p.cost_minor });
  }
  const sup = new Set((await q('SELECT name FROM suppliers WHERE tenant_id=?', tenant)).map((s) => s.name));
  const cus = new Map((await q('SELECT name, credit_limit_minor FROM customers WHERE tenant_id=?', tenant)).map((c) => [c.name, c.credit_limit_minor]));
  const suppliers = { matched: rows.suppliers.filter((s) => sup.has(s.name)).length, unmatched: rows.suppliers.filter((s) => !sup.has(s.name)).map((s) => s.name), total_balance_minor: rows.suppliers.reduce((n, s) => n + s.balance_minor, 0) };
  const customers = { matched: 0, unmatched: [], over_credit_limit: [], total_credit_minor: rows.customers.reduce((n, c) => n + c.credit_minor, 0) };
  for (const c of rows.customers) {
    if (!cus.has(c.name)) { customers.unmatched.push(c.name); continue; }
    customers.matched++;
    if (c.credit_minor > cus.get(c.name)) customers.over_credit_limit.push({ name: c.name, limit: cus.get(c.name), opening: c.credit_minor });
  }
  const diffs = items.unmatched.length + items.unit_mismatch.length + items.stock_diff.length + items.cost_diff.length + suppliers.unmatched.length + customers.unmatched.length + customers.over_credit_limit.length;
  return { items, suppliers, customers, totals: { products: rows.products.length, suppliers: rows.suppliers.length, customers: rows.customers.length, differences: diffs } };
}

export function rollbackPlan(cutoff) {
  return [
    `1) قبل التطبيق: خذ نسخة D1 Time Travel وسجّل الـ bookmark (قطع ${cutoff}).`,
    '2) التطبيق (مستقبلاً) يضيف حركات رصيد افتتاحي فقط ولا يعدّل أو يستبدل أي سجل قائم.',
    '3) التراجع: إضافة حركات عكسية (reversal) لكل حركة افتتاحية، أو الاستعادة من الـ bookmark بموافقة المالك.',
  ].join('\n');
}

async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function registerBalanceMigrationRoutes(route, { json, errorResponse }) {
  async function guard(ctx, sensitive) {
    const { env, requestId } = ctx;
    if (!balanceMigrationEnabled(env)) return { res: errorResponse('BALMIG_DISABLED', 'ترحيل الأرصدة غير مفعّل.', 404, requestId) };
    const a = await authenticate(ctx.request, env);
    if (a.fail) return { res: errorResponse(a.fail.code, a.fail.message_ar, a.fail.status, requestId) };
    if (normalizeRole(a.session.role) !== 'owner') return { res: errorResponse('PERMISSION_DENIED', 'ليست لديك صلاحية لهذه العملية.', 403, requestId) };
    if (sensitive) { const re = requireReauth(a.session); if (re.fail) return { res: errorResponse(re.fail.code, re.fail.message_ar, re.fail.status, requestId) }; }
    let body; try { body = await ctx.request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return { res: errorResponse('BALMIG_BAD_REQUEST', 'صيغة الطلب غير صالحة.', 400, requestId) };
    const v = validateSample(body.balances || body);
    return { a, body, v, tenant: String(a.session.tenant || env.NOVA_TENANT_ID || 'default') };
  }

  route('POST', '/api/v1/balance-migration/dry-run', async (ctx) => {
    const g = await guard(ctx, false);
    if (g.res) return g.res;
    const { env, requestId } = ctx;
    try {
      const report = await buildReport(env.DB, g.tenant, g.v.rows);
      return json({ ok: true, dryRun: true, written: 0, report, reportHash: await sha256(JSON.stringify(report)), issues: g.v.issues, rollbackPlan: rollbackPlan(str(g.v.rows && (g.body.balances || g.body).cutoff)), requestId }, 200, { 'X-Request-Id': requestId });
    } catch { return errorResponse('BALMIG_FAILED', 'تعذّر إعداد تقرير الفروقات.', 503, requestId); }
  });

  route('POST', '/api/v1/balance-migration/approve', async (ctx) => {
    const g = await guard(ctx, true);
    if (g.res) return g.res;
    const { env, requestId } = ctx;
    if (g.body.confirm !== CONFIRM_TEXT) return errorResponse('BALMIG_CONFIRM_REQUIRED', 'يلزم تأكيد صريح للموافقة (confirm).', 400, requestId);
    if (g.v.issues.length) return errorResponse(g.v.issues[0].code, g.v.issues[0].message_ar, 422, requestId);
    try {
      const report = await buildReport(env.DB, g.tenant, g.v.rows);
      const reportJson = JSON.stringify(report);
      const hash = await sha256(reportJson);
      if (g.body.reportHash !== hash) return errorResponse('BALMIG_REPORT_STALE', 'تقرير الفروقات تغيّر أو لم يُراجَع. أعد التشغيل التجريبي.', 409, requestId);
      const cutoff = str((g.body.balances || g.body).cutoff);
      const id = 'bma_' + hash.slice(0, 12) + '_' + Date.now().toString(36);
      await env.DB.prepare('INSERT INTO balance_migration_approvals (id,tenant_id,cutoff_at,report_hash,report_json,rollback_plan,approved_by) VALUES (?,?,?,?,?,?,?)')
        .bind(id, g.tenant, cutoff, hash, reportJson, rollbackPlan(cutoff), String(g.a.session.user)).run();
      return json({ ok: true, approvalId: id, applied: 0, requestId }, 200, { 'X-Request-Id': requestId });
    } catch { return errorResponse('BALMIG_FAILED', 'تعذّر تسجيل الموافقة.', 503, requestId); }
  });
}

export { sha256 as reportHash };
