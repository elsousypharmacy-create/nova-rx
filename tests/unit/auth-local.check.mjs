// N45 SEC-01: individual accounts, session expiry/revoke, trusted devices, re-auth gate (mock auth, on-device).
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
const NovaAuth = createRequire(import.meta.url)('../../auth-local.js');
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), raw: m }; };
let t0 = Date.parse('2026-11-12T08:00:00Z'); const clock = { now: () => t0 };
const store = mem(); const mk = (s = store) => NovaAuth.create({ storage: s, crypto: webcrypto, now: clock.now });
let a = mk(), n = 0;
const t = async (name, fn) => { try { await fn(); } catch (e) { console.log('  FAIL', name, '\n   ', e.message); process.exit(1); } n++; console.log('  ok', name); };
const code = async p => { try { await (typeof p === 'function' ? p() : p); } catch (e) { return e.code; } return null; };

await t('no accounts: sensitive actions allowed (nobody to authenticate)', () => assert.equal(a.sensitiveAllowed(), true));
await t('weak password / bad name refused', async () => {
  assert.equal(await code(() => a.createAccount({ name: 'Ali', password: '123' })), 'weak-password');
  assert.equal(await code(() => a.createAccount({ name: ' ', password: 'secret1' })), 'bad-name');
});
await t('first account is forced to owner; passwords never stored in clear', async () => {
  const o = await a.createAccount({ name: 'Ahmed', role: 'cashier', password: 'secret1' });
  assert.equal(o.role, 'owner'); assert.ok(!('hash' in o));
  assert.ok(![...store.raw.values()].some(v => v.includes('secret1')));
});
await t('once an account exists, sensitive actions are blocked until signed in and re-authenticated', () => assert.equal(a.sensitiveAllowed(), false));
await t('wrong password and unknown user fail the same way', async () => {
  assert.equal(await code(() => a.signIn('Ahmed', 'nope')), 'bad-credentials');
  assert.equal(await code(() => a.signIn('ghost', 'secret1')), 'bad-credentials');
  assert.equal(a.current(), null);
});
await t('creating a second account needs a session (reauth-required) then owner/manager', async () => {
  assert.equal(await code(() => a.createAccount({ name: 'Sara', role: 'cashier', password: 'pass123' })), 'reauth-required');
  await a.signIn('ahmed', 'secret1');
  assert.equal((await a.createAccount({ name: 'Sara', role: 'cashier', password: 'pass123' })).role, 'cashier');
  assert.equal(await code(() => a.createAccount({ name: 'SARA', role: 'cashier', password: 'pass123' })), 'duplicate-name');
});
await t('re-auth window: fresh after sign-in, stale after 5 min, restored by password', async () => {
  assert.equal(a.sensitiveAllowed(), true);
  t0 += NovaAuth.REAUTH_MS + 1000; assert.equal(a.sensitiveAllowed(), false);
  assert.equal(await code(() => a.reauthenticate('wrong')), 'bad-credentials'); assert.equal(a.sensitiveAllowed(), false);
  await a.reauthenticate('secret1'); assert.equal(a.sensitiveAllowed(), true);
});
await t('cashier cannot create accounts even when fresh', async () => {
  await a.signOut(); await a.signIn('Sara', 'pass123');
  assert.equal(await code(() => a.createAccount({ name: 'X', role: 'cashier', password: 'pass123' })), 'permission');
});
await t('session expires after 8h', async () => {
  assert.ok(a.current()); t0 += NovaAuth.SESSION_MS + 1; assert.equal(a.current(), null); assert.equal(a.sessions().length, 0);
});
await t('revoking a session signs it out; unknown id errors', async () => {
  await a.signIn('Ahmed', 'secret1'); const s = a.sessions().find(x => x.current);
  assert.ok(a.revokeSession(s.id)); assert.equal(a.current(), null); assert.equal(a.sessions().some(x => x.id === s.id), false);
  assert.equal(await code(() => a.revokeSession('nope')), 'not-found');
});
await t('revoked session stays dead after reload (state is on the device)', async () => {
  await a.signIn('Ahmed', 'secret1'); const id = a.current().sessionId; a.revokeSession(id);
  store.setItem('nova.auth.current', id); assert.equal(mk().current(), null);
});
await t('trusted device list: this device is added at sign-in; removing it revokes its sessions', async () => {
  await a.signIn('Ahmed', 'secret1');
  const d = a.trustedDevices(); assert.equal(d.length, 1); assert.equal(d[0].thisDevice, true);
  assert.ok(a.removeDevice(d[0].id)); assert.equal(a.current(), null); assert.equal(a.trustedDevices().length, 0); assert.equal(a.sessions().length, 0);
});
await t('sign-out revokes the session so it cannot be resumed', async () => {
  await a.signIn('Ahmed', 'secret1'); const id = a.current().sessionId; a.signOut();
  assert.equal(a.sessions().some(x => x.id === id), false); store.setItem('nova.auth.current', id); assert.equal(a.current(), null);
});
console.log(`auth-local: ${n} passed`);
