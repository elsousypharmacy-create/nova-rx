// Q24 look (Gemini designer #9, #11): desktop shift form not stretched to the full width; on the phone the settings
// cards and theme buttons fit the screen, the settings tabs show a scroll fade, the report period buttons fit without wrapping.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const errors = [];
async function open(vp) {
  const mobile = vp.width < 600;
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block', hasTouch: mobile, isMobile: mobile });
  await ctx.route('**/*', r => {
    const q = r.request(), u = q.url();
    if (!['GET', 'HEAD'].includes(q.method())) return r.abort();
    return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort();
  });
  await ctx.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('__seed')) { localStorage.clear(); sessionStorage.setItem('__seed', '1'); localStorage.setItem('nova-rx-onboarding-done', '1');
        localStorage.setItem('nova-rx-sales-v1', JSON.stringify([1, 2, 3].map(i => ({ id: 'S' + i, number: '2026-0000' + i, at: Date.now() - i * 36e5, total: 50, vat: 0, payment: 'cash', customer: '', status: 'final', lines: [{ name: 'صنف تجريبي', price: 25, qty: 2, discount: 0 }] })))); } // fake sales: the period bar shows only with data
      localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage');
    } catch {}
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.goto(BASE + 'index.html', { waitUntil: 'load' });
  await page.waitForSelector('#mainSearchInput', { timeout: 15000 });
  await page.locator('#novaSplash').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.evaluate(() => window.novaLazy && window.novaLazy.load()).catch(() => {}); // the owner report (period buttons) is lazy
  return { ctx, page };
}
const go = async (page, name) => { await page.evaluate(n => window.novaSwitchPage(n), name); await page.waitForTimeout(900); };
try {
  // desktop: the shift close form is at most 760px wide
  let { ctx, page } = await open({ width: 1366, height: 768 });
  await go(page, 'shift');
  await page.waitForSelector('#novaShiftCount', { timeout: 10000 });
  const w = await page.evaluate(() => ['novaShiftClose', 'novaShiftCount', 'novaShiftFloat'].map(id => Math.round(document.getElementById(id).getBoundingClientRect().width)));
  assert.ok(w.every(x => x > 300 && x <= 760), 'shift form width ' + w);
  await ctx.close();

  // phone
  ({ ctx, page } = await open({ width: 390, height: 844 }));
  await go(page, 'settings');
  await page.waitForSelector('#novaPageView .nova-set-sec', { timeout: 10000 });
  const out = await page.evaluate(() => [...document.querySelectorAll('#novaPageView .nova-set-sec, #novaPageView .nova-setting-card, #novaThemeCard .nova-lang-switch')]
    .filter(e => e.offsetParent).filter(e => { const r = e.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; }).map(e => e.id || e.className));
  assert.deepEqual(out, [], 'settings cards and theme buttons inside the screen');
  const mask = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('#novaPageView .nova-set-nav')); return s.webkitMaskImage || s.maskImage || 'none'; });
  assert.match(mask, /gradient/, 'settings tabs have a scroll fade');
  await go(page, 'reports');
  await page.waitForSelector('#novaPageView .nova-rep-seg button', { timeout: 10000 });
  const seg = await page.evaluate(() => [...document.querySelectorAll('#novaPageView .nova-rep-seg button')].filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return { l: r.left, r: r.right, h: r.height }; }));
  assert.ok(seg.length >= 4, 'report period buttons shown: ' + seg.length);
  assert.ok(seg.every(b => b.l >= -1 && b.r <= 391 && b.h <= 50), 'period buttons fit on one line each ' + JSON.stringify(seg.map(b => Math.round(b.h))));
  await ctx.close();
  assert.deepEqual(errors, [], 'no page errors');
  console.log('q24-look: PASS');
} finally {
  await browser.close();
}
