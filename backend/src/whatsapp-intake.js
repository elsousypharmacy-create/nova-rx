// MSG-01 (N114): WhatsApp Cloud API webhook intake. Flag NOVA_WA_INTAKE defaults OFF.
// GET verify, X-Hub-Signature-256 check, dedup by Meta message id, queue + retry + dead-letter.
// No network calls here: the processor is injected (mock in tests).
// Secrets by NAME only: WA_APP_SECRET, WA_VERIFY_TOKEN (WA_TOKEN / WA_PHONE_ID are used only by the future sender).
const enc = new TextEncoder();
export const MAX_ATTEMPTS = 5;
export const MAX_BODY = 1024 * 1024;

export function waIntakeEnabled(env) { return !!env && env.NOVA_WA_INTAKE === '1'; }

export function timingSafeEqual(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}

export async function hmacSha256Hex(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifySignature(secret, rawBody, header) {
  if (!secret || !header || !String(header).startsWith('sha256=')) return false;
  return timingSafeEqual(await hmacSha256Hex(secret, rawBody), String(header).slice(7));
}

// Extract inbound messages (status updates are ignored) from a Meta payload.
export function extractMessages(payload) {
  const out = [];
  for (const entry of (payload && payload.entry) || []) {
    for (const ch of (entry && entry.changes) || []) {
      const v = ch && ch.value;
      for (const m of (v && v.messages) || []) {
        if (m && typeof m.id === 'string' && m.id) out.push({ id: m.id, message: m, metadata: v.metadata || null });
      }
    }
  }
  return out;
}

export async function enqueue(db, msgs) {
  let queued = 0, duplicates = 0;
  for (const m of msgs) {
    const r = await db.prepare('INSERT OR IGNORE INTO wa_inbound_queue (wa_message_id, payload_json) VALUES (?, ?)')
      .bind(m.id, JSON.stringify({ message: m.message, metadata: m.metadata })).run();
    if (r && r.meta && r.meta.changes === 0) duplicates++; else queued++;
  }
  return { queued, duplicates };
}

export function backoffSeconds(attempts) { return Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1)); }

// Process due rows with an injected processor(payload). Failures retry with backoff, then dead-letter.
export async function processQueue(db, processor, { now = Math.floor(Date.now() / 1000), limit = 20 } = {}) {
  const { results } = await db.prepare("SELECT id, payload_json, attempts FROM wa_inbound_queue WHERE status='pending' AND next_attempt_at <= ? ORDER BY id LIMIT ?").bind(now, limit).all();
  const stats = { done: 0, retried: 0, dead: 0 };
  for (const row of results || []) {
    try {
      await processor(JSON.parse(row.payload_json));
      await db.prepare("UPDATE wa_inbound_queue SET status='done', attempts=?, last_error=NULL, updated_at=datetime('now') WHERE id=?").bind(row.attempts + 1, row.id).run();
      stats.done++;
    } catch (e) {
      const attempts = row.attempts + 1;
      const err = String((e && e.message) || e).slice(0, 200);
      if (attempts >= MAX_ATTEMPTS) {
        await db.prepare("UPDATE wa_inbound_queue SET status='dead', attempts=?, last_error=?, updated_at=datetime('now') WHERE id=?").bind(attempts, err, row.id).run();
        stats.dead++;
      } else {
        await db.prepare("UPDATE wa_inbound_queue SET attempts=?, last_error=?, next_attempt_at=?, updated_at=datetime('now') WHERE id=?").bind(attempts, err, now + backoffSeconds(attempts), row.id).run();
        stats.retried++;
      }
    }
  }
  return stats;
}

export function registerWhatsAppRoutes(route, { json, errorResponse }) {
  const off = (ctx) => errorResponse('WA_INTAKE_DISABLED', 'استقبال واتساب غير مفعّل.', 404, ctx.requestId);
  route('GET', '/api/v1/webhooks/whatsapp', (ctx) => {
    if (!waIntakeEnabled(ctx.env)) return off(ctx);
    const p = ctx.url.searchParams;
    const tok = ctx.env.WA_VERIFY_TOKEN;
    if (!tok || p.get('hub.mode') !== 'subscribe' || !timingSafeEqual(p.get('hub.verify_token') || '', tok)) {
      return errorResponse('WA_VERIFY_FAILED', 'فشل التحقق من الويب هوك.', 403, ctx.requestId);
    }
    return new Response(String(p.get('hub.challenge') || ''), { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  });
  route('POST', '/api/v1/webhooks/whatsapp', async (ctx) => {
    if (!waIntakeEnabled(ctx.env)) return off(ctx);
    const raw = await ctx.request.text();
    if (raw.length > MAX_BODY) return errorResponse('WA_PAYLOAD_TOO_LARGE', 'حجم الطلب كبير جداً.', 413, ctx.requestId);
    if (!(await verifySignature(ctx.env.WA_APP_SECRET, raw, ctx.request.headers.get('X-Hub-Signature-256')))) {
      return errorResponse('WA_BAD_SIGNATURE', 'توقيع غير صالح.', 401, ctx.requestId);
    }
    let payload;
    try { payload = JSON.parse(raw); } catch { return errorResponse('WA_BAD_JSON', 'صيغة الطلب غير صالحة.', 400, ctx.requestId); }
    if (!ctx.env.DB) return errorResponse('WA_NO_DB', 'قاعدة البيانات غير متاحة.', 503, ctx.requestId);
    const res = await enqueue(ctx.env.DB, extractMessages(payload));
    return json({ ok: true, ...res, requestId: ctx.requestId }, 200, { 'X-Request-Id': ctx.requestId });
  });
}
