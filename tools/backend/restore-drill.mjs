// N107 restore drill: restore a snapshot into a NEW, empty database only (never in place),
// verify per-table row counts + sha256 checksums, and report. Local node:sqlite only, no network.
// CLI: node tools/backend/restore-drill.mjs <snapshot.json> [--target <new-db-path>]   (default target: in-memory)
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';

export const SNAPSHOT_FORMAT = 'nova-snapshot-v1';
const q = (n) => '"' + String(n).replace(/"/g, '""') + '"';
const userTables = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);

export function checksumRows(columns, rows) {
  const lines = rows.map((r) => JSON.stringify(columns.map((c) => (r[c] === undefined ? null : r[c])))).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

export function createSnapshot(db) {
  const tables = {};
  for (const name of userTables(db)) {
    const columns = db.prepare(`PRAGMA table_info(${q(name)})`).all().map((c) => c.name);
    const rows = db.prepare(`SELECT * FROM ${q(name)}`).all().map((r) => ({ ...r }));
    tables[name] = { columns, count: rows.length, sha256: checksumRows(columns, rows), rows };
  }
  return { format: SNAPSHOT_FORMAT, tables };
}

export class RestoreError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// target must be a fresh, empty DatabaseSync. Throws RestoreError (stable code) otherwise.
export async function restoreDrill(snapshot, target, { migrations } = {}) {
  if (!snapshot || snapshot.format !== SNAPSHOT_FORMAT || typeof snapshot.tables !== 'object') {
    throw new RestoreError('SNAPSHOT_INVALID', 'invalid snapshot format');
  }
  if (userTables(target).length) throw new RestoreError('TARGET_NOT_EMPTY', 'restore refused: target database is not new/empty (in-place restore is forbidden)');
  migrations = migrations || await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url)));
  await applyMigrations(target, migrations);
  const report = { ok: true, tables: [], problems: [] };
  target.exec('PRAGMA foreign_keys = OFF');
  try {
    target.exec('BEGIN');
    for (const [name, t] of Object.entries(snapshot.tables)) {
      if (name === 'schema_migrations') continue; // owned by the fresh target's migrator
      if (!userTables(target).includes(name)) { report.problems.push(`${name}: table missing in target schema`); continue; }
      const cols = t.columns;
      const ins = target.prepare(`INSERT INTO ${q(name)} (${cols.map(q).join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      for (const r of t.rows) ins.run(...cols.map((c) => (r[c] === undefined ? null : r[c])));
    }
    target.exec('COMMIT');
  } catch (e) {
    try { target.exec('ROLLBACK'); } catch {}
    throw new RestoreError('RESTORE_FAILED', 'restore failed: ' + e.message);
  } finally { target.exec('PRAGMA foreign_keys = ON'); }
  for (const [name, t] of Object.entries(snapshot.tables)) {
    if (name === 'schema_migrations' || !userTables(target).includes(name)) continue;
    const rows = target.prepare(`SELECT * FROM ${q(name)}`).all();
    const sha = checksumRows(t.columns, rows);
    const entry = { table: name, expectedCount: t.count, actualCount: rows.length, expectedSha256: t.sha256, actualSha256: sha, ok: rows.length === t.count && sha === t.sha256 };
    if (!entry.ok) report.problems.push(`${name}: count/checksum mismatch`);
    report.tables.push(entry);
  }
  const fk = target.prepare('PRAGMA foreign_key_check').all();
  if (fk.length) report.problems.push(`foreign_key_check: ${fk.length} violation(s)`);
  report.ok = report.problems.length === 0;
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const ti = args.indexOf('--target');
  const target = ti >= 0 ? args[ti + 1] : ':memory:';
  const file = args.find((a, i) => !a.startsWith('--') && i !== ti + 1);
  if (!file) { console.error('usage: restore-drill.mjs <snapshot.json> [--target <new-db-path>]'); process.exit(2); }
  if (target !== ':memory:' && existsSync(target)) { console.error('TARGET_EXISTS: target path already exists; restore only into a NEW database'); process.exit(2); }
  try {
    const report = await restoreDrill(JSON.parse(readFileSync(file, 'utf8')), new DatabaseSync(target));
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  } catch (e) { console.error(`${e.code || 'ERROR'}: ${e.message}`); process.exit(2); }
}
