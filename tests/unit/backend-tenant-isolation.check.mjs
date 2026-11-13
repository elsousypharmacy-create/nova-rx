import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as T from '../../backend/src/security/tenant.js';

assert.equal(T.isolationEnabled(undefined), false);
assert.equal(T.isolationEnabled({}), false);
assert.equal(T.isolationEnabled({ NOVA_TENANT_ISOLATION: '0' }), false);
assert.equal(T.isolationEnabled({ NOVA_TENANT_ISOLATION: '1' }), true);
assert.ok(!/NOVA_TENANT_ISOLATION\s*=\s*"?1/.test(readFileSync(new URL('../../backend/wrangler.toml', import.meta.url), 'utf8')), 'flag off in wrangler');

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../../backend/migrations/0001_identity.sql', import.meta.url), 'utf8'));
db.exec(readFileSync(new URL('../../backend/migrations/0002_catalog_inventory.sql', import.meta.url), 'utf8'));
for (const t of ['t1', 't2']) db.prepare('INSERT INTO tenants(id,name) VALUES(?,?)').run(t, t);
for (const [b, t] of [['b1', 't1'], ['b2', 't1'], ['c1', 't2']]) db.prepare('INSERT INTO branches(id,tenant_id,name) VALUES(?,?,?)').run(b, t, b);
const ins = db.prepare('INSERT INTO products(id,tenant_id,branch_id,sku,name_ar,price_minor) VALUES(?,?,?,?,?,?)');
ins.run('p1', 't1', 'b1', 'S1', 'دواء أ', 100); ins.run('p2', 't1', 'b2', 'S2', 'دواء ب', 200); ins.run('p3', 't2', 'c1', 'S3', 'سري', 300);

const execute = async (sql, params, kind) => {
  const st = db.prepare(sql);
  return kind === 'read' ? st.all(...params) : { changes: Number(st.run(...params).changes) };
};
const schema = { products: { columns: ['id', 'sku', 'name_ar', 'price_minor'] } };
const session = { actorId: 'u1', tenantId: 't1', roles: ['Pharmacist'], tenantBranchIds: ['b1', 'b2'], assignedBranchIds: ['b1'], activeBranchId: 'b1' };
const req = (o = {}) => ({ headers: {}, query: {}, params: {}, body: {}, ...o });

const s = T.scopeFromSession(session, req(), 'req_1');
assert.ok(s.ok); assert.equal(s.tenantId, 't1'); assert.equal(s.branchId, 'b1');
const repo = T.scopedDb(s.ctx, execute, schema);

// read: only own tenant+branch
let r = await repo.select('products'); assert.deepEqual(r.rows.map(x => x.id), ['p1']);
r = await repo.getById('products', 'p3'); assert.equal(r.ok, false); assert.equal(r.error, 'not-found');
r = await repo.select('products', { tenant_id: 't2' }); assert.equal(r.ok, false);
// write: cross-tenant update/delete change nothing; insert is forced into own scope
r = await repo.update('products', { id: 'p3' }, { name_ar: 'x' }); assert.equal(r.changes, 0);
r = await repo.delete('products', { id: 'p3' }); assert.equal(r.changes, 0);
r = await repo.insert('products', { id: 'p9', sku: 'S9', name_ar: 'ج', price_minor: 1, tenant_id: 't2' }); assert.equal(r.ok, false);
r = await repo.insert('products', { id: 'p9', sku: 'S9', name_ar: 'ج', price_minor: 1 }); assert.ok(r.ok);
assert.deepEqual({ ...db.prepare("SELECT tenant_id,branch_id FROM products WHERE id='p9'").get() }, { tenant_id: 't1', branch_id: 'b1' });
assert.equal(db.prepare("SELECT name_ar FROM products WHERE id='p3'").get().name_ar, 'سري');
// SQL injection attempt via value stays a parameter
r = await repo.select('products', { sku: "x' OR '1'='1" }); assert.equal(r.rows.length, 0);

// export: no foreign rows, no leak of secret text
const ex = await T.scopedExport(repo, 'products');
assert.ok(ex.ok); assert.ok(!JSON.stringify(ex).includes('سري')); assert.ok(ex.rows.every(x => x.id !== 'p3'));

// client-named scope must match the session
for (const bad of [req({ headers: { 'X-Tenant-Id': 't2' } }), req({ query: { tenantId: 't2' } }), req({ body: { nested: { tenant_id: 't2' } } })]) {
  const e = T.scopeFromSession(session, bad, 'req_2');
  assert.equal(e.ok, false); assert.equal(e.status, 403); assert.equal(e.code, 'TENANT_MISMATCH');
  assert.equal(e.requestId, 'req_2'); assert.ok(/[؀-ۿ]/.test(e.message_ar));
}
for (const b of ['b2', 'c1']) {
  const e = T.scopeFromSession(session, req({ query: { branchId: b } }), 'req_3');
  assert.equal(e.code, 'BRANCH_FORBIDDEN'); assert.equal(e.status, 403);
}
// invalid session / client-supplied wide flag
assert.equal(T.scopeFromSession({ ...session, isTenantWide: true }, req(), 'r').code, 'SCOPE_INVALID');
assert.equal(T.scopeFromSession(null, req(), 'r').status, 401);
// activeBranch of another tenant is rejected at the session level
assert.equal(T.scopeFromSession({ ...session, activeBranchId: 'c1' }, req(), 'r').ok, false);

// files
const f = T.scopedFileKey(s.ctx, 'report.csv'); assert.ok(f.ok); assert.ok(T.ownsFileKey(s.ctx, f.key));
const other = T.scopeFromSession({ ...session, tenantId: 't2', tenantBranchIds: ['c1'], assignedBranchIds: ['c1'], activeBranchId: 'c1' }, req(), 'r');
assert.equal(T.ownsFileKey(other.ctx, f.key), false);
for (const n of ['../t2/x', 'a/b', '..', '']) assert.equal(T.scopedFileKey(s.ctx, n).ok, false);
console.log('backend-tenant-isolation OK');
