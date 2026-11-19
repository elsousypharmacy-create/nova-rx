// SEC-01 / S1-07: staff-gate.js pure logic. Fake storage, fake fetch, fake clock; no network, no real account.
// Run: node tests/unit/staff-gate.check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';

const req = createRequire(import.meta.url);
const NovaAuth = req('../../auth-local.js'), Gate = req('../../staff-gate.js'), Perms = req('../../auth-permissions.js');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };
const mem = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const L = (href) => { const u = new URL(href); return { hostname: u.hostname, protocol: u.protocol, pathname: u.pathname, search: u.search }; };
const PREVIEW = 'https://nova-rx-preview.example.test';

// fake server: one account (fake credentials), records calls
function fakeServer({ users = { 'mona.cashier': ['fake-pass-1', 'cashier'], boss: ['fake-pass-2', 'owner'] }, down = false } = {}) {
  const calls = [];
  const fetch = async (url, o) => {
    calls.push({ url, o });
    if (down) throw new TypeError('Failed to fetch');
    const b = JSON.parse(o.body || '{}'), res = (status, j) => ({ ok: status < 300, status, json: async () => j });
    if (url.endsWith('/api/v1/auth/login')) {
      const u = users[b.username];
      if (!u || u[0] !== b.password) return res(401, { ok: false, code: 'AUTH_INVALID_CREDENTIALS' });
      return res(200, { ok: true, access_token: 'A'.repeat(64), refresh_token: 'R'.repeat(64), expires_in: 3600, refresh_expires_in: 30 * 86400, user: b.username, role: u[1] });
    }
    if (url.endsWith('/api/v1/auth/refresh')) return b.refresh_token === 'R'.repeat(64) ? res(200, { ok: true, access_token: 'B'.repeat(64), refresh_token: 'S'.repeat(64), expires_in: 3600, user: 'mona.cashier', role: 'cashier' }) : res(401, { ok: false });
    if (url.endsWith('/api/v1/auth/logout')) return res(200, { ok: true });
    return res(404, {});
  };
  return { fetch, calls };
}
function rig(href, opts = {}) {
  const storage = opts.storage || mem(); let now = opts.now || Date.parse('2026-11-19T08:00:00Z');
  const clock = () => now;
  const auth = NovaAuth.create({ storage, crypto: webcrypto, now: clock });
  const perms = Perms.create({ storage, current: () => auth.current(), hasAccounts: () => auth.hasAccounts() });
  const srv = opts.server || fakeServer();
  const g = Gate.create({ storage, fetch: srv.fetch, location: L(href), auth, now: clock, flag: opts.flag, perms: () => perms });
  return { g, auth, storage, srv, perms, tick: (ms) => { now += ms; } };
}

await t('gate is enforced on every real host; on loopback only with the flag or ?staffGate=1; a flag can never switch it off', () => {
  assert.equal(Gate.enforced(L(PREVIEW + '/')), true);
  assert.equal(Gate.enforced(L(PREVIEW + '/whatsapp')), true);
  assert.equal(Gate.enforced(L(PREVIEW + '/'), false), true, 'false flag ignored off loopback');
  assert.equal(Gate.enforced(L('http://127.0.0.1:8765/')), false);
  assert.equal(Gate.enforced(L('http://localhost:8765/')), false);
  assert.equal(Gate.enforced(L('http://127.0.0.1:8765/?staffGate=1')), true);
  assert.equal(Gate.enforced(L('http://127.0.0.1:8765/'), true), true);
  assert.equal(Gate.enforced(L('http://127.0.0.1.evil.test/')), true, 'look-alike host is gated');
});
await t('WhatsApp mode: /whatsapp, /wa, /?app=whatsapp', () => {
  for (const p of ['/whatsapp', '/whatsapp/', '/wa', '/?app=whatsapp']) assert.equal(Gate.waMode(L(PREVIEW + p)), true, p);
  for (const p of ['/', '/index.html', '/?app=pos']) assert.equal(Gate.waMode(L(PREVIEW + p)), false, p);
});
await t('logged out: gate closed, no bearer, no sale', async () => {
  const { g } = rig(PREVIEW + '/');
  assert.equal(g.ok(), false); assert.equal(g.bearer(), ''); assert.equal(g.allow('sale.create'), false); assert.equal(g.allow('accounts.manage'), false);
});
await t('first run (backend off, /): the owner creates the first account; no built-in password', async () => {
  const { g, auth, srv } = rig(PREVIEW + '/');
  assert.equal(g.hasAccounts(), false);
  await assert.rejects(g.firstRun('Ahmed', 'fake-owner-1', 'different'), /mismatch/);
  await assert.rejects(g.firstRun('Ahmed', '123', '123'), /weak-password/);
  const r = await g.firstRun('Ahmed', 'fake-owner-1', 'fake-owner-1');
  assert.equal(r.mode, 'local'); assert.equal(auth.current().role, 'owner'); assert.equal(g.ok(), true);
  assert.equal(g.allow('sale.create'), true); assert.equal(g.allow('accounts.manage'), true);
  await assert.rejects(g.firstRun('Other', 'fake-owner-2', 'fake-owner-2'), /permission/, 'second first-run refused');
  assert.equal(srv.calls.length, 0, 'first run never talks to a server');
});
await t('server login: mirrors the account + role locally, stores the bearer bound to the 8 h local session', async () => {
  const { g, auth, srv, storage } = rig(PREVIEW + '/whatsapp');
  const r = await g.signIn('Mona.Cashier', 'fake-pass-1', true);
  assert.equal(r.mode, 'server');
  const login = srv.calls.find((c) => c.url.endsWith('/auth/login'));
  assert.equal(login.url, 'https://nova-rx-api-staging.elsousypharmacy.workers.dev/api/v1/auth/login', 'backend off => staging API');
  const body = JSON.parse(login.o.body); assert.equal(body.username, 'mona.cashier'); assert.equal(body.trust_device, true); assert.ok(body.device_id.startsWith('dev-'));
  assert.equal(login.o.credentials, 'omit');
  assert.equal(auth.current().name, 'mona.cashier'); assert.equal(auth.current().role, 'cashier');
  assert.equal(g.bearer(), 'A'.repeat(64)); assert.equal(g.ok(), true);
  assert.equal(g.allow('sale.create'), true, 'cashier can sell'); assert.equal(g.allow('accounts.manage'), false, 'cashier cannot manage accounts');
  assert.ok(!storage.getItem('nova.auth.accounts').includes('fake-pass-1'), 'password never stored in clear');
});
await t('wrong password on the WhatsApp screen => refused, no local fallback, no bearer', async () => {
  const { g, auth } = rig(PREVIEW + '/whatsapp');
  await assert.rejects(g.signIn('mona.cashier', 'nope'), /bad-credentials/);
  assert.equal(auth.current(), null); assert.equal(g.bearer(), '');
});
await t('offline after a first server login: the local mirror opens the app, no chats token', async () => {
  const storage = mem(); const up = rig(PREVIEW + '/whatsapp', { storage });
  await up.g.signIn('mona.cashier', 'fake-pass-1', true); up.g.signOut();
  assert.equal(up.g.ok(), false); assert.equal(storage.getItem('nova.staff.server'), null, 'logout drops the server token');
  const off = rig(PREVIEW + '/whatsapp', { storage, server: fakeServer({ down: true }) });
  const r = await off.g.signIn('mona.cashier', 'fake-pass-1', true);
  assert.deepEqual([r.mode, r.offline], ['local', true]); assert.equal(off.g.ok(), true); assert.equal(off.g.bearer(), '');
  const fresh = rig(PREVIEW + '/whatsapp', { server: fakeServer({ down: true }) });
  await assert.rejects(fresh.g.signIn('mona.cashier', 'fake-pass-1'), /offline-first/, 'never-seen device offline cannot log in');
});
await t('backend off on /: server refusal falls back to the local account on this device', async () => {
  const { g } = rig(PREVIEW + '/');
  await g.firstRun('Ahmed', 'fake-owner-1', 'fake-owner-1'); g.signOut();
  const r = await g.signIn('Ahmed', 'fake-owner-1');
  assert.equal(r.mode, 'local'); assert.equal(g.ok(), true); assert.equal(g.bearer(), '');
});
await t('backend on: production API, server session required (wrong password refused even with a local account)', async () => {
  const storage = mem(); storage.setItem('novaBackend.enabled', 'true');
  const { g, srv } = rig(PREVIEW + '/', { storage });
  await g.firstRun('boss', 'fake-local-9', 'fake-local-9'); g.signOut();
  await assert.rejects(g.signIn('boss', 'fake-local-9'), /bad-credentials/);
  assert.ok(srv.calls.every((c) => c.url.startsWith('https://nova-rx-api.elsousypharmacy.workers.dev/')));
  const r = await g.signIn('boss', 'fake-pass-2'); assert.equal(r.mode, 'server'); assert.equal(g.allow('accounts.manage'), true);
});
await t('8 h session: after expiry the gate closes and the bearer is dropped', async () => {
  const x = rig(PREVIEW + '/whatsapp');
  await x.g.signIn('mona.cashier', 'fake-pass-1', true);
  x.tick(NovaAuth.SESSION_MS - 1000); assert.equal(x.g.ok(), true);
  x.tick(2000); assert.equal(x.g.ok(), false); assert.equal(x.g.bearer(), ''); assert.equal(x.storage.getItem('nova.staff.server'), null);
});
await t('access token expiry: bearer empty, refresh rotates it', async () => {
  const x = rig(PREVIEW + '/whatsapp');
  await x.g.signIn('mona.cashier', 'fake-pass-1', true);
  x.tick(3600 * 1000); assert.equal(x.g.bearer(), ''); assert.equal(x.g.canRefresh(), true);
  assert.equal(await x.g.refresh(), true); assert.equal(x.g.bearer(), 'B'.repeat(64));
});
await t('a token from another local session is never used', async () => {
  const x = rig(PREVIEW + '/whatsapp');
  await x.g.signIn('mona.cashier', 'fake-pass-1', true);
  const s = JSON.parse(x.storage.getItem('nova.staff.server')); s.sessionId = 'ses-other'; x.storage.setItem('nova.staff.server', JSON.stringify(s));
  assert.equal(x.g.bearer(), '');
});
await t('loopback without the flag: gate open (test harness), sale allowed', async () => {
  const { g } = rig('http://127.0.0.1:8765/');
  assert.equal(g.ok(), true); assert.equal(g.allow('sale.create'), true);
});
await t('locked account (429) is reported, not retried locally', async () => {
  const srv = { calls: [], fetch: async () => ({ ok: false, status: 429, json: async () => ({ ok: false, code: 'AUTH_LOCKED' }) }) };
  const { g } = rig(PREVIEW + '/', { server: srv });
  await assert.rejects(g.signIn('x', 'y'), /locked/);
});
console.log(`staff-gate: ${n} passed`);
