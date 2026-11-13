// N119 OPS-03 delivery orders. Flag NOVA_DELIVERY=1 (default OFF) + D1 binding DB.
// States: new -> assigned -> picked_up -> delivered -> collected; failed (reason) -> re-assign.
// Address change needs manager approval (request -> approve/reject). Every transition is an append-only event.
// Adapter to the existing order system is injected; the default is a mock (no network).
import { scopeFromSession } from './security/tenant.js';

export const deliveryEnabled = (env) => !!env && String(env.NOVA_DELIVERY) === '1';
export const FAILURE_REASONS = ['no_answer', 'wrong_address', 'refused', 'unavailable', 'other'];
const NEXT = { new: ['assigned'], assigned: ['picked_up', 'assigned'], picked_up: ['delivered', 'failed'], delivered: ['collected'], failed: ['assigned'], collected: [] };
const MANAGER = ['owner', 'pharmacist'];
const str = (v, max) => (typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v : null);

class DeliveryError extends Error {
  constructor(code, message_ar, status) { super(code); this.code = code; this.message_ar = message_ar; this.status = status; }
}
const bad = (m) => new DeliveryError('DELIVERY_BAD_REQUEST', m || 'بيانات التوصيل غير صالحة.', 400);
const missing = () => new DeliveryError('DELIVERY_NOT_FOUND', 'طلب التوصيل غير موجود.', 404);
const badState = () => new DeliveryError('DELIVERY_BAD_STATE', 'لا يمكن الانتقال إلى هذه الحالة من الحالة الحالية.', 409);
const forbidden = () => new DeliveryError('DELIVERY_FORBIDDEN', 'هذه العملية تحتاج موافقة المدير.', 403);

// Mock adapter for the existing order system (real one needs an owner-provided endpoint; never called here).
export const mockOrderAdapter = (orders = {}) => ({ async getOrder(ref) { return orders[ref] || null; } });

const toDto = (r) => ({
  id: r.id, orderRef: r.order_ref, customer: r.customer, address: r.address, amount: r.amount, status: r.status,
  courier: r.courier, failureReason: r.failure_reason, pendingAddress: r.pending_address, pendingReason: r.pending_reason,
  createdAt: r.created_at, updatedAt: r.updated_at,
});
async function get(db, t, id) {
  const r = await db.prepare('SELECT * FROM delivery_orders WHERE tenant_id = ? AND id = ?').bind(t, str(id, 80) || '').first();
  if (!r) throw missing();
  return r;
}
async function event(db, t, id, { action, actor, from, to, detail, now }) {
  await db.prepare('INSERT INTO delivery_events (tenant_id, id, delivery_id, action, actor, from_status, to_status, detail, at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(t, 'e_' + crypto.randomUUID(), id, action, actor || null, from || null, to || null, detail ? String(detail).slice(0, 500) : null, Number(now) || 0).run();
}
const isManager = (ctx) => (ctx.roles || []).some((r) => MANAGER.includes(String(r).toLowerCase()));

export async function createDelivery(db, t, p, ctx = {}, adapter = mockOrderAdapter()) {
  const id = str(p.id, 80); if (!id) throw bad();
  let { customer, address, amount } = p;
  if (p.orderRef) {
    const o = await adapter.getOrder(String(p.orderRef));
    if (!o) throw new DeliveryError('DELIVERY_ORDER_NOT_FOUND', 'الطلب الأصلي غير موجود.', 404);
    customer = customer ?? o.customer; address = address ?? o.address; amount = amount ?? o.amount;
  }
  if (!str(address, 500)) throw bad('عنوان التوصيل مطلوب.');
  const amt = amount === undefined ? 0 : Number(amount);
  if (!Number.isFinite(amt) || amt < 0) throw bad('المبلغ غير صالح.');
  const now = Number(p.now) || 0;
  const ex = await db.prepare('SELECT 1 AS x FROM delivery_orders WHERE tenant_id = ? AND id = ?').bind(t, id).first();
  if (ex) throw new DeliveryError('DELIVERY_EXISTS', 'طلب التوصيل موجود مسبقاً.', 409);
  await db.prepare('INSERT INTO delivery_orders (tenant_id, id, order_ref, customer, address, amount, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(t, id, p.orderRef ? String(p.orderRef).slice(0, 100) : null, String(customer || '').slice(0, 200), address, amt, now, now).run();
  await event(db, t, id, { action: 'create', actor: ctx.actor, to: 'new', now });
  return toDto(await get(db, t, id));
}

async function move(db, t, p, ctx, to, extra = {}) {
  const r = await get(db, t, p.id);
  if (!NEXT[r.status].includes(to)) throw badState();
  const now = Number(p.now) || 0;
  await db.prepare('UPDATE delivery_orders SET status = ?, courier = ?, failure_reason = ?, updated_at = ? WHERE tenant_id = ? AND id = ?')
    .bind(to, extra.courier ?? r.courier, to === 'failed' ? extra.reason : null, now, t, r.id).run();
  await event(db, t, r.id, { action: extra.action || to, actor: ctx.actor, from: r.status, to, detail: extra.detail, now });
  return toDto(await get(db, t, r.id));
}
export function assignCourier(db, t, p, ctx = {}) {
  const courier = str(p.courier, 100); if (!courier) throw bad('اسم المندوب مطلوب.');
  return move(db, t, p, ctx, 'assigned', { courier, action: 'assign', detail: courier });
}
export const pickup = (db, t, p, ctx = {}) => move(db, t, p, ctx, 'picked_up');
export const deliver = (db, t, p, ctx = {}) => move(db, t, p, ctx, 'delivered');
export const collect = (db, t, p, ctx = {}) => move(db, t, p, ctx, 'collected');
export function fail(db, t, p, ctx = {}) {
  if (!FAILURE_REASONS.includes(p.reason)) throw bad('سبب الفشل غير صالح.');
  return move(db, t, p, ctx, 'failed', { reason: p.reason, detail: p.reason });
}

export async function requestLocationChange(db, t, p, ctx = {}) {
  const r = await get(db, t, p.id);
  if (r.status === 'delivered' || r.status === 'collected') throw badState();
  const address = str(p.address, 500), reason = str(p.reason, 300);
  if (!address || !reason) throw bad('العنوان الجديد وسبب التغيير مطلوبان.');
  const now = Number(p.now) || 0;
  await db.prepare('UPDATE delivery_orders SET pending_address = ?, pending_reason = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').bind(address, reason, now, t, r.id).run();
  await event(db, t, r.id, { action: 'location_requested', actor: ctx.actor, detail: reason, now });
  return toDto(await get(db, t, r.id));
}
export async function decideLocationChange(db, t, p, ctx = {}, approve) {
  if (!isManager(ctx)) throw forbidden();
  const r = await get(db, t, p.id);
  if (!r.pending_address) throw new DeliveryError('DELIVERY_NO_PENDING', 'لا يوجد طلب تغيير عنوان معلّق.', 409);
  const now = Number(p.now) || 0;
  await db.prepare('UPDATE delivery_orders SET address = ?, pending_address = NULL, pending_reason = NULL, updated_at = ? WHERE tenant_id = ? AND id = ?')
    .bind(approve ? r.pending_address : r.address, now, t, r.id).run();
  await event(db, t, r.id, { action: approve ? 'location_approved' : 'location_rejected', actor: ctx.actor, detail: `${r.address} -> ${r.pending_address}`, now });
  return toDto(await get(db, t, r.id));
}

export async function listDeliveries(db, t, { status, courier } = {}) {
  if (status && !Object.keys(NEXT).includes(status)) throw bad();
  const { results } = await db.prepare('SELECT * FROM delivery_orders WHERE tenant_id = ? AND (? IS NULL OR status = ?) AND (? IS NULL OR courier = ?) ORDER BY updated_at DESC, id ASC LIMIT 200')
    .bind(t, status || null, status || null, courier || null, courier || null).all();
  return (results || []).map(toDto);
}
export async function history(db, t, id) {
  await get(db, t, id);
  const { results } = await db.prepare('SELECT * FROM delivery_events WHERE tenant_id = ? AND delivery_id = ? ORDER BY at ASC, rowid ASC').bind(t, id).all();
  return (results || []).map((e) => ({ id: e.id, action: e.action, actor: e.actor, from: e.from_status, to: e.to_status, detail: e.detail, at: e.at }));
}

export function registerDeliveryRoutes(route, { errorResponse }, { authenticate }, adapter = mockOrderAdapter()) {
  const guard = (handler) => async (ctx) => {
    const { env, requestId, request, url } = ctx;
    if (!deliveryEnabled(env) || !env.DB || !env.KV) return errorResponse('DELIVERY_DISABLED', 'التوصيل غير مفعّل.', 404, requestId);
    const a = await authenticate(request, env);
    if (a.fail) return errorResponse(a.fail.code, a.fail.message_ar, a.fail.status, requestId);
    const s = a.session;
    const sc = scopeFromSession({
      actorId: s.user, tenantId: s.tenantId, roles: s.roles || [], tenantBranchIds: s.tenantBranchIds,
      assignedBranchIds: s.assignedBranchIds, activeBranchId: s.activeBranchId,
    }, { query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(request.headers) }, requestId);
    if (!sc.ok) return errorResponse(sc.code, sc.message_ar, sc.status, requestId);
    let body = {};
    if (request.method === 'POST') {
      try { body = await request.json(); } catch { return errorResponse('DELIVERY_BAD_REQUEST', 'بيانات التوصيل غير صالحة.', 400, requestId); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return errorResponse('DELIVERY_BAD_REQUEST', 'بيانات التوصيل غير صالحة.', 400, requestId);
    }
    try {
      const c = { actor: s.user, roles: s.roles || (s.role ? [s.role] : []) };
      return { ok: true, ...(await handler({ db: env.DB, t: sc.tenantId, body, url, c })), requestId };
    } catch (e) {
      if (e instanceof DeliveryError) return errorResponse(e.code, e.message_ar, e.status, requestId);
      return errorResponse('DELIVERY_FAILED', 'تعذّر تنفيذ العملية. حاول مرة أخرى لاحقاً.', 503, requestId);
    }
  };
  const base = '/api/v1/delivery/';
  const post = (name, fn) => route('POST', base + name, guard(async ({ db, t, body, c }) => ({ delivery: await fn(db, t, body, c) })));
  route('GET', base + 'orders', guard(async ({ db, t, url }) => ({ deliveries: await listDeliveries(db, t, { status: url.searchParams.get('status'), courier: url.searchParams.get('courier') }) })));
  route('GET', base + 'history', guard(async ({ db, t, url }) => ({ events: await history(db, t, url.searchParams.get('id') || '') })));
  post('create', (db, t, b, c) => createDelivery(db, t, b, c, adapter));
  post('assign', assignCourier);
  post('pickup', pickup);
  post('deliver', deliver);
  post('collect', collect);
  post('fail', fail);
  post('location/request', requestLocationChange);
  post('location/approve', (db, t, b, c) => decideLocationChange(db, t, b, c, true));
  post('location/reject', (db, t, b, c) => decideLocationChange(db, t, b, c, false));
}
