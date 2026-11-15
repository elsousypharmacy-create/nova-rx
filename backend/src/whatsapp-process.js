// UX49 (UX37-10): WhatsApp queue processor -> unified inbox. Flag NOVA_WA_INTAKE (default OFF). No network.
// Tenant comes ONLY from the non-secret config var WA_TENANT_MAP (JSON {"<phone_number_id>":"<tenantId>"}).
import { waIntakeEnabled, processQueue } from './whatsapp-intake.js';
import { openConversation, receiveMessage } from './inbox.js';
import { isMediaType, PLACEHOLDER, cleanMime, SKIP_REASONS } from './inbox-media.js';

export function tenantMap(env) {
  try { const m = JSON.parse((env && env.WA_TENANT_MAP) || '{}'); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; } catch { return {}; }
}

// UX405: every media type gets a text placeholder (never skipped, caption optional); the media columns carry the rest.
export function messageText(m) {
  if (m.type === 'text' || (!m.type && m.text)) { const b = m.text && m.text.body; if (typeof b === 'string' && b) return b; }
  if (isMediaType(m.type)) {
    const o = (m[m.type] && typeof m[m.type] === 'object') ? m[m.type] : {};
    return PLACEHOLDER[m.type] + (m.type === 'document' && o.filename ? ' ' + o.filename : '') + (o.caption ? ' ' + o.caption : '');
  }
  return null;
}

// Meta-shaped message (m.image / m.sticker / ...) -> media columns, or null.
export function messageMedia(m) {
  if (!m || !isMediaType(m.type)) return null;
  const o = (m[m.type] && typeof m[m.type] === 'object') ? m[m.type] : {};
  const st = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : null);
  const size = Number(o.size);
  return { type: m.type, id: st(o.id, 200), mime: cleanMime(o.mime_type), filename: st(o.filename, 200), size: Number.isFinite(size) && size >= 0 && o.size != null ? Math.round(size) : null,
    skipped: SKIP_REASONS.includes(o.skipped) ? o.skipped : null, caption: st(o.caption, 3000), cached: o.cached === true ? 1 : 0 };
}

export function makeProcessor(db, env, now = () => Math.floor(Date.now() / 1000)) {
  const map = tenantMap(env);
  return async (payload) => {
    const m = payload && payload.message;
    if (!m || typeof m.id !== 'string' || !m.id || typeof m.from !== 'string' || !m.from) throw new Error('WA_BAD_PAYLOAD');
    const pid = payload.metadata && payload.metadata.phone_number_id;
    const tenant = typeof pid === 'string' && Object.prototype.hasOwnProperty.call(map, pid) ? map[pid] : null;
    if (typeof tenant !== 'string' || !tenant) throw new Error('WA_UNKNOWN_PHONE_NUMBER_ID');
    const text = messageText(m);
    if (!text) throw new Error('WA_UNSUPPORTED_MESSAGE');
    const mid = 'wa_' + m.id;
    const dup = await db.prepare('SELECT id FROM inbox_messages WHERE tenant_id = ? AND id = ?').bind(tenant, mid).first();
    if (dup) return { duplicate: true };
    const at = Number(m.timestamp) || now();
    const cid = 'wa_' + m.from;
    const name = payload.metadata && payload.metadata.contacts && payload.metadata.contacts[0] && payload.metadata.contacts[0].profile && payload.metadata.contacts[0].profile.name;
    await openConversation(db, tenant, { id: cid, customer: typeof name === 'string' ? name : m.from, now: at });
    const r = await receiveMessage(db, tenant, { id: cid, text, now: at });
    await db.prepare('UPDATE inbox_messages SET id = ? WHERE tenant_id = ? AND id = ?').bind(mid, tenant, r.id).run();
    const md = messageMedia(m);
    if (md) await db.prepare('UPDATE inbox_messages SET media_type = ?, media_id = ?, media_mime = ?, media_filename = ?, media_size = ?, media_skipped = ?, media_caption = ?, media_cached = ? WHERE tenant_id = ? AND id = ?')
      .bind(md.type, md.id, md.mime, md.filename, md.size, md.skipped, md.caption, md.cached, tenant, mid).run();
    return { duplicate: false };
  };
}

// Scheduled hook: does nothing unless NOVA_WA_INTAKE=1 and a DB is bound.
export async function scheduledWaProcess(env, opts = {}) {
  if (!waIntakeEnabled(env) || !env.DB) return null;
  return processQueue(env.DB, makeProcessor(env.DB, env, opts.clock), opts);
}
