// UX238 (keyboard + screen reader, built on the FIX46 mock pattern). Original FIX46 note: old WhatsApp chats behind the pharmacy PIN. No PIN => lock form, no history request, no chat text.
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
const act = (page) => page.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.getAttribute('data-conv') || a.hasAttribute('data-wa-back') && 'back' || a.tagName) : null; });
for (const vp of [{ width: 1280, height: 800, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
  const posts = [];
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url();
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && q.method() !== 'OPTIONS') { posts.push(q.method() + ' ' + u); return r.abort(); }
    if (u.includes('/api/v1/inbox/history/')) {
      const pin = q.headers()['x-nova-pin'];
      const cors = { 'Access-Control-Allow-Origin': origin };
      if (pin !== PIN) return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, code: pin ? 'PIN_INVALID' : 'PIN_REQUIRED', message_ar: 'x' }) });
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
  // opening: heading, labels, PIN focused
  assert.equal(await view.locator('h1').count(), 1, 'page heading');
  assert.ok(await view.locator('#waSearch').getAttribute('aria-label'), 'search label');
  assert.ok(await view.locator('#waList').getAttribute('aria-label'), 'list label');
  assert.equal(await act(page), 'waHistPin', 'PIN focused on open');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/qa-loop-231-${vp.name}-pin.png` });
  // wrong PIN via Enter
  await page.keyboard.type('wrong-pin-000000');
  await page.keyboard.press('Enter');
  await view.locator('.wa-lock-err[role=alert]').waitFor();
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'waHistPin');
  assert.equal(await act(page), 'waHistPin', 'PIN focused after wrong PIN');
  // right PIN via Enter
  await page.keyboard.type(PIN);
  await page.keyboard.press('Enter');
  await view.locator('[data-conv="wa_201000000001"]').waitFor();
  assert.ok(await view.locator('#waHistLock').getAttribute('aria-label'), 'lock label');
  assert.equal(await view.locator('[aria-current]').count(), 0, 'no current chat yet');
  // keyboard into list: Tab from search, arrow
  await view.locator('#waSearch').focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await act(page), 'wa_201000000001', 'ArrowDown moves from search to list');
  await page.keyboard.press('Enter');
  await view.locator('[data-mid="h_u_1"]').waitFor();
  const want = vp.name === 'mobile' ? 'back' : 'waMsgs';
  assert.equal(await act(page), want, 'focus moves into chat pane');
  assert.equal(await view.locator('[data-conv="wa_201000000001"]').getAttribute('aria-current'), 'true', 'aria-current on active chat');
  assert.equal(await view.locator('#waMsgs').getAttribute('role'), 'log');
  assert.equal(await view.locator('#waMsgs').getAttribute('aria-live'), 'polite');
  assert.ok(await view.locator('#waMsgs').getAttribute('aria-label'), 'msgs label');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/qa-loop-231-${vp.name}-chat.png` });
  await page.keyboard.press('Escape');
  await view.locator('[data-wa-root][data-view=list]').waitFor();
  assert.equal(await act(page), 'wa_201000000001', 'Escape returns focus to the chat button');
  assert.equal(await view.locator('[aria-current]').count(), 0, 'aria-current cleared');
  assert.deepEqual(posts, [], 'no non-GET requests');
  assert.deepEqual(errors, [], 'no page errors: ' + errors.join(' | '));
  await ctx.close();
}
await browser.close();
console.log('ux238-wa-keyboard OK');
