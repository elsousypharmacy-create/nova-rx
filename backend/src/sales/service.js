// N103 transactional sales + stock writes. Flag NOVA_SALES_WRITES=1 (default OFF) and a D1 binding `DB`.
// Every write is ONE db.batch([...]) (D1 batch = single implicit transaction: all-or-nothing).
// Stock = SUM(inventory_movements.qty_delta) (append-only ledger); DB triggers (0003/0005) enforce
// returns <= sold, no negative stock, and no delete/rewrite of completed financial records (reversal rows instead).
// Money = integer minor units. No network. Errors: { ok:false, status, code, message_ar, requestId }.
export const salesWritesEnabled = (env) => !!env && String(env.NOVA_SALES_WRITES) === '1' && !!env.DB;

const MSG = {
  SALES_DISABLED: ['خدمة المبيعات غير مفعّلة.', 404],
  BAD_REQUEST: ['بيانات الطلب غير صالحة.', 400],
  INSUFFICIENT_STOCK: ['الكمية المتوفرة في المخزون غير كافية.', 409],
  RETURN_EXCEEDS_SOLD: ['كمية المرتجع تتجاوز الكمية المباعة.', 409],
  PAYMENT_MISMATCH: ['مجموع الدفعات لا يطابق إجمالي الفاتورة.', 400],
  NOT_FOUND: ['السجل غير موجود.', 404],
  SALE_NOT_COMPLETED: ['الفاتورة ملغاة بالفعل.', 409],
  VOID_HAS_RETURNS: ['لا يمكن إلغاء فاتورة لها مرتجعات.', 409],
  ALREADY_REVERSED: ['تم عكس هذه الحركة مسبقاً.', 409],
  FINANCIAL_RECORD_IMMUTABLE: ['السجلات المالية المكتملة لا تُعدّل ولا تُحذف، يتم عكسها فقط.', 409],
  WRITE_FAILED: ['تعذّر حفظ العملية، لم يتم تغيير أي بيانات.', 500],
};
const fail = (code, requestId) => ({ ok: false, status: MSG[code][1], code, message_ar: MSG[code][0], requestId });

function mapError(e, requestId) {
  const m = String((e && e.message) || e);
  for (const c of ['INSUFFICIENT_STOCK', 'RETURN_EXCEEDS_SOLD', 'FINANCIAL_RECORD_IMMUTABLE']) if (m.includes(c)) return fail(c, requestId);
  if (/UNIQUE.*reverses_id|reverses_id/i.test(m)) return fail('ALREADY_REVERSED', requestId);
  return fail('WRITE_FAILED', requestId); // never echo SQL / data
}

const uid = (p) => p + '_' + crypto.randomUUID().replace(/-/g, '');
const posInt = (n) => Number.isSafeInteger(n) && n > 0;
const nonNegInt = (n) => Number.isSafeInteger(n) && n >= 0;
const scopeOk = (s) => s && typeof s.tenantId === 'string' && s.tenantId && typeof s.branchId === 'string' && s.branchId;

async function exec(env, stmts, requestId, ok) {
  try { await env.DB.batch(stmts); } catch (e) { return mapError(e, requestId); }
  return { ok: true, requestId, ...ok };
}
const ins = (db, table, row) => {
  const k = Object.keys(row);
  return db.prepare(`INSERT INTO ${table} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).bind(...k.map((x) => row[x]));
};
function journal(db, S, memo, refType, refId, debit, credit, amount) {
  const id = uid('je');
  return [
    ins(db, 'journal_entries', { id, ...S, memo, ref_type: refType, ref_id: refId }),
    ins(db, 'journal_lines', { id: uid('jl'), ...S, entry_id: id, account_code: debit, debit_minor: amount, credit_minor: 0 }),
    ins(db, 'journal_lines', { id: uid('jl'), ...S, entry_id: id, account_code: credit, debit_minor: 0, credit_minor: amount }),
  ];
}

// Stock on hand, derived from the ledger only.
export async function stockOnHand(env, scope, productId) {
  const r = await env.DB.prepare('SELECT COALESCE(SUM(qty_delta),0) AS qty FROM inventory_movements WHERE tenant_id=? AND branch_id=? AND product_id=?')
    .bind(scope.tenantId, scope.branchId, productId).first();
  return r ? r.qty : 0;
}

function guard(env, scope, requestId) {
  if (!salesWritesEnabled(env)) return fail('SALES_DISABLED', requestId);
  if (!scopeOk(scope)) return fail('BAD_REQUEST', requestId);
  return null;
}

// Stock movement service: receipt (+), adjustment (+/-). Sales/returns go through their own services.
export async function recordStockMovement(env, scope, input, requestId, actor = null) {
  const g = guard(env, scope, requestId); if (g) return g;
  const i = input || {};
  const delta = i.qtyDelta;
  if (!['receipt', 'adjustment'].includes(i.kind) || !Number.isSafeInteger(delta) || delta === 0 || typeof i.productId !== 'string'
    || (i.kind === 'receipt' && delta < 0) || !nonNegInt(i.unitCostMinor ?? 0)) return fail('BAD_REQUEST', requestId);
  const S = { tenant_id: scope.tenantId, branch_id: scope.branchId };
  const id = uid('mv');
  return exec(env, [ins(env.DB, 'inventory_movements', { id, ...S, product_id: i.productId, kind: i.kind, qty_delta: delta,
    unit_cost_minor: i.unitCostMinor ?? 0, ref_type: 'manual', ref_id: null, note: i.note || null, created_by: actor })], requestId, { movementId: id });
}

// input: { items:[{productId, qty, unitPriceMinor}], payments:[{method, amountMinor}], discountMinor?, customerId?, cashierSessionId? }
export async function createSale(env, scope, input, requestId, actor = null) {
  const g = guard(env, scope, requestId); if (g) return g;
  const i = input || {};
  const items = i.items, pays = i.payments || [], disc = i.discountMinor ?? 0;
  if (!Array.isArray(items) || !items.length || !Array.isArray(pays) || !nonNegInt(disc)) return fail('BAD_REQUEST', requestId);
  let gross = 0;
  for (const it of items) {
    if (!it || typeof it.productId !== 'string' || !posInt(it.qty) || !nonNegInt(it.unitPriceMinor)) return fail('BAD_REQUEST', requestId);
    gross += it.qty * it.unitPriceMinor;
  }
  for (const p of pays) if (!p || !['cash', 'card', 'credit', 'wallet'].includes(p.method) || !posInt(p.amountMinor)) return fail('BAD_REQUEST', requestId);
  if (disc > gross) return fail('BAD_REQUEST', requestId);
  const total = gross - disc;
  if (pays.reduce((a, p) => a + p.amountMinor, 0) !== total) return fail('PAYMENT_MISMATCH', requestId);
  const db = env.DB, S = { tenant_id: scope.tenantId, branch_id: scope.branchId }, saleId = uid('sale');
  const st = [ins(db, 'sales', { id: saleId, ...S, customer_id: i.customerId || null, cashier_session_id: i.cashierSessionId || null, total_minor: total, discount_minor: disc, status: 'completed' })];
  for (const it of items) {
    st.push(ins(db, 'sale_items', { id: uid('si'), ...S, sale_id: saleId, product_id: it.productId, qty: it.qty, unit_price_minor: it.unitPriceMinor }));
    st.push(ins(db, 'inventory_movements', { id: uid('mv'), ...S, product_id: it.productId, kind: 'sale', qty_delta: -it.qty, ref_type: 'sale', ref_id: saleId, created_by: actor }));
  }
  for (const p of pays) st.push(ins(db, 'payments', { id: uid('pay'), ...S, sale_id: saleId, method: p.method, amount_minor: p.amountMinor }));
  if (total > 0) st.push(...journal(db, S, 'sale', 'sale', saleId, '1000', '4000', total));
  return exec(env, st, requestId, { saleId, totalMinor: total });
}

// input: { saleId, items:[{saleItemId, qty}], reason? }. Over-return is refused by the DB trigger (whole batch rolls back).
export async function returnSale(env, scope, input, requestId, actor = null) {
  const g = guard(env, scope, requestId); if (g) return g;
  const i = input || {};
  if (typeof i.saleId !== 'string' || !Array.isArray(i.items) || !i.items.length) return fail('BAD_REQUEST', requestId);
  for (const it of i.items) if (!it || typeof it.saleItemId !== 'string' || !posInt(it.qty)) return fail('BAD_REQUEST', requestId);
  const db = env.DB, S = { tenant_id: scope.tenantId, branch_id: scope.branchId };
  const sale = await db.prepare('SELECT id,total_minor,discount_minor,status FROM sales WHERE id=? AND tenant_id=? AND branch_id=?').bind(i.saleId, S.tenant_id, S.branch_id).first();
  if (!sale) return fail('NOT_FOUND', requestId);
  if (sale.status !== 'completed') return fail('SALE_NOT_COMPLETED', requestId);
  const gross = sale.total_minor + sale.discount_minor;
  const retId = uid('ret'), st = [ins(db, 'sale_returns', { id: retId, ...S, sale_id: i.saleId, reason: i.reason || null })];
  let refund = 0;
  const seen = new Set();
  for (const it of i.items) {
    if (seen.has(it.saleItemId)) return fail('BAD_REQUEST', requestId);
    seen.add(it.saleItemId);
    const row = await db.prepare('SELECT id,product_id,unit_price_minor FROM sale_items WHERE id=? AND sale_id=? AND tenant_id=? AND branch_id=?').bind(it.saleItemId, i.saleId, S.tenant_id, S.branch_id).first();
    if (!row) return fail('NOT_FOUND', requestId);
    const r = gross > 0 ? Math.floor(it.qty * row.unit_price_minor * sale.total_minor / gross) : 0; // pro-rata of any discount
    refund += r;
    st.push(ins(db, 'sale_return_items', { id: uid('ri'), ...S, return_id: retId, sale_item_id: row.id, qty: it.qty, refund_minor: r }));
    st.push(ins(db, 'inventory_movements', { id: uid('mv'), ...S, product_id: row.product_id, kind: 'return', qty_delta: it.qty, ref_type: 'return', ref_id: retId, created_by: actor }));
  }
  if (refund > 0) st.push(...journal(db, S, 'sale return', 'return', retId, '4000', '1000', refund));
  return exec(env, st, requestId, { returnId: retId, refundMinor: refund });
}

// Void = mark sale void + reversal movements + reversing journal entry. Nothing is deleted.
export async function voidSale(env, scope, input, requestId, actor = null) {
  const g = guard(env, scope, requestId); if (g) return g;
  const i = input || {};
  if (typeof i.saleId !== 'string') return fail('BAD_REQUEST', requestId);
  const db = env.DB, S = { tenant_id: scope.tenantId, branch_id: scope.branchId };
  const sale = await db.prepare('SELECT id,total_minor,status FROM sales WHERE id=? AND tenant_id=? AND branch_id=?').bind(i.saleId, S.tenant_id, S.branch_id).first();
  if (!sale) return fail('NOT_FOUND', requestId);
  if (sale.status !== 'completed') return fail('SALE_NOT_COMPLETED', requestId);
  const ret = await db.prepare('SELECT 1 AS x FROM sale_returns WHERE sale_id=? LIMIT 1').bind(i.saleId).first();
  if (ret) return fail('VOID_HAS_RETURNS', requestId);
  const mv = await db.prepare("SELECT id,product_id,qty_delta,unit_cost_minor FROM inventory_movements WHERE ref_type='sale' AND ref_id=? AND tenant_id=? AND branch_id=?").bind(i.saleId, S.tenant_id, S.branch_id).all();
  const st = [db.prepare("UPDATE sales SET status='void' WHERE id=? AND status='completed'").bind(i.saleId)];
  for (const m of (mv.results || mv)) {
    st.push(ins(db, 'inventory_movements', { id: uid('mv'), ...S, product_id: m.product_id, kind: 'reversal', qty_delta: -m.qty_delta, unit_cost_minor: m.unit_cost_minor,
      ref_type: 'sale_void', ref_id: i.saleId, reverses_id: m.id, note: i.reason || null, created_by: actor }));
  }
  if (sale.total_minor > 0) st.push(...journal(db, S, 'sale void (reversal)', 'sale_void', i.saleId, '4000', '1000', sale.total_minor));
  return exec(env, st, requestId, { saleId: i.saleId });
}
