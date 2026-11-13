import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { createSnapshot, restoreDrill, RestoreError } from '../../tools/backend/restore-drill.mjs';

const migs = await loadMigrationsFromDir(new URL('../../backend/migrations', import.meta.url).pathname);
const src = new DatabaseSync(':memory:');
src.exec('PRAGMA foreign_keys = ON');
await applyMigrations(src, migs);
src.exec("INSERT INTO tenants (id,name) VALUES ('t1','صيدلية'),('t2','B')");
src.exec("INSERT INTO users (id,tenant_id,username) VALUES ('u1','t1','a'),('u2','t2','b')");
const snap = createSnapshot(src);
const wire = JSON.parse(JSON.stringify(snap));

// happy path into a new db
const fresh = new DatabaseSync(':memory:');
const rep = await restoreDrill(wire, fresh);
assert.equal(rep.ok, true, JSON.stringify(rep.problems));
const t = rep.tables.find((x) => x.table === 'tenants');
assert.equal(t.actualCount, 2); assert.equal(t.actualSha256, t.expectedSha256);
assert.equal(fresh.prepare("SELECT name FROM tenants WHERE id='t1'").get().name, 'صيدلية');

// in-place restore refused: target already holds data/schema; source untouched
await assert.rejects(() => restoreDrill(wire, src), (e) => e instanceof RestoreError && e.code === 'TARGET_NOT_EMPTY');
assert.equal(src.prepare('SELECT COUNT(*) c FROM tenants').get().c, 2);

// tampered snapshot: checksum mismatch detected
const bad = JSON.parse(JSON.stringify(wire));
bad.tables.tenants.rows[0].name = 'tampered';
const rep2 = await restoreDrill(bad, new DatabaseSync(':memory:'));
assert.equal(rep2.ok, false);
assert.ok(rep2.problems.some((p) => p.startsWith('tenants')));

// dropped row: count mismatch detected
const bad2 = JSON.parse(JSON.stringify(wire));
bad2.tables.users.count = 5;
assert.equal((await restoreDrill(bad2, new DatabaseSync(':memory:'))).ok, false);

// orphan FK rows are reported
const bad3 = JSON.parse(JSON.stringify(wire));
bad3.tables.users.rows.push({ ...bad3.tables.users.rows[0], id: 'u9', username: 'z', tenant_id: 'nope' });
bad3.tables.users.count = 3;
const r3 = await restoreDrill(bad3, new DatabaseSync(':memory:'));
assert.equal(r3.ok, false);

// invalid snapshot
await assert.rejects(() => restoreDrill({}, new DatabaseSync(':memory:')), (e) => e.code === 'SNAPSHOT_INVALID');

// flag default OFF + no network in tool
const wt = readFileSync(new URL('../../backend/wrangler.toml', import.meta.url), 'utf8');
assert.ok(!/BACKEND_ENABLED\s*=\s*"?(1|true|on)/i.test(wt), 'backend flag defaults OFF');
assert.ok(!/fetch\(|https?:\/\//.test(readFileSync(new URL('../../tools/backend/restore-drill.mjs', import.meta.url), 'utf8')), 'no network');
console.log('backend-restore-drill OK');
