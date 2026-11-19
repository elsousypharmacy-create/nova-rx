// UX420: opening conversations with permission already granted replaces a day-old push subscription (a dead one was never renewed) and keeps a fresh one. Fakes only.
// (from ux414) bell with the server push ENABLED: permission -> subscribe -> POST push/subscribe; no «مش متفعلة» toast. Fakes only.
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
const STALE = process.env.STALE !== '0';
const page = await ctx.newPage(); await page.addInitScript((st) => { try { localStorage.setItem('nova.wa.pushAt', String(st ? 1000 : Date.now())); } catch (e) {} }, STALE); const errors = [];
await page.addInitScript(() => {
  const w = window; w.__t = { perm: 'granted', ask: 0, sub: 0, unsub: 0, existing: true };
  function N() {} Object.defineProperty(N, 'permission', { get: () => w.__t.perm });
  N.requestPermission = () => { w.__t.ask++; w.__t.perm = 'granted'; return Promise.resolve('granted'); };
  w.Notification = N; w.PushManager = function () {};
  const sub = { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/fake414', keys: { p256dh: 'x', auth: 'y' } }) };
  const reg = { pushManager: { getSubscription: async () => (w.__t.existing ? Object.assign({ unsubscribe: async () => { w.__t.unsub++; w.__t.existing = false; return true; } }, sub) : null), subscribe: async (o) => { w.__t.sub++; w.__t.existing = true; w.__t.key = o && o.applicationServerKey && o.applicationServerKey.length; return sub; } } };
  Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve(reg), register: async () => reg, getRegistration: async () => reg, addEventListener() {}, removeEventListener() {} }, configurable: true });
});
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(400);
await page.locator('#novaWaBtn').click();
await page.locator('#novaInboxView [data-conv="'+conv.id+'"]').waitFor();
await page.waitForTimeout(1500);
const t = await page.evaluate(() => window.__t);
if (STALE) assert.deepEqual([t.unsub, t.sub, globalThis.__posted], [1, 1, 1], 'stale subscription dropped, fresh one registered, server told once');
else assert.deepEqual([t.unsub, t.sub, globalThis.__posted], [0, 0, 1], 'fresh subscription kept, only re-registered');
assert.deepEqual(errors, [], 'no page errors');
console.log('PASS ux420 stale push subscription (stale=' + STALE + ')');
await browser.close();
