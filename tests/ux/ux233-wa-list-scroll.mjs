// UX233: chat list scroll position kept when opening a chat and on back (desktop + mobile), 22 chats, mocked history API (no real PIN).
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux233-wa-list-scroll.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOTS || '';
const PIN = 'test-pin-1234567';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const T = Date.UTC(2026, 9, 20, 10, 0, 0);
const id = (i) => 'wa_2010000000' + String(i).padStart(2, '0');
const CONVS = Array.from({ length: 22 }, (_, i) => ({ id: id(i), customer: 'عميل ' + i, updatedAt: T - i * 1000, count: 1, last: { id: 'h_' + i, dir: 'in', kind: 'in', text: 'رسالة ' + i, at: T - i * 1000, status: null } }));
const full = (c) => ({ id: c.id, customer: c.customer, updatedAt: c.updatedAt, messages: [c.last] });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
for (const vp of [{ width: 1280, height: 800, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
  const posts = [];
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url();
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && q.method() !== 'OPTIONS') { posts.push(u); return r.abort(); }
    if (u.includes('/api/v1/inbox/history/')) {
      const cors = { 'Access-Control-Allow-Origin': origin };
      if (q.headers()['x-nova-pin'] !== PIN) return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'PIN_INVALID', message_ar: 'x' }) });
      let body = { ok: true, conversations: CONVS };
      if (!u.includes('/conversations')) { const m = CONVS.find((c) => u.includes(c.id)); body = { ok: true, conversation: full(m || CONVS[0]) }; }
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
  await view.locator('#waHistForm').waitFor();
  await view.locator('#waHistPin').fill(PIN);
  await view.locator('#waHistForm button[type=submit]').click();
  await view.locator('[data-conv="' + id(0) + '"]').waitFor();
  assert.equal(await view.locator('[data-conv]').count(), 22);
  const top = () => page.evaluate(() => document.querySelector('#waList').scrollTop);
  const setTop = (v) => page.evaluate((v) => { document.querySelector('#waList').scrollTop = v; }, v);
  await setTop(600);
  await page.waitForTimeout(100);
  const before = await top();
  assert.ok(before > 300, vp.name + ' list scrollable, top=' + before);
  const target = id(12);
  await page.evaluate((t) => document.querySelector('[data-conv="' + t + '"]').click(), target);
  await view.locator('[data-mid="h_12"]').waitFor();
  if (vp.name === 'desktop') {
    assert.equal(await top(), before, 'desktop: list scrollTop kept on open');
    assert.equal(await view.locator('[data-conv="' + target + '"].active').count(), 1);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux233-desktop-open.png` });
  } else {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux233-mobile-open.png` });
    await view.locator('[data-wa-back]').click();
    await view.locator('#waList').waitFor({ state: 'visible' });
    await page.waitForTimeout(100);
    assert.equal(await top(), before, 'mobile: list scrollTop restored on back, got ' + await top());
    assert.equal(await view.locator('[data-conv="' + target + '"].active').count(), 1, 'chat just left is highlighted');
    const vis = await page.evaluate((t) => { const e = document.querySelector('[data-conv="' + t + '"]').getBoundingClientRect(), l = document.querySelector('#waList').getBoundingClientRect(); return e.top >= l.top - 1 && e.bottom <= l.bottom + 1; }, target);
    assert.ok(vis, 'chat just left is in view');
    // open a chat near the bottom after scrolling to the end, back: still in view
    await setTop(99999); await page.waitForTimeout(100);
    const t2 = id(21), b2 = await top();
    await page.evaluate((t) => document.querySelector('[data-conv="' + t + '"]').click(), t2);
    await view.locator('[data-mid="h_21"]').waitFor();
    await view.locator('[data-wa-back]').click();
    await page.waitForTimeout(100);
    assert.equal(await top(), b2, 'mobile: bottom scroll restored');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ux233-mobile-back.png` });
  }
  assert.deepEqual(posts, [], 'no non-GET requests');
  assert.deepEqual(errors, [], 'no page errors: ' + errors.join(' | '));
  await ctx.close();
}
await browser.close();
console.log('ux233-wa-list-scroll OK');
