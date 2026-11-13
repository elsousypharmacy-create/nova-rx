// N117 MSG-04: prescription -> order. Flag NOVA_RX_ORDER=1 (default OFF) + NOVA_AUTH session + DB binding. No network, no R2.
// Attachment: AES-GCM encrypted, size-capped blob in D1; key by NAME only: env.NOVA_RX_BLOB_KEY (base64, 32 bytes).
// Extraction: adapter interface {extract({bytes,mime}) -> {items:[{name,qty}]}}. Real adapter (Gemini, paid) is NOT built-in:
// flag NOVA_RX_EXTRACT_GEMINI stays OFF (NEEDS-OWNER). Kimi is retired. Tests/injection use mockExtractor.
// Flow: uploaded -> extracted -> reviewed (pharmacist, mandatory) -> customer_approved -> reserved.
import { authenticate } from './auth/auth.js';
import { normalizeRole } from './auth/permissions.js';

export const MAX_BLOB_BYTES = 1024 * 1024; // 1 MiB cap
export const ALLOWED_MIME = Object.freeze(['image/jpeg', 'image/png', 'application/pdf']);
export const rxOrderEnabled = (env) => !!env && String(env.NOVA_RX_ORDER) === '1' && !!env.DB;

export const RX_ERRORS = Object.freeze({
  RX_DISABLED: ['وصفة الطلب غير مفعّلة.', 404],
  RX_BAD_REQUEST: ['صيغة الطلب غير صالحة.', 400],
  RX_TOO_LARGE: ['حجم المرفق أكبر من الحد المسموح (1 ميغابايت).', 413],
  RX_BAD_MIME: ['نوع الملف غير مدعوم.', 415],
  RX_NO_KEY: ['مفتاح تشفير المرفقات غير مُعدّ.', 503],
  RX_NOT_FOUND: ['الوصفة غير موجودة.', 404],
  RX_BAD_STATE: ['حالة الوصفة لا تسمح بهذه العملية.', 409],
  RX_EXTRACT_UNAVAILABLE: ['الاستخراج الآلي غير متاح. يمكن للصيدلي إدخال الأصناف يدوياً.', 503],
  RX_NOT_PHARMACIST: ['مراجعة الصيدلي مطلوبة ولا تتم إلا بصلاحية صيدلي.', 403],
  RX_ALT_NOT_APPROVED: ['البديل غير معتمد لهذا الصنف.', 422],
  RX_BAD_ITEM: ['صنف غير صالح في المراجعة.', 422],
  RX_CUSTOMER_APPROVAL_REQUIRED: ['موافقة العميل مطلوبة قبل الحجز.', 409],
  RX_FAILED: ['تعذّر تنفيذ العملية.', 503],
});
export class RxError extends Error {
  constructor(code, requestId) { super(code); this.code = code; this.message_ar = RX_ERRORS[code][0]; this.status = RX_ERRORS[code][1]; this.requestId = requestId || null; }
}

const b64 = (u8) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function importKey(env, requestId) {
  let raw; try { raw = unb64(String(env.NOVA_RX_BLOB_KEY || '')); } catch { raw = null; }
  if (!raw || raw.length !== 32) throw new RxError('RX_NO_KEY', requestId);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptBlob(env, bytes, requestId) {
  const key = await importKey(env, requestId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return { iv: b64(iv), enc: b64(ct) };
}
export async function decryptBlob(env, iv, enc, requestId) {
  const key = await importKey(env, requestId);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(enc)));
}

// Extraction adapters
export function mockExtractor(items = []) {
  return { async extract() { return { items: items.map((i) => ({ ...i })) }; } };
}
export function unavailableExtractor() {
  return { async extract() { throw new Error('unavailable'); } };
}
export function getExtractor(env) {
  if (env.NOVA_RX_EXTRACTOR) return env.NOVA_RX_EXTRACTOR; // injected (tests)
  return unavailableExtractor(); // Gemini adapter intentionally not wired: paid, NEEDS-OWNER.
}

const norm = (s) => String(s || '').toLowerCase().replace(/[ً-ٰـ]/g, '').replace(/\s+/g, ' ').trim();

// Suggest catalog candidates (never auto-confirmed; pharmacist must pick).
export async function matchItems(db, tenant, names) {
  const { results } = await db.prepare('SELECT id, sku, name_ar, name_en FROM products WHERE tenant_id = ? AND active = 1').bind(tenant).all();
  const out = [];
  for (const name of names) {
    const n = norm(name);
    const cands = [];
    for (const p of results || []) {
      const fields = [p.sku, p.name_ar, p.name_en].map(norm).filter(Boolean);
      if (fields.includes(n)) cands.push({ product_id: p.id, name_ar: p.name_ar, score: 1 });
      else if (n && fields.some((f) => f.includes(n) || n.includes(f))) cands.push({ product_id: p.id, name_ar: p.name_ar, score: 0.5 });
    }
    cands.sort((a, b) => b.score - a.score);
    out.push({ name, candidates: cands.slice(0, 5) });
  }
  return out;
}

async function getOrder(db, tenant, id, requestId) {
  const o = await db.prepare('SELECT * FROM rx_orders WHERE id = ? AND tenant_id = ?').bind(String(id || ''), tenant).first();
  if (!o) throw new RxError('RX_NOT_FOUND', requestId);
  return o;
}

export async function uploadRx({ env, tenant, user, body, requestId }) {
  if (!body || typeof body.file_base64 !== 'string') throw new RxError('RX_BAD_REQUEST', requestId);
  if (!ALLOWED_MIME.includes(body.mime)) throw new RxError('RX_BAD_MIME', requestId);
  const max = Number(env.NOVA_RX_MAX_BYTES) > 0 ? Math.min(Number(env.NOVA_RX_MAX_BYTES), MAX_BLOB_BYTES) : MAX_BLOB_BYTES;
  if (body.file_base64.length > Math.ceil(max / 3) * 4 + 4) throw new RxError('RX_TOO_LARGE', requestId);
  let bytes; try { bytes = unb64(body.file_base64); } catch { throw new RxError('RX_BAD_REQUEST', requestId); }
  if (!bytes.length) throw new RxError('RX_BAD_REQUEST', requestId);
  if (bytes.length > max) throw new RxError('RX_TOO_LARGE', requestId);
  const { iv, enc } = await encryptBlob(env, bytes, requestId);
  const id = 'rx_' + b64(crypto.getRandomValues(new Uint8Array(9))).replace(/[^a-zA-Z0-9]/g, 'x');
  await env.DB.prepare('INSERT INTO rx_orders (id,tenant_id,customer_ref,mime,size_bytes,blob_iv,blob_enc,created_by) VALUES (?,?,?,?,?,?,?,?)')
    .bind(id, tenant, body.customer_ref ? String(body.customer_ref).slice(0, 80) : null, body.mime, bytes.length, iv, enc, user).run();
  return { id, status: 'uploaded', size_bytes: bytes.length };
}

export async function extractRx({ env, tenant, id, requestId }) {
  const o = await getOrder(env.DB, tenant, id, requestId);
  if (o.status !== 'uploaded' && o.status !== 'extracted') throw new RxError('RX_BAD_STATE', requestId);
  const bytes = await decryptBlob(env, o.blob_iv, o.blob_enc, requestId);
  let res; try { res = await getExtractor(env).extract({ bytes, mime: o.mime }); } catch { throw new RxError('RX_EXTRACT_UNAVAILABLE', requestId); }
  const items = (res && Array.isArray(res.items) ? res.items : []).filter((i) => i && typeof i.name === 'string' && i.name.trim())
    .map((i) => ({ name: i.name.trim().slice(0, 120), qty: Number.isInteger(i.qty) && i.qty > 0 ? i.qty : 1 }));
  const matches = await matchItems(env.DB, tenant, items.map((i) => i.name));
  const extraction = { items, matches, needs_pharmacist_review: true };
  await env.DB.prepare("UPDATE rx_orders SET status='extracted', extraction_json = ? WHERE id = ? AND tenant_id = ?").bind(JSON.stringify(extraction), id, tenant).run();
  return { id, status: 'extracted', extraction };
}

// Mandatory pharmacist review. items:[{extracted_name, product_id, qty, alternative_product_id?}]
export async function reviewRx({ env, tenant, id, role, user, items, requestId }) {
  if (role !== 'pharmacist') throw new RxError('RX_NOT_PHARMACIST', requestId);
  const o = await getOrder(env.DB, tenant, id, requestId);
  if (o.status !== 'extracted' && o.status !== 'reviewed') throw new RxError('RX_BAD_STATE', requestId);
  if (!Array.isArray(items) || !items.length || items.length > 100) throw new RxError('RX_BAD_ITEM', requestId);
  const rows = [];
  for (const it of items) {
    if (!it || typeof it.product_id !== 'string' || !Number.isInteger(it.qty) || it.qty <= 0) throw new RxError('RX_BAD_ITEM', requestId);
    const p = await env.DB.prepare('SELECT id FROM products WHERE id = ? AND tenant_id = ? AND active = 1').bind(it.product_id, tenant).first();
    if (!p) throw new RxError('RX_BAD_ITEM', requestId);
    let productId = it.product_id; let isAlt = 0; let orig = null;
    if (it.alternative_product_id) {
      const a = await env.DB.prepare('SELECT 1 AS ok FROM rx_approved_alternatives WHERE tenant_id = ? AND product_id = ? AND alternative_product_id = ?').bind(tenant, it.product_id, String(it.alternative_product_id)).first();
      if (!a) throw new RxError('RX_ALT_NOT_APPROVED', requestId);
      productId = String(it.alternative_product_id); isAlt = 1; orig = it.product_id;
    }
    rows.push([id, tenant, String(it.extracted_name || '').slice(0, 120), productId, it.qty, isAlt, orig]);
  }
  await env.DB.prepare('DELETE FROM rx_order_items WHERE rx_order_id = ? AND tenant_id = ?').bind(id, tenant).run();
  for (const r of rows) await env.DB.prepare('INSERT INTO rx_order_items (rx_order_id,tenant_id,extracted_name,product_id,qty,is_alternative,original_product_id) VALUES (?,?,?,?,?,?,?)').bind(...r).run();
  await env.DB.prepare("UPDATE rx_orders SET status='reviewed', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ? AND tenant_id = ?").bind(user, id, tenant).run();
  return { id, status: 'reviewed', items: rows.length };
}

export async function customerDecision({ env, tenant, id, user, approve, requestId }) {
  const o = await getOrder(env.DB, tenant, id, requestId);
  if (o.status !== 'reviewed') throw new RxError('RX_BAD_STATE', requestId);
  const status = approve ? 'customer_approved' : 'customer_rejected';
  await env.DB.prepare("UPDATE rx_orders SET status = ?, customer_decision_by = ?, customer_decision_at = datetime('now') WHERE id = ? AND tenant_id = ?").bind(status, user, id, tenant).run();
  return { id, status };
}

// Reservation is only possible after pharmacist review AND customer approval. Does not touch stock itself.
export async function reserveRx({ env, tenant, id, requestId }) {
  const o = await getOrder(env.DB, tenant, id, requestId);
  if (o.status === 'reviewed') throw new RxError('RX_CUSTOMER_APPROVAL_REQUIRED', requestId);
  if (o.status !== 'customer_approved' || !o.reviewed_by) throw new RxError('RX_BAD_STATE', requestId);
  await env.DB.prepare("UPDATE rx_orders SET status='reserved' WHERE id = ? AND tenant_id = ? AND status='customer_approved'").bind(id, tenant).run();
  const { results } = await env.DB.prepare('SELECT product_id, qty FROM rx_order_items WHERE rx_order_id = ? AND tenant_id = ?').bind(id, tenant).all();
  return { id, status: 'reserved', lines: results || [] };
}

export function registerRxOrderRoutes(route, { json, errorResponse }) {
  const handler = (fn) => async (ctx) => {
    const { env, requestId } = ctx;
    if (!rxOrderEnabled(env)) return errorResponse('RX_DISABLED', RX_ERRORS.RX_DISABLED[0], 404, requestId);
    const a = await authenticate(ctx.request, env);
    if (a.fail) return errorResponse(a.fail.code, a.fail.message_ar, a.fail.status, requestId);
    const role = normalizeRole(a.session.role);
    if (!['owner', 'manager', 'pharmacist'].includes(role)) return errorResponse('PERMISSION_DENIED', 'ليست لديك صلاحية لهذه العملية.', 403, requestId);
    let body; try { body = await ctx.request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse('RX_BAD_REQUEST', RX_ERRORS.RX_BAD_REQUEST[0], 400, requestId);
    const base = { env, tenant: String(a.session.tenant || env.NOVA_TENANT_ID || 'default'), user: String(a.session.user), role, requestId, id: body.id };
    try { return json({ ok: true, ...(await fn(base, body)), requestId }, 200, { 'X-Request-Id': requestId }); }
    catch (e) {
      if (e instanceof RxError) return errorResponse(e.code, e.message_ar, e.status, requestId);
      return errorResponse('RX_FAILED', RX_ERRORS.RX_FAILED[0], 503, requestId);
    }
  };
  route('POST', '/api/v1/rx-orders', handler((c, b) => uploadRx({ ...c, body: b })));
  route('POST', '/api/v1/rx-orders/extract', handler((c) => extractRx(c)));
  route('POST', '/api/v1/rx-orders/review', handler((c, b) => reviewRx({ ...c, items: b.items })));
  route('POST', '/api/v1/rx-orders/customer-decision', handler((c, b) => customerDecision({ ...c, approve: b.approve === true })));
  route('POST', '/api/v1/rx-orders/reserve', handler((c) => reserveRx(c)));
}
