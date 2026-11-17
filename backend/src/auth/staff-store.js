// S1-06: D1 is the source of truth for staff accounts (users / roles / user_roles from 0001_identity), so the daily D1
// backup restores logins. Used only when NOVA_AUTH=1 and a D1 binding exists. Sessions stay in KV (short-lived, TTL);
// they now carry the tenant/branch scope so sync and other scoped routes work with a staff login.
// SELECT/INSERT/UPDATE only: never DELETE (disable = active 0). No network.
export const d1AuthOn = (env) => !!env && String(env.NOVA_AUTH) === '1' && !!env.DB;
export const tenantOf = (env) => String((env && env.NOVA_TENANT_ID) || 'default');
// D1 staff mode only when the identity tables are really there (a D1 binding used for something else keeps KV auth).
const USABLE = new WeakMap();
export async function d1Usable(env) {
  if (!d1AuthOn(env)) return false;
  if (USABLE.has(env.DB)) return USABLE.get(env.DB);
  let ok = false;
  try { await env.DB.prepare('SELECT 1 AS x FROM users LIMIT 1').bind().first(); ok = true; } catch { ok = false; }
  USABLE.set(env.DB, ok);
  return ok;
}
const rid = (p) => { const b = new Uint8Array(8); crypto.getRandomValues(b); return p + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); };

// backend role -> isolation role (worker/security/tenant-scope.js ROLES). Owner/manager are tenant-wide.
const ISO = { owner: 'Owner', manager: 'Owner', pharmacist: 'Pharmacist', cashier: 'Cashier', stock: 'InventoryManager', accountant: 'Pharmacist', delivery: 'Cashier' };
export const isolationRole = (role) => ISO[role] || 'Cashier';

export async function tenantExists(env) {
  try { return !!(await env.DB.prepare('SELECT 1 AS x FROM tenants WHERE id = ?').bind(tenantOf(env)).first()); } catch { return false; }
}

// Throws on a D1 error (callers decide: login fails closed). Returns null only when the user really does not exist.
export async function findUser(env, username) {
  {
    const u = await env.DB.prepare(
      'SELECT u.id, u.username, u.password_hash, u.active, u.branch_id, ' +
      '(SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id ORDER BY r.name LIMIT 1) AS role ' +
      'FROM users u WHERE u.tenant_id = ? AND u.username = ?',
    ).bind(tenantOf(env), username).first();
    return u ? { id: u.id, username: u.username, password_hash: u.password_hash, active: Number(u.active) === 1, branchId: u.branch_id || null, role: u.role || 'cashier', d1: true } : null;
  }
}

export async function branchesOf(env) {
  try { const { results } = await env.DB.prepare('SELECT id FROM branches WHERE tenant_id = ? ORDER BY created_at, id').bind(tenantOf(env)).all(); return (results || []).map((r) => r.id); } catch { return []; }
}

// Session scope fields for a D1 user (tenant-wide roles get every branch; others only their own branch).
export async function scopeFor(env, user) {
  const all = await branchesOf(env), iso = isolationRole(user.role);
  const own = user.branchId && all.includes(user.branchId) ? user.branchId : all[0] || null;
  return { tenantId: tenantOf(env), tenantBranchIds: all, assignedBranchIds: iso === 'Owner' ? all : (own ? [own] : []), activeBranchId: own, roles: [iso] };
}

async function roleId(env, name) {
  const t = tenantOf(env);
  const r = await env.DB.prepare('SELECT id FROM roles WHERE tenant_id = ? AND name = ?').bind(t, name).first();
  if (r) return r.id;
  const id = rid('rl_');
  await env.DB.prepare('INSERT INTO roles (id, tenant_id, name) VALUES (?,?,?)').bind(id, t, name).run();
  return id;
}

export async function insertUser(env, { username, passwordHash, role, branchId = null, displayName = null }) {
  const id = rid('us_'), rl = await roleId(env, role);
  const st = [
    env.DB.prepare('INSERT INTO users (id, tenant_id, branch_id, username, display_name, password_hash) VALUES (?,?,?,?,?,?)').bind(id, tenantOf(env), branchId, username, displayName, passwordHash),
    env.DB.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?,?)').bind(id, rl),
  ];
  if (typeof env.DB.batch === 'function') await env.DB.batch(st); // D1: both rows or none
  else for (const s of st) await s.run(); // minimal executors (tests) without batch()
  return id;
}

// First owner on an empty D1: tenant + one branch + the owner (password hash given by the caller). Additive only.
export async function ensureTenantWithOwner(env, passwordHash) {
  const t = tenantOf(env);
  if (!(await tenantExists(env))) {
    await env.DB.prepare('INSERT INTO tenants (id, name) VALUES (?,?)').bind(t, 'NOVA Rx').run();
    await env.DB.prepare('INSERT INTO branches (id, tenant_id, name) VALUES (?,?,?)').bind(rid('br_'), t, 'الرئيسي').run();
  }
  const b = (await branchesOf(env))[0] || null;
  if (!(await findUser(env, 'owner'))) await insertUser(env, { username: 'owner', passwordHash, role: 'owner', branchId: b });
  return findUser(env, 'owner');
}

export async function listUsers(env) {
  const { results } = await env.DB.prepare(
    'SELECT u.username, u.active, u.branch_id, (SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id ORDER BY r.name LIMIT 1) AS role ' +
    'FROM users u WHERE u.tenant_id = ? ORDER BY u.username',
  ).bind(tenantOf(env)).all();
  return (results || []).map((u) => ({ username: u.username, role: u.role || null, active: Number(u.active) === 1, branchId: u.branch_id || null }));
}

export async function setActive(env, username, active) {
  const r = await env.DB.prepare('UPDATE users SET active = ? WHERE tenant_id = ? AND username = ?').bind(active ? 1 : 0, tenantOf(env), username).run();
  return !!(r && r.meta && r.meta.changes);
}

// One role per user: re-point the existing user_roles row (an UPDATE, never a DELETE).
export async function setRole(env, user, role) {
  const rl = await roleId(env, role);
  const r = await env.DB.prepare('UPDATE user_roles SET role_id = ? WHERE user_id = ?').bind(rl, user.id).run();
  if (!(r && r.meta && r.meta.changes)) await env.DB.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?,?)').bind(user.id, rl).run();
  return true;
}
