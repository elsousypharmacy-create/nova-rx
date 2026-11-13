// Migration runner. Works with D1 (prepare/exec/batch) or node:sqlite (DatabaseSync) handles.
// Migrations: [{ version: 1, name: '0001_identity', sql: '...' }]. Additive only.
const FILE_RE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export function parseMigrationFile(file, sql) {
  const m = FILE_RE.exec(file);
  if (!m) throw new Error('bad migration file name: ' + file);
  return { version: Number(m[1]), name: file.replace(/\.sql$/, ''), sql };
}

export async function loadMigrationsFromDir(dir) {
  const { readdirSync, readFileSync } = await import('node:fs');
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => parseMigrationFile(f, readFileSync(`${dir}/${f}`, 'utf8')));
}

export async function applyMigrations(db, migrations) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  const rows = await db.prepare('SELECT version FROM schema_migrations').all();
  const done = new Set((rows.results || rows).map((r) => r.version));
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  const seen = new Set();
  for (const m of sorted) {
    if (seen.has(m.version)) throw new Error('duplicate migration version ' + m.version);
    seen.add(m.version);
  }
  const applied = [];
  for (const m of sorted) {
    if (done.has(m.version)) continue;
    await db.exec(m.sql);
    await db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
    applied.push(m.version);
  }
  return applied;
}
