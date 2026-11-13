// Local simulated load (no network): drives the Worker `handle` in-process over node:sqlite-emulated D1.
// Usage: node tools/backend/load-sim.mjs [requests=200] [batch=20]
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { createUser, login, sha256Hex } from '../../backend/src/auth/auth.js';

export function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}
export function summarize(ms, errors = 0) {
  const s = [...ms].sort((a, b) => a - b);
  return { count: s.length, errors, p50: percentile(s, 50), p95: percentile(s, 95), max: s[s.length - 1] || 0 };
}

export async function makeEmulatedEnv() {
  const db = new DatabaseSync(':memory:');
  await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
  const DB = { prepare: (sql) => ({ bind: (...a) => ({
    async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; },
    async first() { return db.prepare(sql).get(...a) || null; },
    async all() { return { results: db.prepare(sql).all(...a) }; } }) }) };
  const m = new Map();
  const KV = { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
  const env = { NOVA_AUTH: '1', NOVA_SYNC: '1', DB, KV, NOVA_API_PIN: 'pin-load-1' };
  await createUser(KV, { username: 'owner', password: 'pw-owner-12345', role: 'owner' });
  const lg = await login(env, { username: 'owner', password: 'pw-owner-12345' });
  const o = lg.ok || lg;
  // Tenant-scoped session for pull + a seeded change_feed page.
  const pullToken = 'p'.repeat(40);
  const now = Math.floor(Date.now() / 1000);
  await KV.put('sess:' + (await sha256Hex(pullToken)), JSON.stringify({ user: 'u1', role: 'staff', expires: now + 3600, refreshExpires: now + 3600, reauthAt: now,
    tenantId: 't1', roles: ['Cashier'], tenantBranchIds: ['b1'], assignedBranchIds: ['b1'], activeBranchId: 'b1' }));
  const ins = db.prepare('INSERT INTO change_feed (tenant_id,branch_id,entity,entity_id,deleted,payload_json) VALUES (?,?,?,?,?,?)');
  for (let i = 0; i < 100; i++) ins.run('t1', 'b1', 'product', 'p' + i, 0, '{"price":1}');
  return { env, db, token: o.access_token || o.accessToken || o.token, pullToken };
}

async function timed(fn, ms, state) {
  const t = performance.now();
  const r = await fn();
  ms.push(performance.now() - t);
  if (r.status !== 200) state.errors++;
  await r.arrayBuffer();
}

// Returns { push, pull } latency summaries (ms per request).
export async function runLoad({ requests = 200, batch = 20 } = {}) {
  const { env, token, pullToken } = await makeEmulatedEnv();
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const pushMs = [], pullMs = [], pe = { errors: 0 }, le = { errors: 0 };
  for (let i = 0; i < requests; i++) {
    const ops = Array.from({ length: batch }, (_, j) => {
      const id = `inv-${i}-${j}`;
      return { key: id, payload: { id, total: 5, lines: [{ code: 'A', qty: 1, price: 5 }] } };
    });
    await timed(() => handle(new Request('https://x.test/api/v1/sync/push', { method: 'POST', headers: H, body: JSON.stringify({ ops }) }), env), pushMs, pe);
    await timed(() => handle(new Request('https://x.test/api/v1/sync/pull', { headers: { Authorization: 'Bearer ' + pullToken } }), env), pullMs, le);
  }
  return { push: summarize(pushMs, pe.errors), pull: summarize(pullMs, le.errors) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const res = await runLoad({ requests: Number(process.argv[2]) || 200, batch: Number(process.argv[3]) || 20 });
  console.log(JSON.stringify(res, null, 2));
}
