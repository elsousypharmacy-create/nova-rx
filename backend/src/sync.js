// N101: POST /api/v1/sync/push. Flag NOVA_SYNC=1 (default OFF) + NOVA_AUTH session + DB binding. No network.
// Ops: {key, kind:'ledger'|'master', entity, id?, payload, baseVersion?}. An op without kind (offline-outbox entry) is a ledger 'invoice'.
import { authenticate } from './auth/auth.js';
import { audit } from './audit.js';
import { createSale, returnSale, salesWritesEnabled } from './sales/service.js';
import { syncScope } from './sync-scope.js';

// S1-02: with NOVA_SALES_WRITES=1 a ledger 'invoice' op is also applied as a real sale + stock movements, and a
// change_feed row is written so /sync/pull returns it on the other devices. Everything (sale, stock, sync_ledger,
// change_feed, sync_ops) is ONE db.batch(): all-or-nothing. A replay of the same op.key returns the stored result.
// POS line -> sale item mapping (documented in docs/backend/SYNC.md): productId = String(line.productId || line.code),
// qty = line.qty (positive integer), unitPriceMinor = round(line.price * 100) (the POS stores major units).
// invoice-level discount = round(payload.discount * 100); payments = payload.payments[{method, amount}] or one cash payment = total.
const NOT_MINOR = (n) => Math.round(Number(n) * 100);
export function invoiceToSaleInput(p) {
  const lines = Array.isArray(p && p.lines) ? p.lines : null;
  if (!lines || !lines.length) return null;
  const items = [];
  for (const l of lines) {
    const productId = l && (l.productId || l.code);
    const qty = l && Number(l.qty), price = l && Number(l.price);
    if (!productId || !Number.isSafeInteger(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) return null;
    items.push({ productId: String(productId), qty, unitPriceMinor: NOT_MINOR(price) });
  }
  const gross = items.reduce((a, it) => a + it.qty * it.unitPriceMinor, 0);
  const disc = p.discount == null ? 0 : NOT_MINOR(p.discount);
  if (!Number.isSafeInteger(disc) || disc < 0 || disc > gross) return null;
  const total = gross - disc;
  let payments = [];
  if (Array.isArray(p.payments) && p.payments.length) payments = p.payments.map((x) => ({ method: x && x.method, amountMinor: NOT_MINOR(x && x.amount) }));
  else if (total > 0) payments = [{ method: 'cash', amountMinor: total }];
  return { items, payments, discountMinor: disc };
}

async function applyInvoice(db, tenant, op, id, data, ctx) {
  const input = invoiceToSaleInput(op.payload);
  if (!input) return rej('SYNC_INVOICE_INVALID', 'بيانات الفاتورة غير صالحة (البنود أو الأسعار أو الكميات).');
  const saleId = 'sale_' + crypto.randomUUID().replace(/-/g, '');
  const totalMinor = input.items.reduce((a, it) => a + it.qty * it.unitPriceMinor, 0) - input.discountMinor;
  const res = { status: 'applied', saleId, totalMinor };
  const extra = () => [
    db.prepare('INSERT INTO sync_ledger (id,tenant_id,entity,payload_json) VALUES (?,?,?,?)').bind(id, tenant, 'invoice', data),
    db.prepare('INSERT INTO change_feed (tenant_id,branch_id,entity,entity_id,deleted,payload_json) VALUES (?,?,?,?,0,?)')
      .bind(tenant, ctx.scope.branchId, 'sale', saleId, JSON.stringify({ saleId, opKey: op.key, invoiceId: id, items: input.items, discountMinor: input.discountMinor, payments: input.payments })),
    db.prepare('INSERT INTO sync_ops (tenant_id,op_key,result_json) VALUES (?,?,?)').bind(tenant, op.key, JSON.stringify(res)), // strict: a concurrent twin batch fails on the PK and rolls back whole
  ];
  const r = await createSale(ctx.env, ctx.scope, input, ctx.requestId, ctx.actor, { saleId, extra });
  if (r.ok) return res;
  if (r.code === 'WRITE_FAILED') { // lost a race with the same op/invoice (PK of sync_ops / sync_ledger): the twin won, answer with its stored result
    const prior = await db.prepare('SELECT result_json FROM sync_ops WHERE tenant_id=? AND op_key=?').bind(tenant, op.key).first();
    if (prior) return { ...JSON.parse(prior.result_json), duplicate: true };
  }
  if (r.code === 'INSUFFICIENT_STOCK') return { status: 'conflict', code: 'SYNC_STOCK_CONFLICT', message_ar: r.message_ar, transient: true };
  return rej('SYNC_SALE_REJECTED', r.message_ar);
}

// S2-01: a POS return/cancel op { kind:'ledger', entity:'sale_return', payload:{ id, op:'return', clientReturnId, saleInvoiceId, lines:[{code,qty,price}] } }
// is applied through returnSale; sync_ledger + change_feed ('sale_return') + sync_ops go in the SAME batch. Sale not synced yet => transient conflict.
async function applyReturn(db, tenant, op, id, data, ctx) {
  const p = op.payload || {};
  const saleInvoiceId = typeof p.saleInvoiceId === 'string' ? p.saleInvoiceId.trim() : '';
  const clientReturnId = typeof p.clientReturnId === 'string' ? p.clientReturnId.trim() : '';
  const lines = Array.isArray(p.lines) ? p.lines : [];
  if (!saleInvoiceId || !clientReturnId || !lines.length) {
    return rej('SYNC_RETURN_INVALID', 'بيانات المرتجع غير صالحة.');
  }

  const invOp = await db.prepare('SELECT result_json FROM sync_ops WHERE tenant_id = ? AND op_key = ?')
    .bind(tenant, saleInvoiceId).first();
  if (!invOp) {
    return {
      status: 'conflict',
      code: 'SYNC_SALE_NOT_SYNCED',
      message_ar: 'الفاتورة الأصلية لم تُزامن بعد.',
      transient: true,
    };
  }

  let invRes = null;
  try { invRes = JSON.parse(invOp.result_json); } catch {}
  if (!invRes || invRes.status !== 'applied' || typeof invRes.saleId !== 'string' || !invRes.saleId) {
    return rej('SYNC_RETURN_INVALID', 'الفاتورة الأصلية غير صالحة للمرتجع.');
  }
  const saleId = invRes.saleId;

  const byItem = new Map();
  for (const ln of lines) {
    const code = ln && typeof ln.code === 'string' ? ln.code.trim() : '';
    const qty = Number(ln && ln.qty);
    if (!code || !Number.isInteger(qty) || qty <= 0) {
      return rej('SYNC_RETURN_INVALID', 'سطر المرتجع غير صالح.');
    }
    const si = await db.prepare('SELECT id FROM sale_items WHERE sale_id = ? AND product_id = ? AND tenant_id = ? AND branch_id = ?')
      .bind(saleId, code, ctx.scope.tenantId, ctx.scope.branchId).first();
    if (!si) {
      return rej('SYNC_RETURN_INVALID', 'الصنف غير موجود في الفاتورة الأصلية.');
    }
    const prev = byItem.get(si.id);
    if (prev) {
      prev.qty += qty;
    } else {
      byItem.set(si.id, { saleItemId: si.id, productId: code, qty });
    }
  }

  const items = [];
  const feedItems = [];
  for (const v of byItem.values()) {
    items.push({ saleItemId: v.saleItemId, qty: v.qty });
    feedItems.push({ productId: v.productId, qty: v.qty });
  }

  const r = await returnSale(
    ctx.env,
    ctx.scope,
    { saleId, items, reason: 'pos-sync' },
    ctx.requestId,
    ctx.actor || null,
    {
      extra: (returnId, refundMinor) => {
        const applied = { status: 'applied', returnId, refundMinor };
        const feedPayload = JSON.stringify({
          returnId,
          clientReturnId,
          saleInvoiceId,
          items: feedItems,
        });
        return [
          db.prepare('INSERT INTO sync_ledger (id, tenant_id, entity, payload_json) VALUES (?, ?, ?, ?)')
            .bind(id, tenant, 'sale_return', data),
          db.prepare('INSERT INTO change_feed (tenant_id, branch_id, entity, entity_id, deleted, payload_json) VALUES (?, ?, ?, ?, 0, ?)')
            .bind(ctx.scope.tenantId, ctx.scope.branchId, 'sale_return', returnId, feedPayload),
          db.prepare('INSERT INTO sync_ops (tenant_id, op_key, result_json) VALUES (?, ?, ?)')
            .bind(tenant, op.key, JSON.stringify(applied)),
        ];
      },
    }
  );

  if (r && r.ok) {
    return { status: 'applied', returnId: r.returnId, refundMinor: r.refundMinor };
  }
  const code = r?.code;
  const msg = r?.message_ar || 'تعذر تنفيذ المرتجع.';
  if (code === 'RETURN_EXCEEDS_SOLD') {
    return rej('SYNC_RETURN_REJECTED', msg);
  }
  if (code === 'WRITE_FAILED') {
    const stored = await db.prepare('SELECT result_json FROM sync_ops WHERE tenant_id = ? AND op_key = ?')
      .bind(tenant, op.key).first();
    if (stored) {
      return { ...JSON.parse(stored.result_json), duplicate: true };
    }
  }
  return rej('SYNC_RETURN_INVALID', msg);
}

export const MAX_OPS = 200;
export function syncEnabled(env) { return !!env && String(env.NOVA_SYNC) === '1' && !!env.DB; }

const KEY_RE = /^[A-Za-z0-9_\-:.]{1,128}$/;
const NAME_RE = /^[a-z][a-z0-9_]{0,48}$/;
const rej = (code, message_ar) => ({ status: 'rejected', code, message_ar });

async function one(db, tenant, op, ctx) {
  if (!op || typeof op !== 'object' || typeof op.key !== 'string' || !KEY_RE.test(op.key)) return rej('SYNC_OP_INVALID', 'عملية غير صالحة: المفتاح مفقود أو خاطئ.');
  const kind = op.kind || 'ledger';
  const entity = op.entity || (op.kind ? '' : 'invoice');
  if ((kind !== 'ledger' && kind !== 'master') || !NAME_RE.test(entity)) return rej('SYNC_OP_INVALID', 'نوع العملية أو الكيان غير صالح.');
  if (!op.payload || typeof op.payload !== 'object' || Array.isArray(op.payload)) return rej('SYNC_OP_INVALID', 'محتوى العملية غير صالح.');
  const id = String(op.id || op.key);
  if (!KEY_RE.test(id)) return rej('SYNC_OP_INVALID', 'معرّف السجل غير صالح.');
  const data = JSON.stringify(op.payload);

  const prior = await db.prepare('SELECT result_json FROM sync_ops WHERE tenant_id=? AND op_key=?').bind(tenant, op.key).first();
  if (prior) return { ...JSON.parse(prior.result_json), duplicate: true };

  let res;
  if (kind === 'ledger') {
    const ex = await db.prepare('SELECT payload_json FROM sync_ledger WHERE tenant_id=? AND entity=? AND id=?').bind(tenant, entity, id).first();
    if (ex) res = ex.payload_json === data ? { status: 'applied', duplicate: true } : rej('SYNC_LEDGER_EXISTS', 'السجل موجود ولا يمكن تعديله (دفتر إضافة فقط).');
    else if (entity === 'sale_return' && ctx && ctx.scope && salesWritesEnabled(ctx.env) && Array.isArray(op.payload.lines)) { // S2-01
      res = await applyReturn(db, tenant, op, id, data, ctx);
      if (res.transient) { const { transient, ...out } = res; return out; } // the sale may sync later: never cache this conflict
      if (res.status === 'applied') return res;
    } else if (entity === 'invoice' && ctx && ctx.scope && salesWritesEnabled(ctx.env) && Array.isArray(op.payload.lines)) { // no `lines` = a plain ledger record, as before
      res = await applyInvoice(db, tenant, op, id, data, ctx);
      if (res.transient) { const { transient, ...out } = res; return out; } // stock may arrive later: never cache this conflict
      if (res.status === 'applied') return res; // sync_ops row was written in the same batch
    } else { await db.prepare('INSERT INTO sync_ledger (id,tenant_id,entity,payload_json) VALUES (?,?,?,?)').bind(id, tenant, entity, data).run(); res = { status: 'applied' }; }
  } else {
    const cur = await db.prepare('SELECT version FROM sync_master WHERE tenant_id=? AND entity=? AND id=?').bind(tenant, entity, id).first();
    const base = op.baseVersion == null ? null : Number(op.baseVersion);
    if (base !== null && (!Number.isInteger(base) || base < 0)) return rej('SYNC_OP_INVALID', 'رقم الإصدار غير صالح.');
    if (!cur) {
      if (base !== null && base !== 0) res = { status: 'conflict', code: 'SYNC_VERSION_CONFLICT', message_ar: 'السجل غير موجود في الخادم.', serverVersion: 0 };
      else { await db.prepare('INSERT INTO sync_master (id,tenant_id,entity,version,data_json) VALUES (?,?,?,1,?)').bind(id, tenant, entity, data).run(); res = { status: 'applied', version: 1 }; }
    } else if (base === null || base === cur.version) {
      // base omitted = explicit last-writer-wins; matching base = normal update. Compare-and-set on version.
      const r = await db.prepare("UPDATE sync_master SET version=version+1, data_json=?, updated_at=datetime('now') WHERE tenant_id=? AND entity=? AND id=? AND version=?").bind(data, tenant, entity, id, cur.version).run();
      const changed = r && r.meta && typeof r.meta.changes === 'number' ? r.meta.changes : 1;
      res = changed ? { status: 'applied', version: cur.version + 1 } : { status: 'conflict', code: 'SYNC_VERSION_CONFLICT', message_ar: 'تعارض في الإصدار.', serverVersion: cur.version + 1 };
    } else res = { status: 'conflict', code: 'SYNC_VERSION_CONFLICT', message_ar: 'السجل تغيّر على الخادم. راجع التعارض.', serverVersion: cur.version };
  }
  await db.prepare('INSERT OR IGNORE INTO sync_ops (tenant_id,op_key,result_json) VALUES (?,?,?)').bind(tenant, op.key, JSON.stringify(res)).run();
  return res;
}

export async function pushOps(db, tenant, ops, ctx = null) {
  const results = [];
  for (const op of ops) {
    let r;
    try { r = await one(db, tenant, op, ctx); } catch { r = { status: 'error', code: 'SYNC_OP_FAILED', message_ar: 'فشلت معالجة العملية. أعد المحاولة.' }; }
    results.push({ key: op && typeof op.key === 'string' ? op.key : null, ...r });
  }
  return results;
}

export function registerSyncRoutes(route, { json, errorResponse }) {
  route('POST', '/api/v1/sync/push', async (ctx) => {
    const { env, requestId } = ctx;
    if (!syncEnabled(env)) return errorResponse('SYNC_DISABLED', 'خدمة المزامنة غير مفعّلة.', 404, requestId);
    const a = await authenticate(ctx.request, env);
    if (a.fail) return errorResponse(a.fail.code, a.fail.message_ar, a.fail.status, requestId);
    let body;
    try { body = await ctx.request.json(); } catch { body = null; }
    const ops = body && (Array.isArray(body.ops) ? body.ops : Array.isArray(body.changes) ? body.changes : null);
    if (!ops) return errorResponse('SYNC_BAD_REQUEST', 'صيغة الطلب غير صالحة: ops مطلوبة.', 400, requestId);
    if (ops.length > MAX_OPS) return errorResponse('SYNC_TOO_MANY_OPS', 'عدد العمليات يتجاوز الحد المسموح.', 413, requestId);
    const tenant = String(a.session.tenant || env.NOVA_TENANT_ID || 'default');
    // S1-02: the sale needs a tenant+branch scope (from the session only). No scope => ledger-only, as before.
    let applyCtx = null;
    if (salesWritesEnabled(env)) {
      const sc = await syncScope(env, a.session, ctx.request, requestId);
      if (sc.ok) applyCtx = { env, requestId, actor: a.session.user, scope: { tenantId: sc.tenantId, branchId: sc.branchId } };
    }
    const results = await pushOps(env.DB, applyCtx ? applyCtx.scope.tenantId : tenant, ops, applyCtx); // one tenant for the sale AND the sync rows
    const c = (s) => results.filter((r) => r.status === s).length;
    await audit(env, { actor: a.session.user, action: 'sync.push', entity: 'sync', requestId, outcome: 'ALLOWED', after: { ops: ops.length, applied: c('applied'), conflict: c('conflict'), rejected: c('rejected') } });
    return json({ ok: true, results, requestId }, 200, { 'X-Request-Id': requestId });
  });
}
