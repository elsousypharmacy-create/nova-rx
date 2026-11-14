// UX234: opening an old WhatsApp chat shows a skeleton + aria-busy until the full history arrives; a failed fetch shows an inline error with retry.
// Backend mocked, delayed. Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux234-wa-chat-loading.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOTS || '';
const PIN = 'test-pin-1234567';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const T = Date.UTC(2026, 9, 20, 10, 0, 0);
const ID = 'wa_201000000001';
const CONVS = [{ id: ID, customer: 'منى التجريبية', updatedAt: T + 3000, count: 3, last: { id: 'h_b_3', dir: 'out', kind: 'bot', text: 'آخر رسالة معاينة', at: T + 3000, status: 'delivered' } }];
const FULL = { id: ID, customer: 'منى التجريبية', updatedAt: T + 3000, messages: [
  { id: 'h_u_1', dir: 'in', kind: 'in', text: 'عندكم بنادول؟', at: T, status: null },
  { id: 'h_p_2', dir: 'out', kind: 'pharm', text: 'أهلاً، موجود', at: T + 2000, status: 'delivered' },
  { id: 'h_b_3', dir: 'out', kind: 'bot', text: 'آخر رسالة معاينة', at: T + 3000, status: 'delivered' } ] };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG', serviceWorkers: 'block' });
let mode = 'slow', convCalls = 0, release;
await ctx.route('**/*', async (r) => {
  const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin };
  if (u.includes('/api/v1/inbox/history/')) {
    if (u.includes('/conversations')) return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, conversations: CONVS }) });
    convCalls++;
    if (mode === 'slow') await new Promise((res) => { release = res; });
    if (mode === 'fail') return r.fulfill({ status: 500, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'SERVER', message_ar: 'تعذّر تحميل المحادثة، حاول مرة أخرى.' }) });
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, conversation: FULL }) });
  }
  if (q.method() !== 'GET' && q.method() !== 'HEAD' && q.method() !== 'OPTIONS') return r.abort();
  return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
});
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(600);
await page.locator('#novaWaBtn').click();
const view = page.locator('#novaInboxView');
await view.locator('#waHistPin').fill(PIN);
await view.locator('#waHistForm button[type=submit]').click();
await view.locator('[data-conv="' + ID + '"]').waitFor();
// slow fetch: placeholder, aria-busy, no lone preview bubble
await view.locator('[data-conv="' + ID + '"]').click();
await view.locator('[data-chat-loading]').waitFor();
assert.equal(await view.locator('#waMsgs').getAttribute('aria-busy'), 'true', 'aria-busy while loading');
assert.ok((await view.locator('[data-chat-loading]').innerText()).includes('جاري تحميل المحادثة'));
assert.equal(await view.locator('[data-mid]').count(), 0, 'no lone preview bubble while loading');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux234-loading.png` });
release();
await view.locator('[data-mid="h_u_1"]').waitFor();
assert.equal(await view.locator('[data-chat-loading]').count(), 0, 'placeholder gone');
assert.equal(await view.locator('#waMsgs').getAttribute('aria-busy'), null, 'aria-busy cleared');
assert.equal(await view.locator('[data-mid]').count(), 3);
// failing fetch: inline error + retry
await view.locator('[data-wa-back]').click();
await page.evaluate(() => 0);
mode = 'fail';
// fresh conversation state: lock and re-enter
await view.locator('#waHistLock').click();
await view.locator('#waHistPin').fill(PIN);
await view.locator('#waHistForm button[type=submit]').click();
await view.locator('[data-conv="' + ID + '"]').click();
await view.locator('[data-chat-error]').waitFor();
assert.equal(await view.locator('#waMsgs').getAttribute('aria-busy'), null);
assert.equal(await view.locator('[data-chat-error]').getAttribute('role'), 'alert');
assert.equal(await view.locator('[data-mid]').count(), 1, 'only the preview bubble, not the full chat');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux234-error.png` });
mode = 'ok';
await view.locator('[data-wa-reload]').click();
await view.locator('[data-mid="h_u_1"]').waitFor();
assert.equal(await view.locator('[data-chat-error]').count(), 0);
assert.deepEqual(errors, [], 'no page errors: ' + errors.join(' | '));
await browser.close();
console.log('ux234-wa-chat-loading OK');
