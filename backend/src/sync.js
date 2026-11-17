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
// S2-02: lines may carry unit (box|strip|tablet) + perBox (base units per box). The sale/stock use items exactly as before
// (qty = integer base units); feedItems = items + unit/perBox so the other devices show the line in the right unit.
const VALID_UNITS = new Set(['box', 'strip', 'tablet']);
export function invoiceToSaleInput(p) {
  const lines = Array.isArray(p && p.lines) ? p.lines : null;
  if (!lines || !lines.length) return null;
  const items = [], feedItems = [];
  for (const l of lines) {
    const productId = l && (l.productId || l.code);
    const qty = l && Number(l.qty), price = l && Number(l.price);
    if (!productId || !Number.isSafeInteger(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) return null;
    const item = { productId: String(productId), qty, unitPriceMinor: NOT_MINOR(price) };
    items.push(item);
    const fi = { ...item };
    if (l && VALID_UNITS.has(l.unit)) fi.unit = l.unit;
    const pb = l && Number(l.perBox);
    if (Number.isSafeInteger(pb) && pb > 0) fi.perBox = pb;
    feedItems.push(fi);
  }
  const gross = items.reduce((a, it) => a + it.qty * it.unitPriceMinor, 0);
  const disc = p.discount == null ? 0 : NOT_MINOR(p.discount);
  if (!Number.isSafeInteger(disc) || disc < 0 || disc > gross) return null;
  const total = gross - disc;
  let payments = [];
  if (Array.isArray(p.payments) && p.payments.length) payments = p.payments.map((x) => ({ method: x && x.method, amountMinor: NOT_MINOR(x && x.amount) }));
  else if (total > 0) payments = [{ method: 'cash', amountMinor: total }];
  return { items, feedItems, payments, discountMinor: disc };
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
      .bind(tenant, ctx.scope.branchId, 'sale', saleId, JSON.stringify({ saleId, opKey: op.key, invoiceId: id, items: input.feedItems, discountMinor: input.discountMinor, payments: input.payments })),
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

// S2-03: a goods receipt op { kind:'ledger', entity:'stock_receipt', payload:{ id, op:'receipt', poId, ref, lines:[{code, qty (base units), price, lot, expiry, unit, perBox}] } }
// creates the product row if missing, adds to the lot batch, appends the receipt movement, and writes sync rows: ONE batch.
async function applyReceipt(db, tenant, op, id, data, ctx) {
  const payload = op.payload || {};
  const lines = payload.lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    return rej('SYNC_RECEIPT_INVALID', 'بيانات الاستلام غير صالحة.');
  }

  const normLines = [];
  for (const ln of lines) {
    if (!ln || typeof ln !== 'object') {
      return rej('SYNC_RECEIPT_INVALID', 'بيانات الاستلام غير صالحة.');
    }
    const code = typeof ln.code === 'string' ? ln.code.trim() : '';
    const qty = ln.qty;
    const price = ln.price;
    const lot = typeof ln.lot === 'string' ? ln.lot.trim() : '';
    const expiry = ln.expiry == null ? '' : String(ln.expiry).trim();

    if (
      !code ||
      !Number.isSafeInteger(qty) || qty <= 0 ||
      typeof price !== 'number' || !Number.isFinite(price) || price < 0 ||
      !lot || lot.length > 64 ||
      (expiry !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(expiry))
    ) {
      return rej('SYNC_RECEIPT_INVALID', 'بيانات الاستلام غير صالحة.');
    }

    const unitCostMinor = Math.round(price * 100);
    const unit = typeof ln.unit === 'string' && ln.unit ? ln.unit : 'box';
    const perBox = Number.isFinite(Number(ln.perBox)) && Number(ln.perBox) > 0 ? Number(ln.perBox) : 1;

    normLines.push({
      code,
      qty,
      unitCostMinor,
      lot,
      expiry: expiry || null,
      expiryStr: expiry,
      unit,
      perBox
    });
  }

  const { tenantId, branchId } = ctx.scope;
  const createdBy = (typeof ctx.actor === 'string' ? ctx.actor : (ctx.actor && (ctx.actor.id || ctx.actor.username || ctx.actor.sub))) || null;
  const stmts = [];
  const feedItems = [];

  for (const ln of normLines) {
    const btId = 'bt_' + crypto.randomUUID();
    const mvId = 'mv_' + crypto.randomUUID();

    stmts.push(
      db.prepare(
        'INSERT OR IGNORE INTO products (id, tenant_id, branch_id, sku, name_ar) VALUES (?, ?, ?, ?, ?)'
      ).bind(ln.code, tenantId, branchId, ln.code, ln.code)
    );

    stmts.push(
      db.prepare(
        'INSERT INTO inventory_batches (id, tenant_id, branch_id, product_id, batch_no, expiry_date, qty_on_hand, cost_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tenant_id, branch_id, product_id, batch_no) DO UPDATE SET qty_on_hand = qty_on_hand + excluded.qty_on_hand'
      ).bind(btId, tenantId, branchId, ln.code, ln.lot, ln.expiry, ln.qty, ln.unitCostMinor)
    );

    stmts.push(
      db.prepare(
        "INSERT INTO inventory_movements (id, tenant_id, branch_id, product_id, batch_id, kind, qty_delta, unit_cost_minor, ref_type, ref_id, created_by) SELECT ?, ?, ?, ?, b.id, 'receipt', ?, ?, 'stock_receipt', ?, ? FROM inventory_batches b WHERE b.tenant_id = ? AND b.branch_id = ? AND b.product_id = ? AND b.batch_no = ?"
      ).bind(mvId, tenantId, branchId, ln.code, ln.qty, ln.unitCostMinor, id, createdBy, tenantId, branchId, ln.code, ln.lot)
    );

    feedItems.push({
      productId: ln.code,
      qty: ln.qty,
      lot: ln.lot,
      expiry: ln.expiryStr,
      unitCostMinor: ln.unitCostMinor,
      unit: ln.unit,
      perBox: ln.perBox
    });
  }

  const feedPayload = JSON.stringify({
    receiptId: id,
    poId: payload.poId ? String(payload.poId) : '',
    ref: payload.ref ? String(payload.ref) : '',
    items: feedItems
  });

  const opResult = { status: 'applied', receiptId: id };
  const opResultJson = JSON.stringify(opResult);

  stmts.push(
    db.prepare(
      "INSERT INTO sync_ledger (id, tenant_id, entity, payload_json) VALUES (?, ?, 'stock_receipt', ?)"
    ).bind(id, tenant, data)
  );

  stmts.push(
    db.prepare(
      "INSERT INTO change_feed (tenant_id, branch_id, entity, entity_id, deleted, payload_json) VALUES (?, ?, 'stock_receipt', ?, 0, ?)"
    ).bind(tenantId, branchId, id, feedPayload)
  );

  stmts.push(
    db.prepare(
      'INSERT INTO sync_ops (tenant_id, op_key, result_json) VALUES (?, ?, ?)'
    ).bind(tenant, op.key, opResultJson)
  );

  try {
    await db.batch(stmts);
    return opResult;
  } catch (_) {
    try {
      const existing = await db
        .prepare('SELECT result_json FROM sync_ops WHERE tenant_id = ? AND op_key = ?')
        .bind(tenant, op.key)
        .first();
      if (existing && existing.result_json) {
        const stored = JSON.parse(existing.result_json);
        return { ...stored, duplicate: true };
      }
    } catch (_) {}
    return rej('SYNC_WRITE_FAILED', 'تعذّر حفظ الاستلام.');
  }
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
    } else if (entity === 'credit_move' && ctx && ctx.scope && op.payload && op.payload.move && typeof op.payload.move === 'object') { // S2-05
      const mv = op.payload.move;
      const validTypes = { opening: 1, charge: 1, collection: 1, reversal: 1 };
      if (
        typeof mv.id !== 'string' || !/^[A-Za-z0-9_\-:.]{1,128}$/.test(mv.id) ||
        !validTypes[mv.type] ||
        typeof mv.customerId !== 'string' || !mv.customerId.trim() ||
        typeof mv.cents !== 'number' || !Number.isInteger(mv.cents) || mv.cents <= 0
      ) {
        return rej('SYNC_CREDIT_INVALID', 'بيانات حركة الآجل غير صالحة.');
      }
      const appliedRes = { status: 'applied' };
      try {
        await db.batch([
          db.prepare('INSERT INTO sync_ledger (id,tenant_id,entity,payload_json) VALUES (?,?,?,?)').bind(id, tenant, entity, data),
          db.prepare('INSERT INTO change_feed (tenant_id,branch_id,entity,entity_id,deleted,payload_json) VALUES (?,?,?,?,0,?)').bind(
            ctx.scope.tenantId,
            ctx.scope.branchId || null,
            'credit_move',
            String(mv.id),
            JSON.stringify({ move: mv })
          ),
          db.prepare('INSERT INTO sync_ops (tenant_id,op_key,result_json) VALUES (?,?,?)').bind(
            tenant,
            op.key,
            JSON.stringify(appliedRes)
          )
        ]);
        return appliedRes;
      } catch (e) {
        const dup = await db.prepare('SELECT result_json FROM sync_ops WHERE tenant_id = ? AND op_key = ?').bind(tenant, op.key).first();
        if (dup && dup.result_json) {
          return { ...JSON.parse(dup.result_json), duplicate: true };
        }
        return rej('SYNC_WRITE_FAILED', 'تعذّر حفظ حركة الآجل.');
      }
    } else if (entity === 'stock_receipt' && ctx && ctx.scope && salesWritesEnabled(ctx.env) && Array.isArray(op.payload.lines)) { // S2-03
      res = await applyReceipt(db, tenant, op, id, data, ctx);
      if (res.transient) { const { transient, ...out } = res; return out; }
      if (res.status === 'applied') return res;
    } else if (entity === 'shift_close' && ctx && ctx.scope && op.payload && op.payload.record && typeof op.payload.record === 'object') { // S2-06
      const rec = op.payload.record;
      const validId = typeof rec.id === 'string' && /^[A-Za-z0-9_\-:.]{1,128}$/.test(rec.id);
      const validNums =
        typeof rec.at === 'number' && Number.isFinite(rec.at) &&
        typeof rec.float === 'number' && Number.isFinite(rec.float) && rec.float >= 0 &&
        typeof rec.expected === 'number' && Number.isFinite(rec.expected) &&
        typeof rec.counted === 'number' && Number.isFinite(rec.counted) && rec.counted >= 0 &&
        typeof rec.diff === 'number' && Number.isFinite(rec.diff) &&
        typeof rec.note === 'string';
      if (!validId || !validNums) {
        return rej('SYNC_SHIFT_INVALID', 'بيانات إقفال الوردية غير صالحة.');
      }
      const tenantId = ctx.scope.tenantId;
      const branchId = ctx.scope.branchId;
      const userId = String(rec.cashier || (ctx.actor || 'pos'));
      const openingMinor = Math.round(rec.float * 100);
      const countedMinor = Math.round(rec.counted * 100);
      const isoAt = new Date(rec.at).toISOString();
      const appliedResult = { status: 'applied' };
      try {
        await db.batch([
          db.prepare('INSERT INTO sync_ledger (id, tenant_id, entity, payload_json) VALUES (?, ?, ?, ?)')
            .bind(id, tenant, entity, data),
          db.prepare("INSERT INTO cashier_sessions (id, tenant_id, branch_id, user_id, opening_float_minor, closing_counted_minor, status, opened_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, 'closed', ?, ?)")
            .bind('cs:' + rec.id, tenantId, branchId, userId, openingMinor, countedMinor, isoAt, isoAt),
          db.prepare('INSERT INTO change_feed (tenant_id, branch_id, entity, entity_id, deleted, payload_json) VALUES (?, ?, ?, ?, 0, ?)')
            .bind(tenantId, branchId, 'shift_close', rec.id, JSON.stringify({ record: rec })),
          db.prepare('INSERT INTO sync_ops (tenant_id, op_key, result_json) VALUES (?, ?, ?)')
            .bind(tenant, op.key, JSON.stringify(appliedResult))
        ]);
      } catch (e) {
        const prev = await db.prepare('SELECT result_json FROM sync_ops WHERE tenant_id = ? AND op_key = ?')
          .bind(tenant, op.key)
          .first();
        if (prev && prev.result_json) {
          const stored = JSON.parse(prev.result_json);
          return { ...stored, duplicate: true };
        }
        return rej('SYNC_WRITE_FAILED', 'تعذّر حفظ إقفال الوردية.');
      }
      return appliedResult;
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
