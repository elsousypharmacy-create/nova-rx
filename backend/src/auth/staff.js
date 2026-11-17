// S1-06: owner/manager staff management on D1. Flag NOVA_AUTH=1 + D1 binding (else 404). Every route needs a session;
// roles come from the permissions matrix (canAssignRole: owner may assign any role, manager may not create owners).
// Disable is soft (active=0) and revokes that user's sessions; nothing is ever deleted. Passwords: PBKDF2 (hashPassword).
import { authenticate, hashPassword, revokeUserSessions } from './auth.js';
import { canAssignRole, normalizeRole } from './permissions.js';
import { d1Usable, tenantExists, findUser, insertUser, listUsers, setActive, setRole, branchesOf } from './staff-store.js';
import { audit } from '../audit.js';

const USER_RE = /^[a-z0-9._-]{3,40}$/;
// Acting on an EXISTING account: owner may act on anyone (except self, checked per route); a manager only on roles below manager.
const canManage = (actor, target) => actor === 'owner' || (canAssignRole(actor, target).ok && target !== 'owner' && target !== 'manager');

export function registerStaffRoutes(route, { json, errorResponse }) {
  const guard = (fn) => async (ctx) => {
    const { env, requestId } = ctx;
    if (!(await d1Usable(env))) return errorResponse('STAFF_DISABLED', 'إدارة الموظفين غير مفعّلة.', 404, requestId);
    const a = await authenticate(ctx.request, env);
    if (a.fail) return errorResponse(a.fail.code, a.fail.message_ar, a.fail.status, requestId);
    if (!canAssignRole(a.session.role, 'cashier').ok) return errorResponse('FORBIDDEN', 'هذه العملية للمالك أو المدير فقط.', 403, requestId);
    if (!(await tenantExists(env))) return errorResponse('STAFF_NO_TENANT', 'سجّل دخول المالك أولاً لتجهيز الصيدلية.', 409, requestId);
    let body = {};
    if (ctx.request.method === 'POST') { try { body = await ctx.request.json(); } catch { body = {}; } }
    const r = await fn({ env, session: a.session, body });
    await audit(env, { actor: a.session.user, action: 'staff.' + (ctx.url.pathname.split('/').pop() || 'list'), entity: 'staff', requestId,
      outcome: r.err ? 'DENIED' : 'ALLOWED', reason: r.err ? r.err[0] : null, after: r.audit || null });
    if (r.err) return errorResponse(r.err[0], r.err[1], r.err[2], requestId);
    return json({ ok: true, ...r.ok, requestId }, 200, { 'X-Request-Id': requestId });
  };

  route('GET', '/api/v1/staff', guard(async ({ env }) => ({ ok: { staff: await listUsers(env) } })));

  route('POST', '/api/v1/staff', guard(async ({ env, session, body }) => {
    const username = String(body.username || '').trim().toLowerCase(), password = String(body.password || ''), role = normalizeRole(body.role);
    if (!USER_RE.test(username) || password.length < 8 || password.length > 256 || !role) return { err: ['STAFF_BAD_REQUEST', 'اسم مستخدم 3-40 حرف وكلمة مرور 8+ ودور صحيح مطلوبين.', 400] };
    if (!canAssignRole(session.role, role).ok) return { err: ['FORBIDDEN', 'لا يمكنك إنشاء موظف بهذا الدور.', 403] };
    if (await findUser(env, username)) return { err: ['STAFF_EXISTS', 'اسم المستخدم موجود بالفعل.', 409] };
    const branches = await branchesOf(env), branchId = body.branchId && branches.includes(String(body.branchId)) ? String(body.branchId) : branches[0] || null;
    await insertUser(env, { username, passwordHash: await hashPassword(password), role, branchId, displayName: body.displayName ? String(body.displayName).slice(0, 80) : null });
    return { ok: { created: { username, role, branchId } }, audit: { username, role } };
  }));

  route('POST', '/api/v1/staff/disable', guard(async ({ env, session, body }) => {
    const username = String(body.username || '').trim().toLowerCase(), u = username && (await findUser(env, username));
    if (!u) return { err: ['STAFF_NOT_FOUND', 'الموظف غير موجود.', 404] };
    if (u.username === session.user) return { err: ['STAFF_SELF', 'لا يمكنك إيقاف حسابك.', 409] };
    if (!canManage(session.role, u.role)) return { err: ['FORBIDDEN', 'لا يمكنك إيقاف هذا الحساب.', 403] };
    await setActive(env, username, false);
    const revoked = await revokeUserSessions(env.KV, username);
    return { ok: { disabled: username, revokedSessions: revoked }, audit: { username } };
  }));

  route('POST', '/api/v1/staff/enable', guard(async ({ env, session, body }) => {
    const username = String(body.username || '').trim().toLowerCase(), u = username && (await findUser(env, username));
    if (!u) return { err: ['STAFF_NOT_FOUND', 'الموظف غير موجود.', 404] };
    if (!canManage(session.role, u.role)) return { err: ['FORBIDDEN', 'لا يمكنك تفعيل هذا الحساب.', 403] };
    await setActive(env, username, true);
    return { ok: { enabled: username }, audit: { username } };
  }));

  route('POST', '/api/v1/staff/role', guard(async ({ env, session, body }) => {
    const username = String(body.username || '').trim().toLowerCase(), role = normalizeRole(body.role), u = username && (await findUser(env, username));
    if (!u || !role) return { err: ['STAFF_BAD_REQUEST', 'الموظف والدور مطلوبين.', 400] };
    if (u.username === session.user) return { err: ['STAFF_SELF', 'لا يمكنك تغيير دورك.', 409] };
    if (!canAssignRole(session.role, role).ok || !canManage(session.role, u.role) || (session.role !== 'owner' && role === 'manager')) return { err: ['FORBIDDEN', 'لا يمكنك تعيين هذا الدور.', 403] };
    await setRole(env, u, role);
    await revokeUserSessions(env.KV, username); // new role takes effect at the next login
    return { ok: { username, role }, audit: { username, role } };
  }));
}
