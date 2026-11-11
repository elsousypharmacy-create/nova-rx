// SEC-03 tenant and branch isolation. Pure module: no I/O of its own, no storage choice, not wired into the Worker.
// The scoped repository is the ONLY way to reach operational tables: tenant_id (and branch_id) come from a verified
// context, never from the caller; identifiers are checked against an allowlist; values are parameters only.
// Cloudflare D1 (SQLite) has no row level security, so this wrapper is the only barrier there (see docs/erp/SEC-03_...).

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const IDENT = /^[a-z][a-z0-9_]*$/;
export const ROLES = Object.freeze(['Owner', 'Pharmacist', 'Cashier', 'InventoryManager']); // SEC-02 (no Auditor there)
const SCOPE_FIELDS = new Set(['tenant_id', 'branch_id']);
const KINDS = new Set(['idem', 'cache', 'queue']);
const MAX_LIMIT = 1000;
const CONTEXTS = new WeakSet(); // only contexts built by createIsolationContext are accepted

const fail = (error, extra = {}) => ({ ok: false, error, code: error, ...extra });
const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const validId = v => typeof v === 'string' && ID.test(v);

// ---- context -------------------------------------------------------------------------------------------------------
// claims: already verified by SEC-01. isTenantWide is derived from the role and is refused as input.
export function createIsolationContext(claims) {
  if (!isPlain(claims)) return fail('claims-invalid');
  if (claims.isTenantWide !== undefined) return fail('isTenantWide-not-allowed');
  if (!validId(claims.actorId)) return fail('actorId-invalid');
  if (!validId(claims.tenantId)) return fail('tenantId-invalid');
  const roles = claims.roles;
  if (!Array.isArray(roles) || roles.length === 0 || roles.length > ROLES.length || new Set(roles).size !== roles.length || roles.some(r => !ROLES.includes(r))) return fail('roles-invalid');
  const assigned = claims.assignedBranchIds === undefined ? [] : claims.assignedBranchIds;
  if (!Array.isArray(assigned) || assigned.length > 100 || assigned.some(b => !validId(b))) return fail('assignedBranchIds-invalid');
  const isTenantWide = roles.includes('Owner');
  let active = claims.activeBranchId === undefined ? null : claims.activeBranchId;
  if (active !== null && !validId(active)) return fail('activeBranchId-invalid');
  if (!isTenantWide) {
    if (active === null && assigned.length === 1) active = assigned[0];
    if (active === null) return fail('branch-required');
    if (!assigned.includes(active)) return fail('activeBranch-not-assigned');
  }
  const context = Object.freeze({ actorId: claims.actorId, tenantId: claims.tenantId, roles: Object.freeze([...roles]), assignedBranchIds: Object.freeze([...assigned]), activeBranchId: active, isTenantWide });
  CONTEXTS.add(context);
  return { ok: true, context };
}

const branchAllowed = (ctx, branchId) => ctx.isTenantWide || ctx.assignedBranchIds.includes(branchId);

// ---- request scope -------------------------------------------------------------------------------------------------
const normKey = k => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
const TENANT_KEYS = new Set(['tenantid', 'xtenantid']);
const BRANCH_KEYS = new Set(['branchid', 'xbranchid']);

function scan(value, found, depth = 0) {
  if (value === null || typeof value !== 'object' || depth > 6) return;
  if (Array.isArray(value)) { for (const item of value) scan(item, found, depth + 1); return; }
  for (const key of Object.keys(value)) {
    const nk = normKey(key);
    if (TENANT_KEYS.has(nk)) found.tenant.push(value[key]);
    else if (BRANCH_KEYS.has(nk)) found.branch.push(value[key]);
    else scan(value[key], found, depth + 1);
  }
}

// Any tenant or branch the CLIENT names (header, query, params, body, nested, any case) must match the verified context.
export function checkRequestScope(ctx, request) {
  if (!CONTEXTS.has(ctx)) return fail('context-invalid', { status: 500 });
  const found = { tenant: [], branch: [] };
  if (request && typeof request === 'object') for (const part of ['headers', 'query', 'params', 'body']) scan(request[part], found);
  if (found.tenant.some(v => v !== ctx.tenantId)) return fail('SEC_TENANT_MISMATCH', { status: 403 });
  if (found.branch.some(v => !validId(v) || !branchAllowed(ctx, v) || v !== found.branch[0])) return fail('SEC_BRANCH_FORBIDDEN', { status: 403 });
  return { ok: true, tenantId: ctx.tenantId, branchId: found.branch.length ? found.branch[0] : ctx.activeBranchId };
}

// ---- scoped repository ---------------------------------------------------------------------------------------------
function checkSchema(schema) {
  if (!isPlain(schema) || Object.keys(schema).length === 0) throw new Error('schema-invalid');
  const out = {};
  for (const [table, def] of Object.entries(schema)) {
    if (!IDENT.test(table) || !isPlain(def) || !Array.isArray(def.columns) || def.columns.length === 0) throw new Error('schema-invalid');
    if (def.columns.some(c => typeof c !== 'string' || !IDENT.test(c) || SCOPE_FIELDS.has(c)) || new Set(def.columns).size !== def.columns.length) throw new Error('schema-invalid');
    out[table] = Object.freeze({ columns: Object.freeze([...def.columns]), branchScoped: def.branchScoped !== false });
  }
  return Object.freeze(out);
}

const scalar = v => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const param = v => (typeof v === 'boolean' ? (v ? 1 : 0) : v);

// execute(sql, params, kind): kind 'read' -> array of rows, kind 'write' -> { changes }.
export function createScopedRepository(ctx, execute, schema, options = {}) {
  if (!CONTEXTS.has(ctx)) throw new Error('context-invalid');
  if (typeof execute !== 'function') throw new Error('executor-invalid');
  const tables = checkSchema(schema);
  const branch = options.branchId !== undefined ? options.branchId : ctx.activeBranchId;
  if (branch !== null && (!validId(branch) || !branchAllowed(ctx, branch))) throw new Error('branch-not-allowed');

  const table = name => (typeof name === 'string' && Object.prototype.hasOwnProperty.call(tables, name) ? tables[name] : null);
  const base = def => {                       // WHERE tenant_id = ? [AND branch_id = ?]
    let sql = 'tenant_id = ?'; const params = [ctx.tenantId];
    if (def.branchScoped && branch !== null) { sql += ' AND branch_id = ?'; params.push(branch); }
    return { sql, params };
  };
  const conditions = (def, where, required) => {
    if (!isPlain(where)) return fail('where-invalid');
    const keys = Object.keys(where);
    if (required && keys.length === 0) return fail('where-required');
    const b = base(def);
    for (const key of keys) {
      if (SCOPE_FIELDS.has(key)) return fail('scope-field-not-allowed');
      if (!def.columns.includes(key)) return fail('column-invalid');
      const v = where[key];
      if (!scalar(v)) return fail('value-invalid');
      if (v === null) b.sql += ` AND ${key} IS NULL`; else { b.sql += ` AND ${key} = ?`; b.params.push(param(v)); }
    }
    return { ok: true, ...b };
  };
  const assignable = (def, row) => {          // columns of an insert row or an update patch
    if (!isPlain(row)) return fail('row-invalid');
    for (const key of Object.keys(row)) {
      if (SCOPE_FIELDS.has(key)) return fail('scope-field-not-allowed');
      if (!def.columns.includes(key)) return fail('column-invalid');
      if (!scalar(row[key])) return fail('value-invalid');
    }
    return { ok: true };
  };
  const run = async (sql, params, kind, errorCode) => { try { return { ok: true, result: await execute(sql, params, kind) }; } catch { return fail(errorCode); } };

  const repo = {
    async select(name, where = {}, opts = {}) {
      const def = table(name); if (!def) return fail('table-unknown');
      const c = conditions(def, where, false); if (!c.ok) return c;
      const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? Math.min(opts.limit, MAX_LIMIT) : 100;
      const r = await run(`SELECT ${def.columns.join(', ')} FROM ${name} WHERE ${c.sql} ORDER BY ${def.columns[0]} LIMIT ?`, [...c.params, limit], 'read', 'read-failed');
      return r.ok ? { ok: true, rows: r.result } : r;
    },
    async getById(name, id) {
      const r = await repo.select(name, { id }, { limit: 1 });
      if (!r.ok) return r;
      return r.rows.length ? { ok: true, row: r.rows[0] } : fail('not-found'); // another tenant's row looks exactly like a missing one
    },
    async insert(name, row) {
      const def = table(name); if (!def) return fail('table-unknown');
      const a = assignable(def, row); if (!a.ok) return a;
      const cols = Object.keys(row); if (cols.length === 0) return fail('row-invalid');
      const names = ['tenant_id']; const params = [ctx.tenantId];
      if (def.branchScoped) { if (branch === null) return fail('branch-required'); names.push('branch_id'); params.push(branch); }
      for (const col of cols) { names.push(col); params.push(param(row[col])); }
      const r = await run(`INSERT INTO ${name} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`, params, 'write', 'write-failed');
      return r.ok ? { ok: true, changes: r.result.changes } : r;
    },
    async update(name, where, patch) {
      const def = table(name); if (!def) return fail('table-unknown');
      const c = conditions(def, where, true); if (!c.ok) return c;
      const a = assignable(def, patch); if (!a.ok) return a;
      const cols = Object.keys(patch); if (cols.length === 0) return fail('patch-empty');
      const r = await run(`UPDATE ${name} SET ${cols.map(k => `${k} = ?`).join(', ')} WHERE ${c.sql}`, [...cols.map(k => param(patch[k])), ...c.params], 'write', 'write-failed');
      return r.ok ? { ok: true, changes: r.result.changes } : r;
    },
    async delete(name, where) {
      const def = table(name); if (!def) return fail('table-unknown');
      const c = conditions(def, where, true); if (!c.ok) return c;
      const r = await run(`DELETE FROM ${name} WHERE ${c.sql}`, c.params, 'write', 'write-failed');
      return r.ok ? { ok: true, changes: r.result.changes } : r;
    },
  };
  return Object.freeze(repo);
}

// Lint helper: a statement on an operational table must filter on tenant_id with a parameter, never a literal.
export const isTenantScoped = sql => /\btenant_id\s*=\s*\?/i.test(String(sql));

// ---- inter-branch transfer -----------------------------------------------------------------------------------------
// Both branches must exist INSIDE the caller's tenant (the repository filters by tenant). `repo` needs a tenant-only `branches` table.
export async function validateTransfer(ctx, repo, sourceBranchId, destinationBranchId) {
  if (!CONTEXTS.has(ctx)) return fail('context-invalid');
  if (!ctx.roles.includes('Owner') && !ctx.roles.includes('InventoryManager')) return fail('SEC_ROLE_FORBIDDEN');
  if (!validId(sourceBranchId) || !validId(destinationBranchId)) return fail('branch-invalid');
  if (sourceBranchId === destinationBranchId) return fail('transfer-same-branch');
  if (!branchAllowed(ctx, sourceBranchId)) return fail('SEC_BRANCH_FORBIDDEN');
  for (const id of [sourceBranchId, destinationBranchId]) {
    const r = await repo.getById('branches', id);
    if (!r.ok) return fail('SEC_CROSS_TENANT_TRANSFER_DENIED');
  }
  return { ok: true };
}

// ---- cache / idempotency / queue keys ------------------------------------------------------------------------------
export function scopedKey(ctx, kind, clientKey) {
  if (!CONTEXTS.has(ctx)) throw new Error('context-invalid');
  if (!KINDS.has(kind)) throw new Error('kind-invalid');
  if (typeof clientKey !== 'string' || clientKey.length === 0 || clientKey.length > 256) throw new Error('key-invalid');
  return `t:${ctx.tenantId}:b:${ctx.activeBranchId ?? '*'}:${kind}:${encodeURIComponent(clientKey)}`;
}
