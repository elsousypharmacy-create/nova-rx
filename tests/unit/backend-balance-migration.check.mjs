import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { balanceMigrationEnabled, validateSample } from '../../backend/src/balance-migration.js';
import { createUser, login } from '../../backend/src/auth/auth.js';

const db = new DatabaseSync(':memory:');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const D1 = { prepare: (sql) => ({ bind: (...a) => ({
  async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; },
  async first() { return db.prepare(sql).get(...a) || null; },
  async all() { return { results: db.prepare(sql).all(...a) }; } }) }) };
const kvm = new Map();
const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const env = { NOVA_AUTH: '1', NOVA_BALANCE_MIGRATION: '1', DB: D1, KV };
const call = (e, path, body, h = {}) => handle(new Request('https://x.test/api/v1/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(body) }), e);
const T = 'default';
const snap = () => JSON.stringify(['products', 'inventory_batches', 'suppliers', 'customers'].map((t) => db.prepare(`SELECT * FROM ${t}`).all()));

// default OFF
assert.equal(balanceMigrationEnabled({ DB: D1 }), false);
assert.equal(balanceMigrationEnabled({ DB: D1, NOVA_BALANCE_MIGRATION: '0' }), false);
let r = await call({ DB: D1, KV, NOVA_AUTH: '1' }, 'balance-migration/dry-run', {});
assert.equal(r.status, 404); assert.equal((await r.json()).code, 'BALMIG_DISABLED');
assert.equal((await call(env, 'balance-migration/dry-run', {})).status, 401);

// validation
assert.ok(validateSample({ cutoff: 'bad' }).issues.some((i) => i.code === 'BALMIG_BAD_CUTOFF'));
assert.ok(validateSample({ cutoff: '2026-12-31', products: [{ sku: 'a', unit: 'u', qty: -1, cost_minor: 1 }] }).issues.some((i) => i.code === 'BALMIG_BAD_PRODUCT'));

// seed existing data
db.prepare("INSERT INTO products (id,tenant_id,branch_id,sku,name_ar,base_unit,cost_minor) VALUES ('p1',?,'b','S1','بنادول','box',500),('p2',?,'b','S2','x','box',100)").run(T, T);
db.prepare("INSERT INTO inventory_batches (id,tenant_id,branch_id,product_id,batch_no,qty_on_hand) VALUES ('b1',?,'b','p1','B',10)").run(T);
db.prepare("INSERT INTO suppliers (id,tenant_id,branch_id,name) VALUES ('s1',?,'b','مورد أ')").run(T);
db.prepare("INSERT INTO customers (id,tenant_id,branch_id,name,credit_limit_minor) VALUES ('c1',?,'b','عميل أ',1000)").run(T);
const before = snap();

await createUser(KV, { username: 'owner', password: 'pw-owner-12345', role: 'owner' });
await createUser(KV, { username: 'cash', password: 'pw-cash-123456', role: 'cashier' });
const tk = async (u, p) => { const l = await login(env, { username: u, password: p }); const x = l.ok || l; return { Authorization: 'Bearer ' + (x.access_token || x.accessToken || x.token) }; };
const H = await tk('owner', 'pw-owner-12345'), HC = await tk('cash', 'pw-cash-123456');

const sample = { cutoff: '2026-12-31',
  products: [{ sku: 'S1', name: 'بنادول', unit: 'box', qty: 12, cost_minor: 500 }, { sku: 'S2', unit: 'strip', qty: 0, cost_minor: 100 }, { sku: 'NEW', unit: 'box', qty: 3, cost_minor: 50 }],
  suppliers: [{ name: 'مورد أ', balance_minor: 7000 }, { name: 'مورد ب', balance_minor: 100 }],
  customers: [{ name: 'عميل أ', credit_minor: 2500 }, { name: 'عميل ب', credit_minor: 5 }] };

assert.equal((await call(env, 'balance-migration/dry-run', sample, HC)).status, 403);
r = await call(env, 'balance-migration/dry-run', sample, H);
assert.equal(r.status, 200);
const j = await r.json();
assert.equal(j.written, 0); assert.match(j.requestId, /^req_/);
assert.equal(j.report.items.matched, 2);
assert.deepEqual(j.report.items.unmatched, ['NEW']);
assert.equal(j.report.items.unit_mismatch[0].sku, 'S2');
assert.deepEqual(j.report.items.stock_diff[0], { sku: 'S1', current: 10, opening: 12, delta: 2 });
assert.deepEqual(j.report.suppliers.unmatched, ['مورد ب']);
assert.equal(j.report.suppliers.total_balance_minor, 7100);
assert.equal(j.report.customers.over_credit_limit[0].name, 'عميل أ');
assert.ok(j.report.totals.differences > 0);
assert.match(j.rollbackPlan, /Time Travel/);
assert.equal(snap(), before, 'dry-run never writes');
assert.equal(db.prepare('SELECT count(*) c FROM balance_migration_approvals').get().c, 0);

// approval: confirm + hash required; owner; never touches balances
assert.equal((await call(env, 'balance-migration/approve', { ...sample, confirm: 'APPROVE', reportHash: j.reportHash }, HC)).status, 403);
r = await call(env, 'balance-migration/approve', { ...sample, reportHash: j.reportHash }, H);
assert.equal(r.status, 400); assert.equal((await r.json()).code, 'BALMIG_CONFIRM_REQUIRED');
r = await call(env, 'balance-migration/approve', { ...sample, confirm: 'APPROVE', reportHash: 'nope' }, H);
assert.equal(r.status, 409); assert.equal((await r.json()).code, 'BALMIG_REPORT_STALE');
r = await call(env, 'balance-migration/approve', { ...sample, cutoff: 'bad', confirm: 'APPROVE', reportHash: j.reportHash }, H);
assert.equal(r.status, 422);
assert.equal(db.prepare('SELECT count(*) c FROM balance_migration_approvals').get().c, 0);
r = await call(env, 'balance-migration/approve', { ...sample, confirm: 'APPROVE', reportHash: j.reportHash }, H);
assert.equal(r.status, 200);
const a = await r.json();
assert.equal(a.applied, 0); assert.match(a.approvalId, /^bma_/);
const row = db.prepare('SELECT * FROM balance_migration_approvals').get();
assert.equal(row.cutoff_at, '2026-12-31'); assert.equal(row.report_hash, j.reportHash); assert.ok(row.rollback_plan);
assert.equal(snap(), before, 'approval never overwrites balances');
console.log('backend-balance-migration OK');
