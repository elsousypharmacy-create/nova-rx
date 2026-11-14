// N115 MSG-02 unified inbox server. Flag NOVA_INBOX=1 (default OFF) + D1 binding DB. No real WhatsApp/Telegram sending:
// outbound is recorded as 'sent'; delivered/failed only arrive from the (mock) source through /inbox/status.
// Tenant comes ONLY from the authenticated session. Nothing here deletes.
import { scopeFromSession } from './security/tenant.js';
import { backfillSheetRows, backfillFromQueue } from './inbox-backfill.js';

export const inboxEnabled = (env) => !!env && String(env.NOVA_INBOX) === '1';
const STATUSES = ['sent', 'delivered', 'failed'];
const MODES = ['bot', 'human'];
const str = (v, max) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);
const optStr = (v, max) => (v === null || v === undefined ? null : str(v, max));

class InboxError extends Error {
  constructor(code, message_ar, status) { super(code); this.code = code; this.message_ar = message_ar; this.status = status; }
}
const bad = (m) => new InboxError('INBOX_BAD_REQUEST', m || 'بيانات المحادثة غير صالحة.', 400);
const missing = () => new InboxError('INBOX_NOT_FOUND', 'المحادثة غير موجودة.', 404);

const toConv = (r, messages) => ({
  id: r.id, customer: r.customer, customerId: r.customer_id, orderId: r.order_id, assignee: r.assignee, mode: r.mode,
  updatedAt: r.updated_at, messages: messages || [],
});
const toMsg = (r) => ({ id: r.id, dir: r.dir, text: r.text, at: r.at, status: r.status });

async function getConv(db, t, id) {
  const r = await db.prepare('SELECT * FROM inbox_conversations WHERE tenant_id = ? AND id = ?').bind(t, id).first();
  if (!r) throw missing();
  return r;
}
async function full(db, t, id) {
  const c = await getConv(db, t, id);
  const { results } = await db.prepare('SELECT * FROM inbox_messages WHERE tenant_id = ? AND conversation_id = ? ORDER BY at ASC, rowid ASC').bind(t, id).all();
  return toConv(c, (results || []).map(toMsg));
}

export async function listConversations(db, t, { assignee, mode } = {}) {
  if (mode && !MODES.includes(mode)) throw bad();
  const { results } = await db.prepare(
    'SELECT * FROM inbox_conversations WHERE tenant_id = ? AND (? IS NULL OR assignee = ?) AND (? IS NULL OR mode = ?) ORDER BY updated_at DESC, id ASC LIMIT 200',
  ).bind(t, assignee || null, assignee || null, mode || null, mode || null).all();
  const out = [];
  for (const c of results || []) out.push(await full(db, t, c.id));
  return out;
}

export async function openConversation(db, t, { id, customer, now }) {
  const cid = str(id, 80); if (!cid) throw bad();
  await db.prepare('INSERT OR IGNORE INTO inbox_conversations (tenant_id, id, customer, updated_at) VALUES (?,?,?,?)')
    .bind(t, cid, optStr(customer, 200) || '', Number(now) || 0).run();
  return full(db, t, cid);
}

async function addMessage(db, t, { id, text, now, dir, status }) {
  const cid = str(id, 80), body = str(text, 4000);
  if (!cid || !body || (dir === 'out' && !body.trim())) throw bad(dir === 'out' ? 'نص الرسالة فارغ.' : undefined);
  await getConv(db, t, cid);
  const mid = 'm_' + crypto.randomUUID(), at = Number(now) || 0;
  await db.prepare('INSERT INTO inbox_messages (tenant_id, id, conversation_id, dir, text, status, at) VALUES (?,?,?,?,?,?,?)').bind(t, mid, cid, dir, body, status, at).run();
  await db.prepare('UPDATE inbox_conversations SET updated_at = ? WHERE tenant_id = ? AND id = ?').bind(at, t, cid).run();
  return { id: mid, dir, text: body, at, status };
}
export const receiveMessage = (db, t, p) => addMessage(db, t, { ...p, dir: 'in', status: null });
export const sendMessage = (db, t, p) => addMessage(db, t, { ...p, dir: 'out', status: 'sent' });

export async function setStatus(db, t, { id, messageId, status }) {
  if (!STATUSES.includes(status)) throw bad('حالة التسليم غير صالحة.');
  const m = await db.prepare('SELECT id FROM inbox_messages WHERE tenant_id = ? AND conversation_id = ? AND id = ? AND dir = ?').bind(t, str(id, 80), str(messageId, 100), 'out').first();
  if (!m) throw new InboxError('INBOX_NOT_FOUND', 'الرسالة غير موجودة.', 404);
  await db.prepare('UPDATE inbox_messages SET status = ? WHERE tenant_id = ? AND id = ?').bind(status, t, m.id).run();
  return { id: m.id, status };
}

export async function assign(db, t, { id, staff }) {
  const cid = str(id, 80); if (!cid) throw bad();
  await getConv(db, t, cid);
  await db.prepare('UPDATE inbox_conversations SET assignee = ? WHERE tenant_id = ? AND id = ?').bind(optStr(staff, 100), t, cid).run();
  return full(db, t, cid);
}

export async function handoff(db, t, { id, staff }) {
  const cid = str(id, 80); if (!cid) throw bad();
  await getConv(db, t, cid);
  await db.prepare("UPDATE inbox_conversations SET mode = 'human', assignee = COALESCE(?, assignee) WHERE tenant_id = ? AND id = ?").bind(optStr(staff, 100), t, cid).run();
  return full(db, t, cid);
}

export async function link(db, t, p) {
  const cid = str(p.id, 80); if (!cid) throw bad();
  const c = await getConv(db, t, cid);
  const customerId = 'customerId' in p ? optStr(p.customerId, 100) : c.customer_id;
  const orderId = 'orderId' in p ? optStr(p.orderId, 100) : c.order_id;
  await db.prepare('UPDATE inbox_conversations SET customer_id = ?, order_id = ? WHERE tenant_id = ? AND id = ?').bind(customerId, orderId, t, cid).run();
  return full(db, t, cid);
}

export function registerInboxRoutes(route, { errorResponse }, { authenticate }) {
  const guard = (handler) => async (ctx) => {
    const { env, requestId, request, url } = ctx;
    if (!inboxEnabled(env) || !env.DB || !env.KV) return errorResponse('INBOX_DISABLED', 'صندوق الرسائل غير مفعّل.', 404, requestId);
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
      try { body = await request.json(); } catch { return errorResponse('INBOX_BAD_REQUEST', 'بيانات المحادثة غير صالحة.', 400, requestId); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return errorResponse('INBOX_BAD_REQUEST', 'بيانات المحادثة غير صالحة.', 400, requestId);
    }
    try {
      return { ok: true, ...(await handler({ db: env.DB, t: sc.tenantId, body, url, session: s })), requestId };
    } catch (e) {
      if (e instanceof InboxError) return errorResponse(e.code, e.message_ar, e.status, requestId);
      return errorResponse('INBOX_FAILED', 'تعذّر تنفيذ العملية. حاول مرة أخرى لاحقاً.', 503, requestId);
    }
  };
  const base = '/api/v1/inbox/';
  route('GET', base + 'conversations', guard(async ({ db, t, url }) => ({
    conversations: await listConversations(db, t, { assignee: url.searchParams.get('assignee'), mode: url.searchParams.get('mode') }),
  })));
  route('GET', base + 'conversation', guard(async ({ db, t, url }) => ({ conversation: await full(db, t, url.searchParams.get('id') || '') })));
  route('POST', base + 'open', guard(async ({ db, t, body }) => ({ conversation: await openConversation(db, t, body) })));
  route('POST', base + 'receive', guard(async ({ db, t, body }) => ({ message: await receiveMessage(db, t, body) })));
  route('POST', base + 'send', guard(async ({ db, t, body }) => ({ message: await sendMessage(db, t, body) })));
  route('POST', base + 'status', guard(async ({ db, t, body }) => ({ message: await setStatus(db, t, body) })));
  route('POST', base + 'assign', guard(async ({ db, t, body }) => ({ conversation: await assign(db, t, body) })));
  route('POST', base + 'handoff', guard(async ({ db, t, body }) => ({ conversation: await handoff(db, t, body) })));
  route('POST', base + 'backfill', guard(async ({ db, t, body }) => ({ result: body.source === 'queue' ? await backfillFromQueue(db, t) : await backfillSheetRows(db, t, Array.isArray(body.rows) ? body.rows.slice(0, 2000) : []) })));
  route('POST', base + 'link', guard(async ({ db, t, body }) => ({ conversation: await link(db, t, body) })));
}
