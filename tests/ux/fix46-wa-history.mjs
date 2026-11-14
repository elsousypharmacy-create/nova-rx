// FIX46: old WhatsApp chats behind the pharmacy PIN. No PIN => lock form, no history request, no chat text.
// Wrong PIN => error, PIN forgotten. Right PIN => old chats (system notes centred, bot/pharmacist labels), composer stays disabled,
// chats never written to localStorage, "قفل المحادثات" clears them. Backend is mocked; no network, no sends.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/fix46-wa-history.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOTS || '';
const PIN = 'test-pin-1234567';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const T = Date.UTC(2026, 9, 20, 10, 0, 0);
const CONVS = [{ id: 'wa_201000000001', customer: 'منى التجريبية', updatedAt: T + 3000, count: 4, last: { id: 'h_b_3', dir: 'out', kind: 'bot', text: 'متوفر بـ 30 جنيه', at: T + 3000, status: 'delivered' } }];
const FULL = { id: 'wa_201000000001', customer: 'منى التجريبية', updatedAt: T + 3000, messages: [
  { id: 'h_u_1', dir: 'in', kind: 'in', text: 'عندكم بنادول؟', at: T, status: null },
  { id: 'h_s_2', dir: 'out', kind: 'sys', text: 'اتحوّل للصيدلي', at: T + 1000, status: null },
  { id: 'h_p_4', dir: 'out', kind: 'pharm', text: 'أهلاً، موجود', at: T + 2000, status: 'delivered' },
  { id: 'h_b_3', dir: 'out', kind: 'bot', text: 'متوفر بـ 30 جنيه', at: T + 3000, status: 'delivered' } ] };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
for (const vp of [{ width: 1280, height: 800, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
  const hist = [], posts = [];
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url();
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && q.method() !== 'OPTIONS') { posts.push(q.method() + ' ' + u); return r.abort(); }
    if (u.includes('/api/v1/inbox/history/')) {
      hist.push(u);
      const pin = q.headers()['x-nova-pin'];
      const cors = { 'Access-Control-Allow-Origin': origin };
      if (pin !== PIN) return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, code: pin ? 'PIN_INVALID' : 'PIN_REQUIRED', message_ar: 'رقم PIN غير صحيح.' }) });
      const body = u.includes('/conversations') ? { ok: true, conversations: CONVS } : { ok: true, conversation: FULL };
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
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
  await view.locator('#waHistForm').waitFor();
  assert.equal(hist.length, 0, 'no history request without a PIN');
  assert.ok(!(await view.innerText()).includes('منى التجريبية'), 'no chat text before PIN');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/fix46-${vp.name}-locked.png` });
  // wrong PIN
  await view.locator('#waHistPin').fill('wrong-pin-000000');
  await view.locator('#waHistForm button[type=submit]').click();
  await view.locator('.wa-lock-err').waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('novaHistPin')), null, 'wrong PIN forgotten');
  assert.ok(!(await view.innerText()).includes('منى التجريبية'));
  // right PIN
  await view.locator('#waHistPin').fill(PIN);
  await view.locator('#waHistForm button[type=submit]').click();
  await view.locator('[data-conv="wa_201000000001"]').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('novaHistPin')), null, 'PIN never in localStorage');
  await view.locator('[data-conv="wa_201000000001"]').click();
  await view.locator('[data-mid="h_u_1"]').waitFor();
  assert.equal(await view.locator('.wa-sys[data-kind="sys"]').count(), 1, 'system note centred');
  assert.equal(await view.locator('[data-mid="h_b_3"] .wa-who-bot').count(), 1, 'bot label');
  assert.equal(await view.locator('[data-mid="h_p_4"] .wa-who-ph').count(), 1, 'pharmacist label');
  assert.equal(await view.locator('#waInput').isDisabled(), true, 'composer stays a disabled draft');
  assert.equal(await view.locator('.wa-chat.unread').count(), 0, 'archived chats are not unread');
  const ls = await page.evaluate(() => JSON.stringify(localStorage));
  assert.ok(!ls.includes('بنادول') && !ls.includes('منى التجريبية'), 'chats never stored in localStorage');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/fix46-${vp.name}-open.png` });
  if (vp.name === 'mobile') { await view.locator('[data-wa-back]').click(); }
  await view.locator('#waHistLock').click();
  await view.locator('#waHistForm').waitFor();
  assert.ok(!(await view.innerText()).includes('منى التجريبية'), 'lock clears chats');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('novaHistPin')), null);
  assert.deepEqual(posts, [], 'no non-GET requests');
  assert.deepEqual(errors, [], 'no page errors: ' + errors.join(' | '));
  await ctx.close();
}
await browser.close();
console.log('fix46-wa-history OK');
