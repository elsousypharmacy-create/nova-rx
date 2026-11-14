// UX49 (UX37-10): WhatsApp queue processor -> unified inbox. Flag NOVA_WA_INTAKE (default OFF). No network.
// Tenant comes ONLY from the non-secret config var WA_TENANT_MAP (JSON {"<phone_number_id>":"<tenantId>"}).
import { waIntakeEnabled, processQueue } from './whatsapp-intake.js';
import { openConversation, receiveMessage } from './inbox.js';

export function tenantMap(env) {
  try { const m = JSON.parse((env && env.WA_TENANT_MAP) || '{}'); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; } catch { return {}; }
}

export function messageText(m) {
  if (m.type === 'text' || (!m.type && m.text)) { const b = m.text && m.text.body; if (typeof b === 'string' && b) return b; }
  if (m.type === 'image' && m.image) return '[صورة]' + (m.image.caption ? ' ' + m.image.caption : '');
  if (m.type === 'document' && m.document) return '[مستند]' + (m.document.filename ? ' ' + m.document.filename : '') + (m.document.caption ? ' ' + m.document.caption : '');
  return null;
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
    return { duplicate: false };
  };
}

// Scheduled hook: does nothing unless NOVA_WA_INTAKE=1 and a DB is bound.
export async function scheduledWaProcess(env, opts = {}) {
  if (!waIntakeEnabled(env) || !env.DB) return null;
  return processQueue(env.DB, makeProcessor(env.DB, env, opts.clock), opts);
}
