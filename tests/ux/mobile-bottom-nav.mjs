// NAV-01: phone bottom navigation (<= 780px). 5 targets replace the scrolling top tabs; «المزيد» sheet holds the rest;
// the sale screen's pay button stays fully visible above the bar; desktop keeps the top tabs and has no bar.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = (process.env.NOVA_URL || process.env.NOVA_UX_URL || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
  await ctx.route('**/*', r => { const q = r.request(); return q.url().startsWith(BASE) && q.method() === 'GET' ? r.continue() : r.abort(); });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(String(e)));
  await p.goto(BASE + (BASE.includes('127.0.0.1') ? 'index.html' : '') + '#sale');
  await p.locator('#novaSplash').waitFor({ state: 'hidden' });
  const bar = p.locator('#novaBottomNav');
  await bar.waitFor();
  assert.equal(await bar.locator('button').count(), 5);
  assert.equal(await p.locator('.nova-nav').isVisible(), false, 'top tabs hidden on the phone');
  assert.equal(await bar.locator('[data-bnav="sale"]').getAttribute('aria-current'), 'page');
  // pay button fully above the bar
  const geo = await p.evaluate(() => { const b = document.getElementById('novaBottomNav').getBoundingClientRect(); const f = document.querySelector('.invoice-footer').getBoundingClientRect(); return { barTop: b.top, footBottom: f.bottom, vh: innerHeight }; });
  assert.ok(geo.footBottom <= geo.barTop + 1, 'sale footer ends above the bar (' + geo.footBottom + ' <= ' + geo.barTop + ')');
  // main targets
  await bar.locator('[data-bnav="products"]').click();
  await p.waitForFunction(() => document.querySelector('.nova-tab.active[data-page="products"]'));
  assert.equal(await bar.locator('[data-bnav="products"]').getAttribute('aria-current'), 'page');
  await bar.locator('[data-bnav="customers"]').click();
  await p.waitForFunction(() => document.querySelector('.nova-tab.active[data-page="customers"]'));
  // more sheet: Esc closes and returns focus; item opens the page and marks «المزيد»
  await bar.locator('[data-bnav="more"]').click();
  const sheet = p.locator('#novaMoreSheet [role="dialog"]');
  await sheet.waitFor();
  assert.equal(await sheet.locator('a[href="/purchases"]').count(), 1);
  await p.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
  assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-bnav')), 'more');
  await bar.locator('[data-bnav="more"]').click();
  await p.locator('#novaMoreSheet [data-more="reports"]').click();
  await p.waitForFunction(() => document.querySelector('.nova-tab.active[data-page="reports"]'));
  assert.equal(await bar.locator('[data-bnav="more"]').getAttribute('aria-current'), 'page');
  // desktop: no bar, top tabs visible
  const d = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' })).newPage();
  await d.context().route('**/*', r => { const q = r.request(); return q.url().startsWith(BASE) && q.method() === 'GET' ? r.continue() : r.abort(); });
  d.on('pageerror', e => errors.push(String(e)));
  await d.goto(BASE + (BASE.includes('127.0.0.1') ? 'index.html' : '') + '#sale');
  await d.locator('#novaSplash').waitFor({ state: 'hidden' });
  assert.equal(await d.locator('#novaBottomNav').isVisible(), false, 'no bar on desktop');
  assert.equal(await d.locator('.nova-nav').isVisible(), true, 'top tabs on desktop');
  assert.deepEqual(errors, [], 'no page errors');
  console.log('mobile-bottom-nav PASS');
} finally { await browser.close(); }
