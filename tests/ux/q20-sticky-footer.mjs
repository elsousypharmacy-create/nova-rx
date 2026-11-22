// Q20 step 0: on the phone (390x844) «إقفال الوردية» and the receiving «تأكيد الاستلام» are on screen without scrolling
// (fixed bar above the bottom nav on the shift page; sticky footer in the receiving dialog). SHOT_DIR=<dir> saves screenshots.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOT = process.env.SHOT_DIR || '';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const shot = async (page, name) => { if (SHOT) await page.screenshot({ path: SHOT + '/' + name + '.png' }); };

// true when the element is inside the viewport and is the topmost element at its centre (not hidden under the nav)
const reachable = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s); if (!el || !el.offsetParent) return 'missing';
  const r = el.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight || r.height < 40) return 'off-screen ' + Math.round(r.top) + '..' + Math.round(r.bottom) + '/' + innerHeight;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return hit && (hit === el || el.contains(hit)) ? 'ok' : 'covered by ' + (hit && (hit.id || hit.className));
}, sel);

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG', serviceWorkers: 'block', hasTouch: true, isMobile: true });
await ctx.route('**/*', r => {
  const q = r.request(), u = q.url();
  if (!['GET', 'HEAD'].includes(q.method())) return r.abort();
  return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort();
});
await ctx.addInitScript(() => {
  try {
    if (!sessionStorage.getItem('__seed')) { localStorage.clear(); sessionStorage.setItem('__seed', '1'); localStorage.setItem('nova-rx-onboarding-done', '1'); }
    localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage');
  } catch {}
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e.message)));
page.on('dialog', d => d.dismiss().catch(() => {}));
try {
  await page.goto(BASE + 'index.html', { waitUntil: 'load' });
  await page.waitForSelector('#mainSearchInput', { timeout: 15000 });
  await page.locator('#novaSplash').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);

  // 1) shift page: the close button is visible at once, above the bottom nav
  await page.locator('#novaBottomNav button', { hasText: 'الوردية' }).click();
  await page.waitForSelector('#novaShiftDo', { timeout: 10000 });
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.getElementById('novaPageView').scrollTop), 0, 'page opened at the top');
  assert.equal(await reachable(page, '#novaShiftDo'), 'ok', 'إقفال الوردية reachable without scrolling');
  assert.equal(await reachable(page, '#novaBottomNav'), 'ok', 'bottom nav still visible');
  await shot(page, 'q20-shift-390');
  // pressing it with no count focuses the counted-cash box instead of closing
  await page.locator('#novaShiftDo').click();
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'novaShiftCount', 'focus moves to counted cash');
  // the last field is not hidden under the fixed bar after scrolling to the end
  await page.evaluate(() => { const v = document.getElementById('novaPageView'); v.scrollTop = v.scrollHeight; });
  await page.waitForTimeout(200);

  // 2) other pages: no fixed bar
  await page.locator('#novaBottomNav button', { hasText: 'البيع' }).click();
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => { const b = document.querySelector('.nova-shift-acts'); return !!(b && b.offsetParent && getComputedStyle(b).position === 'fixed'); }), false, 'no fixed shift bar outside the shift page');

  // 3) receiving invoice dialog with many lines: confirm button stays on screen
  await page.evaluate(() => window.novaReceiving.open());
  await page.waitForSelector('#rcvForm', { timeout: 8000 });
  for (let i = 0; i < 5; i++) await page.locator('#rcvForm [data-rcv-add]').click();
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => { const d = document.querySelector('#rcvForm .rcv-dlg'); return d.scrollHeight > d.clientHeight + 100; }), 'dialog content is taller than the screen');
  assert.equal(await reachable(page, '#rcvOk'), 'ok', 'تأكيد الاستلام reachable without scrolling');
  await shot(page, 'q20-receiving-390');
  await page.evaluate(() => { const d = document.querySelector('#rcvForm .rcv-dlg'); d.scrollTop = d.scrollHeight; });
  assert.equal(await reachable(page, '#rcvOk'), 'ok', 'still reachable at the end');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('q20-sticky-footer: PASS');
} finally {
  await browser.close();
}
