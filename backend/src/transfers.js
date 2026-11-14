// UX51 (UX37-12) stock transfers API over stock_transfers + inventory_movements (transfer_out / transfer_in).
// Flag NOVA_TRANSFERS=1 (default OFF => 404). Tenant + branch come ONLY from the authenticated session.
// Status machine: pending -> shipped -> received, pending -> cancelled. Every transition is a guarded UPDATE
// (WHERE status = expected) so a repeated ship/receive cannot move stock twice. The ledger is append-only.
// The source batch is chosen FEFO (earliest non-expired, non-recalled batch that covers the whole qty).
import { scopeFromSession } from './security/tenant.js';

export const transfersEnabled = (env) => !!env && String(env.NOVA_TRANSFERS) === '1';

class TransferError extends Error {
  constructor(code, message_ar, status) { super(code); this.code = code; this.message_ar = message_ar; this.status = status; }
}
const bad = (m) => new TransferError('TRANSFER_BAD_REQUEST', m || 'بيانات التحويل غير صالحة.', 400);
const notFound = () => new TransferError('TRANSFER_NOT_FOUND', 'التحويل غير موجود.', 404);
const conflict = (m) => new TransferError('TRANSFER_STATE_CONFLICT', m || 'حالة التحويل لا تسمح بهذه العملية.', 409);

const str = (v, max) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);
const changes = (r) => Number((r && ((r.meta && r.meta.changes) ?? r.changes)) || 0);
const toTransfer = (r) => ({
  id: r.id, productId: r.product_id, batchId: r.batch_id, qty: r.qty, status: r.status,
  fromBranchId: r.branch_id, toBranchId: r.to_branch_id, createdBy: r.created_by, createdAt: r.created_at,
});
const today = (now) => new Date(now()).toISOString().slice(0, 10);

async function getTransfer(db, t, id) {
  const r = await db.prepare('SELECT * FROM stock_transfers WHERE tenant_id = ? AND id = ?').bind(t, id).first();
  if (!r) throw notFound();
  return r;
}
// Visible only to the source or destination branch of the active session.
const involved = (r, branch) => r.branch_id === branch || r.to_branch_id === branch;

export async function createTransfer(db, { t, branch, branches, actor }, { id, productId, toBranchId, qty }) {
  const tid = str(id, 80), pid = str(productId, 80), to = str(toBranchId, 80);
  if (!tid || !pid || !to || !Number.isInteger(qty) || qty <= 0) throw bad();
  if (to === branch) throw new TransferError('TRANSFER_SAME_BRANCH', 'لا يمكن التحويل إلى نفس الفرع.', 400);
  if (!branches.includes(to)) throw new TransferError('TRANSFER_BRANCH_FORBIDDEN', 'الفرع المستلم غير تابع لهذه الجهة.', 403);
  const p = await db.prepare('SELECT id FROM products WHERE tenant_id = ? AND branch_id = ? AND id = ?').bind(t, branch, pid).first();
  if (!p) throw new TransferError('TRANSFER_PRODUCT_NOT_FOUND', 'الصنف غير موجود في الفرع المُرسِل.', 404);
  const exists = await db.prepare('SELECT * FROM stock_transfers WHERE tenant_id = ? AND id = ?').bind(t, tid).first();
  if (exists) {
    if (!involved(exists, branch)) throw notFound();
    return toTransfer(exists); // idempotent replay
  }
  await db.prepare('INSERT INTO stock_transfers (id, tenant_id, branch_id, to_branch_id, product_id, qty, status, created_by) VALUES (?,?,?,?,?,?,?,?)')
    .bind(tid, t, branch, to, pid, qty, 'pending', actor || null).run();
  return toTransfer(await getTransfer(db, t, tid));
}

export async function shipTransfer(db, { t, branch, actor, now }, { id }) {
  const tid = str(id, 80); if (!tid) throw bad();
  const r = await getTransfer(db, t, tid);
  if (r.branch_id !== branch) throw notFound();
  if (r.status !== 'pending') throw conflict();
  // FEFO: earliest expiry first; batches without expiry last; expired and recalled batches are never used.
  const { results } = await db.prepare(
    `SELECT b.id, b.batch_no, b.expiry_date, b.qty_on_hand, b.cost_minor FROM inventory_batches b
     WHERE b.tenant_id = ? AND b.branch_id = ? AND b.product_id = ? AND b.qty_on_hand >= ?
       AND (b.expiry_date IS NULL OR b.expiry_date >= ?)
       AND NOT EXISTS (SELECT 1 FROM recalled_batches rb WHERE rb.tenant_id = b.tenant_id AND rb.batch_id = b.id)
     ORDER BY (b.expiry_date IS NULL) ASC, b.expiry_date ASC, b.id ASC LIMIT 1`,
  ).bind(t, branch, r.product_id, r.qty, today(now)).all();
  const batch = (results || [])[0];
  if (!batch) throw new TransferError('TRANSFER_INSUFFICIENT_STOCK', 'الرصيد الصالح غير كافٍ (منتهي أو مسحوب أو أقل من الكمية).', 409);
  const claim = await db.prepare("UPDATE stock_transfers SET status = 'shipped', batch_id = ? WHERE tenant_id = ? AND id = ? AND status = 'pending'").bind(batch.id, t, tid).run();
  if (changes(claim) !== 1) throw conflict();
  const dec = await db.prepare('UPDATE inventory_batches SET qty_on_hand = qty_on_hand - ? WHERE tenant_id = ? AND branch_id = ? AND id = ? AND qty_on_hand >= ?').bind(r.qty, t, branch, batch.id, r.qty).run();
  if (changes(dec) !== 1) {
    await db.prepare("UPDATE stock_transfers SET status = 'pending', batch_id = NULL WHERE tenant_id = ? AND id = ? AND status = 'shipped'").bind(t, tid).run();
    throw new TransferError('TRANSFER_INSUFFICIENT_STOCK', 'الرصيد الصالح غير كافٍ.', 409);
  }
  try {
    await db.prepare('INSERT INTO inventory_movements (id, tenant_id, branch_id, product_id, batch_id, kind, qty_delta, unit_cost_minor, ref_type, ref_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind('mv_' + crypto.randomUUID(), t, branch, r.product_id, batch.id, 'transfer_out', -r.qty, batch.cost_minor, 'stock_transfer', tid, actor || null).run();
  } catch (e) {
    // The ledger trigger (SUM(qty_delta) >= 0) refused: compensate so batch balance and status stay consistent.
    await db.prepare('UPDATE inventory_batches SET qty_on_hand = qty_on_hand + ? WHERE tenant_id = ? AND branch_id = ? AND id = ?').bind(r.qty, t, branch, batch.id).run();
    await db.prepare("UPDATE stock_transfers SET status = 'pending', batch_id = NULL WHERE tenant_id = ? AND id = ? AND status = 'shipped'").bind(t, tid).run();
    throw new TransferError('TRANSFER_INSUFFICIENT_STOCK', 'الرصيد الصالح غير كافٍ.', 409);
  }
  return toTransfer(await getTransfer(db, t, tid));
}

export async function receiveTransfer(db, { t, branch, actor }, { id }) {
  const tid = str(id, 80); if (!tid) throw bad();
  const r = await getTransfer(db, t, tid);
  if (r.to_branch_id !== branch) throw notFound();
  if (r.status !== 'shipped') throw conflict(r.status === 'received' ? 'تم استلام هذا التحويل من قبل.' : undefined);
  const src = await db.prepare('SELECT p.sku, b.batch_no, b.expiry_date, b.cost_minor FROM products p, inventory_batches b WHERE p.id = ? AND b.id = ? AND p.tenant_id = ? AND b.tenant_id = ?').bind(r.product_id, r.batch_id, t, t).first();
  const dp = src && await db.prepare('SELECT id FROM products WHERE tenant_id = ? AND branch_id = ? AND sku = ?').bind(t, branch, src.sku).first();
  if (!dp) throw new TransferError('TRANSFER_DEST_PRODUCT_MISSING', 'الصنف غير معرّف في الفرع المستلم.', 409);
  const claim = await db.prepare("UPDATE stock_transfers SET status = 'received' WHERE tenant_id = ? AND id = ? AND to_branch_id = ? AND status = 'shipped'").bind(t, tid, branch).run();
  if (changes(claim) !== 1) throw conflict('تم استلام هذا التحويل من قبل.');
  let b = await db.prepare('SELECT id FROM inventory_batches WHERE tenant_id = ? AND branch_id = ? AND product_id = ? AND batch_no = ?').bind(t, branch, dp.id, src.batch_no).first();
  if (!b) {
    const nid = 'b_' + crypto.randomUUID();
    await db.prepare('INSERT INTO inventory_batches (id, tenant_id, branch_id, product_id, batch_no, expiry_date, qty_on_hand, cost_minor) VALUES (?,?,?,?,?,?,?,?)')
      .bind(nid, t, branch, dp.id, src.batch_no, src.expiry_date, 0, src.cost_minor).run();
    b = { id: nid };
  }
  await db.prepare('UPDATE inventory_batches SET qty_on_hand = qty_on_hand + ? WHERE tenant_id = ? AND branch_id = ? AND id = ?').bind(r.qty, t, branch, b.id).run();
  await db.prepare('INSERT INTO inventory_movements (id, tenant_id, branch_id, product_id, batch_id, kind, qty_delta, unit_cost_minor, ref_type, ref_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind('mv_' + crypto.randomUUID(), t, branch, dp.id, b.id, 'transfer_in', r.qty, src.cost_minor, 'stock_transfer', tid, actor || null).run();
  return toTransfer(await getTransfer(db, t, tid));
}

// Only a pending transfer can be cancelled (nothing has left the source yet); a shipped one must be received.
export async function cancelTransfer(db, { t, branch }, { id }) {
  const tid = str(id, 80); if (!tid) throw bad();
  const r = await getTransfer(db, t, tid);
  if (!involved(r, branch)) throw notFound();
  if (r.status !== 'pending') throw conflict();
  const c = await db.prepare("UPDATE stock_transfers SET status = 'cancelled' WHERE tenant_id = ? AND id = ? AND status = 'pending'").bind(t, tid).run();
  if (changes(c) !== 1) throw conflict();
  return toTransfer(await getTransfer(db, t, tid));
}

export async function listTransfers(db, { t, branch }, { status } = {}) {
  if (status && !['pending', 'shipped', 'received', 'cancelled'].includes(status)) throw bad();
  const { results } = await db.prepare(
    'SELECT * FROM stock_transfers WHERE tenant_id = ? AND (branch_id = ? OR to_branch_id = ?) AND (? IS NULL OR status = ?) ORDER BY created_at DESC, id ASC LIMIT 200',
  ).bind(t, branch, branch, status || null, status || null).all();
  return (results || []).map(toTransfer);
}

export function registerTransferRoutes(route, { errorResponse }, { authenticate }, now = Date.now) {
  const guard = (handler) => async (ctx) => {
    const { env, requestId, request, url } = ctx;
    if (!transfersEnabled(env) || !env.DB || !env.KV) return errorResponse('TRANSFERS_DISABLED', 'تحويلات المخزون غير مفعّلة.', 404, requestId);
    const a = await authenticate(request, env);
    if (a.fail) return errorResponse(a.fail.code, a.fail.message_ar, a.fail.status, requestId);
    const s = a.session;
    let body = {};
    if (request.method === 'POST') {
      try { body = await request.json(); } catch { return errorResponse('TRANSFER_BAD_REQUEST', 'بيانات التحويل غير صالحة.', 400, requestId); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return errorResponse('TRANSFER_BAD_REQUEST', 'بيانات التحويل غير صالحة.', 400, requestId);
    }
    // Source/active branch must not be client-named; tenantId/branchId anywhere in query/headers/body must match the session.
    const { toBranchId, ...scoped } = body;
    const sc = scopeFromSession({
      actorId: s.user, tenantId: s.tenantId, roles: s.roles || [], tenantBranchIds: s.tenantBranchIds,
      assignedBranchIds: s.assignedBranchIds, activeBranchId: s.activeBranchId,
    }, { query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(request.headers), body: scoped }, requestId);
    if (!sc.ok) return errorResponse(sc.code, sc.message_ar, sc.status, requestId);
    if (!sc.branchId) return errorResponse('BRANCH_FORBIDDEN', 'غير مسموح بالوصول إلى هذا الفرع.', 403, requestId);
    try {
      const c = { t: sc.tenantId, branch: sc.branchId, branches: s.tenantBranchIds || [], actor: s.user, now };
      return { ok: true, ...(await handler({ db: env.DB, c, body: { ...body }, url })), requestId };
    } catch (e) {
      if (e instanceof TransferError) return errorResponse(e.code, e.message_ar, e.status, requestId);
      return errorResponse('TRANSFER_FAILED', 'تعذّر تنفيذ العملية. حاول مرة أخرى لاحقاً.', 503, requestId);
    }
  };
  const base = '/api/v1/transfers/';
  route('POST', base + 'create', guard(async ({ db, c, body }) => ({ transfer: await createTransfer(db, c, body) })));
  route('POST', base + 'ship', guard(async ({ db, c, body }) => ({ transfer: await shipTransfer(db, c, body) })));
  route('POST', base + 'receive', guard(async ({ db, c, body }) => ({ transfer: await receiveTransfer(db, c, body) })));
  route('POST', base + 'cancel', guard(async ({ db, c, body }) => ({ transfer: await cancelTransfer(db, c, body) })));
  route('GET', base + 'list', guard(async ({ db, c, url }) => ({ transfers: await listTransfers(db, c, { status: url.searchParams.get('status') }) })));
}
