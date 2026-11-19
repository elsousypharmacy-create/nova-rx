// UX419: Settings > WhatsApp notifications card: status of THIS device, enable / renew (drops a stale subscription, registers a fresh one),
// local test notification. Notification / PushManager / service worker are FAKED; the history API is stubbed (no real push, no real send).
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux419-push-card.mjs   (SHOTS=dir to save a screenshot)
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/', SHOTS = process.env.SHOTS || '';
const origin = new URL(BASE).origin;
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let n = 0; const ok = (m) => { n++; console.log('ok -', m); };
async function open({ perm = 'default', existing = false, pushEnabled = true, subStatus = 200, lang = 'ar', pm = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: lang === 'en' ? 'en-US' : 'ar-EG', serviceWorkers: 'block', hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const st = { posts: [], other: [] };
  await ctx.addInitScript(([p, ex, l, usePm]) => {
    const w = window; w.__t = { perm: p, ask: 0, unsub: 0, sub: 0, show: [], existing: ex };
    try { localStorage.setItem('nova-rx-language', l); } catch (e) {}
    function N() {} Object.defineProperty(N, 'permission', { get: () => w.__t.perm });
    N.requestPermission = (cb) => { w.__t.ask++; w.__t.perm = 'granted'; if (cb) cb('granted'); return Promise.resolve('granted'); };
    w.Notification = N; if (usePm) w.PushManager = function () {}; else { try { delete w.PushManager; } catch (e) {} try { Object.defineProperty(w, 'PushManager', { value: undefined, configurable: true }); } catch (e) {} }
    const mk = () => ({ endpoint: 'https://web.push.apple.com/fake419', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'x', auth: 'y' } }; }, unsubscribe: async () => { w.__t.unsub++; w.__t.existing = false; return true; } });
    const reg = { pushManager: { getSubscription: async () => (w.__t.existing ? mk() : null), subscribe: async () => { w.__t.sub++; w.__t.existing = true; return mk(); } }, showNotification: async (t, o) => { w.__t.show.push([t, o && o.tag]); } };
    Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve(reg), register: async () => reg, getRegistration: async () => reg, addEventListener() {}, removeEventListener() {} }, configurable: true });
  }, [perm, existing, lang, pm]);
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (q.method() === 'POST' && u.includes('/push/subscribe')) { st.posts.push(1); return r.fulfill({ status: subStatus, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: subStatus === 200 }) }); }
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { st.other.push(q.method() + ' ' + u); return r.abort(); }
    if (u.includes('/emergency/stock.json')) return r.fulfill({ status: 200, contentType: 'application/json', body: snapshot });
    if (u.includes('/push/key')) return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, enabled: pushEnabled, publicKey: pushEnabled ? 'B' + 'A'.repeat(86) : null }) });
    if (u.includes('/api/v1/inbox/history/')) return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, conversations: [], conversation: null }) });
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + 'index.html#settings', { waitUntil: 'load' }); await page.locator('#novaPushCard').waitFor(); await page.waitForTimeout(500);
  return { ctx, page, errors, st };
}
const state = (page) => page.evaluate(() => { const e = document.getElementById('novaPushState'); return [e.textContent.trim(), e.getAttribute('data-state')]; });
const T = (page) => page.evaluate(() => window.__t);
const press = async (page, k) => { await page.locator(`[data-nova-push=${k}]`).click(); await page.waitForTimeout(500); };

{ // not enabled yet -> Enable asks once, subscribes once, tells the server
  const { ctx, page, errors, st } = await open({ perm: 'default' });
  let s = await state(page); assert.equal(s[1], 'off'); assert.match(s[0], /لسه ما اتفعلتش/);
  if (SHOTS) await page.locator('#novaPushCard').screenshot({ path: SHOTS + '/ux419-card.png' });
  await press(page, 'renew'); const t = await T(page); assert.deepEqual([t.ask, t.unsub, t.sub, st.posts.length], [1, 0, 1, 1], 'asked once, subscribed once, server told once'); s = await state(page); assert.equal(s[1], 'on'); assert.match(s[0], /تم التفعيل/);
  assert.deepEqual(errors, []); assert.deepEqual(st.other, []); await ctx.close(); ok('not enabled: Enable asks for permission, subscribes and registers the device');
}
{ // enabled and healthy -> status says so (with the push service), Renew replaces the subscription
  const { ctx, page, st } = await open({ perm: 'granted', existing: true });
  let s = await state(page); assert.equal(s[1], 'on'); assert.match(s[0], /شغالة على الجهاز ده/); assert.match(s[0], /Apple/);
  await press(page, 'renew'); const t = await T(page); assert.deepEqual([t.ask, t.unsub, t.sub, st.posts.length], [0, 1, 1, 1], 'old subscription dropped, a fresh one registered and sent to the server, no new permission prompt');
  s = await state(page); assert.equal(s[1], 'on'); await ctx.close(); ok('Renew drops the old subscription and registers a fresh one');
}
{ // permission yes but nothing registered
  const { ctx, page } = await open({ perm: 'granted', existing: false }); const s = await state(page); assert.equal(s[1], 'nosub'); assert.match(s[0], /مش مسجّلة/); await ctx.close(); ok('permission without a registered subscription is called out');
}
{ // blocked
  const { ctx, page, st } = await open({ perm: 'denied' }); let s = await state(page); assert.equal(s[1], 'denied'); assert.match(s[0], /مقفولة/);
  await press(page, 'renew'); const t = await T(page); assert.deepEqual([t.ask, t.sub, st.posts.length], [0, 0, 0], 'nothing is attempted while blocked'); await press(page, 'test'); assert.equal((await T(page)).show.length, 0, 'no test notification while blocked'); await ctx.close(); ok('blocked notifications: clear message, nothing attempted');
}
{ // server without push
  const { ctx, page, st } = await open({ perm: 'granted', existing: true, pushEnabled: false }); await press(page, 'renew'); const s = await state(page); assert.equal(s[1], 'server'); assert.match(s[0], /مش متفعلة على السيرفر/); assert.equal(st.posts.length, 0); await ctx.close(); ok('server without push keys: says so, registers nothing');
}
{ // server rejects the registration
  const { ctx, page } = await open({ perm: 'granted', existing: false, subStatus: 500 }); await press(page, 'renew'); const s = await state(page); assert.equal(s[1], 'error'); assert.match(s[0], /http 500/); await ctx.close(); ok('a rejected registration shows the reason');
}
{ // local test notification
  const { ctx, page } = await open({ perm: 'granted', existing: true }); await press(page, 'test'); const t = await T(page); assert.deepEqual(t.show, [['NOVA Rx', 'nova-test']], 'one local test notification'); const s = await state(page); assert.equal(s[1], 'tested'); await ctx.close(); ok('Test notification shows one local notification');
}
{ // browser without background push
  const { ctx, page } = await open({ perm: 'granted', pm: false }); const s = await state(page); assert.equal(s[1], 'page-only'); await ctx.close(); ok('a browser without background push is explained');
}
{ // English
  const { ctx, page } = await open({ perm: 'granted', existing: true, lang: 'en' }); const card = (await page.locator('#novaPushCard').innerText()).replace(/\s+/g, ' ');
  assert.ok(/WhatsApp notifications/.test(card) && /Enable \/ renew/.test(card) && /Test notification/.test(card) && /On for this device/.test(card), card); assert.ok(!/[؀-ۿ]/.test(card), 'no Arabic left in English mode: ' + card); await ctx.close(); ok('English labels and status');
}
await browser.close();
console.log(`PASS ux419 push card: ${n} groups`);
