// UX406: new-message notifications on the conversations screen. 1366x768 + 390x844, fake data only:
// history API answered by page.route; Notification, AudioContext and the Service Worker/PushManager are fakes injected
// before the page loads (no real push vendor, no real SW). Every non-GET is aborted except the faked push/subscribe call,
// which is answered inside the browser and recorded (never reaches a server). No WhatsApp send, no PIN, no live customer.
// Covers: permission button (default -> granted, dismissed, denied; never re-prompts by itself), in-app sound hook (mocked),
// per-chat unread badge, «المحادثات» tab badge, document.title count in the background and restore on focus, mute toggle,
// SW push message -> badge/title, notification click -> opens the chat.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux406-wa-notify.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-15T12:00:00+03:00');
const A = 'wa_201000000406', B = 'wa_201000000407', C = 'wa_201000000408';
const FAKE_KEY = 'B' + 'A'.repeat(86); // 65 bytes base64url, fake (not a real VAPID key)
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;

const FAKES = () => {
  const w = window;
  w.__t = { snd: 0, ask: 0, perm: 'default', answer: 'granted', focus: true, hidden: false, subs: 0, swl: [] };
  class FakeAC { constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createOscillator() { return { type: '', frequency: { setValueAtTime() {} }, connect() {}, start() { w.__t.snd++; }, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } resume() {} }
  w.AudioContext = FakeAC; w.webkitAudioContext = FakeAC;
  function N() {} Object.defineProperty(N, 'permission', { get: () => w.__t.perm });
  N.requestPermission = () => { w.__t.ask++; return new Promise((res) => setTimeout(() => { if (w.__t.answer !== 'default') w.__t.perm = w.__t.answer; res(w.__t.answer); }, 30)); };
  w.Notification = N; w.PushManager = function () {};
  let sub = null;
  const reg = { pushManager: { getSubscription: async () => sub, subscribe: async (o) => { w.__t.subOpts = { uvo: o.userVisibleOnly, keyLen: o.applicationServerKey.length }; sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/fake-ux406', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) } }; } }; return sub; } } };
  const sw = { ready: Promise.resolve(reg), register: async () => reg, getRegistration: async () => reg, addEventListener: (t, f) => { if (t === 'message') w.__t.swl.push(f); }, removeEventListener() {} };
  Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true });
  w.__swEmit = (data) => w.__t.swl.forEach((f) => f({ data }));
  Object.defineProperty(document, 'hidden', { get: () => w.__t.hidden, configurable: true });
  Object.defineProperty(document, 'visibilityState', { get: () => (w.__t.hidden ? 'hidden' : 'visible'), configurable: true });
  document.hasFocus = () => w.__t.focus;
  w.__bg = (on) => { w.__t.hidden = on; w.__t.focus = !on; document.dispatchEvent(new Event('visibilitychange')); w.dispatchEvent(new Event(on ? 'blur' : 'focus')); };
};

const M = (id, dir, at, text, kind) => ({ id, dir, kind: kind || (dir === 'in' ? 'in' : 'bot'), text, at, status: dir === 'out' ? 'read' : null });
for (const vp of [{ width: 1366, height: 768, name: 'desktop', touch: false }, { width: 390, height: 844, name: 'mobile', touch: true }]) {
  const data = {
    [A]: { customer: 'منى (تجربة)', messages: [M('a1', 'in', NOW - 3600e3, 'عايزة بنادول'), M('a2', 'out', NOW - 3500e3, 'متوفر')] },
    [B]: { customer: 'سعيد (تجربة)', messages: [M('b1', 'in', NOW - 7200e3, 'السلام عليكم')] },
  };
  const list = () => Object.entries(data).map(([id, c]) => ({ id, customer: c.customer, updatedAt: c.messages[c.messages.length - 1].at, count: c.messages.length, last: c.messages[c.messages.length - 1] }));
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'ar-EG', timezoneId: 'Africa/Cairo', serviceWorkers: 'block', hasTouch: vp.touch, isMobile: vp.touch, deviceScaleFactor: 1 });
  const other = [], subscribed = [];
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin };
    if (u.includes('/api/v1/inbox/history/') && q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'content-type,accept' } });
    if (u.includes('/api/v1/inbox/history/push/subscribe') && q.method() === 'POST') { subscribed.push(JSON.parse(q.postData() || '{}')); return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"ok":true,"subscribed":true}' }); }
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { other.push(q.method() + ' ' + u); return r.abort(); }
    if (u.includes('/api/v1/inbox/history/')) {
      const id = new URL(u).searchParams.get('id');
      const body = u.includes('/push/key') ? { ok: true, enabled: true, publicKey: FAKE_KEY }
        : u.includes('/conversations') ? { ok: true, conversations: list() }
        : { ok: true, conversation: data[id] ? { id, customer: data[id].customer, updatedAt: NOW, messages: data[id].messages } : null };
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage(); const errors = [];
  await page.addInitScript(FAKES);
  await page.clock.setFixedTime(new Date(NOW));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const title0 = await page.title();
  await page.locator('#novaWaBtn').click();
  const view = page.locator('#novaInboxView');
  await view.locator(`[data-conv="${B}"]`).waitFor();
  const T = () => page.evaluate(() => ({ ...window.__t, swl: undefined }));
  const tabBadge = () => page.evaluate(() => { const b = document.querySelector('#novaInboxTab [data-wa-tab-unread]'); return b ? { hidden: b.hidden, n: b.textContent } : null; });
  const unreadOf = (id) => page.evaluate((id) => { const b = document.querySelector(`[data-conv="${id}"] [data-unread]`); return b ? b.dataset.unread : null; }, id);

  // 1) old history is never "unread"; permission button in the header, default state
  assert.deepEqual([await unreadOf(A), await unreadOf(B)], [null, null]);
  assert.deepEqual(await tabBadge(), { hidden: true, n: '' });
  const nb = view.locator('[data-wa-notify]');
  assert.equal(await nb.getAttribute('data-wa-notify'), 'default');
  assert.match(await nb.textContent(), /فعّل الإشعارات/);
  const box = await nb.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= vp.width + 0.5 && box.height >= (vp.touch ? 44 : 36), vp.name + ' notify button visible + target ' + JSON.stringify(box));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal overflow');
  assert.equal((await T()).ask, 0, 'never asks without a click');

  // 2) a new customer message arrives (poll) while visible: sound, per-chat badge, tab badge; title untouched while visible
  data[B].messages.push(M('b2', 'in', NOW + 60e3, 'محتاج روشتة'));
  await page.waitForFunction((id) => document.querySelector(`[data-conv="${id}"] [data-unread]`), B, { timeout: 9000 });
  assert.equal(await unreadOf(B), '1');
  assert.deepEqual(await tabBadge(), { hidden: false, n: '1' });
  assert.equal((await T()).snd, 1, 'in-app sound once');
  assert.equal(await page.title(), title0);
  // a bot reply is not unread and makes no sound
  data[A].messages.push(M('a3', 'out', NOW + 61e3, 'رد آلي', 'bot'));
  await page.waitForTimeout(4600);
  assert.deepEqual([await unreadOf(A), (await T()).snd], [null, 1]);

  // 3) background: title count; a SW push message bumps another chat; focus restores the title
  await page.evaluate(() => window.__bg(true));
  assert.equal(await page.title(), '(1) ' + title0);
  await page.evaluate((c) => window.__swEmit({ type: 'nova-wa-push', chat: c, chats: [c], count: 2 }), C);
  assert.equal(await page.title(), '(2) ' + title0);
  assert.deepEqual(await tabBadge(), { hidden: false, n: '2' });
  assert.equal((await T()).snd, 1, 'no in-app sound while hidden (system notification handles it)');
  await page.evaluate(() => window.__bg(false));
  assert.equal(await page.title(), title0, 'title restored on focus');
  assert.deepEqual(await tabBadge(), { hidden: false, n: '2' });

  // 4) opening the chat clears its badge
  await view.locator(`[data-conv="${B}"]`).click();
  await view.locator('[data-mid="b2"]').waitFor();
  if (vp.touch) await view.locator('[data-wa-back]').click();
  await page.waitForFunction(() => document.querySelector('#novaInboxTab [data-wa-tab-unread]').textContent === '1');
  assert.equal(await unreadOf(B), null);

  // 5) mute: next message => badge but no sound; unmute restores
  await view.locator('[data-wa-mute]').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('nova.wa.mute')), '1');
  assert.equal(await view.locator('[data-wa-mute]').getAttribute('aria-pressed'), 'true');
  data[A].messages.push(M('a4', 'in', NOW + 120e3, 'لو سمحت'));
  await page.waitForFunction((id) => document.querySelector(`[data-conv="${id}"] [data-unread]`), A, { timeout: 9000 });
  assert.equal((await T()).snd, 1, 'muted => silent');
  await view.locator('[data-wa-mute]').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('nova.wa.mute')), '0');

  // 6) permission: dismissed => one ask, Arabic note, no re-prompt loop
  await page.evaluate(() => { window.__t.answer = 'default'; });
  await view.locator('[data-wa-notify]').click();
  await view.locator('[data-wa-notif-note]').waitFor();
  await page.waitForTimeout(800);
  assert.equal((await T()).ask, 1);
  assert.match(await view.locator('[data-wa-notif-note]').textContent(), /ما اتفعلتش/);
  // granted => subscribe once through the faked API
  await page.evaluate(() => { window.__t.answer = 'granted'; });
  await view.locator('[data-wa-notify]').click();
  await page.waitForFunction(() => document.querySelector('[data-wa-notify]')?.dataset.waNotify === 'granted');
  await page.waitForFunction(() => true);
  await page.waitForTimeout(300);
  const t6 = await T();
  assert.equal(t6.ask, 2);
  assert.deepEqual(t6.subOpts, { uvo: true, keyLen: 65 });
  assert.equal(subscribed.length, 1);
  assert.equal(subscribed[0].subscription.endpoint, 'https://fcm.googleapis.com/fcm/send/fake-ux406');
  assert.match(await view.locator('[data-wa-notify]').textContent(), /الإشعارات شغّالة/);
  assert.equal(await view.locator('[data-wa-notif-note]').count(), 0);
  // denied => help text, requestPermission is NOT called again
  await page.evaluate(() => { window.__t.perm = 'denied'; });
  await view.locator('[data-wa-mute]').click(); await view.locator('[data-wa-mute]').click(); // redraw
  assert.equal(await view.locator('[data-wa-notify]').getAttribute('data-wa-notify'), 'denied');
  await view.locator('[data-wa-notify]').click();
  await view.locator('[data-wa-notif-note]').waitFor();
  assert.match(await view.locator('[data-wa-notif-note]').textContent(), /إعدادات الموقع/);
  assert.equal((await T()).ask, 2, 'denied never re-prompts');

  // 7) notification click (SW 'nova-wa-open') opens that chat
  await page.evaluate((c) => window.__swEmit({ type: 'nova-wa-open', chat: c }), A);
  await view.locator('[data-mid="a4"]').waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('[data-wa-root]').dataset.view), 'chat');

  await page.waitForTimeout(400);
  await page.screenshot({ path: `tests/ux/__screenshots__/ux406-${vp.name}.png` });
  assert.deepEqual(other, [], 'no non-GET except the faked push/subscribe');
  assert.deepEqual(errors, [], 'no page errors');
  console.log('ok', vp.name, JSON.stringify({ sounds: (await T()).snd, asks: (await T()).ask, subscribed: subscribed.length }));
  await ctx.close();
}
await browser.close();
console.log('ux406-wa-notify OK');
