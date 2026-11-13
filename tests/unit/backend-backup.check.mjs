import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { backupEnabled, runBackup, pruneBackups, scheduledBackup, sha256Text } from '../../backend/src/backup.js';
import worker from '../../backend/src/index.js';

const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
db.prepare('INSERT INTO tenants (id,name) VALUES (?,?)').run('t1', 'T1');
db.prepare('INSERT INTO tenants (id,name) VALUES (?,?)').run('t2', 'T2');
const D1 = { prepare: (sql) => ({ bind: (...a) => ({ async all() { return { results: db.prepare(sql).all(...a) }; } }) }) };
function mockR2() {
  const m = new Map();
  return { m,
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { objects: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }; } };
}

// flag default OFF
assert.equal(backupEnabled({}), false);
assert.equal(backupEnabled({ NOVA_BACKUP: '0' }), false);
assert.equal(backupEnabled({ NOVA_BACKUP: '1' }), true);
let r2 = mockR2();
assert.deepEqual(await scheduledBackup({ DB: D1, R2: r2 }), { ok: false, skipped: 'disabled' });
assert.equal(r2.m.size, 0);
await worker.scheduled({}, { DB: D1, R2: r2 }, null);
assert.equal(r2.m.size, 0);

// backup + manifest
const t0 = new Date('2026-11-01T02:00:00Z');
const man = await runBackup({ DB: D1, R2: r2 }, t0);
assert.equal(man.id, '20261101T020000Z');
assert.equal(man.tables.tenants.rows, 2);
const body = r2.m.get(man.tables.tenants.key);
assert.equal(man.tables.tenants.sha256, await sha256Text(body));
assert.equal(JSON.parse(body).rows.length, 2);
assert.deepEqual(JSON.parse(r2.m.get('backups/20261101T020000Z/manifest.json')), man);
assert.ok(man.tables.sales && man.tables.change_feed);

// retention
await runBackup({ DB: D1, R2: r2 }, new Date('2026-11-12T02:00:00Z'));
const del = await pruneBackups({ R2: r2 }, new Date('2026-11-13T02:00:00Z'), 7);
assert.ok(del.length > 0 && del.every((k) => k.includes('20261101T')));
assert.ok([...r2.m.keys()].every((k) => k.includes('20261112T')));

// enabled scheduled run, and error fallback
const env = { NOVA_BACKUP: '1', DB: D1, R2: r2, BACKUP_RETENTION_DAYS: '7' };
const res = await scheduledBackup(env, new Date('2026-11-13T02:00:00Z'));
assert.equal(res.ok, true);
const bad = await scheduledBackup({ NOVA_BACKUP: '1', DB: D1, R2: { put() { throw new Error('boom'); }, list() {}, delete() {} } });
assert.equal(bad.code, 'BACKUP_FAILED');
assert.deepEqual(await scheduledBackup({ NOVA_BACKUP: '1' }), { ok: false, skipped: 'no-bindings' });
console.log('backend-backup checks passed');
