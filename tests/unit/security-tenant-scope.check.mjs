import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createIsolationContext, checkRequestScope, createScopedRepository, validateTransfer, scopedKey, looksTenantScoped } from '../../worker/security/tenant-scope.js';

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };
console.log('security tenant-scope checks (SEC-03)');

// ---- real SQL: two tenants (A has branches a1,a2; B has b1) --------------------------------------------------------
const db = new DatabaseSync(':memory:');
db.exec(`create table invoices(id text primary key, tenant_id text not null, branch_id text not null, total real, status text);
         create table branches(id text primary key, tenant_id text not null, name text);
         insert into branches values ('a1','tenant_A','East'),('a2','tenant_A','West'),('b1','tenant_B','Other');
         insert into invoices values ('inv_a1_1','tenant_A','a1',10,'OPEN'),('inv_a2_1','tenant_A','a2',20,'OPEN'),('inv_b1_1','tenant_B','b1',99,'OPEN');`);
const log = [];
const execute = (sql, params, kind) => {
  log.push({ sql, params });
  const st = db.prepare(sql);
  if (kind === 'read') return st.all(...params).map(r => ({ ...r }));
  return { changes: Number(st.run(...params).changes) };
};
const schema = {
  invoices: { columns: ['id', 'total', 'status'], branchScoped: true },
  branches: { columns: ['id', 'name'], branchScoped: false },
};
const raw = sql => db.prepare(sql).all().map(r => ({ ...r }));
const claims = (over = {}) => ({ actorId: 'usr_1', tenantId: 'tenant_A', roles: ['Pharmacist'], tenantBranchIds: ['a1', 'a2'], assignedBranchIds: ['a1'], activeBranchId: 'a1', ...over });
const ctxOf = over => { const r = createIsolationContext(claims(over)); assert.equal(r.ok, true, JSON.stringify(r)); return r.context; };
const pharmacist = () => createScopedRepository(ctxOf(), execute, schema);
const owner = (branchId) => createScopedRepository(ctxOf({ roles: ['Owner'], assignedBranchIds: [], activeBranchId: null }), execute, schema, branchId ? { branchId } : {});
const bad = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.error ?? r.code, code, JSON.stringify(r)); };

await t('context: built from verified claims, frozen, isTenantWide derived from the role only', () => {
  const p = ctxOf(); assert.equal(p.tenantId, 'tenant_A'); assert.equal(p.isTenantWide, false); assert.equal(Object.isFrozen(p), true); assert.equal(Object.isFrozen(p.roles), true);
  assert.equal(ctxOf({ roles: ['Owner'], assignedBranchIds: [], activeBranchId: null }).isTenantWide, true);
  assert.equal(ctxOf({ roles: ['Pharmacist', 'Owner'] }).isTenantWide, true);
  assert.throws(() => { p.tenantId = 'tenant_B'; }, TypeError);
});

await t('context: bad claims are refused (separators in ids, unknown roles, client-supplied isTenantWide, unassigned branch)', () => {
  bad(createIsolationContext(claims({ tenantId: 'tenant:A' })), 'tenantId-invalid');
  bad(createIsolationContext(claims({ tenantId: '' })), 'tenantId-invalid');
  bad(createIsolationContext(claims({ actorId: undefined })), 'actorId-invalid');
  bad(createIsolationContext(claims({ roles: ['Auditor'] })), 'roles-invalid');
  bad(createIsolationContext(claims({ roles: [] })), 'roles-invalid');
  bad(createIsolationContext(claims({ roles: 'Owner' })), 'roles-invalid');
  bad(createIsolationContext(claims({ roles: ['Owner', '__proto__'] })), 'roles-invalid');
  bad(createIsolationContext(claims({ isTenantWide: true })), 'isTenantWide-not-allowed');
  bad(createIsolationContext(claims({ assignedBranchIds: ['a1', 'b:1'] })), 'assignedBranchIds-invalid');
  bad(createIsolationContext(claims({ assignedBranchIds: [], activeBranchId: null })), 'branch-required');
  bad(createIsolationContext(claims({ activeBranchId: 'a2' })), 'activeBranch-not-assigned');
  bad(createIsolationContext(null), 'claims-invalid');
  bad(createIsolationContext('x'), 'claims-invalid');
});

await t('context: missing fields never widen access (no branch list means no branch, not every branch)', () => {
  const noList = { actorId: 'usr_1', tenantId: 'tenant_A', roles: ['Pharmacist'], tenantBranchIds: ['a1', 'a2'] };
  bad(createIsolationContext(noList), 'branch-required');
  bad(createIsolationContext({ ...noList, activeBranchId: 'a1' }), 'activeBranch-not-assigned');
  const one = createIsolationContext({ ...noList, assignedBranchIds: ['a1'] });
  assert.equal(one.ok, true); assert.equal(one.context.activeBranchId, 'a1'); assert.equal(one.context.isTenantWide, false);
  bad(createIsolationContext({ ...noList, assignedBranchIds: ['a1', 'a2'] }), 'branch-required');
  assert.equal(createIsolationContext({ ...noList, roles: ['Cashier'], assignedBranchIds: ['a1'], activeBranchId: 'a1' }).context.isTenantWide, false);
  assert.equal(createIsolationContext({ ...noList, roles: ['Owner'] }).context.isTenantWide, true);
});

await t('request scope: client-supplied tenant or branch must match the verified context', () => {
  const ctx = ctxOf();
  const ok = checkRequestScope(ctx, { headers: { 'X-Tenant-Id': 'tenant_A', 'x-branch-id': 'a1' }, query: {}, body: {} });
  assert.equal(ok.ok, true); assert.equal(ok.branchId, 'a1');
  assert.equal(checkRequestScope(ctx, {}).branchId, 'a1', 'no scope fields: the active branch');
  const mism = checkRequestScope(ctx, { headers: { 'x-tenant-id': 'tenant_B' } });
  assert.equal(mism.ok, false); assert.equal(mism.code, 'SEC_TENANT_MISMATCH'); assert.equal(mism.status, 403);
  const br = checkRequestScope(ctx, { headers: { 'x-branch-id': 'a2' } });
  assert.equal(br.code, 'SEC_BRANCH_FORBIDDEN'); assert.equal(br.status, 403);
});

await t('request scope: injection through query, params, nested body, arrays and mixed-case names', () => {
  const ctx = ctxOf();
  for (const req of [
    { query: { tenant_id: 'tenant_B' } }, { query: { tenantId: 'tenant_B' } }, { params: { TENANT_ID: 'tenant_B' } },
    { body: { filter: { tenant_id: 'tenant_B' } } }, { body: { items: [{ tenantId: 'tenant_B' }] } },
    { body: { tenant_id: ['tenant_A', 'tenant_B'] } }, { body: { tenant_id: { $ne: 'x' } } }, { body: { 'Tenant-Id': 'tenant_B' } },
    { headers: { 'X-TENANT-ID': 'tenant_B' } },
  ]) { const r = checkRequestScope(ctx, req); assert.equal(r.ok, false, JSON.stringify(req)); assert.equal(r.code, 'SEC_TENANT_MISMATCH', JSON.stringify(req)); }
  assert.equal(checkRequestScope(ctx, { body: { branch_id: 'b1' } }).code, 'SEC_BRANCH_FORBIDDEN');
  assert.equal(checkRequestScope(ctx, { query: { branchId: ['a1', 'a2'] } }).ok, false);
  assert.equal(checkRequestScope(ctx, { body: { tenant_id: 'tenant_A', filter: { branch_id: 'a1' } } }).ok, true, 'matching values pass');
});

await t('request scope: Owner may name any branch of its own tenant, never another tenant; prototype payloads are harmless', () => {
  const ctx = ctxOf({ roles: ['Owner'], assignedBranchIds: [], activeBranchId: null });
  assert.equal(checkRequestScope(ctx, { headers: { 'x-branch-id': 'a2' } }).branchId, 'a2');
  assert.equal(checkRequestScope(ctx, {}).branchId, null);
  assert.equal(checkRequestScope(ctx, { headers: { 'x-tenant-id': 'tenant_B' } }).code, 'SEC_TENANT_MISMATCH');
  const evil = JSON.parse('{"__proto__":{"tenant_id":"tenant_B"},"constructor":{"tenantId":"tenant_B"},"a":1}');
  assert.doesNotThrow(() => checkRequestScope(ctx, { body: evil }));
  assert.equal(({}).tenant_id, undefined);
  assert.equal(checkRequestScope(ctx, { body: 'text' }).ok, true);
  assert.equal(checkRequestScope(ctx, null).ok, true);
});

await t('repository: reads return only the caller tenant and branch; another tenant looks like "not found"', async () => {
  const r = pharmacist();
  assert.deepEqual((await r.select('invoices')).rows.map(x => x.id), ['inv_a1_1']);
  assert.deepEqual((await r.getById('invoices', 'inv_a1_1')).row.id, 'inv_a1_1');
  const other = await r.getById('invoices', 'inv_b1_1'); const missing = await r.getById('invoices', 'inv_nope');
  assert.deepEqual(other, missing, 'no difference between "exists in another tenant" and "does not exist"'); bad(other, 'not-found');
  bad(await r.getById('invoices', 'inv_a2_1'), 'not-found'); // same tenant, other branch
  assert.deepEqual((await r.select('invoices', { id: 'inv_b1_1' })).rows, []);
});

await t('repository: tenant-wide Owner sees every branch of its tenant and nothing of another', async () => {
  assert.deepEqual((await owner().select('invoices')).rows.map(x => x.id).sort(), ['inv_a1_1', 'inv_a2_1']);
  assert.deepEqual((await owner('a2').select('invoices')).rows.map(x => x.id), ['inv_a2_1']);
  bad(await owner().getById('invoices', 'inv_b1_1'), 'not-found');
  assert.deepEqual((await owner().select('branches')).rows.map(x => x.id).sort(), ['a1', 'a2'], 'tenant-only table');
});

await t('repository: a non-wide user cannot be pointed at a branch it is not assigned to', () => {
  assert.throws(() => createScopedRepository(ctxOf(), execute, schema, { branchId: 'a2' }), /branch-not-allowed/);
  assert.throws(() => createScopedRepository(ctxOf(), execute, schema, { branchId: 'b1' }), /branch-not-allowed/);
  assert.doesNotThrow(() => createScopedRepository(ctxOf({ assignedBranchIds: ['a1', 'a2'] }), execute, schema, { branchId: 'a2' }));
});

await t('repository: update and delete cannot touch another tenant or branch, and the rows stay intact', async () => {
  const r = pharmacist();
  assert.equal((await r.update('invoices', { id: 'inv_b1_1' }, { status: 'PAID' })).changes, 0);
  assert.equal((await r.delete('invoices', { id: 'inv_b1_1' })).changes, 0);
  assert.equal((await r.update('invoices', { id: 'inv_a2_1' }, { status: 'PAID' })).changes, 0);
  assert.equal((await r.delete('invoices', { id: 'inv_a2_1' })).changes, 0);
  assert.deepEqual(raw("select id,status from invoices where id in ('inv_b1_1','inv_a2_1') order by id"), [{ id: 'inv_a2_1', status: 'OPEN' }, { id: 'inv_b1_1', status: 'OPEN' }]);
  assert.equal((await r.update('invoices', { id: 'inv_a1_1' }, { status: 'PAID' })).changes, 1);
  assert.equal(raw("select status from invoices where id='inv_a1_1'")[0].status, 'PAID');
  db.exec("update invoices set status='OPEN' where id='inv_a1_1'");
});

await t('repository: SQL injection through values, column names and table names is not possible', async () => {
  const r = pharmacist();
  assert.deepEqual((await r.select('invoices', { id: "x' OR '1'='1" })).rows, []);
  assert.deepEqual((await r.select('invoices', { status: "OPEN' OR tenant_id <> 'x" })).rows, []);
  bad(await r.select('invoices', { 'id OR 1=1 --': 'x' }), 'column-invalid');
  bad(await r.select('invoices', { 'status; drop table invoices': 'x' }), 'column-invalid');
  bad(await r.select('invoices; drop table invoices', {}), 'table-unknown');
  bad(await r.select('sqlite_master', {}), 'table-unknown');
  bad(await r.update('invoices', { id: 'inv_a1_1' }, { 'status = 1, total': 5 }), 'column-invalid');
  bad(await r.select('invoices', { id: { $ne: 'x' } }), 'value-invalid');
  bad(await r.select('invoices', { id: ['a', 'b'] }), 'value-invalid');
  assert.equal(raw('select count(*) c from invoices')[0].c, 3, 'nothing was dropped');
  for (const entry of log) assert.ok(!/OR '1'|drop table|\$ne/i.test(entry.sql), `values never enter the SQL text: ${entry.sql}`);
});

await t('repository: tenant_id and branch_id cannot be supplied by the caller (WITH CHECK equivalent)', async () => {
  const r = pharmacist();
  bad(await r.select('invoices', { tenant_id: 'tenant_B' }), 'scope-field-not-allowed');
  bad(await r.select('invoices', { branch_id: 'a2' }), 'scope-field-not-allowed');
  bad(await r.insert('invoices', { id: 'x1', tenant_id: 'tenant_B', total: 1 }), 'scope-field-not-allowed');
  bad(await r.insert('invoices', { id: 'x1', branch_id: 'b1', total: 1 }), 'scope-field-not-allowed');
  bad(await r.update('invoices', { id: 'inv_a1_1' }, { tenant_id: 'tenant_B' }), 'scope-field-not-allowed');
  bad(await r.update('invoices', { id: 'inv_a1_1' }, { branch_id: 'a2' }), 'scope-field-not-allowed');
  bad(await r.insert('invoices', { id: 'x1', unknown_col: 1 }), 'column-invalid');
  assert.equal(raw("select count(*) c from invoices where id='x1'")[0].c, 0);
});

await t('repository: inserts are stamped with the context tenant and branch', async () => {
  const r = pharmacist();
  assert.equal((await r.insert('invoices', { id: 'inv_new', total: 5, status: 'OPEN' })).ok, true);
  assert.deepEqual(raw("select tenant_id, branch_id from invoices where id='inv_new'"), [{ tenant_id: 'tenant_A', branch_id: 'a1' }]);
  bad(await r.insert('invoices', { id: 'inv_new', total: 6 }), 'write-failed'); // primary key violation is reported, not thrown
  bad(await owner().insert('invoices', { id: 'inv_o', total: 1 }), 'branch-required');
  assert.equal((await owner('a2').insert('invoices', { id: 'inv_o', total: 1 })).ok, true);
  assert.deepEqual(raw("select tenant_id, branch_id from invoices where id='inv_o'"), [{ tenant_id: 'tenant_A', branch_id: 'a2' }]);
  assert.equal((await r.insert('branches', { id: 'a3', name: 'New' })).ok, true, 'tenant-only table');
  assert.deepEqual(raw("select tenant_id from branches where id='a3'"), [{ tenant_id: 'tenant_A' }]);
  db.exec("delete from invoices where id in ('inv_new','inv_o'); delete from branches where id='a3';");
});

await t('repository: no mass update or delete, and no way to run raw SQL', async () => {
  const r = pharmacist();
  bad(await r.update('invoices', {}, { status: 'X' }), 'where-required');
  bad(await r.delete('invoices', {}), 'where-required');
  bad(await r.update('invoices', { id: 'inv_a1_1' }, {}), 'patch-empty');
  for (const m of ['query', 'execute', 'raw', 'sql', 'run', 'exec']) assert.equal(r[m], undefined, m);
  assert.deepEqual(Object.keys(r).sort(), ['delete', 'describe', 'getById', 'insert', 'select', 'update']);
  assert.equal(raw('select count(*) c from invoices')[0].c, 3);
});

await t('every generated statement carries the tenant predicate (lint helper)', async () => {
  log.length = 0;
  const r = pharmacist(); await r.select('invoices'); await r.getById('invoices', 'x'); await r.update('invoices', { id: 'x' }, { status: 'A' }); await r.delete('invoices', { id: 'x' }); await r.insert('invoices', { id: 'zz' });
  await owner().select('invoices'); await owner().select('branches');
  assert.ok(log.length >= 7);
  for (const e of log.filter(x => !/^insert/i.test(x.sql))) assert.ok(looksTenantScoped(e.sql), e.sql);
  for (const e of log.filter(x => /^insert/i.test(x.sql))) assert.ok(/tenant_id/.test(e.sql) && e.params.includes('tenant_A'), e.sql);
  const pharmacistReads = log.slice(0, 4); // select, getById, update, delete by the single-branch pharmacist
  for (const e of pharmacistReads) assert.ok(/branch_id = \?/.test(e.sql) && e.params.includes('a1'), `branch predicate present: ${e.sql}`);
  assert.equal(looksTenantScoped('select * from invoices'), false);
  assert.equal(looksTenantScoped("select * from invoices where tenant_id = 'x'"), false, 'literals are not parameters');
  assert.equal(looksTenantScoped('select * from invoices where tenant_id = ?'), true);
  db.exec("delete from invoices where id='zz'");
});

await t('transfer between branches: both branches must belong to the tenant, and the role must allow it', async () => {
  const ownerCtx = ctxOf({ roles: ['Owner'], assignedBranchIds: [], activeBranchId: null });
  const ownerRepo = createScopedRepository(ownerCtx, execute, schema);
  assert.equal((await validateTransfer(ownerCtx, ownerRepo, 'a1', 'a2')).ok, true);
  bad(await validateTransfer(ownerCtx, ownerRepo, 'a1', 'b1'), 'SEC_CROSS_TENANT_TRANSFER_DENIED');
  bad(await validateTransfer(ownerCtx, ownerRepo, 'b1', 'a1'), 'SEC_CROSS_TENANT_TRANSFER_DENIED');
  bad(await validateTransfer(ownerCtx, ownerRepo, 'a1', 'nope'), 'SEC_CROSS_TENANT_TRANSFER_DENIED');
  bad(await validateTransfer(ownerCtx, ownerRepo, 'a1', 'a1'), 'transfer-same-branch');
  bad(await validateTransfer(ownerCtx, ownerRepo, 'a:1', 'a2'), 'branch-invalid');
  const cashier = ctxOf({ roles: ['Cashier'] }); bad(await validateTransfer(cashier, createScopedRepository(cashier, execute, schema), 'a1', 'a2'), 'SEC_ROLE_FORBIDDEN');
  const im = ctxOf({ roles: ['InventoryManager'] }); const imRepo = createScopedRepository(im, execute, schema);
  assert.equal((await validateTransfer(im, imRepo, 'a1', 'a2')).ok, true, 'source is the assigned branch');
  bad(await validateTransfer(im, imRepo, 'a2', 'a1'), 'SEC_BRANCH_FORBIDDEN');
});

await t('cache and idempotency keys cannot collide across tenants, branches or kinds', () => {
  const a = ctxOf(); const b = ctxOf({ tenantId: 'tenant_B', tenantBranchIds: ['b1'], assignedBranchIds: ['b1'], activeBranchId: 'b1' });
  const k1 = scopedKey(a, 'idem', 'same-client-key'); const k2 = scopedKey(b, 'idem', 'same-client-key');
  assert.notEqual(k1, k2); assert.equal(k1, 't:tenant_A:b:a1:idem:same-client-key');
  assert.notEqual(scopedKey(a, 'idem', 'x'), scopedKey(a, 'cache', 'x'));
  assert.notEqual(scopedKey(a, 'idem', 'x:b:a2:idem:y'), scopedKey(ctxOf({ assignedBranchIds: ['a1', 'a2'], activeBranchId: 'a2' }), 'idem', 'y'), 'separators in the client key are encoded');
  assert.ok(scopedKey(a, 'idem', 'p:q').endsWith('p%3Aq'));
  assert.equal(scopedKey(ctxOf({ roles: ['Owner'], assignedBranchIds: [], activeBranchId: null }), 'cache', 'x'), 't:tenant_A:b:*:cache:x');
  for (const badKey of ['', null, undefined, 5, 'x'.repeat(300)]) assert.throws(() => scopedKey(a, 'idem', badKey), /key-invalid/);
  assert.throws(() => scopedKey(a, 'weird', 'x'), /kind-invalid/);
});

await t('review B1: an Owner cannot address another tenant\'s branch (the branch must belong to the verified tenant branch list)', async () => {
  const ownerClaims = { roles: ['Owner'], assignedBranchIds: [], activeBranchId: null };
  bad(createIsolationContext(claims({ ...ownerClaims, activeBranchId: 'b1' })), 'activeBranch-not-in-tenant');
  bad(createIsolationContext(claims({ ...ownerClaims, assignedBranchIds: ['b1'] })), 'assignedBranch-not-in-tenant');
  bad(createIsolationContext(claims({ roles: ['Pharmacist'], assignedBranchIds: ['b1'], activeBranchId: 'b1' })), 'assignedBranch-not-in-tenant');
  bad(createIsolationContext(claims({ tenantBranchIds: undefined })), 'tenantBranchIds-invalid');
  bad(createIsolationContext(claims({ tenantBranchIds: 'a1' })), 'tenantBranchIds-invalid');
  bad(createIsolationContext(claims({ tenantBranchIds: ['a1', 'a1'] })), 'tenantBranchIds-invalid');
  bad(createIsolationContext(claims({ tenantBranchIds: ['a:1'] })), 'tenantBranchIds-invalid');
  const ownerCtx = ctxOf(ownerClaims);
  assert.throws(() => createScopedRepository(ownerCtx, execute, schema, { branchId: 'b1' }), /branch-not-allowed/);
  assert.equal(checkRequestScope(ownerCtx, { headers: { 'x-branch-id': 'b1' } }).code, 'SEC_BRANCH_FORBIDDEN');
  assert.equal(checkRequestScope(ownerCtx, { headers: { 'x-branch-id': 'a2' } }).ok, true);
  const before = raw('select count(*) c from invoices')[0].c;
  assert.equal(raw("select count(*) c from invoices where tenant_id='tenant_A' and branch_id='b1'")[0].c, 0, 'no orphan rows pointing at tenant B');
  assert.equal(raw('select count(*) c from invoices')[0].c, before);
});

await t('review B2: the request-scope scan fails closed when nesting is too deep, instead of ignoring what is below', () => {
  const ctx = ctxOf();
  const nest = (depth, leaf) => { let o = leaf; for (let i = 0; i < depth; i++) o = { x: o }; return o; };
  for (const depth of [7, 8, 20, 50]) { const r = checkRequestScope(ctx, { body: nest(depth, { tenantId: 'tenant_B' }) }); assert.equal(r.ok, false, `depth ${depth}`); assert.equal(r.code, 'request-too-deep'); assert.equal(r.status, 400); }
  for (const depth of [1, 3, 5]) assert.equal(checkRequestScope(ctx, { body: nest(depth, { tenantId: 'tenant_B' }) }).code, 'SEC_TENANT_MISMATCH', `depth ${depth} still detected`);
  assert.equal(checkRequestScope(ctx, { body: nest(3, { tenantId: 'tenant_A' }) }).ok, true);
  const arr = nest(0, []); let deepArr = arr; for (let i = 0; i < 30; i++) deepArr = [deepArr];
  assert.equal(checkRequestScope(ctx, { query: deepArr }).code, 'request-too-deep');
  const cyc = { a: {} }; cyc.a.b = cyc; assert.equal(checkRequestScope(ctx, { body: cyc }).code, 'request-too-deep', 'a cyclic object cannot hang the scan');
});

await t('review B3: the SQL lint helper is advisory and refuses the known bypasses (OR, comments, extra statements, UNION)', () => {
  for (const sql of ["select * from items where name='x' OR tenant_id = ?", 'select * from items -- tenant_id = ?', 'select * from items /* tenant_id = ? */', 'select * from items where tenant_id = ?; delete from items', 'select * from items where tenant_id = ? union select * from other', 'SELECT * FROM items WHERE tenant_id = ? or 1=1', 'select * from items where tenant_id = ?\nOR 1 = 1'])
    assert.equal(looksTenantScoped(sql), false, sql);
  assert.equal(looksTenantScoped('SELECT id FROM items WHERE tenant_id = ? AND branch_id = ? AND status = ? ORDER BY id LIMIT ?'), true);
  assert.equal(looksTenantScoped('DELETE FROM items WHERE tenant_id = ? AND id = ?'), true);
  assert.equal(looksTenantScoped(null), false);
});

await t('review: a transfer needs the branches table to be tenant-only, and says so explicitly', async () => {
  const wrong = { branches: { columns: ['id', 'name'], branchScoped: true }, invoices: schema.invoices };
  const im = ctxOf({ roles: ['InventoryManager'], assignedBranchIds: ['a1', 'a2'], activeBranchId: 'a1' });
  const repo = createScopedRepository(im, execute, wrong);
  bad(await validateTransfer(im, repo, 'a1', 'a2'), 'branches-table-must-be-tenant-only');
  assert.deepEqual(createScopedRepository(im, execute, schema).describe('branches'), { columns: ['id', 'name'], branchScoped: false });
  assert.equal(createScopedRepository(im, execute, schema).describe('nope'), null);
  assert.equal((await validateTransfer(im, createScopedRepository(im, execute, schema), 'a1', 'a2')).ok, true);
});

await t('review: a client key whose encoded form is long is refused (KV keys are limited to 512 bytes)', () => {
  const a = ctxOf();
  assert.throws(() => scopedKey(a, 'idem', '\u00e9'.repeat(256)), /key-invalid/);
  assert.ok(scopedKey(a, 'idem', 'x'.repeat(256)).length <= 512);
  assert.ok(scopedKey(a, 'idem', '\u00e9'.repeat(40)).length <= 512);
});

await t('schema definitions are validated: names must be plain identifiers, scope columns are reserved', () => {
  assert.throws(() => createScopedRepository(ctxOf(), execute, { 'bad name': { columns: ['id'] } }), /schema-invalid/);
  assert.throws(() => createScopedRepository(ctxOf(), execute, { t: { columns: ['id; drop'] } }), /schema-invalid/);
  assert.throws(() => createScopedRepository(ctxOf(), execute, { t: { columns: ['id', 'tenant_id'] } }), /schema-invalid/);
  assert.throws(() => createScopedRepository(ctxOf(), execute, {}), /schema-invalid/);
  assert.throws(() => createScopedRepository(ctxOf(), 'not a function', schema), /executor-invalid/);
  assert.throws(() => createScopedRepository(null, execute, schema), /context-invalid/);
  assert.throws(() => createScopedRepository({ tenantId: 'tenant_A', isTenantWide: true, roles: ['Owner'] }, execute, schema), /context-invalid/, 'a hand-made context is refused');
});

console.log(`PASS security tenant-scope checks (SEC-03): ${n} cases`);
