import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { camerasEnabled } from '../../backend/src/cameras.js';
import { handle } from '../../backend/src/index.js';
import { sha256Hex } from '../../backend/src/auth/auth.js';

const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async first() { return db.prepare(sql).get(...a) ?? null; },
  async run() { db.prepare(sql).run(...a); return { success: true }; },
}) }) };
const kvm = new Map();
const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const now = () => Math.floor(Date.now() / 1000);
async function session(token, extra) {
  await KV.put('sess:' + (await sha256Hex(token)), JSON.stringify({ user: 'u1', role: 'staff', expires: now() + 600, refreshExpires: now() + 600, reauthAt: now(), ...extra }));
}
const TO = 'a'.repeat(40), TC = 'c'.repeat(40), T2 = 'b'.repeat(40);
const br = { tenantBranchIds: ['b1'], assignedBranchIds: ['b1'], activeBranchId: 'b1' };
await session(TO, { tenantId: 't1', role: 'owner', roles: ['Owner'], ...br });
await session(TC, { tenantId: 't1', role: 'cashier', roles: ['Cashier'], ...br });
await session(T2, { tenantId: 't2', role: 'owner', roles: ['Owner'], tenantBranchIds: ['b9'], assignedBranchIds: ['b9'], activeBranchId: 'b9' });
const env = { NOVA_CAMERAS: '1', DB: D1, KV };
const call = async (path, tok = TO, e = env, method = 'GET') => {
  const r = await handle(new Request('https://x.test/api/v1/cameras/' + path, { method, headers: tok ? { Authorization: 'Bearer ' + tok } : {} }), e);
  return [r.status, await r.json()];
};
const ins = (t, id, cam, d, ev) => db.prepare('INSERT INTO camera_reports (tenant_id,id,camera_id,report_date,title,summary,evidence_count,created_at) VALUES (?,?,?,?,?,?,?,1)').run(t, id, cam, d, 'تقرير', 'ملخص', ev);
ins('t1', 'r1', 'c1', '2026-11-01', 2); ins('t1', 'r2', 'c2', '2026-11-02', 0); ins('t1', 'r3', 'c1', '2026-11-02', 3); ins('t2', 'x1', 'c1', '2026-11-01', 9);
db.prepare("INSERT INTO camera_source_status (tenant_id,source_id,state,last_report_at,updated_at) VALUES ('t1','hik','online',5,6),('t2','other','offline',1,1)").run();

// flag default OFF
assert.equal(camerasEnabled({}), false);
let [s, j] = await call('reports', TO, { DB: D1, KV });
assert.equal(s, 404); assert.equal(j.code, 'CAMERAS_DISABLED'); assert.match(j.requestId, /^req_/);
[s] = await call('reports', null); assert.equal(s, 401);
// special permission
[s, j] = await call('reports', TC); assert.equal(s, 403); assert.equal(j.code, 'CAMERAS_FORBIDDEN');
// reports + tenant isolation
[s, j] = await call('reports'); assert.equal(s, 200); assert.deepEqual(j.reports.map((r) => r.id), ['r2', 'r3', 'r1']);
[s, j] = await call('reports?from=2026-11-02&cameraId=c1'); assert.deepEqual(j.reports.map((r) => r.id), ['r3']);
[s, j] = await call('reports?from=bad'); assert.equal(s, 400); assert.equal(j.code, 'CAMERAS_BAD_REQUEST');
[s, j] = await call('status'); assert.deepEqual(j.sources.map((x) => x.sourceId), ['hik']); assert.equal(j.sources[0].state, 'online');
// coverage: raw counts only, no score, no analysis calls
[s, j] = await call('coverage');
assert.deepEqual(j.coverage, { reports: 3, reportsWithEvidence: 2, reportsWithoutEvidence: 1, evidenceItems: 5, days: 2, firstDate: '2026-11-01', lastDate: '2026-11-02' });
assert.equal(j.analysis.calls, 0);
assert.ok(!/score|quality|percent/i.test(JSON.stringify(j).replace(/qualityless/, '')));
[s, j] = await call('reports', T2); assert.deepEqual(j.reports.map((r) => r.id), ['x1']);
// read-only: no write routes
[s] = await call('reports', TO, env, 'POST'); assert.notEqual(s, 200);
assert.equal(db.prepare('SELECT COUNT(*) c FROM camera_reports').get().c, 4);
console.log('backend-cameras: OK');
