// UX414: bell with the server push ENABLED: permission -> subscribe -> POST push/subscribe; no «مش متفعلة» toast. Fakes only.
// (derived from ux409)  = home + «المحادثات» + ONE bell button; no notifications row, no pill text.
// UX410: the permission/push explanation is a short toast on bell tap only, never a persistent hint row.
// 390x844, fake data only (history API via page.route, Notification faked). Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux409-wa-bell.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-15T12:00:00+03:00');
const origin = new URL(BASE).origin;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG', timezoneId: 'Africa/Cairo', serviceWorkers: 'block', hasTouch: true, isMobile: true });
const conv = { id: 'wa_201000000409', customer: 'منى (تجربة)', updatedAt: NOW, count: 1, last: { id: 'm1', dir: 'in', kind: 'in', text: 'ازيك', at: NOW } };
await ctx.route('**/*', (r) => {
  const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin };
  if (q.method() === 'OPTIONS' && u.includes('/api/v1/inbox/history/')) return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'content-type,accept' } });
  if (q.method() === 'POST' && u.includes('/push/subscribe')) { globalThis.__posted = (globalThis.__posted || 0) + 1; return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"ok":true}' }); }
  if (q.method() !== 'GET' && q.method() !== 'HEAD') return r.abort();
  if (u.includes('/push/key')) return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, enabled: true, publicKey: 'B' + 'A'.repeat(86) }) });
  if (u.includes('/api/v1/inbox/history/')) {
    const body = u.includes('/conversations') ? { ok: true, conversations: [conv] } : { ok: true, conversation: { id: conv.id, customer: conv.customer, updatedAt: NOW, messages: [conv.last] } };
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
  }
  return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
});
const page = await ctx.newPage(); const errors = [];
await page.addInitScript(() => {
  const w = window; w.__t = { perm: 'default', ask: 0, sub: 0 };
  function N() {} Object.defineProperty(N, 'permission', { get: () => w.__t.perm });
  N.requestPermission = () => { w.__t.ask++; w.__t.perm = 'granted'; return Promise.resolve('granted'); };
  w.Notification = N; w.PushManager = function () {};
  const sub = { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/fake414', keys: { p256dh: 'x', auth: 'y' } }) };
  const reg = { pushManager: { getSubscription: async () => null, subscribe: async (o) => { w.__t.sub++; w.__t.key = o && o.applicationServerKey && o.applicationServerKey.length; return sub; } } };
  Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve(reg), register: async () => reg, getRegistration: async () => reg, addEventListener() {}, removeEventListener() {} }, configurable: true });
});
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(400);
await page.locator('#novaWaBtn').click();
const view = page.locator('#novaInboxView');
await view.locator(`[data-conv="${conv.id}"]`).waitFor();
const bell = view.locator('.wa-side-head [data-wa-notify]');
assert.equal(await bell.getAttribute('aria-pressed'), 'false', 'off before permission');
await bell.click();
await page.waitForFunction(() => window.__t.sub === 1, null, { timeout: 5000 });
await page.waitForTimeout(500);
const t = await page.evaluate(() => window.__t);
assert.deepEqual([t.ask, t.sub, t.key], [1, 1, 65], 'asked once, subscribed once with a 65-byte VAPID key');
assert.equal(await bell.getAttribute('aria-pressed'), 'true', 'bell on');
assert.equal(await view.locator('[data-wa-notif-note]').count(), 0, 'no «لسه مش متفعلة» toast when the server is enabled');
assert.ok(!/مش متفعلة على السيرفر/.test(await view.innerText()), 'toast text absent');
assert.deepEqual(errors, [], 'no page errors');
console.log('ALL PASS ux414 bell: permission -> subscribe -> on, no server-disabled toast');
await browser.close();
