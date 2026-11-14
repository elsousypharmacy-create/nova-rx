// WA-SEND: pharmacist replies from the in-app conversations screen to the REAL customer on WhatsApp
// (owner approved 2026-11-14 «افتح الإرسال من شاشة المحادثات للعملاء الحقيقيين").
// Route: POST /api/v1/inbox/history/send, PIN-gated exactly like the history (X-Nova-Pin == NOVA_API_PIN).
// Delivery reuses the pharmacy bot's EXISTING Apps Script op novaWhatsAppBridge/reply (same WA_BACKEND_URL +
// NOVA_WA_BRIDGE_TOKEN as the auto-reply toggle). NOVA never holds the WhatsApp token; secrets by NAME only.
// Safety: flag NOVA_INBOX_SEND === '1'; text only; 1..1000 chars; target = the conversation's own chat id
// (must exist in D1; the client never sends a phone number); WhatsApp 24-hour customer-service window;
// per-IP and per-tenant rate limits; duplicate guard by client id; every attempt logged in wa_send_log.
import { sha256Hex } from './auth/auth.js';
import { checkPin, historyTenant, atMs } from './inbox-history.js';

export const MAX_TEXT = 1000;
export const WINDOW_MS = 24 * 3600 * 1000 - 2 * 60 * 1000; // 2-minute safety margin
const IP_MAX = 20, IP_WINDOW_S = 600;       // 20 sends / 10 min per client IP
const TENANT_MAX = 150, TENANT_WINDOW_S = 3600; // 150 sends / hour for the pharmacy
const CHAT_RE = /^wa_[A-Za-z0-9_.-]{1,100}$/;
const MS = (col) => `(CASE WHEN ${col} > 0 AND ${col} < 1000000000000 THEN ${col} * 1000 ELSE ${col} END)`;

export const SEND_ERR = Object.freeze({
  SEND_DISABLED: ['الإرسال من شاشة المحادثات غير مفعّل.', 404],
  SEND_NOT_CONFIGURED: ['إعدادات ربط البوت غير مكتملة، الرسالة ما اتبعتتش.', 503],
  SEND_BAD_REQUEST: ['الرسالة غير صالحة.', 400],
  SEND_EMPTY: ['اكتب الرسالة الأول.', 400],
  SEND_TOO_LONG: ['الرسالة طويلة. الحد الأقصى 1000 حرف.', 400],
  SEND_UNKNOWN_CHAT: ['المحادثة دي مش موجودة.', 404],
  SEND_WINDOW_CLOSED: ['مينفعش تبعت للعميل ده دلوقتي: آخر رسالة منه عدّى عليها أكتر من 24 ساعة (قاعدة واتساب). لازم العميل يبعت الأول.', 422],
  SEND_RATE_LIMITED: ['رسائل كتير ورا بعض. استنى شوية وحاول تاني.', 429],
  SEND_DUPLICATE: ['الرسالة دي اتبعتت قبل كده.', 409],
  SEND_FAILED: ['واتساب رفض الرسالة، ما وصلتش للعميل.', 502],
  SEND_UNKNOWN: ['مش متأكدين إن الرسالة وصلت (البوت ما ردّش). راجع المحادثة قبل ما تبعت تاني.', 504],
});

export const inboxSendEnabled = (env) => !!env && String(env.NOVA_INBOX_SEND) === '1';

/* "yyyy-MM-dd HH:mm[:ss]" in Africa/Cairo (the bot's log zone) -> epoch ms; 0 when unparseable. */
export function cairoMs(s) {
  const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ''));
  if (!m) return 0;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  let off = 2 * 3600 * 1000;
  try {
    const p = {};
    for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(guess)) p[x.type] = x.value;
    off = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - guess;
  } catch { /* keep +2h */ }
  return guess - off;
}

async function bump(kv, key, max, ttl) {
  if (!kv) return true;
  let n = 0;
  try { n = Number(await kv.get(key)) || 0; } catch { n = 0; }
  if (n >= max) return false;
  try { await kv.put(key, String(n + 1), { expirationTtl: ttl }); } catch { /* fail open on KV errors */ }
  return true;
}

async function callBot(env, payload, ms) {
  const f = env.NOVA_FETCH || globalThis.fetch; // injectable (tests)
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ac ? setTimeout(() => ac.abort(), ms) : null;
  try {
    const r = await f(env.WA_BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), redirect: 'follow', ...(ac ? { signal: ac.signal } : {}) });
    let j = null; try { j = await r.json(); } catch { j = null; }
    return { http: r.status, ok: r.ok, j };
  } finally { if (t) clearTimeout(t); }
}

/* Last incoming customer message time: NOVA D1 first, then the bot's own log (op 'get', read-only). */
export async function lastIncomingMs(env, t, cid, bridge) {
  const row = await env.DB.prepare("SELECT MAX(" + MS('at') + ") AS a FROM inbox_messages WHERE tenant_id = ? AND conversation_id = ? AND dir = 'in'").bind(t, cid).first();
  const d1 = Number(row && row.a) || 0;
  if (Date.now() - d1 <= WINDOW_MS || !bridge) return d1;
  try {
    const r = await callBot(env, { ...bridge, operation: 'get', chatId: cid }, 15000);
    const msgs = r.ok && r.j && r.j.ok === true && Array.isArray(r.j.msgs) ? r.j.msgs : [];
    let best = d1;
    for (const m of msgs) if (m && m.role === 'user') best = Math.max(best, cairoMs(String(m.t || '').replace(/^'/, '')));
    return best;
  } catch { return d1; }
}

export function registerInboxSendRoutes(route, { errorResponse }) {
  route('POST', '/api/v1/inbox/history/send', async (ctx) => {
    const { env, requestId, request } = ctx;
    const err = (code) => errorResponse(code, SEND_ERR[code][0], SEND_ERR[code][1], requestId);
    const bad = await checkPin(request, env);
    if (bad) return errorResponse(bad.code, bad.message_ar, bad.status, requestId);
    if (!inboxSendEnabled(env)) return err('SEND_DISABLED');
    const token = env.NOVA_WA_BRIDGE_TOKEN;
    if (typeof env.WA_BACKEND_URL !== 'string' || !env.WA_BACKEND_URL || typeof token !== 'string' || token.length < 32) return err('SEND_NOT_CONFIGURED');
    let body = null;
    try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return err('SEND_BAD_REQUEST');
    const cid = typeof body.id === 'string' ? body.id : '';
    if (!CHAT_RE.test(cid)) return err('SEND_BAD_REQUEST');
    if (typeof body.text !== 'string') return err('SEND_BAD_REQUEST');
    const text = body.text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
    if (!text) return err('SEND_EMPTY');
    if (text.length > MAX_TEXT) return err('SEND_TOO_LONG');
    const clientId = typeof body.clientId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.clientId) ? body.clientId : null;
    const by = typeof body.by === 'string' ? body.by.trim().slice(0, 60) || null : null;
    const t = historyTenant(env), db = env.DB;
    const conv = await db.prepare('SELECT id FROM inbox_conversations WHERE tenant_id = ? AND id = ?').bind(t, cid).first();
    if (!conv) return err('SEND_UNKNOWN_CHAT');
    const ipHash = (await sha256Hex(request.headers.get('CF-Connecting-IP') || 'anon')).slice(0, 32);
    if (clientId && env.KV) {
      let seen = null; try { seen = await env.KV.get('wasend:cid:' + clientId); } catch { seen = null; }
      if (seen) return err('SEND_DUPLICATE');
    }
    if (!(await bump(env.KV, 'wasend:ip:' + ipHash, IP_MAX, IP_WINDOW_S)) || !(await bump(env.KV, 'wasend:t:' + t, TENANT_MAX, TENANT_WINDOW_S))) return err('SEND_RATE_LIMITED');
    const bridge = { action: 'novaWhatsAppBridge', bridgeToken: token };
    const now0 = Date.now();
    const lastIn = await lastIncomingMs(env, t, cid, bridge);
    const logId = 'ws_' + crypto.randomUUID();
    const log = (status, error) => db.prepare('UPDATE wa_send_log SET status = ?, error = ?, finished_at = ? WHERE tenant_id = ? AND id = ?').bind(status, error, Date.now(), t, logId).run();
    await db.prepare('INSERT INTO wa_send_log (tenant_id, id, conversation_id, client_id, ip_hash, sent_by, text_len, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(t, logId, cid, clientId, ipHash, by, text.length, 'pending', now0).run();
    if (!lastIn || Date.now() - lastIn > WINDOW_MS) {
      await log('blocked', 'window-closed');
      return errorResponse('SEND_WINDOW_CLOSED', SEND_ERR.SEND_WINDOW_CLOSED[0], 422, requestId, lastIn ? { 'X-Last-Incoming': String(lastIn) } : undefined);
    }
    if (clientId && env.KV) { try { await env.KV.put('wasend:cid:' + clientId, '1', { expirationTtl: 86400 }); } catch { /* ignore */ } }
    let r;
    try { r = await callBot(env, { ...bridge, operation: 'reply', chatId: cid, text }, 25000); } catch { r = null; }
    if (!r) { await log('unknown', 'no-response'); return err('SEND_UNKNOWN'); }
    if (!r.ok || !r.j || r.j.ok !== true) {
      const why = r.j && typeof r.j.error === 'string' ? r.j.error.slice(0, 200) : 'http-' + r.http;
      await log('failed', why);
      return err('SEND_FAILED');
    }
    const at = Date.now(), mid = 'ps_' + crypto.randomUUID();
    await db.prepare('INSERT INTO inbox_messages (tenant_id, id, conversation_id, dir, text, status, at) VALUES (?,?,?,?,?,?,?)').bind(t, mid, cid, 'out', text, 'sent', at).run();
    await db.prepare('UPDATE inbox_conversations SET updated_at = ? WHERE tenant_id = ? AND id = ?').bind(at, t, cid).run();
    await log('sent', null);
    return { ok: true, message: { id: mid, dir: 'out', kind: 'pharm', text, at, status: 'sent' }, requestId };
  });
}
