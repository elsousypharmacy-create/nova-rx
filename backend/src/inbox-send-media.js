// WA-SEND-IMG: the pharmacist sends a PHOTO from the conversations screen to the real customer on WhatsApp.
// Route: POST /api/v1/inbox/history/send-media { id, mime, data(base64), caption?, clientId?, by? }.
// Same gate as the text send (checkPin; staging/preview need no PIN) plus its OWN flag NOVA_INBOX_SEND_MEDIA === '1' (default OFF).
// Delivery reuses the pharmacy bot's Apps Script op novaWhatsAppBridge/sendMedia (the bot validates again and holds the WhatsApp token;
// NOVA never does). JPEG/PNG only, magic bytes checked, <= 5 MB, caption <= 1024. Target = the conversation's own chat id (never a phone).
// Only after the bot confirms: the message row + bytes in KV are stored; the bot's echo (wb_<wamid>) is replaced by ours. Every attempt is logged in wa_send_log.
import { sha256Hex } from './auth/auth.js';
import { checkPin, historyTenant } from './inbox-history.js';
import { callBot, SEND_ERR } from './inbox-send.js';
import { decodeBase64, cacheMedia, mediaOfRow } from './inbox-media.js';

export const MEDIA_SEND_MAX = 5 * 1024 * 1024;
export const MEDIA_CAPTION_MAX = 1024;
const MIMES = { 'image/jpeg': 1, 'image/png': 1 };
const IP_MAX = 12, IP_WINDOW_S = 600, TENANT_MAX = 60, TENANT_WINDOW_S = 3600;
const CHAT_RE = /^wa_[A-Za-z0-9_.-]{1,100}$/;
const ERR = Object.freeze({
  SENDMEDIA_DISABLED: ['إرسال الصور من شاشة المحادثات غير مفعّل.', 404],
  SENDMEDIA_BAD_FILE: ['الملف غير صالح. المسموح صور JPEG أو PNG فقط.', 400],
  SENDMEDIA_TOO_LARGE: ['الصورة كبيرة. الحد الأقصى 5 ميجا.', 413],
  SENDMEDIA_CAPTION: ['التعليق طويل. الحد الأقصى 1024 حرف.', 400],
});
const e = (code) => ERR[code] || SEND_ERR[code];
const magicOk = (b, mime) => (mime === 'image/jpeg' ? b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF : b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47);

async function bump(kv, key, max, ttl) {
  if (!kv) return true;
  let n = 0; try { n = Number(await kv.get(key)) || 0; } catch { n = 0; }
  if (n >= max) return false;
  try { await kv.put(key, String(n + 1), { expirationTtl: ttl }); } catch { /* fail open */ }
  return true;
}

export function registerInboxSendMediaRoutes(route, { errorResponse }) {
  route('POST', '/api/v1/inbox/history/send-media', async (ctx) => {
    const { env, requestId, request } = ctx;
    const err = (code) => errorResponse(code, e(code)[0], e(code)[1], requestId);
    const bad = await checkPin(request, env);
    if (bad) return errorResponse(bad.code, bad.message_ar, bad.status, requestId);
    if (String(env.NOVA_INBOX_SEND_MEDIA) !== '1') return err('SENDMEDIA_DISABLED');
    const token = env.NOVA_WA_BRIDGE_TOKEN;
    if (typeof env.WA_BACKEND_URL !== 'string' || !env.WA_BACKEND_URL || typeof token !== 'string' || token.length < 32) return err('SEND_NOT_CONFIGURED');
    if (Number(request.headers.get('content-length')) > 9 * 1024 * 1024) return err('SENDMEDIA_TOO_LARGE');
    let body = null; try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return err('SEND_BAD_REQUEST');
    const cid = typeof body.id === 'string' ? body.id : '';
    if (!CHAT_RE.test(cid)) return err('SEND_BAD_REQUEST');
    const mime = typeof body.mime === 'string' ? body.mime.toLowerCase() : '';
    if (!MIMES[mime]) return err('SENDMEDIA_BAD_FILE');
    if (body.caption != null && typeof body.caption !== 'string') return err('SEND_BAD_REQUEST');
    const caption = String(body.caption || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
    if (caption.length > MEDIA_CAPTION_MAX) return err('SENDMEDIA_CAPTION');
    const data = typeof body.data === 'string' ? body.data.replace(/\s+/g, '') : '';
    if (!data) return err('SENDMEDIA_BAD_FILE');
    if (Math.floor(data.length * 3 / 4) > MEDIA_SEND_MAX + 3) return err('SENDMEDIA_TOO_LARGE');
    const bytes = decodeBase64(data);
    if (!bytes || bytes.length < 8 || !magicOk(bytes, mime)) return err('SENDMEDIA_BAD_FILE');
    if (bytes.length > MEDIA_SEND_MAX) return err('SENDMEDIA_TOO_LARGE');
    const clientId = typeof body.clientId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.clientId) ? body.clientId : null;
    const by = typeof body.by === 'string' ? body.by.trim().slice(0, 60) || null : null;
    const t = historyTenant(env), db = env.DB;
    const conv = await db.prepare('SELECT id FROM inbox_conversations WHERE tenant_id = ? AND id = ?').bind(t, cid).first();
    if (!conv) return err('SEND_UNKNOWN_CHAT');
    const ipHash = (await sha256Hex(request.headers.get('CF-Connecting-IP') || 'anon')).slice(0, 32);
    if (clientId && env.KV) { let seen = null; try { seen = await env.KV.get('wasend:cid:' + clientId); } catch { seen = null; } if (seen) return err('SEND_DUPLICATE'); }
    if (!(await bump(env.KV, 'wasendm:ip:' + ipHash, IP_MAX, IP_WINDOW_S)) || !(await bump(env.KV, 'wasendm:t:' + t, TENANT_MAX, TENANT_WINDOW_S))) return err('SEND_RATE_LIMITED');
    const logId = 'ws_' + crypto.randomUUID();
    const log = (status, error) => db.prepare('UPDATE wa_send_log SET status = ?, error = ?, finished_at = ? WHERE tenant_id = ? AND id = ?').bind(status, error, Date.now(), t, logId).run();
    await db.prepare('INSERT INTO wa_send_log (tenant_id, id, conversation_id, client_id, ip_hash, sent_by, text_len, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(t, logId, cid, clientId, ipHash, by, caption.length, 'pending', Date.now()).run();
    if (clientId && env.KV) { try { await env.KV.put('wasend:cid:' + clientId, '1', { expirationTtl: 86400 }); } catch { /* ignore */ } }
    const payload = { action: 'novaWhatsAppBridge', bridgeToken: token, operation: 'sendMedia', chatId: cid, kind: 'image', mime, media_base64: data };
    if (caption) payload.caption = caption;
    let r; try { r = await callBot(env, payload, 40000); } catch { r = null; }
    if (!r) { await log('unknown', 'no-response'); return err('SEND_UNKNOWN'); }
    if (!r.ok || !r.j || r.j.ok !== true) {
      const why = r.j && typeof r.j.error === 'string' ? r.j.error.slice(0, 200) : 'http-' + r.http;
      if (/24\s*ساعة|131047|re-?engagement/i.test(why)) { await log('failed', 'window-closed'); return err('SEND_WINDOW_CLOSED'); }
      await log('failed', why); return err('SEND_FAILED');
    }
    const at = Date.now(), mid = 'ps_' + crypto.randomUUID();
    try { await db.prepare("DELETE FROM inbox_messages WHERE tenant_id = ? AND rowid IN (SELECT rowid FROM inbox_messages WHERE tenant_id = ? AND conversation_id = ? AND dir = 'out' AND id LIKE 'wb\\_%' ESCAPE '\\' AND media_type = 'image' AND at BETWEEN ? AND ? ORDER BY at DESC LIMIT 1)").bind(t, t, cid, at - 180000, at + 180000).run(); } catch { /* the duplicate stays */ }
    const cached = await cacheMedia(env.KV, t, mid, data);
    await db.prepare('INSERT INTO inbox_messages (tenant_id, id, conversation_id, dir, text, status, at, media_type, media_mime, media_size, media_caption, media_cached) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(t, mid, cid, 'out', caption, 'sent', at, 'image', mime, bytes.length, caption || null, cached ? 1 : 0).run();
    await db.prepare('UPDATE inbox_conversations SET updated_at = ? WHERE tenant_id = ? AND id = ?').bind(at, t, cid).run();
    await log('sent', null);
    const row = { media_type: 'image', media_mime: mime, media_size: bytes.length, media_caption: caption || null, media_cached: cached ? 1 : 0 };
    return { ok: true, message: { id: mid, dir: 'out', kind: 'pharm', text: caption, at, status: 'sent', media: mediaOfRow(row) }, requestId };
  });
}
