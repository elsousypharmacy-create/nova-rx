// SEC-02: server permission matrix (port of auth-permissions.js). Pure, no network, no deps.
// Flag NOVA_PERMISSIONS defaults OFF: when off, enforcement is skipped (local mode unchanged).
export const ROLES = Object.freeze(['owner', 'manager', 'pharmacist', 'cashier', 'stock', 'accountant', 'delivery']);
export const ACTIONS = Object.freeze(['sale.create', 'sale.return', 'sale.cancel', 'data.export', 'data.import', 'stock.adjust', 'prices.edit', 'reports.view', 'accounts.manage', 'purchases.manage', 'delivery.update']);
const ALL = ACTIONS.slice();
export const MATRIX = Object.freeze({
  owner: Object.freeze(ALL.slice()),
  manager: Object.freeze(ALL.slice()),
  pharmacist: Object.freeze(['sale.create', 'sale.return', 'stock.adjust', 'reports.view']),
  cashier: Object.freeze(['sale.create', 'sale.return']),
  stock: Object.freeze(['stock.adjust', 'purchases.manage']),
  accountant: Object.freeze(['data.export', 'reports.view']),
  delivery: Object.freeze(['delivery.update']),
});
// the client app calls the stock role "store"
const ALIASES = { store: 'stock' };

export function permissionsEnabled(env) {
  return !!env && String(env.NOVA_PERMISSIONS) === '1';
}

export function normalizeRole(role) {
  const r = ALIASES[role] || role;
  return typeof r === 'string' && Object.prototype.hasOwnProperty.call(MATRIX, r) ? r : null;
}

// Deny by default. The role comes only from the verified session, never from the request body.
export function decide(role, action) {
  if (!ACTIONS.includes(action)) return { ok: false, why: 'unknown-action' };
  if (!role) return { ok: false, why: 'signed-out' };
  const r = normalizeRole(role);
  if (!r) return { ok: false, why: 'unknown-role' };
  return MATRIX[r].includes(action) ? { ok: true, why: 'role' } : { ok: false, why: 'role-denied' };
}

// No privilege escalation: only an owner may grant owner/manager; nobody grants a role above their own
// permissions; the actor needs accounts.manage.
export function canAssignRole(actorRole, targetRole) {
  if (!decide(actorRole, 'accounts.manage').ok) return { ok: false, why: 'role-denied' };
  const t = normalizeRole(targetRole);
  if (!t) return { ok: false, why: 'bad-role' };
  if ((t === 'owner' || t === 'manager') && normalizeRole(actorRole) !== 'owner') return { ok: false, why: 'escalation' };
  return { ok: true, why: 'role' };
}

const MSG = {
  'signed-out': 'يجب تسجيل الدخول أولاً.',
  default: 'ليست لديك صلاحية لتنفيذ هذا الإجراء.',
};

export function memoryDenialLog() {
  const entries = [];
  return { entries, async write(e) { entries.push(e); } };
}

// Middleware: returns null when allowed, otherwise a denial {ok:false, code, message_ar, requestId, status}.
// session = { role, id? } from the verified auth layer. Denials are logged (never throws on log failure).
export async function requirePermission({ env, session, action, requestId, log, now = Date.now, target }) {
  if (!permissionsEnabled(env)) return null;
  const d = target !== undefined
    ? (action === 'accounts.manage' ? canAssignRole(session && session.role, target) : decide(session && session.role, action))
    : decide(session && session.role, action);
  if (d.ok) return null;
  const signedOut = d.why === 'signed-out';
  if (log) {
    try {
      await log.write({ at: new Date(now()).toISOString(), action: String(action), account: (session && session.id) || null, role: (session && session.role) || null, why: d.why, requestId });
    } catch (e) { /* logging must not change the decision */ }
  }
  return {
    ok: false,
    code: signedOut ? 'AUTH_REQUIRED' : 'PERMISSION_DENIED',
    message_ar: signedOut ? MSG['signed-out'] : MSG.default,
    requestId,
    status: signedOut ? 401 : 403,
  };
}
