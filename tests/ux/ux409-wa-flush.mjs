// UX409: iPhone conversations list and open chat sit flush on the bottom edge (no empty dark band).
// 390x844, iPhone UA, simulated safe-area (--wa-sat 47px / --wa-sab 34px). Fake data only; every non-GET aborted.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux409-wa-flush.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-15T22:50:00+03:00');
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const origin = new URL(BASE).origin;
const conv = { id: 'wa_201000000409', customer: 'منى (تجربة)', updatedAt: NOW, count: 1, last: { id: 'm1', dir: 'in', kind: 'in', text: 'ازيك', at: NOW } };
const msgs = [
  { id: 'm1', dir: 'in', kind: 'in', text: 'ازيك', at: NOW - 120000 },
  { id: 'm2', dir: 'out', kind: 'pharm', text: 'الحمد لله', at: NOW - 60000, status: 'read' },
];

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, locale: 'ar-EG', timezoneId: 'Asia/Riyadh',
  serviceWorkers: 'block', hasTouch: true, isMobile: true, userAgent: IPHONE_UA,
});
await ctx.route('**/*', (r) => {
  const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin };
  if (q.method() === 'OPTIONS' && u.includes('/api/v1/inbox/history/')) return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'content-type,accept' } });
  if (q.method() !== 'GET' && q.method() !== 'HEAD') return r.abort();
  if (u.includes('/api/v1/inbox/history/')) {
    const body = u.includes('/conversations')
      ? { ok: true, conversations: [conv] }
      : { ok: true, conversation: { id: conv.id, customer: conv.customer, updatedAt: NOW, messages: msgs } };
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
  }
  return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
await page.goto(BASE + '?app=whatsapp', { waitUntil: 'load' });
await page.evaluate(() => { document.documentElement.style.setProperty('--wa-sat', '47px'); document.documentElement.style.setProperty('--wa-sab', '34px'); });
await page.waitForTimeout(400);
const view = page.locator('#novaInboxView');
await view.locator(`[data-conv="${conv.id}"]`).waitFor();

// --- list: no notifications row, fills the viewport, safe-area padding is inside the list ---
assert.equal(await view.locator('[data-wa-notifbar]').count(), 0, 'no notifications row');
assert.equal(await view.locator('.wa-side-head [data-wa-notify]').count(), 1, 'bell in the header');
const listGeom = await page.evaluate(() => {
  const v = document.getElementById('novaInboxView');
  const root = document.querySelector('[data-wa-root]');
  const side = document.querySelector('.wa-side');
  const list = document.getElementById('waList');
  const vr = v.getBoundingClientRect(), lr = list.getBoundingClientRect(), sr = side.getBoundingClientRect(), rr = root.getBoundingClientRect();
  const cs = getComputedStyle(list);
  return {
    vh: innerHeight, vw: innerWidth,
    viewTop: vr.top, viewBottom: vr.bottom, viewH: vr.height,
    rootBottom: rr.bottom, sideBottom: sr.bottom,
    listBottom: lr.bottom, listPadB: cs.paddingBottom, listBg: cs.backgroundColor,
    bodyBg: getComputedStyle(document.body).backgroundColor,
  };
});
assert.equal(listGeom.viewTop, 0, 'inbox starts at the top');
assert.ok(Math.abs(listGeom.viewBottom - listGeom.vh) <= 1, 'inbox reaches the bottom ' + JSON.stringify(listGeom));
assert.ok(Math.abs(listGeom.sideBottom - listGeom.vh) <= 1, 'list pane reaches the bottom');
assert.ok(Math.abs(listGeom.listBottom - listGeom.vh) <= 1, 'list scroll area reaches the bottom (no dark band / spacer)');
assert.equal(listGeom.listPadB, '34px', 'safe-area padding is inside the list scroll area');

// --- open chat: composer flush on the bottom, padding lives inside the bar ---
await view.locator(`[data-conv="${conv.id}"]`).click();
await page.locator('#waComposer').waitFor();
const chatGeom = await page.evaluate(() => {
  const v = document.getElementById('novaInboxView');
  const root = document.querySelector('[data-wa-root]');
  const comp = document.querySelector('[data-wa-composer]') || document.getElementById('waComposer');
  const vr = v.getBoundingClientRect(), cr = comp.getBoundingClientRect(), rr = root.getBoundingClientRect();
  const cs = getComputedStyle(comp);
  return {
    vh: innerHeight,
    viewBottom: vr.bottom, rootBottom: rr.bottom,
    compTop: cr.top, compBottom: cr.bottom, compH: cr.height,
    padB: cs.paddingBottom, marginB: cs.marginBottom, bg: cs.backgroundColor,
    kbd: root.getAttribute('data-kbd'),
  };
});
assert.ok(Math.abs(chatGeom.viewBottom - chatGeom.vh) <= 1, 'chat container reaches the bottom ' + JSON.stringify(chatGeom));
assert.ok(Math.abs(chatGeom.compBottom - chatGeom.vh) <= 1, 'composer sits flush on the bottom edge ' + JSON.stringify(chatGeom));
assert.equal(chatGeom.padB, '34px', 'composer padding-bottom is max(8, 34) (safe-area inside the bar)');
assert.equal(chatGeom.marginB, '0px', 'no extra margin under the composer');
assert.ok(!chatGeom.kbd, 'keyboard not open: UX407 data-kbd is off');

// PWA name on the standalone link
assert.equal(await page.title(), 'NOVA WhatsApp');
assert.equal(await page.locator('meta[name=apple-mobile-web-app-title]').getAttribute('content'), 'NOVA WhatsApp');

assert.deepEqual(errors, []);
await browser.close();
console.log('ux409-wa-flush OK');
