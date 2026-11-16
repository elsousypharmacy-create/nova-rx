// WA edges: the conversations screen must not leave a dead band under it. Desktop/tablet: an equal 12px frame above and below
// (the generic page padding was 24px / 72px). Phone (tab mode and ?app=whatsapp): the screen fills the viewport edge to edge.
// Fake history only; every non-GET request is aborted. Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/wa-edges.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-15T18:17:00+03:00');
const conv = (i) => ({ id: 'wa_2010000000' + String(i).padStart(2, '0'), customer: i % 3 ? 'عميل ' + i : '0100000000' + i, updatedAt: NOW - i * 60000, count: 1, last: { id: 'm' + i, dir: 'in', kind: 'user', text: 'رسالة ' + i, at: NOW - i * 60000, status: null } });
const list = Array.from({ length: 30 }, (_, i) => conv(i + 1));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
let n = 0; const ok = (m) => { n++; console.log('  ok', m); };
async function open(vp, url, short = 0) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'ar-EG', hasTouch: !!vp.touch, isMobile: !!vp.touch, serviceWorkers: 'block' });
  // iOS home-screen apps report a window.innerHeight that is shorter than the screen (owner's iPhone: ~47pt): emulate that shortfall
  if (short) await ctx.addInitScript((h) => { Object.defineProperty(window, 'innerHeight', { get: () => h }); const d = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight'); Object.defineProperty(Element.prototype, 'clientHeight', { get() { return this === document.documentElement ? h : d.get.call(this); } }); }, vp.height - short);
  const other = [];
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin };
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { other.push(q.method() + ' ' + u); return r.abort(); }
    if (u.includes('/api/v1/inbox/history/')) {
      const json = (o) => r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.includes('/conversations')) return json({ ok: true, conversations: list });
      if (u.includes('/conversation?')) { const id = decodeURIComponent(/id=([^&]+)/.exec(u)[1]), c = list.find((x) => x.id === id) || list[0]; return json({ ok: true, conversation: { id, customer: c.customer, updatedAt: c.updatedAt, messages: [c.last] } }); }
      return json({ ok: true, linked: 0 });
    }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(400);
  if (!url.includes('app=whatsapp')) await page.locator('#novaWaBtn').click();
  await page.locator('#novaInboxView [data-conv]').first().waitFor(); await page.waitForTimeout(300);
  return { ctx, page, other, errors };
}
const rects = (page) => page.evaluate(() => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; }; return { vh: innerHeight, real: visualViewport.height, view: r('#novaInboxView'), root: r('.wa-root'), docH: document.documentElement.scrollHeight }; });
for (const [name, vp] of [['desktop 1920x950', { width: 1920, height: 950 }], ['desktop 1366x768', { width: 1366, height: 768 }], ['tablet 1194x834', { width: 1194, height: 834, touch: true }]]) {
  const { ctx, page, other, errors } = await open(vp, BASE + '#wa'); const g = await rects(page);
  const top = g.root.top - g.view.top, bottom = g.view.bottom - g.root.bottom;
  assert.ok(Math.abs(g.view.bottom - g.vh) <= 1, name + ': the view reaches the bottom of the window'); assert.ok(top >= 0 && top <= 14, name + ': top frame ' + top); assert.ok(bottom >= 0 && bottom <= 14, name + ': bottom frame ' + bottom + ' (was 72)'); assert.ok(g.docH <= g.vh + 1, name + ': no page scroll');
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgb(26, 30, 36)', name + ': desktop page background is not recoloured');
  assert.deepEqual(other, []); assert.deepEqual(errors, []); ok(name + ': ' + Math.round(top) + 'px above, ' + Math.round(bottom) + 'px below, no page scroll'); await ctx.close();
}
for (const [name, url] of [['phone tab 390x844', BASE + '#wa'], ['phone app 390x844', BASE + '?app=whatsapp']]) {
  const { ctx, page, other, errors } = await open({ width: 390, height: 844, touch: true }, url); const g = await rects(page);
  assert.ok(g.root.top <= 1 && Math.abs(g.root.bottom - g.vh) <= 1, name + ': fills the screen ' + JSON.stringify(g.root) + ' vh ' + g.vh); assert.ok(g.docH <= g.vh + 1, name + ': no page scroll');
  // whatever is left under the screen (home-indicator / browser-bar area) must be the colour of what sits above it, never a darker band
  const htmlBg = () => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  assert.equal(await htmlBg(), 'rgb(20, 23, 28)', name + ': list view: page background = list colour');
  await page.locator('#novaInboxView [data-conv]').first().click(); await page.locator('.wa-composer').waitFor(); await page.waitForTimeout(350);
  assert.equal(await htmlBg(), 'rgb(26, 30, 36)', name + ': chat view: page background = composer colour');
  assert.deepEqual(other, []); assert.deepEqual(errors, []); ok(name + ': edge to edge, page background follows the screen'); await ctx.close();
}
{ // standalone iPhone: innerHeight 47px shorter than the screen. The screen must still reach the real bottom edge (inset:0), list and chat.
  const { ctx, page, other, errors } = await open({ width: 390, height: 844, touch: true }, BASE + '?app=whatsapp', 47); let g = await rects(page);
  assert.ok(g.real - g.vh >= 46, 'the shortfall is emulated: ' + g.real + ' vs ' + g.vh);
  assert.ok(Math.abs(g.root.bottom - g.real) <= 1, 'list: reaches the real screen bottom (' + g.root.bottom + ' vs ' + g.real + '), not the short innerHeight ' + g.vh);
  await page.locator('#novaInboxView [data-conv]').first().click(); await page.locator('.wa-composer').waitFor(); await page.waitForTimeout(350); g = await rects(page);
  assert.ok(Math.abs(g.root.bottom - g.real) <= 1, 'chat: reaches the real screen bottom (' + g.root.bottom + ' vs ' + g.real + ')');
  assert.deepEqual(other, []); assert.deepEqual(errors, []); ok('phone app, innerHeight 47px short (iOS standalone): list and chat still reach the screen bottom'); await ctx.close();
}
console.log('PASS wa-edges:', n, 'cases'); await browser.close();
