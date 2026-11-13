// N101: POST /api/v1/sync/push. Flag NOVA_SYNC=1 (default OFF) + NOVA_AUTH session + DB binding. No network.
// Ops: {key, kind:'ledger'|'master', entity, id?, payload, baseVersion?}. An op without kind (offline-outbox entry) is a ledger 'invoice'.
import { authenticate } from './auth/auth.js';
import { audit } from './audit.js';

export const MAX_OPS = 200;
export function syncEnabled(env) { return !!env && String(env.NOVA_SYNC) === '1' && !!env.DB; }

const KEY_RE = /^[A-Za-z0-9_\-:.]{1,128}$/;
const NAME_RE = /^[a-z][a-z0-9_]{0,48}$/;
const rej = (code, message_ar) => ({ status: 'rejected', code, message_ar });

async function one(db, tenant, op) {
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
    else { await db.prepare('INSERT INTO sync_ledger (id,tenant_id,entity,payload_json) VALUES (?,?,?,?)').bind(id, tenant, entity, data).run(); res = { status: 'applied' }; }
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

export async function pushOps(db, tenant, ops) {
  const results = [];
  for (const op of ops) {
    let r;
    try { r = await one(db, tenant, op); } catch { r = { status: 'error', code: 'SYNC_OP_FAILED', message_ar: 'فشلت معالجة العملية. أعد المحاولة.' }; }
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
    const results = await pushOps(env.DB, tenant, ops);
    const c = (s) => results.filter((r) => r.status === s).length;
    await audit(env, { actor: a.session.user, action: 'sync.push', entity: 'sync', requestId, outcome: 'ALLOWED', after: { ops: ops.length, applied: c('applied'), conflict: c('conflict'), rejected: c('rejected') } });
    return json({ ok: true, results, requestId }, 200, { 'X-Request-Id': requestId });
  });
}
