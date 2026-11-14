// UX237: weekday names for the last 6 days, localized date for older, sticky frosted .wa-date separators.
// Mock history API, fake dates, no real PIN. Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux237-wa-dates.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOTS || '';
const PIN = 'test-pin-1234567';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const D = 86400000, NOW = Date.now();
const msgs = [];
// 28 days x 2 msgs stays under the default 80-message render window
for (let d = 27; d >= 0; d--) for (let k = 0; k < 2; k++) msgs.push({ id: `h_${d}_${k}`, dir: k % 2 ? "out" : "in", kind: k % 2 ? 'pharm' : 'in', text: `رسالة ${d}-${k}`, at: NOW - d * D - (2 - k) * 60000 + 1000, status: k % 2 ? 'delivered' : null });
msgs.sort((a, b) => a.at - b.at);
const last = msgs[msgs.length - 1];
const CONVS = [{ id: 'wa_201000000009', customer: 'عميل تاريخ', updatedAt: last.at, count: msgs.length, last }];
const FULL = { id: 'wa_201000000009', customer: 'عميل تاريخ', updatedAt: last.at, messages: msgs };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG', serviceWorkers: 'block' });
await ctx.route('**/*', (r) => {
  const q = r.request(), u = q.url();
  if (q.method() !== 'GET' && q.method() !== 'HEAD') return r.abort();
  if (u.includes('/api/v1/inbox/history/')) {
    const cors = { 'Access-Control-Allow-Origin': origin };
    if (q.headers()['x-nova-pin'] !== PIN) return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'PIN_INVALID' }) });
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(u.includes('/conversations') ? { ok: true, conversations: CONVS } : { ok: true, conversation: FULL }) });
  }
  return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
});
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(600);
await page.locator('#novaWaBtn').click();
const view = page.locator('#novaInboxView');
await view.locator('#waHistForm').waitFor();
await view.locator('#waHistPin').fill(PIN);
await view.locator('#waHistForm button[type=submit]').click();
await view.locator('[data-conv="wa_201000000009"]').waitFor();
await view.locator('[data-conv="wa_201000000009"]').click();
await view.locator('.wa-date').first().waitFor();
const labels = await view.locator('.wa-date span').allInnerTexts();
const WD = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const expected = [];
const fmt = (t) => new Date(t).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' });
const days = [...new Set(msgs.map((m) => new Date(m.at).setHours(0, 0, 0, 0)))];
const today0 = new Date(NOW).setHours(0, 0, 0, 0);
for (const t of days) { const diff = Math.round((today0 - t) / D); expected.push(diff === 0 ? 'اليوم' : diff === 1 ? 'أمس' : diff <= 6 ? WD[new Date(t).getDay()] : fmt(t)); }
assert.deepEqual(labels, expected, 'labels per fake day');
assert.ok(labels.length >= 27, 'many separators');
assert.ok(!labels.some((l) => /^\d{4}\/\d\d\/\d\d$/.test(l)), 'no dry YYYY/MM/DD');
assert.equal(labels.slice(-3, -1).length, 2);
assert.ok(labels.slice(-7, -2).every((l) => WD.includes(l)), 'days 2..6 are weekday names');
const st = await view.locator('.wa-date').first().evaluate((el) => { const c = getComputedStyle(el), s = getComputedStyle(el.firstElementChild); return { pos: c.position, top: c.top, bf: s.backdropFilter || s.webkitBackdropFilter, bg: s.backgroundColor }; });
assert.equal(st.pos, 'sticky'); assert.match(st.bf, /blur/); assert.match(st.bg, /rgba/);
// scroll to middle: some separator must be pinned near top of the scroller
const pinned = await page.evaluate(() => {
  const sc = document.querySelector('#waMsgs'); sc.scrollTop = sc.scrollHeight / 2;
  return new Promise((res) => setTimeout(() => {
    const top = sc.getBoundingClientRect().top;
    const seps = [...sc.querySelectorAll('.wa-date')].map((e) => e.getBoundingClientRect().top - top);
    res({ seps: seps.filter((y) => y >= 0 && y < 20).length, scrollTop: sc.scrollTop });
  }, 150));
});
assert.ok(pinned.scrollTop > 0 && pinned.seps >= 1, 'a separator stays pinned while scrolling: ' + JSON.stringify(pinned));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux237-sticky.png` });
assert.deepEqual(errors, [], errors.join('|'));
await browser.close();
console.log('ux237-wa-dates OK', labels.length, 'separators');
