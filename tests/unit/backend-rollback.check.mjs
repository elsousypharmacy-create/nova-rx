import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { deploysEnabled, previousGood } from '../../backend/src/deploys.js';
import { handle } from '../../backend/src/index.js';
import { sha256Hex } from '../../backend/src/auth/auth.js';
import { computePreviousGood } from '../../tools/backend/previous-good-version.mjs';
import { lintMigrations, loadDir } from '../../tools/backend/check-migrations.mjs';

assert.deepEqual(lintMigrations(loadDir(new URL('../../backend/migrations/', import.meta.url))), []);
assert.equal(deploysEnabled({}), false);

const L = { version: '0.3.0', sha: 'c', env: 'staging' };
assert.equal(computePreviousGood({ live: L, history: [{ version: '0.1.0', sha: 'a', env: 'staging' }, { version: '0.2.0', sha: 'b', env: 'staging' }, L] }).sha, 'b');
assert.equal(computePreviousGood({ live: L, history: [{ version: '0.1.0', sha: 'a', env: 'staging' }, { version: '0.2.0', sha: 'b', env: 'staging', bad: true }, L] }).sha, 'a');
assert.equal(computePreviousGood({ live: L, history: [{ version: '0.2.0', sha: 'b', env: 'prod' }, L] }), null);
assert.equal(computePreviousGood({ live: L, history: [L] }), null);
assert.equal(computePreviousGood({}), null);

const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const ins = db.prepare('INSERT INTO deploy_records (version,sha,env,status) VALUES (?,?,?,?)');
ins.run('0.1.0', 'a', 'staging', 'superseded'); ins.run('0.2.0', 'b', 'staging', 'failed'); ins.run('0.3.0', 'c', 'staging', 'live'); ins.run('9.0.0', 'z', 'prod', 'live');
const D1 = { prepare: (sql) => ({ bind: (...a) => ({ async all() { return { results: db.prepare(sql).all(...a) }; } }) }) };
const kvm = new Map();
const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const now = () => Math.floor(Date.now() / 1000);
const T = 'd'.repeat(40);
await KV.put('sess:' + (await sha256Hex(T)), JSON.stringify({ user: 'u1', role: 'staff', expires: now() + 600, refreshExpires: now() + 600, reauthAt: now() }));
const get = (qs, tok, e) => handle(new Request('https://x.test/api/v1/deploys' + qs, { headers: tok ? { Authorization: 'Bearer ' + tok } : {} }), e);
const env = { NOVA_DEPLOYS: '1', NOVA_ENV: 'staging', DB: D1, KV };

let r = await get('', T, { DB: D1, KV });
assert.equal(r.status, 404); assert.equal((await r.json()).code, 'DEPLOYS_DISABLED');
assert.equal((await get('', null, env)).status, 401);
r = await get('', T, env); let j = await r.json();
assert.equal(r.status, 200); assert.equal(j.deploys.length, 3); assert.equal(j.previousGood.sha, 'a'); assert.ok(j.requestId);
j = await (await get('?env=prod', T, env)).json();
assert.equal(j.deploys.length, 1); assert.equal(j.previousGood, null);
r = await get('?limit=x', T, env); assert.equal(r.status, 400); assert.equal((await r.json()).code, 'DEPLOYS_BAD_LIMIT');
assert.equal(previousGood([]), null);
console.log('backend-rollback OK');
