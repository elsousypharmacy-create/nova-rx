// UX241: 320-message chat renders only the latest 80, "رسائل أقدم" reveals more without jumping, floating scroll-to-latest button.
// Backend mocked; no network, no sends. Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux241-big-chat.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const PIN = 'test-pin-1234567';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const T = Date.UTC(2026, 9, 20, 10, 0, 0), ID = 'wa_201000000009', N = 320;
const msgs = Array.from({ length: N }, (_, k) => ({ id: 'h_' + k, dir: k % 2 ? 'out' : 'in', kind: k % 2 ? 'bot' : 'in', text: 'رسالة رقم ' + k, at: T + k * 60000, status: k % 2 ? 'delivered' : null }));
const CONVS = [{ id: ID, customer: 'عميل كبير', updatedAt: T + N * 60000, count: N, last: msgs[N - 1] }];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url();
    if (q.method() !== 'GET' && q.method() !== 'HEAD') return r.abort();
    if (u.includes('/api/v1/inbox/history/')) {
      const cors = { 'Access-Control-Allow-Origin': origin };
      if (q.headers()['x-nova-pin'] !== PIN) return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: '{"ok":false}' });
      const body = u.includes('/conversations') ? { ok: true, conversations: CONVS } : { ok: true, conversation: { id: ID, customer: 'عميل كبير', updatedAt: T, messages: msgs } };
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
  await view.locator('#waHistPin').fill(PIN);
  await view.locator('#waHistForm button[type=submit]').click();
  await view.locator(`[data-conv="${ID}"]`).click();
  await view.locator('[data-mid="h_319"]').waitFor();
  const st = () => page.evaluate(() => { const m = document.getElementById('waMsgs'); const b = document.querySelector('[data-wa-latest]');
    return { n: m.querySelectorAll('[data-mid]').length, top: m.scrollTop, h: m.scrollHeight, ch: m.clientHeight, btnHidden: b.hidden, first: m.querySelector('[data-mid]').dataset.mid,
      older: !!m.querySelector('[data-wa-older]'), olderTxt: (m.querySelector('[data-wa-older]') || {}).textContent }; });
  let s = await st();
  assert.equal(s.n, 80, 'bounded DOM on open'); assert.equal(s.first, 'h_240');
  assert.ok(Math.abs(s.h - s.ch - s.top) < 3, 'opens at bottom'); assert.equal(s.btnHidden, true);
  assert.ok(s.older && s.olderTxt.includes('240'), 'older button shows hidden count');
  assert.equal(await view.locator('#waInput').isDisabled(), true);
  // scroll up > 1 screen: latest button appears
  await page.evaluate(() => { document.getElementById('waMsgs').scrollTop = 0; });
  await page.waitForTimeout(100);
  s = await st(); assert.equal(s.btnHidden, false, 'latest button visible when far from bottom');
  // load older: anchor stays on the same message
  const before = await page.evaluate(() => { const m = document.getElementById('waMsgs'); const e = m.querySelector('[data-mid="h_240"]'); return e.getBoundingClientRect().top - m.getBoundingClientRect().top; });
  await view.locator('[data-wa-older]').click();
  s = await st(); assert.equal(s.n, 160, 'older batch revealed');
  const after = await page.evaluate(() => { const m = document.getElementById('waMsgs'); const e = m.querySelector('[data-mid="h_240"]'); return e.getBoundingClientRect().top - m.getBoundingClientRect().top; });
  assert.ok(Math.abs(after - before) < 3, `no jump (${before} vs ${after})`);
  // reveal everything
  await view.locator('[data-wa-older]').click(); await view.locator('[data-wa-older]').click().catch(() => {});
  s = await st(); assert.equal(s.n, 320); assert.equal(s.older, false, 'no older button when all shown');
  // scroll-to-latest
  await page.evaluate(() => { document.getElementById('waMsgs').scrollTop = 0; }); await page.waitForTimeout(100);
  await view.locator('[data-wa-latest]').click();
  s = await st(); assert.ok(Math.abs(s.h - s.ch - s.top) < 3, 'jumped to latest'); assert.equal(s.btnHidden, true);
  assert.deepEqual(errors, [], errors.join('|'));
  await ctx.close();
}
await browser.close();
console.log('ux241-big-chat OK');
