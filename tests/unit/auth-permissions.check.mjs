// N46 SEC-02: permissions matrix, deny by default, denial log, no escalation (UI/local only, not a security boundary).
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const NovaAuth = req('../../auth-local.js'), P = req('../../auth-permissions.js');
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const store = mem(); let t0 = Date.parse('2026-11-12T08:00:00Z');
const auth = NovaAuth.create({ storage: store, crypto: webcrypto, now: () => t0 });
const perms = P.create({ storage: store, current: () => auth.current(), hasAccounts: () => auth.hasAccounts(), now: () => t0 });
let n = 0; const t = async (name, fn) => { try { await fn(); } catch (e) { console.log('  FAIL', name, '\n   ', e.message); process.exit(1); } n++; console.log('  ok', name); };
const code = async f => { try { await f(); } catch (e) { return e.code; } return null; };

await t('matrix covers the seven roles; every cell references a known action', () => {
  assert.deepEqual([...P.ROLES], ['owner', 'manager', 'pharmacist', 'cashier', 'store', 'accountant', 'delivery']);
  for (const r of P.ROLES) for (const a of P.MATRIX[r]) assert.ok(P.ACTIONS.includes(a), a);
  assert.deepEqual([...P.MATRIX.owner], [...P.ACTIONS]);
  assert.ok(P.ROLES.every(r => NovaAuth.create({ storage: mem(), crypto: webcrypto }).ROLES.includes(r)));
});
await t('matrix is frozen: a screen cannot grant itself a permission', () => {
  assert.throws(() => P.MATRIX.cashier.push('data.import'), TypeError);
  assert.equal(Object.isFrozen(P.MATRIX), true);
});
await t('no accounts yet: allowed (documented limit); unknown action always refused', () => {
  assert.equal(perms.can('data.export'), true); assert.equal(perms.can('nope'), false);
});
await t('accounts exist but signed out: everything denied and logged', async () => {
  await auth.createAccount({ name: 'Ahmed', password: 'secret1' });
  assert.equal(perms.require('sale.create'), false);
  const d = perms.denied(); assert.equal(d.length, 1); assert.equal(d[0].why, 'signed-out'); assert.equal(d[0].action, 'sale.create');
});
await t('owner may do everything', async () => {
  await auth.signIn('Ahmed', 'secret1'); for (const a of P.ACTIONS) assert.equal(perms.can(a), true, a);
});
await t('each role gets exactly its matrix row; denial is logged with account and role', async () => {
  for (const r of ['manager', 'pharmacist', 'cashier', 'store', 'accountant', 'delivery']) {
    await auth.signIn('Ahmed', 'secret1'); await auth.createAccount({ name: 'u-' + r, role: r, password: 'pass123' });
    await auth.signIn('u-' + r, 'pass123'); perms.clearDenied();
    for (const a of P.ACTIONS) { assert.equal(perms.require(a), P.MATRIX[r].includes(a), r + ' ' + a); }
    const denied = perms.denied(); assert.equal(denied.length, P.ACTIONS.length - P.MATRIX[r].length);
    assert.ok(denied.every(x => x.role === r && x.account === 'u-' + r && x.why === 'role-denied'));
  }
});
await t('cashier cannot export, import, cancel; can sell and return', async () => {
  await auth.signIn('u-cashier', 'pass123');
  assert.deepEqual(['data.export', 'data.import', 'sale.cancel', 'sale.create', 'sale.return'].map(a => perms.can(a)), [false, false, false, true, true]);
});
await t('no escalation: manager cannot create owner/manager; cashier cannot create anyone; role is not an argument', async () => {
  await auth.signIn('u-manager', 'pass123');
  assert.equal(await code(() => auth.createAccount({ name: 'x1', role: 'owner', password: 'pass123' })), 'permission');
  assert.equal(await code(() => auth.createAccount({ name: 'x2', role: 'manager', password: 'pass123' })), 'permission');
  assert.equal((await auth.createAccount({ name: 'x3', role: 'cashier', password: 'pass123' })).role, 'cashier');
  await auth.signIn('u-cashier', 'pass123');
  assert.equal(await code(() => auth.createAccount({ name: 'x4', role: 'cashier', password: 'pass123' })), 'permission');
});
await t('signed-out and expired sessions are denied', async () => {
  await auth.signIn('u-cashier', 'pass123'); auth.signOut(); assert.equal(perms.can('sale.create'), false);
  await auth.signIn('u-cashier', 'pass123'); t0 += NovaAuth.SESSION_MS + 1; assert.equal(perms.can('sale.create'), false);
});
await t('denial log is capped at 200 entries', () => { perms.clearDenied(); for (let i = 0; i < 230; i++) perms.require('data.export'); assert.equal(perms.denied().length, 200); });
console.log(`auth-permissions: ${n} passed`);
