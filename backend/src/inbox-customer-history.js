// WA-CUSTHIST: a customer's purchase history inside a WhatsApp chat. Read-only: asks the pharmacy bot (op 'customerHistory', the daily sales
// files, matched by the chat's phone number) and returns the last purchases. Nothing is stored in D1; the answer is cached in KV for 5 minutes.
// Gate: same as the history (PIN, or none on staging/preview). Needs WA_BACKEND_URL + NOVA_WA_BRIDGE_TOKEN.
import { checkPin } from './inbox-history.js';
import { callBot } from './inbox-send.js';

const PHONE_CHAT = /^wa_\d{8,15}$/;
const CACHE_S = 300;

/* Pure: bot answer -> what the screen gets (trimmed, typed). */
export function cleanHistory(j) {
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const purchases = (Array.isArray(j && j.purchases) ? j.purchases : []).slice(0, 10).map((p) => ({
    date: typeof p.date === 'string' ? p.date.slice(0, 10) : '',
    invoice: typeof p.invoice === 'string' ? p.invoice.slice(0, 40) : '',
    total: num(p.total),
    items: (Array.isArray(p.items) ? p.items : []).slice(0, 40).map((i) => ({ name: typeof i.name === 'string' ? i.name.slice(0, 80) : '', qty: num(i.qty) })),
  }));
  return { purchases, debt: j && j.debt && Number.isFinite(Number(j.debt.net)) ? { net: Number(j.debt.net) } : null, partial: !!(j && j.partial) };
}

export function registerInboxCustomerHistoryRoutes(route, { errorResponse }) {
  route('GET', '/api/v1/inbox/history/customer-history', async (ctx) => {
    const { env, requestId, request, url } = ctx;
    const bad = await checkPin(request, env);
    if (bad) return errorResponse(bad.code, bad.message_ar, bad.status, requestId);
    const id = url.searchParams.get('id') || '';
    if (!PHONE_CHAT.test(id)) return { ok: true, available: false, reason: 'no-phone', purchases: [], debt: null, partial: false, requestId };
    const token = env.NOVA_WA_BRIDGE_TOKEN;
    if (typeof env.WA_BACKEND_URL !== 'string' || !env.WA_BACKEND_URL || typeof token !== 'string' || token.length < 32)
      return errorResponse('HIST_NOT_CONFIGURED', 'إعدادات ربط البوت غير مكتملة.', 503, requestId);
    const key = 'wacusthist:' + id;
    if (env.KV) {
      let hit = null; try { hit = await env.KV.get(key); } catch { hit = null; }
      if (hit) { try { return { ok: true, available: true, cached: true, ...JSON.parse(hit), requestId }; } catch { /* fall through */ } }
    }
    let r;
    try { r = await callBot(env, { action: 'novaWhatsAppBridge', bridgeToken: token, operation: 'customerHistory', chatId: id }, 28000); } catch { r = null; }
    if (!r || !r.ok || !r.j || r.j.ok !== true) return errorResponse('HIST_FAILED', 'تعذّر تحميل سجل الفواتير. حاول مرة تانية.', 502, requestId);
    const out = cleanHistory(r.j);
    if (env.KV) { try { await env.KV.put(key, JSON.stringify(out), { expirationTtl: CACHE_S }); } catch { /* ignore */ } }
    return { ok: true, available: true, cached: false, ...out, requestId };
  });
}
