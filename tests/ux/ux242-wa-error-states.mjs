// UX242 + UX400: WhatsApp history error states with the PIN-free staging/preview inbox. Mocks 401 (a backend that is
// still PIN-gated, i.e. production), 500, network abort, offline and an empty list. Each state shows explicit Arabic
// copy + a retry button and NEVER a PIN prompt. Fake data only, no X-Nova-Pin, no non-GET.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux242-wa-error-states.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOTS || '';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
const cors = { 'Access-Control-Allow-Origin': origin };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG', serviceWorkers: 'block' });
let mode = 'gated', calls = 0; const posts = [], pins = [];
await ctx.route('**/*', (r) => {
  const q = r.request(), u = q.url();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(q.method())) { posts.push(q.method() + ' ' + u); return r.abort(); }
  if (u.includes('/api/v1/inbox/history/')) {
    calls++; if (q.headers()['x-nova-pin'] !== undefined) pins.push(u);
    if (mode === 'abort') return r.abort('failed');
    if (mode === '500') return r.fulfill({ status: 500, headers: cors, contentType: 'application/json', body: '{"ok":false}' });
    if (mode === 'empty') return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"ok":true,"conversations":[]}' });
    // mode 'gated': a backend that still requires the PIN (production path) answers 401 PIN_REQUIRED
    return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'PIN_REQUIRED' }) });
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
await view.waitFor({ state: 'visible' });
const shot = async (n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux242-${n}.png` }); };
const state = (s) => view.locator(`.wa-state[data-state="${s}"]`);
const noPinUi = async () => {
  for (const sel of ['#waHistPin', '#waHistForm', '#waHistLock', '[data-wa-lock]', '[data-wa-locked-empty]']) assert.equal(await view.locator(sel).count(), 0, 'no PIN UI: ' + sel);
  assert.ok(!/PIN/i.test(await view.innerText()), 'no PIN wording');
};

// 1. opening loads at once; a still-gated backend (401) => plain «not open» error + retry, never a PIN prompt
await state('gated').waitFor();
assert.match(await state('gated').innerText(), /مش فاتح المحادثات/);
await noPinUi();
assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'waHistRetry', 'focus on retry');
await shot('gated');
// 2. 500 -> server panel, retry reloads and recovers
mode = '500'; await view.locator('#waHistRetry').click();
await state('error').waitFor();
assert.match(await state('error').innerText(), /السيرفر مش بيرد/);
await noPinUi();
await shot('server-500');
// 3. retry recovers to the empty list
let before = calls; mode = 'empty';
await view.locator('#waHistRetry').click();
await state('empty').waitFor();
assert.ok(calls > before, 'retry re-requests');
assert.match(await state('empty').innerText(), /لا توجد محادثات قديمة/);
await shot('empty');
// 4. network abort on refresh from empty panel
mode = 'abort'; await view.locator('#waHistRetry').click();
await state('network').waitFor();
assert.match(await state('network').innerText(), /تعذّر الاتصال/);
await shot('network');
// 5. offline flag
await ctx.setOffline(true);
await view.locator('#waHistRetry').click();
await state('offline').waitFor();
assert.match(await state('offline').innerText(), /غير متصل بالإنترنت/);
await shot('offline');
await ctx.setOffline(false); mode = 'empty';
await view.locator('#waHistRetry').click();
await state('empty').waitFor();
assert.equal(await state('empty').locator('#waHistRetry').count(), 1);
await noPinUi();
assert.deepEqual(posts, []);
assert.deepEqual(pins, [], 'UI never sends X-Nova-Pin');
assert.deepEqual(errors, [], errors.join(' | '));
await browser.close();
console.log('ux242-wa-error-states OK');
