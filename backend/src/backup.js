// N106: R2 snapshot adapter (JSON snapshot + manifest). Flag NOVA_BACKUP, default OFF. R2 is NOT provisioned (no card);
// without an R2 binding this is a no-op. Operational backups: D1 Time Travel + scripts/d1-backup.sh (docs/ops/backup-restore.md).
export const BACKUP_PREFIX = 'backups/';
const PAGE = 500;
const DEFAULT_RETENTION_DAYS = 14;

export function backupEnabled(env) { return !!env && String(env.NOVA_BACKUP) === '1'; }

export function retentionDays(env) {
  const n = Number(env && env.BACKUP_RETENTION_DAYS);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : DEFAULT_RETENTION_DAYS;
}

export async function sha256Text(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
}

export function stamp(date) { return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); }

export function stampToMs(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

async function listTables(db) {
  const r = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name").bind().all();
  return (r.results || []).map((x) => x.name).filter((n) => /^[A-Za-z0-9_]+$/.test(n));
}

async function readAll(db, table) {
  const rows = [];
  for (let off = 0; ; off += PAGE) {
    const r = await db.prepare(`SELECT * FROM "${table}" ORDER BY rowid LIMIT ? OFFSET ?`).bind(PAGE, off).all();
    const part = r.results || [];
    rows.push(...part);
    if (part.length < PAGE) break;
  }
  return rows;
}

export async function runBackup(env, now = new Date()) {
  const id = stamp(now);
  const base = `${BACKUP_PREFIX}${id}/`;
  const tables = {};
  for (const t of await listTables(env.DB)) {
    const rows = await readAll(env.DB, t);
    const body = JSON.stringify({ table: t, rows });
    await env.R2.put(`${base}${t}.json`, body, { httpMetadata: { contentType: 'application/json' } });
    tables[t] = { key: `${base}${t}.json`, rows: rows.length, bytes: body.length, sha256: await sha256Text(body) };
  }
  const manifest = { version: 1, id, createdAt: now.toISOString(), tables, totalRows: Object.values(tables).reduce((a, x) => a + x.rows, 0) };
  // manifest is written last: a backup without manifest.json is incomplete.
  await env.R2.put(`${base}manifest.json`, JSON.stringify(manifest), { httpMetadata: { contentType: 'application/json' } });
  return manifest;
}

export async function pruneBackups(env, now = new Date(), days = retentionDays(env)) {
  const cutoff = now.getTime() - days * 86400000;
  const deleted = [];
  let cursor;
  const keys = [];
  do {
    const l = await env.R2.list({ prefix: BACKUP_PREFIX, cursor });
    for (const o of l.objects || []) keys.push(o.key);
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  for (const k of keys) {
    const ms = stampToMs(k.slice(BACKUP_PREFIX.length).split('/')[0]);
    if (ms !== null && ms < cutoff) { await env.R2.delete(k); deleted.push(k); }
  }
  return deleted;
}

// Cron entry. Flag off or bindings missing: no-op. Errors never throw to the runtime.
export async function scheduledBackup(env, now = new Date()) {
  if (!backupEnabled(env)) return { ok: false, skipped: 'disabled' };
  if (!env.DB || !env.R2) return { ok: false, skipped: 'no-bindings' };
  try {
    const manifest = await runBackup(env, now);
    const pruned = await pruneBackups(env, now);
    return { ok: true, id: manifest.id, totalRows: manifest.totalRows, pruned: pruned.length };
  } catch (e) {
    return { ok: false, code: 'BACKUP_FAILED', message_ar: 'فشل النسخ الاحتياطي.', error: String(e && e.message) };
  }
}
