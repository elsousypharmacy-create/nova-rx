// UX242: WhatsApp history error states. Mocks 401 (PIN_INVALID / PIN_REQUIRED), 500, network abort, and an empty list.
// Each state must show explicit Arabic copy + a retry button; typed PIN length hint kept; no real PIN, no non-GET.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux242-wa-error-states.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOTS || '';
const PIN = 'test-pin-1234567';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
const cors = { 'Access-Control-Allow-Origin': origin };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG', serviceWorkers: 'block' });
let mode = 'ok', calls = 0; const posts = [];
await ctx.route('**/*', (r) => {
  const q = r.request(), u = q.url();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(q.method())) { posts.push(q.method() + ' ' + u); return r.abort(); }
  if (u.includes('/api/v1/inbox/history/')) {
    calls++;
    if (mode === 'abort') return r.abort('failed');
    if (mode === '500') return r.fulfill({ status: 500, headers: cors, contentType: 'application/json', body: '{"ok":false}' });
    if (mode === 'empty') return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"ok":true,"conversations":[]}' });
    const pin = q.headers()['x-nova-pin'];
    if (pin !== PIN) return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, code: pin ? 'PIN_INVALID' : 'PIN_REQUIRED' }) });
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"ok":true,"conversations":[]}' });
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
const submit = async (pin) => { await view.locator('#waHistPin').fill(pin); await view.locator('#waHistForm button[type=submit]').click(); };
const state = (s) => view.locator(`.wa-state[data-state="${s}"]`);

// 1. empty submit -> PIN_REQUIRED copy
await view.locator('#waHistForm').waitFor();
await view.locator('#waHistForm button[type=submit]').click();
await state('pin').waitFor();
assert.match(await state('pin').innerText(), /لازم تكتب رقم PIN/);
// 2. 401 PIN_INVALID
mode = 'ok'; await submit('wrong-pin-000000');
await state('pin').waitFor();
let txt = await state('pin').innerText();
assert.match(txt, /غير صحيح/); assert.match(txt, /16 خانة/, 'PIN length hint kept'); assert.match(txt, /المتبقية/);
assert.equal(await page.evaluate(() => sessionStorage.getItem('novaHistPin')), null);
await shot('wrong-pin');
await view.locator('#waHistRetry').click();
assert.equal(await state('pin').count(), 0); assert.equal(await page.evaluate(() => document.activeElement.id), 'waHistPin');
// 3. 500 -> server panel, retry reloads and recovers
mode = '500'; await submit(PIN);
await state('error').waitFor();
assert.match(await state('error').innerText(), /السيرفر مش بيرد/);
await shot('server-500');
let before = calls; mode = 'ok';
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
assert.deepEqual(posts, []);
assert.deepEqual(errors, [], errors.join(' | '));
await browser.close();
console.log('ux242-wa-error-states OK');
