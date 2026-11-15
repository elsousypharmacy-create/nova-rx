// UX409: conversations list header = home + «المحادثات» + ONE bell button; no notifications row, no pill text.
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
  if (q.method() === 'OPTIONS' && u.includes('/api/v1/inbox/history/')) return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'content-type,accept' } });
  if (q.method() !== 'GET' && q.method() !== 'HEAD') return r.abort();
  if (u.includes('/api/v1/inbox/history/')) {
    const body = u.includes('/conversations') ? { ok: true, conversations: [conv] } : { ok: true, conversation: { id: conv.id, customer: conv.customer, updatedAt: NOW, messages: [conv.last] } };
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
  }
  return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
});
const page = await ctx.newPage(); const errors = [];
await page.addInitScript(() => {
  const w = window; w.__t = { perm: 'default', ask: 0 };
  function N() {} Object.defineProperty(N, 'permission', { get: () => w.__t.perm });
  N.requestPermission = () => { w.__t.ask++; w.__t.perm = 'granted'; return Promise.resolve('granted'); };
  w.Notification = N;
});
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(400);
await page.locator('#novaWaBtn').click();
const view = page.locator('#novaInboxView');
await view.locator(`[data-conv="${conv.id}"]`).waitFor();

assert.equal(await view.locator('[data-wa-notifbar]').count(), 0, 'no notifications row');
assert.equal(await view.locator('[data-wa-mute]').count(), 0, 'no separate bell/mute button');
assert.equal(await view.locator('[data-wa-notify]').count(), 1, 'exactly one bell');
assert.ok(!/الإشعارات شغّالة|فعّل الإشعارات/.test(await view.textContent()), 'no pill text');
const bell = view.locator('.wa-side-head [data-wa-notify]');
assert.equal(await bell.count(), 1, 'bell lives in the list header');
assert.match(await bell.getAttribute('aria-label'), /إشعارات/);
const [bb, tb, sb] = await Promise.all([bell.boundingBox(), view.locator('.wa-title').boundingBox(), view.locator('#waSearch').boundingBox()]);
const hb = await view.locator('.wa-side-head').boundingBox();
assert.ok(bb.y >= hb.y && bb.y + bb.height <= hb.y + hb.height + 0.5, 'bell inside the header box');
assert.ok(Math.abs((bb.y + bb.height / 2) - (tb.y + tb.height / 2)) < 20, 'bell on the title line');
assert.ok(bb.width >= 44 && bb.height >= 44, 'touch target');
assert.ok(sb.y - (hb.y + hb.height) < 40, 'search directly under the header: gap ' + (sb.y - (hb.y + hb.height)));
assert.equal(await view.locator('[data-wa-chips]').count(), 1, 'UX408 chips intact');
assert.equal((await page.evaluate(() => window.__t)).ask, 0, 'never asks without a tap');

// off state: bell-slash (aria-pressed=false); tap requests permission, then is on; tap again mutes, again unmutes
assert.equal(await bell.getAttribute('aria-pressed'), 'false');
await bell.click();
await page.waitForFunction(() => document.querySelector('[data-wa-notify]')?.dataset.waNotify === 'granted');
assert.equal((await page.evaluate(() => window.__t)).ask, 1);
assert.equal(await view.locator('[data-wa-notify]').getAttribute('aria-pressed'), 'true');
await view.locator('[data-wa-notify]').click();
assert.equal(await page.evaluate(() => localStorage.getItem('nova.wa.mute')), '1');
assert.equal(await view.locator('[data-wa-notify]').getAttribute('aria-pressed'), 'false');
await view.locator('[data-wa-notify]').click();
assert.equal(await page.evaluate(() => localStorage.getItem('nova.wa.mute')), '0');
assert.equal(await view.locator('[data-wa-notify]').getAttribute('aria-pressed'), 'true');
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal overflow');
assert.deepEqual(errors, []);
await browser.close();
console.log('ux409-wa-bell OK');
