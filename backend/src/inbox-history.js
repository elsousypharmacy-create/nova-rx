// FIX46: read-only WhatsApp chat history for the in-app conversations screen.
// Guarded by the pharmacy PIN (X-Nova-Pin == env.NOVA_API_PIN, >= 12 chars), independent of NOVA_AUTH,
// so the public preview never gets chat data without the PIN. SELECT only: never writes, deletes or sends.
// Failed PIN attempts are rate limited per client IP in KV (10 per 15 minutes).
import { sha256Hex } from './auth/auth.js';

const FAIL_MAX = 10;
const FAIL_WINDOW_S = 900;
const MS = (col) => `(CASE WHEN ${col} > 0 AND ${col} < 1000000000000 THEN ${col} * 1000 ELSE ${col} END)`;
const KIND = { u: 'in', b: 'bot', p: 'pharm', s: 'sys' };

export const historyTenant = (env) => String((env && env.WA_HISTORY_TENANT) || 'default');
export const atMs = (v) => { const n = Number(v) || 0; return n > 0 && n < 1e12 ? n * 1000 : n; };

// Backfilled ids are h_<u|b|p|s>_<hash>; live WhatsApp ids are wa_<wamid> (incoming) or m_<uuid>.
export function kindOf(id, dir) {
  const m = /^h_([ubps])_/.exec(String(id || ''));
  if (m) return KIND[m[1]];
  if (/^wb_/.test(String(id || ''))) return 'bot'; // FIX51: bot reply forwarded by the bridge
  if (/^ps_/.test(String(id || ''))) return 'pharm'; // WA-SEND: pharmacist reply sent from NOVA
  return dir === 'out' ? 'out' : 'in';
}
const toMsg = (r) => ({ id: r.id, dir: r.dir, kind: kindOf(r.id, r.dir), text: r.text, at: atMs(r.at), status: r.status || null });

async function safeEq(a, b) {
  const [x, y] = await Promise.all([sha256Hex(String(a)), sha256Hex(String(b))]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0 && x.length === y.length;
}

export async function checkPin(request, env) {
  const pin = env && env.NOVA_API_PIN;
  if (!env || !env.DB || !pin || String(pin).length < 12) return { status: 503, code: 'HISTORY_NOT_CONFIGURED', message_ar: 'سجل المحادثات غير مفعّل.' };
  const ip = request.headers.get('CF-Connecting-IP') || 'anon';
  const key = 'histfail:' + (await sha256Hex(ip)).slice(0, 32);
  let fails = 0;
  try { fails = Number(env.KV ? await env.KV.get(key) : 0) || 0; } catch { fails = 0; }
  if (fails >= FAIL_MAX) return { status: 429, code: 'RATE_LIMITED', message_ar: 'محاولات كثيرة. حاول بعد ربع ساعة.' };
  const given = request.headers.get('X-Nova-Pin') || '';
  if (!given) return { status: 401, code: 'PIN_REQUIRED', message_ar: 'اكتب رقم PIN الصيدلية لعرض المحادثات.' };
  if (!(await safeEq(given, pin))) {
    try { if (env.KV) await env.KV.put(key, String(fails + 1), { expirationTtl: FAIL_WINDOW_S }); } catch { /* fail open on KV errors */ }
    return { status: 401, code: 'PIN_INVALID', message_ar: 'رقم PIN غير صحيح.' };
  }
  return null;
}

export async function listHistory(db, t) {
  const { results } = await db.prepare(
    'SELECT c.id, c.customer, c.updated_at, (SELECT COUNT(*) FROM inbox_messages m WHERE m.tenant_id = c.tenant_id AND m.conversation_id = c.id) AS n ' +
    'FROM inbox_conversations c WHERE c.tenant_id = ? ORDER BY ' + MS('c.updated_at') + ' DESC, c.id ASC LIMIT 300',
  ).bind(t).all();
  const out = [];
  for (const c of results || []) {
    const last = await db.prepare('SELECT * FROM inbox_messages WHERE tenant_id = ? AND conversation_id = ? ORDER BY ' + MS('at') + ' DESC, rowid DESC LIMIT 1').bind(t, c.id).first();
    out.push({ id: c.id, customer: c.customer || c.id, updatedAt: atMs(c.updated_at), count: Number(c.n) || 0, last: last ? toMsg(last) : null });
  }
  return out;
}

export async function getHistory(db, t, id) {
  const cid = typeof id === 'string' && id.length > 0 && id.length <= 80 ? id : null;
  if (!cid) return null;
  const c = await db.prepare('SELECT id, customer, updated_at FROM inbox_conversations WHERE tenant_id = ? AND id = ?').bind(t, cid).first();
  if (!c) return null;
  const { results } = await db.prepare(
    'SELECT * FROM (SELECT rowid AS rid, ' + MS('at') + ' AS ams, * FROM inbox_messages WHERE tenant_id = ? AND conversation_id = ? ORDER BY ams DESC, rowid DESC LIMIT 1000) ORDER BY ams ASC, rid ASC',
  ).bind(t, cid).all();
  return { id: c.id, customer: c.customer || c.id, updatedAt: atMs(c.updated_at), messages: (results || []).map(toMsg) };
}

export function registerInboxHistoryRoutes(route, { errorResponse }) {
  const guard = (handler) => async (ctx) => {
    const { env, requestId, request, url } = ctx;
    const bad = await checkPin(request, env);
    if (bad) return errorResponse(bad.code, bad.message_ar, bad.status, requestId);
    try {
      return { ok: true, ...(await handler({ db: env.DB, t: historyTenant(env), url })), requestId };
    } catch {
      return errorResponse('HISTORY_FAILED', 'تعذّر تحميل المحادثات. حاول مرة أخرى.', 503, requestId);
    }
  };
  route('GET', '/api/v1/inbox/history/conversations', guard(async ({ db, t }) => ({ conversations: await listHistory(db, t) })));
  route('GET', '/api/v1/inbox/history/conversation', guard(async ({ db, t, url }) => {
    const c = await getHistory(db, t, url.searchParams.get('id') || '');
    return c ? { conversation: c } : { conversation: null };
  }));
}
