import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';

const dir = fileURLToPath(new URL('../../backend/migrations', import.meta.url));
const migs = await loadMigrationsFromDir(dir);
assert.ok(migs.length >= 1 && migs[0].version === 1);
assert.ok(!/\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i.test(migs.map((m) => m.sql).join('\n')), 'additive only');

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
const first = await applyMigrations(db, migs);
assert.deepEqual(first, migs.map((m) => m.version));
const snap = () => JSON.stringify([db.prepare('SELECT * FROM schema_migrations').all(), db.prepare("SELECT name FROM sqlite_master ORDER BY name").all()]);
const before = snap();
assert.deepEqual(await applyMigrations(db, migs), []);
assert.equal(snap(), before, 'second apply changes nothing');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
for (const t of ['tenants', 'branches', 'users', 'roles', 'user_roles', 'sessions', 'devices', 'schema_migrations']) assert.ok(tables.includes(t), t);
const sessCols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
assert.ok(sessCols.includes('token_hash') && !sessCols.includes('token'));

db.exec("INSERT INTO tenants (id,name) VALUES ('t1','T')");
assert.throws(() => db.exec("INSERT INTO tenants (id,name) VALUES ('t1','dup')"), /UNIQUE|constraint/i);
assert.throws(() => db.exec("INSERT INTO users (id,tenant_id,username) VALUES ('u0','nope','a')"), /FOREIGN KEY/i);
db.exec("INSERT INTO users (id,tenant_id,username) VALUES ('u1','t1','a')");
assert.throws(() => db.exec("INSERT INTO users (id,tenant_id,username) VALUES ('u2','t1','a')"), /UNIQUE/i);
db.exec("INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES ('s1','u1','h','2030-01-01')");
assert.throws(() => db.exec("INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES ('s2','u1','h','2030-01-01')"), /UNIQUE/i);
assert.throws(() => db.exec("INSERT INTO user_roles (user_id,role_id) VALUES ('u1','nope')"), /FOREIGN KEY/i);

// feature flag default OFF: worker source must not gate on a flag defaulting on
const wt = readFileSync(new URL('../../backend/wrangler.toml', import.meta.url), 'utf8');
assert.ok(!/BACKEND_ENABLED\s*=\s*"?(1|true|on)/i.test(wt), 'backend flag defaults OFF');
console.log('backend-migrations OK');
