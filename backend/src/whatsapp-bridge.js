// WA bridge (pharmacy bot <-> NOVA Rx). Flag NOVA_WA_BRIDGE_INTAKE (default OFF) gates the bot->NOVA forward intake.
// Intake only enqueues (same queue + shape as the Meta path); processing still needs NOVA_WA_INTAKE=1 and WA_TENANT_MAP.
// Auto-reply toggle proxies the Apps Script action novaWhatsAppBridge (autoReplyGet / autoReplySet) behind the inbox flag + session.
// Secrets by NAME only: NOVA_WA_BRIDGE_TOKEN, WA_BACKEND_URL. No network unless the injected fetch is called.
import { timingSafeEqual, enqueue } from './whatsapp-intake.js';
import { inboxEnabled } from './inbox.js';
import { messageText, tenantMap } from './whatsapp-process.js';
import { mediaMeta, cacheMedia } from './inbox-media.js';
import { historyTenant } from './inbox-history.js';
import { schedulePush } from './inbox-push.js';

export const MAX_ITEMS = 100;
// UX405: media bytes arrive inline (GAS caps a file at 5 MB => ~6.7 MB of JSON), so this route accepts up to 10 MB.
// The Meta webhook keeps its own 1 MB limit (whatsapp-intake.js MAX_BODY).
export const MAX_BRIDGE_BODY = 10 * 1024 * 1024;
const MIN_TOKEN = 32;

export function waBridgeIntakeEnabled(env) { return !!env && env.NOVA_WA_BRIDGE_INTAKE === '1'; }

const s = (v) => (typeof v === 'string' && v ? v : null);

// Contract item -> internal queue entry (same shape as extractMessages()), or null when it cannot be represented.
export function toQueueEntry(it) {
  const id = s(it && it.id), from = s(it && it.from);
  if (!id || !from) return { bad: true };
  const text = s(it.text), type = s(it.type) || 'text';
  const message = { id, from, timestamp: s(it.timestamp) || (Number.isFinite(it.timestamp) ? String(it.timestamp) : undefined) };
  const md = mediaMeta({ ...it, type });
  if (md) {
    // Meta-shaped part; bytes are NOT queued (D1 rows stay small): the route caches them in KV and sets cached.
    message.type = type;
    message[type] = { id: md.id || undefined, mime_type: md.mime || undefined, filename: md.filename || undefined, caption: md.caption || undefined,
      size: md.size == null ? undefined : md.size, skipped: md.skipped || undefined };
  }
  else if (text) { message.type = 'text'; message.text = { body: text }; }
  else return null;
  const name = s(it.name);
  const metadata = { phone_number_id: s(it.phone_number_id) };
  if (name) metadata.contacts = [{ profile: { name } }];
  return { id, message, metadata };
}

export function waBridgeDirectEnabled(env) { return !!env && env.NOVA_WA_BRIDGE_DIRECT === '1'; }

const tsMs = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? (n < 1e12 ? Math.round(n * 1000) : Math.round(n)) : 0; };

// FIX51: direct, synchronous write of the bot's forwarded copy into the SAME tables the history/send routes read
// (inbox_conversations / inbox_messages, tenant = historyTenant). Idempotent by message id; additive only.
// Inbound id = wa_<wamid> (same as the Meta queue path), outbound (bot reply) id = wb_<wamid>.
// UX405: media items (image/sticker/audio/video/document) are always stored, caption or not, with their media columns;
// media_base64 (when present) is decoded and cached in KV under wamedia:<tenant>:<message id>.
// UX406: fresh (optional array) collects the inbound messages actually written, for the push notification hook.
export async function ingestDirect(db, tenant, items, now = Date.now(), kv = null, fresh = null) {
  let added = 0, duplicates = 0, skipped = 0, cached = 0;
  for (const it of items) {
    const out = it.direction === 'out';
    const from = String(it.from).replace(/\D/g, '');
    const type = s(it.type) || 'text';
    const md = mediaMeta({ ...it, type });
    const m = { type, text: it.text ? { body: it.text } : undefined };
    if (md) m[type] = { filename: md.filename || undefined, caption: md.caption || undefined };
    const text = messageText(m);
    if (!from || !text) { skipped++; continue; }
    const mid = (out ? 'wb_' : 'wa_') + it.id, cid = 'wa_' + from;
    const at = Math.min(tsMs(it.timestamp) || now, now + 5 * 60 * 1000);
    const dup = await db.prepare('SELECT id FROM inbox_messages WHERE tenant_id = ? AND id = ?').bind(tenant, mid).first();
    if (dup) { duplicates++; continue; }
    const ok = md && !md.skipped && it.media_base64 ? await cacheMedia(kv, tenant, mid, it.media_base64) : false;
    if (ok) cached++;
    await db.prepare('INSERT OR IGNORE INTO inbox_conversations (tenant_id, id, customer, updated_at) VALUES (?,?,?,?)').bind(tenant, cid, (!out && s(it.name)) || from, at).run();
    // The name follows what the bot forwards (the pharmacy's customer name when the number is in its database, else the WhatsApp profile name):
    // a real name replaces the stored one; a bare number / phone-formatted text, an empty name or an outgoing message never does.
    const nm = !out ? s(it.name) : '';
    if (nm && !/^\+?\d[\d\s-]*$/.test(nm)) await db.prepare('UPDATE inbox_conversations SET customer = ? WHERE tenant_id = ? AND id = ? AND customer <> ?').bind(nm, tenant, cid, nm).run();
    await db.prepare('INSERT OR IGNORE INTO inbox_messages (tenant_id, id, conversation_id, dir, text, status, at, media_type, media_id, media_mime, media_filename, media_size, media_skipped, media_caption, media_cached) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(tenant, mid, cid, out ? 'out' : 'in', text.slice(0, 4000), out ? 'sent' : null, at,
        md ? md.type : null, md ? md.id : null, md ? md.mime : null, md ? md.filename : null, md ? md.size : null, md ? md.skipped : null, md ? md.caption : null, md ? (ok ? 1 : 0) : null).run();
    await db.prepare('UPDATE inbox_conversations SET updated_at = ? WHERE tenant_id = ? AND id = ? AND (CASE WHEN updated_at > 0 AND updated_at < 1000000000000 THEN updated_at * 1000 ELSE updated_at END) < ?').bind(at, tenant, cid, at).run();
    added++;
    if (!out && Array.isArray(fresh)) fresh.push({ cid, name: s(it.name) || from, text: text.slice(0, 200), at });
  }
  return { added, duplicates, skipped, cached };
}

export function registerWaBridgeRoutes(route, { json, errorResponse }, { authenticate }) {
  route('POST', '/api/v1/webhooks/whatsapp-bridge', async (ctx) => {
    const { env, requestId, request } = ctx;
    if (!waBridgeIntakeEnabled(env)) return errorResponse('WA_INTAKE_DISABLED', 'استقبال واتساب غير مفعّل.', 404, requestId);
    const secret = env.NOVA_WA_BRIDGE_TOKEN;
    if (typeof secret !== 'string' || secret.length < MIN_TOKEN) return errorResponse('WA_BRIDGE_NOT_CONFIGURED', 'إعدادات الجسر غير مكتملة.', 503, requestId);
    const m = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '');
    if (!m || !timingSafeEqual(m[1], secret)) return errorResponse('WA_BRIDGE_UNAUTHORIZED', 'غير مصرّح.', 401, requestId);
    const cl = Number(request.headers.get('Content-Length'));
    if (Number.isFinite(cl) && cl > MAX_BRIDGE_BODY) return errorResponse('WA_PAYLOAD_TOO_LARGE', 'حجم الطلب كبير جداً.', 413, requestId);
    const raw = await request.text();
    if (raw.length > MAX_BRIDGE_BODY) return errorResponse('WA_PAYLOAD_TOO_LARGE', 'حجم الطلب كبير جداً.', 413, requestId);
    let body;
    try { body = JSON.parse(raw); } catch { return errorResponse('WA_BAD_JSON', 'صيغة الطلب غير صالحة.', 400, requestId); }
    if (!body || typeof body !== 'object' || !Array.isArray(body.messages) || body.messages.length > MAX_ITEMS) {
      return errorResponse('WA_BAD_JSON', 'صيغة الطلب غير صالحة.', 400, requestId);
    }
    if (!env.DB) return errorResponse('WA_NO_DB', 'قاعدة البيانات غير متاحة.', 503, requestId);
    if (waBridgeDirectEnabled(env)) {
      for (const it of body.messages) if (!it || typeof it !== 'object' || !s(it.id) || !s(it.from)) return errorResponse('WA_BAD_JSON', 'صيغة الطلب غير صالحة.', 400, requestId);
      const fresh = [], tenant = historyTenant(env);
      const r = await ingestDirect(env.DB, tenant, body.messages, Date.now(), env.KV, fresh);
      schedulePush(ctx, env, tenant, fresh); // UX406: after the rows are written; never awaited, never fails the ingest
      return json({ ok: true, direct: true, ...r, requestId }, 200, { 'X-Request-Id': requestId });
    }
    const entries = [], pend = [];
    let skipped = 0;
    for (const it of body.messages) {
      if (it && it.direction === 'out') { skipped++; continue; }
      const e = it && typeof it === 'object' ? toQueueEntry(it) : { bad: true };
      if (e && e.bad) return errorResponse('WA_BAD_JSON', 'صيغة الطلب غير صالحة.', 400, requestId);
      if (!e) { skipped++; continue; }
      const part = e.message[e.message.type];
      if (part && !part.skipped && typeof it.media_base64 === 'string' && it.media_base64) pend.push([e, part, it.media_base64]);
      entries.push(e);
    }
    // Queue path: tenant comes from WA_TENANT_MAP (same as the processor), so the KV key matches the final message id.
    const map = tenantMap(env);
    for (const [e, part, b64] of pend) {
      const pid = e.metadata.phone_number_id;
      const t = typeof pid === 'string' && Object.prototype.hasOwnProperty.call(map, pid) ? map[pid] : null;
      if (typeof t === 'string' && t && await cacheMedia(env.KV, t, 'wa_' + e.id, b64)) part.cached = true;
    }
    const res = await enqueue(env.DB, entries);
    return json({ ok: true, ...res, skipped, requestId }, 200, { 'X-Request-Id': requestId });
  });

  // Auto-reply toggle (any authenticated staff/owner session, same as the inbox routes), proxied to the Apps Script per contract B.
  const AR = { notConfigured: ['WA_AUTOREPLY_NOT_CONFIGURED', 'الرد الآلي غير مُعدّ.', 503], failed: ['WA_AUTOREPLY_FAILED', 'تعذّر الاتصال بالبوت.', 502] };
  const fail = (k, requestId) => errorResponse(AR[k][0], AR[k][1], AR[k][2], requestId);
  const handler = (write) => async (ctx) => {
    const { env, requestId, request } = ctx;
    if (!inboxEnabled(env) || !env.DB || !env.KV) return errorResponse('INBOX_DISABLED', 'صندوق الرسائل غير مفعّل.', 404, requestId);
    const a = await authenticate(request, env);
    if (a.fail) return errorResponse(a.fail.code, a.fail.message_ar, a.fail.status, requestId);
    const url = env.WA_BACKEND_URL, token = env.NOVA_WA_BRIDGE_TOKEN;
    if (typeof url !== 'string' || !url || typeof token !== 'string' || token.length < MIN_TOKEN) return fail('notConfigured', requestId);
    const payload = { action: 'novaWhatsAppBridge', bridgeToken: token };
    if (write) {
      let body;
      try { body = await request.json(); } catch { body = null; }
      if (!body || typeof body.enabled !== 'boolean') return errorResponse('WA_AUTOREPLY_BAD_REQUEST', 'قيمة الرد الآلي غير صالحة.', 400, requestId);
      Object.assign(payload, { operation: 'autoReplySet', enabled: body.enabled });
    } else payload.operation = 'autoReplyGet';
    try {
      const f = env.NOVA_FETCH || globalThis.fetch; // injectable (tests)
      const up = await f(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), redirect: 'follow' });
      if (!up.ok) return fail('failed', requestId);
      const r = await up.json();
      if (!r || r.ok !== true || typeof r.autoReply !== 'boolean') return fail('failed', requestId);
      return json({ ok: true, autoReply: r.autoReply, requestId }, 200, { 'X-Request-Id': requestId });
    } catch { return fail('failed', requestId); }
  };
  route('GET', '/api/v1/whatsapp/auto-reply', handler(false));
  route('POST', '/api/v1/whatsapp/auto-reply', handler(true));
}
