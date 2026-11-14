// UX240: PIN lock bar merged into the sidebar header. Mock history API, no real PIN, no non-GET.
// Covers locked / busy (no layout shift) / error / unlocked on desktop + mobile.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux240-wa-lock-bar.mjs
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
  const posts = []; let delay = true;
  await ctx.route('**/*', async (r) => {
    const q = r.request(), u = q.url();
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && q.method() !== 'OPTIONS') { posts.push(q.method() + ' ' + u); return r.abort(); }
    if (u.includes('/api/v1/inbox/history/')) {
      const pin = q.headers()['x-nova-pin']; const cors = { 'Access-Control-Allow-Origin': origin };
      if (delay) await new Promise((x) => setTimeout(x, 700));
      if (pin !== PIN) return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, message_ar: 'رقم PIN غير صحيح.' }) });
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(u.includes('/conversations') ? { ok: true, conversations: CONVS } : { ok: true, conversation: FULL }) });
    }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForTimeout(600);
  await page.locator('#novaWaBtn').click();
  const view = page.locator('#novaInboxView');
  await view.waitFor({ state: 'visible' }); await view.locator('#waHistForm').waitFor();
  const box = (sel) => view.locator(sel).boundingBox();
  // locked: lock state lives inside the sidebar header, no separate card
  assert.equal(await view.locator('.wa-side-head #waHistBar[data-state="locked"]').count(), 1, 'lock state inside sidebar header');
  assert.equal(await view.locator('.wa-lock').count(), 0, 'old standalone lock card is gone');
  const pin = view.locator('#waHistPin');
  assert.equal(await pin.getAttribute('inputmode'), 'numeric'); assert.equal(await pin.getAttribute('type'), 'password');
  const side = await box('.wa-side'), pb = await box('.wa-pinbox'), sub = await box('.wa-pinsubmit');
  assert.ok(pb.width > side.width * 0.55, 'PIN field spans most of the sidebar width');
  assert.ok(Math.min(pb.x, sub.x) >= side.x - 1 && Math.max(pb.x + pb.width, sub.x + sub.width) <= side.x + side.width + 1, 'field + button fit inside the sidebar');
  const rootBefore = await box('.wa-root'), formBefore = await box('#waHistForm');
  // show/hide toggle
  await pin.fill('abc123');
  await view.locator('#waHistPinTog').click();
  assert.equal(await pin.getAttribute('type'), 'text'); assert.equal(await view.locator('#waHistPinTog').getAttribute('aria-pressed'), 'true');
  await view.locator('#waHistPinTog').click();
  assert.equal(await pin.getAttribute('type'), 'password');
  // busy: disabled, same width, no layout shift
  await pin.fill(PIN);
  await view.locator('#waHistForm button[type=submit]').click();
  await view.locator('.wa-pinsubmit:disabled').waitFor();
  const subBusy = await box('.wa-pinsubmit'), formBusy = await box('#waHistForm'), rootBusy = await box('.wa-root');
  assert.equal(subBusy.width, sub.width, 'button width unchanged while busy');
  assert.equal(formBusy.height, formBefore.height, 'form height unchanged while busy');
  assert.equal(rootBusy.y, rootBefore.y, 'no vertical shift while busy');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux240-${vp.name}-busy.png` });
  // unlocked
  await view.locator('[data-conv="wa_201000000001"]').waitFor();
  assert.equal(await view.locator('.wa-side-head #waHistBar[data-state="unlocked"]').count(), 1);
  assert.equal(await view.locator('#waHistForm').count(), 0);
  const lockBtn = await box('#waHistLock');
  assert.ok(lockBtn.height <= 36, 'small lock button, got ' + lockBtn.height);
  assert.ok((await box('.wa-side-head')).height <= 60, 'header stays compact');
  assert.equal((await box('.wa-root')).y <= rootBefore.y + 80, true, 'no extra card above the inbox');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux240-${vp.name}-unlocked.png` });
  // lock again, then error state: wrong PIN
  await view.locator('#waHistLock').click(); await view.locator('#waHistForm').waitFor();
  await view.locator('#waHistPin').fill('wrong-pin-000000');
  await view.locator('#waHistForm button[type=submit]').click();
  await view.locator('.wa-lock-err[role=alert]:not(:empty)').waitFor();
  assert.ok((await view.locator('.wa-lock-err').innerText()).includes('PIN'));
  const formErr = await box('#waHistForm');
  assert.equal(formErr.height, formBefore.height, 'error row reserved: no layout shift');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('novaHistPin')), null);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux240-${vp.name}-error.png` });
  // empty submit error
  await view.locator('#waHistPin').fill(''); await view.locator('#waHistForm button[type=submit]').click();
  assert.ok((await view.locator('.wa-lock-err').innerText()).length > 0);
  assert.deepEqual(posts, [], 'no non-GET requests');
  assert.deepEqual(errors, [], 'no page errors: ' + errors.join(' | '));
  await ctx.close();
}
await browser.close();
console.log('ux240-wa-lock-bar OK');
