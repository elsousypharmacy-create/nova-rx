// SEC-01 / S1-07: staff login gate before the app and WhatsApp, 390x844 first. FAKE data only.
// The login and history APIs are answered by page.route (fake accounts, fake chats); every other non-GET is aborted and
// recorded; nothing leaves the machine. No WhatsApp send, no PIN. The gate is forced on the loopback harness with
// window.NOVA_STAFF_GATE = true (real hosts are always gated; see staff-gate.js).
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ui-sec01-staff-gate.mjs
// Screenshots (fake data): NOVA_SHOTS=qa/screens/SEC-01 node tests/ui-sec01-staff-gate.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const origin = new URL(BASE).origin;
const SHOTS = process.env.NOVA_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const snapshot = readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8');
const NOW = Date.now();
const FAKE_NAME = 'عميلة تجريبية (وهمي)';
const FAKE_TEXT = 'رسالة تجريبية وهمية';
const chats = { wa_201000000099: { customer: FAKE_NAME, messages: [{ id: 'f1', dir: 'in', kind: 'in', text: FAKE_TEXT, at: NOW - 600e3, status: null }] } };
const list = () => Object.entries(chats).map(([id, c]) => ({ id, customer: c.customer, updatedAt: c.messages.at(-1).at, count: c.messages.length, last: c.messages.at(-1) }));
// fake staff accounts (test-only values, not real credentials)
const USERS = { 'mona.cashier': ['fake-pass-1', 'cashier'], 'boss.fake': ['fake-pass-2', 'owner'] };
const TOKEN = 'T'.repeat(64);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || process.env.NOVA_CHROMIUM || undefined, args: ['--no-sandbox'] });
let n = 0; const t = async (name, fn) => { try { await fn(); } catch (e) { console.log('  FAIL', name, '\n   ', String(e.message).split('\n').slice(0, 12).join('\n    ')); await browser.close(); process.exit(1); } n++; console.log('  ok', name); };

async function context(vp = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', timezoneId: 'Africa/Cairo', serviceWorkers: 'block', hasTouch: vp.width < 600, isMobile: vp.width < 600 });
  const log = { history: [], historyNoAuth: [], bad: [], logins: [] };
  await ctx.route('**/*', async (r) => {
    const q = r.request(), u = q.url(), m = q.method(), cors = { 'Access-Control-Allow-Origin': origin };
    if (m === 'OPTIONS' && u.includes('/api/v1/')) return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'content-type,authorization,accept,x-nova-pin' } });
    if (u.includes('/emergency/stock.json')) return r.fulfill({ status: 200, contentType: 'application/json', body: snapshot });
    if (u.startsWith(origin) && /^\/(whatsapp|wa)\/?$/.test(new URL(u).pathname) && m === 'GET') return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: indexHtml });
    if (u.startsWith(origin) && (m === 'GET' || m === 'HEAD')) return r.continue();
    if (u.endsWith('/api/v1/auth/login') && m === 'POST') {
      const b = JSON.parse(q.postData() || '{}'); log.logins.push(b.username); const acc = USERS[b.username];
      if (!acc || acc[0] !== b.password) return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'AUTH_INVALID_CREDENTIALS' }) });
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, access_token: TOKEN, refresh_token: 'R'.repeat(64), expires_in: 3600, refresh_expires_in: 12 * 3600, user: b.username, role: acc[1] }) });
    }
    if (u.endsWith('/api/v1/auth/logout') && m === 'POST') return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"ok":true}' });
    if (u.includes('/api/v1/inbox/history/') && m === 'GET') {
      log.history.push(u);
      const auth = q.headers()['authorization'] || '';
      // the fake server behaves like backend/src/inbox-history.js: no valid staff session => 401, no data
      if (auth !== 'Bearer ' + TOKEN) { log.historyNoAuth.push(u); return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'AUTH_REQUIRED' }) }); }
      const id = new URL(u).searchParams.get('id');
      const body = u.includes('/push/key') ? { ok: true, enabled: false } : u.includes('/conversations') ? { ok: true, conversations: list() } : u.includes('/names') ? { ok: true, names: {} } : { ok: true, conversation: chats[id] ? { id, customer: chats[id].customer, updatedAt: NOW, messages: chats[id].messages } : null };
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    }
    if (m !== 'GET' && m !== 'HEAD') { log.bad.push(m + ' ' + u); return r.abort(); }
    return r.abort();
  });
  await ctx.addInitScript(() => { window.NOVA_STAFF_GATE = true; window.NOVA_STOCK_PROBE = true; try { localStorage.setItem('nova.flags.inboxSend', '0'); } catch {} });
  return { ctx, log };
}
async function open(ctx, path) {
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE.replace(/\/$/, '') + path, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.novaStaff, null, { timeout: 8000 });
  await page.waitForTimeout(1200);
  return { page, errs };
}
const gateShown = (page) => page.evaluate(() => { const g = document.getElementById('novaStaffGate'); if (!g) return false; const r = g.getBoundingClientRect(); return getComputedStyle(g).visibility !== 'hidden' && r.width > 300 && r.height > 600; });
const appHidden = (page) => page.evaluate(() => document.documentElement.classList.contains('nova-staff-locked') && [...document.body.children].filter((e) => e.id !== 'novaStaffGate' && e.tagName !== 'SCRIPT' && e.tagName !== 'STYLE').every((e) => getComputedStyle(e).visibility === 'hidden'));
const visibleText = (page) => page.evaluate(() => { const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let x; while ((x = w.nextNode())) { const p = x.parentElement; if (p && getComputedStyle(p).visibility !== 'hidden' && p.getClientRects().length) out.push(x.textContent); } return out.join(' '); });
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
async function login(page, name, pw) {
  await page.fill('#novaStaffName', name); await page.fill('#novaStaffPw', pw); await page.click('#novaStaffGo');
}

await t('/ logged out, first run (no account, backend off): only the owner-creation screen; app hidden; no sale possible', async () => {
  const { ctx, log } = await context(); const { page, errs } = await open(ctx, '/');
  assert.equal(await gateShown(page), true); assert.equal(await appHidden(page), true);
  assert.equal(await page.getAttribute('#novaStaffGate', 'data-mode'), 'first');
  assert.equal(await page.getAttribute('#novaStaffGate', 'dir'), 'rtl');
  assert.match(await page.textContent('#novaStaffTitle'), /إنشاء حساب المالك/);
  assert.equal(await page.locator('#novaStaffPw2').count(), 1, 'first run asks to confirm the new password');
  assert.equal(await page.evaluate(() => window.novaStaff.allow('sale.create')), false, 'no sale finalize without a session');
  assert.equal(await page.locator('#waHistPin, [data-wa-pin], #novaPinStrip').count(), 0, 'old PIN strip is not back');
  await shot(page, 'root-first-run-390');
  assert.deepEqual(log.history, []); assert.deepEqual(log.bad, []); assert.deepEqual(errs, []);
  await ctx.close();
});

await t('/whatsapp logged out: login screen only, no customer thread in the page, history API never called', async () => {
  const { ctx, log } = await context(); const { page, errs } = await open(ctx, '/whatsapp');
  assert.equal(await gateShown(page), true); assert.equal(await appHidden(page), true);
  assert.equal(await page.getAttribute('#novaStaffGate', 'data-mode'), 'login');
  assert.equal(await page.getAttribute('#novaStaffGate', 'data-server'), '1');
  const txt = await page.evaluate(() => document.body.innerText);
  assert.ok(!txt.includes(FAKE_NAME.slice(0, 6)) && !(await page.content()).includes(FAKE_TEXT), 'no customer data in the DOM');
  assert.deepEqual(log.history, [], 'no history request without a session');
  await shot(page, 'whatsapp-login-390');
  assert.deepEqual(log.bad, []); assert.deepEqual(errs, []);
  await ctx.close();
});

await t('/?app=whatsapp logged out: same gate, no history request', async () => {
  const { ctx, log } = await context(); const { page, errs } = await open(ctx, '/?app=whatsapp');
  assert.equal(await gateShown(page), true); assert.equal(await page.getAttribute('#novaStaffGate', 'data-server'), '1');
  assert.deepEqual(log.history, []); assert.deepEqual(log.bad, []); assert.deepEqual(errs, []);
  await ctx.close();
});

await t('the fake server answers 401 to a history call without a bearer (shape of backend inbox-history.js)', async () => {
  const { ctx, log } = await context(); const { page } = await open(ctx, '/whatsapp');
  const st = await page.evaluate(async () => (await fetch('https://nova-rx-api-staging.elsousypharmacy.workers.dev/api/v1/inbox/history/conversations', { credentials: 'omit' })).status);
  assert.equal(st, 401); assert.equal(log.historyNoAuth.length, 1);
  await ctx.close();
});

let cashierCtx;
await t('/whatsapp: wrong password refused; cashier login opens the chats with a Bearer (fake data)', async () => {
  const { ctx, log } = await context(); cashierCtx = { ctx, log }; const { page, errs } = await open(ctx, '/whatsapp');
  await login(page, 'mona.cashier', 'wrong-fake');
  await page.waitForFunction(() => /غير صحيحة/.test(document.getElementById('novaStaffMsg').textContent));
  assert.equal(await page.evaluate(() => window.novaStaff.current()), null); assert.deepEqual(log.history, []);
  await shot(page, 'whatsapp-login-wrong-390');
  await login(page, 'mona.cashier', 'fake-pass-1');
  await page.waitForFunction(() => !document.getElementById('novaStaffGate') && !document.documentElement.classList.contains('nova-staff-locked'), null, { timeout: 8000 });
  await page.waitForFunction((nm) => document.body.innerText.includes(nm), FAKE_NAME, { timeout: 8000 });
  assert.ok(log.history.length > 0); assert.deepEqual(log.historyNoAuth, [], 'every history call carried the staff bearer');
  assert.equal(await page.evaluate(() => window.novaStaff.current().role), 'cashier');
  assert.equal(await page.evaluate(() => window.novaStaff.allow('sale.create')), true, 'cashier can sell');
  assert.equal(await page.evaluate(() => window.novaStaff.allow('accounts.manage')), false, 'cashier cannot manage accounts');
  await shot(page, 'whatsapp-signed-in-fake-390');
  assert.deepEqual(log.bad, []); assert.deepEqual(errs, []);
  await page.close();
});

await t('cashier on / (same device, session kept): app opens, account management is not offered', async () => {
  const { ctx, log } = cashierCtx; const { page, errs } = await open(ctx, '/');
  assert.equal(await page.locator('#novaStaffGate').count(), 0); assert.equal(await page.evaluate(() => document.documentElement.classList.contains('nova-staff-locked')), false);
  await page.evaluate(() => { const b = document.querySelector('.nova-tab[data-page=settings]'); if (b) b.click(); });
  await page.waitForSelector('#novaAuthCard', { state: 'attached', timeout: 8000 });
  await page.waitForFunction(() => !!document.getElementById('novaAuthNoManage'), null, { timeout: 8000 });
  assert.equal(await page.locator('#novaNewForm, #novaNewOk, [data-revoke], [data-untrust], #novaPermMatrix').count(), 0, 'no account/session/device/matrix controls for a cashier');
  await page.evaluate(() => document.getElementById('novaAuthCard').scrollIntoView({ block: 'center' }));
  await shot(page, 'root-cashier-settings-390');
  assert.deepEqual(log.bad, []); assert.deepEqual(errs, []);
  await page.close();
});

await t('logout on /whatsapp drops the chats and shows the login again', async () => {
  const { ctx, log } = cashierCtx; const { page, errs } = await open(ctx, '/whatsapp');
  await page.waitForFunction((nm) => document.body.innerText.includes(nm), FAKE_NAME, { timeout: 8000 });
  await page.evaluate(() => window.novaStaff.logout());
  await page.waitForSelector('#novaStaffGate');
  assert.equal(await appHidden(page), true);
  assert.ok(!(await visibleText(page)).includes(FAKE_NAME), 'no visible customer name after logout');
  const before = log.history.length; await page.waitForTimeout(6000);
  assert.equal(log.history.length, before, 'no history polling after logout');
  assert.deepEqual(log.bad, []); assert.deepEqual(errs, []);
  await ctx.close();
});

await t('/ first run: owner creates the first account (fake), app opens, owner sees account management', async () => {
  const { ctx, log } = await context(); const { page, errs } = await open(ctx, '/');
  await page.fill('#novaStaffName', 'boss.local'); await page.fill('#novaStaffPw', 'fake-pass-9'); await page.fill('#novaStaffPw2', 'fake-pass-8'); await page.click('#novaStaffGo');
  await page.waitForFunction(() => /متطابقتين/.test(document.getElementById('novaStaffMsg').textContent));
  await page.fill('#novaStaffPw', 'fake-pass-9'); await page.fill('#novaStaffPw2', 'fake-pass-9'); await page.click('#novaStaffGo');
  await page.waitForFunction(() => !document.getElementById('novaStaffGate'), null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => window.novaStaff.current().role), 'owner');
  assert.equal(await page.evaluate(() => window.novaStaff.allow('accounts.manage')), true);
  await page.evaluate(() => { const b = document.querySelector('.nova-tab[data-page=settings]'); if (b) b.click(); });
  await page.waitForSelector('#novaAuthCard', { state: 'attached', timeout: 8000 });
  assert.equal(await page.locator('#novaAuthNoManage').count(), 0);
  assert.ok((await page.locator('#novaNewOk').count()) === 1, 'owner can add accounts');
  await shot(page, 'root-owner-signed-in-390');
  assert.deepEqual(log.history, [], '/ with backend off never asks for chats'); assert.deepEqual(log.bad, []); assert.deepEqual(errs, []);
  await ctx.close();
});

await t('1280x800: /whatsapp login screen is centred and the app stays hidden', async () => {
  const { ctx, log } = await context({ width: 1280, height: 800 }); const { page, errs } = await open(ctx, '/whatsapp');
  assert.equal(await appHidden(page), true);
  const box = await page.locator('#novaStaffGate .nsg-card').boundingBox();
  assert.ok(box.width <= 380 && Math.abs(box.x + box.width / 2 - 640) < 4, 'card centred');
  await shot(page, 'whatsapp-login-1280');
  assert.deepEqual(log.history, []); assert.deepEqual(log.bad, []); assert.deepEqual(errs, []);
  await ctx.close();
});

console.log(`ui-sec01-staff-gate: ${n} passed`); await browser.close();
