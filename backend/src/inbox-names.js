// WA-LINK: link WhatsApp conversations to the customers REGISTERED in the pharmacy (its CRM), by phone number.
// The pharmacy bot already resolves the registered name by number when it logs a chat (op 'list' returns {id, name, phone}).
// This route reads that list (read-only on the bot) and sets inbox_conversations.customer to the registered name.
// It never creates a conversation, never touches messages, never sends anything. A bare number / phone-formatted text is never a name.
// GET on purpose (the app's read-only polling stays GET-only; the effect is an idempotent name sync). Gate: same as the history (PIN, or none on staging/preview). Needs WA_BACKEND_URL + NOVA_WA_BRIDGE_TOKEN (names only). Throttled: once per 2 minutes per tenant.
import { checkPin, historyTenant } from './inbox-history.js';
import { callBot } from './inbox-send.js';

const CHAT_RE = /^wa_[A-Za-z0-9_.-]{1,100}$/;
const NUMBERISH = /^\+?\d[\d\s-]*$/;
const THROTTLE_S = 120, MAX_CHATS = 600;

/* A registered customer name we are willing to show: text, no control chars, not a phone number, 1..120 chars. */
export function cleanName(v) {
  if (typeof v !== 'string') return null;
  const n = v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n || n.length > 120 || NUMBERISH.test(n)) return null;
  return n;
}

/* Pure: which conversations change, given the bot's chat list and what NOVA stores now. [{id, name}] */
export function planLinks(botChats, current) {
  const out = [], seen = new Set();
  for (const c of Array.isArray(botChats) ? botChats.slice(0, MAX_CHATS) : []) {
    if (!c || typeof c.id !== 'string' || !CHAT_RE.test(c.id) || seen.has(c.id)) continue;
    const name = cleanName(c.name);
    if (!name || !current.has(c.id) || current.get(c.id) === name) continue;
    seen.add(c.id); out.push({ id: c.id, name });
  }
  return out;
}

export function registerInboxNamesRoutes(route, { errorResponse }) {
  route('GET', '/api/v1/inbox/history/link-names', async (ctx) => {
    const { env, requestId, request } = ctx;
    const bad = await checkPin(request, env);
    if (bad) return errorResponse(bad.code, bad.message_ar, bad.status, requestId);
    const token = env.NOVA_WA_BRIDGE_TOKEN;
    if (typeof env.WA_BACKEND_URL !== 'string' || !env.WA_BACKEND_URL || typeof token !== 'string' || token.length < 32)
      return errorResponse('LINK_NOT_CONFIGURED', 'إعدادات ربط البوت غير مكتملة.', 503, requestId);
    const t = historyTenant(env), db = env.DB;
    const key = 'walink:t:' + t;
    if (env.KV) {
      let seen = null; try { seen = await env.KV.get(key); } catch { seen = null; }
      if (seen) return { ok: true, throttled: true, linked: 0, requestId };
      try { await env.KV.put(key, '1', { expirationTtl: THROTTLE_S }); } catch { /* fail open */ }
    }
    let r;
    try { r = await callBot(env, { action: 'novaWhatsAppBridge', bridgeToken: token, operation: 'list' }, 20000); } catch { r = null; }
    if (!r || !r.ok || !r.j || r.j.ok !== true || !Array.isArray(r.j.chats))
      return errorResponse('LINK_FAILED', 'تعذّر قراءة العملاء المسجلين من البوت.', 502, requestId);
    const rows = await db.prepare("SELECT id, customer FROM inbox_conversations WHERE tenant_id = ? AND id LIKE 'wa\\_%' ESCAPE '\\'").bind(t).all();
    const current = new Map((rows.results || []).map((x) => [x.id, x.customer]));
    const plan = planLinks(r.j.chats, current);
    for (const p of plan) await db.prepare('UPDATE inbox_conversations SET customer = ? WHERE tenant_id = ? AND id = ?').bind(p.name, t, p.id).run();
    return { ok: true, throttled: false, checked: r.j.chats.length, linked: plan.length, requestId };
  });
}
