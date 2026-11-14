// UX200: read-only history backfill into the NOVA inbox store. ADDITIVE ONLY: INSERT OR IGNORE, deterministic ids
// (idempotent on re-run). No DROP/TRUNCATE/DELETE/UPDATE of existing messages. Never sends anything to anyone.
// Sources (normalised by the caller/adapter): rows exported from the pharmacy bot Google Sheets log, or the
// wa_inbound_queue table (SELECT only). NOTE: the exact bot sheet columns were not verifiable from this repo
// (pharmacy repo/Sheets unreachable in CI) - adapters below accept common column names; verify against the real sheet.
const pick = (o, keys) => { for (const k of keys) if (o && o[k] != null && String(o[k]) !== '') return o[k]; return null; };
const digits = (v) => String(v == null ? '' : v).replace(/[^\d]/g, '');

export function toMs(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return toMs(Number(s));
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

async function sha(text) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(b.slice(0, 12), (x) => x.toString(16).padStart(2, '0')).join('');
}

// Sheet-log row -> normalised message. dir: sender/direction column; outgoing = bot/pharmacy/out.
export async function normalizeSheetRow(row) {
  const chat = digits(pick(row, ['chatId', 'chat_id', 'phone', 'from', 'to', 'number', 'الرقم']));
  const text = pick(row, ['text', 'message', 'body', 'الرسالة', 'msg']);
  if (!chat || text == null) return null;
  const at = toMs(pick(row, ['at', 'timestamp', 'time', 'date', 'الوقت']));
  const dirRaw = String(pick(row, ['dir', 'direction', 'sender', 'type', 'role', 'الاتجاه']) || 'in').toLowerCase();
  const dir = /^(out|bot|pharmacy|outgoing|sent|assistant|صيدلية|بوت)/.test(dirRaw) ? 'out' : 'in';
  const sid = pick(row, ['id', 'messageId', 'message_id', 'wa_message_id']);
  const id = 'h_' + (sid ? String(sid).slice(0, 90) : await sha([chat, at, dir, text].join('|')));
  return { conv: chat, customer: pick(row, ['name', 'customer', 'الاسم']) || chat, id, dir, text: String(text).slice(0, 4000), at };
}

export async function backfillRows(db, t, rows) {
  let conversations = 0, added = 0, skipped = 0;
  for (const r of rows || []) {
    const m = r && r.conv && r.id && typeof r.text === 'string' && r.text ? r : null;
    if (!m) { skipped++; continue; }
    const cid = String(m.conv).slice(0, 80);
    const c = await db.prepare('INSERT OR IGNORE INTO inbox_conversations (tenant_id, id, customer, updated_at) VALUES (?,?,?,?)')
      .bind(t, cid, String(m.customer || cid).slice(0, 200), 0).run();
    if (c && c.meta && c.meta.changes > 0) conversations++;
    const res = await db.prepare('INSERT OR IGNORE INTO inbox_messages (tenant_id, id, conversation_id, dir, text, status, at) VALUES (?,?,?,?,?,?,?)')
      .bind(t, String(m.id).slice(0, 100), cid, m.dir === 'out' ? 'out' : 'in', m.text.slice(0, 4000), m.dir === 'out' ? 'delivered' : null, Number(m.at) || 0).run();
    if (res && res.meta && res.meta.changes === 0) { skipped++; continue; }
    added++;
    // monotonic bump only (never lowers updated_at)
    await db.prepare('UPDATE inbox_conversations SET updated_at = ? WHERE tenant_id = ? AND id = ? AND updated_at < ?').bind(Number(m.at) || 0, t, cid, Number(m.at) || 0).run();
  }
  return { conversations, added, skipped };
}

export async function backfillSheetRows(db, t, rawRows) {
  const rows = [];
  for (const r of rawRows || []) rows.push(await normalizeSheetRow(r));
  return backfillRows(db, t, rows.filter(Boolean));
}

// wa_inbound_queue (SELECT only): Meta payload {message:{id,from,timestamp,text:{body}}}. Inbound only.
export async function backfillFromQueue(db, t, { limit = 5000 } = {}) {
  const { results } = await db.prepare('SELECT wa_message_id, payload_json, received_at FROM wa_inbound_queue ORDER BY id LIMIT ?').bind(limit).all();
  const rows = [];
  for (const q of results || []) {
    let p; try { p = JSON.parse(q.payload_json); } catch { continue; }
    const m = p && p.message; const body = m && m.text && m.text.body;
    if (!m || !body || !m.from) continue;
    rows.push({ conv: digits(m.from), customer: digits(m.from), id: 'h_' + q.wa_message_id, dir: 'in', text: String(body), at: toMs(m.timestamp) || toMs(q.received_at) });
  }
  return backfillRows(db, t, rows);
}
