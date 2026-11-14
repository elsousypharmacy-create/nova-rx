// UX205: on 390px every nav tab is reachable, the active tab is fully visible after each click/load,
// scroll-snap + edge-fade hint exist, and purchases.html nav shows البيع/الفواتير (active tab in view).
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const fully = (el, nav) => el.left >= nav.left - 1 && el.right <= nav.right + 1;
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ar-EG' });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForTimeout(1200);
  const tabs = await page.$$eval('.nova-nav .nova-tab', els => els.map(e => e.textContent.trim()));
  assert.ok(tabs.length >= 7, 'tabs count ' + tabs.length + ': ' + tabs.join('|'));
  const css = await page.evaluate(() => { const n = document.querySelector('.nova-nav'); const s = getComputedStyle(n); return { snap: s.scrollSnapType, mask: s.webkitMaskImage || s.maskImage }; });
  assert.ok(/x/.test(css.snap), 'scroll-snap-type x: ' + css.snap);
  assert.ok(/gradient/.test(css.mask), 'edge fade mask: ' + css.mask);
  const vis = () => page.evaluate(() => {
    const n = document.querySelector('.nova-nav'); const a = n.querySelector('.nova-tab.active');
    const nr = n.getBoundingClientRect(), ar = a.getBoundingClientRect();
    return { nav: { left: nr.left, right: nr.right }, el: { left: ar.left, right: ar.right }, t: a.textContent.trim() };
  });
  assert.ok(fully((await vis()).el, (await vis()).nav), 'active visible on load');
  const n = tabs.length;
  for (let i = 0; i < n; i++) {
    const t = page.locator('.nova-nav .nova-tab').nth(i);
    await t.scrollIntoViewIfNeeded();
    const label = (await t.textContent()).trim();
    if (await t.evaluate(e => e.tagName === 'A')) continue; // purchases = navigation, covered below
    await t.click();
    await page.waitForTimeout(450);
    const v = await vis();
    assert.ok(fully(v.el, v.nav), `active tab "${v.t}" fully visible after click on "${label}" ` + JSON.stringify(v));
  }
  console.log('  ok UX205 index: ' + n + ' tabs reachable, active fully visible after each click, snap+fade present');
  const p2 = await ctx.newPage();
  await p2.goto(new URL('purchases.html', BASE).href);
  await p2.waitForTimeout(1200);
  const r = await p2.evaluate(() => {
    const n = document.querySelector('.nova-topbar nav'); const nr = n.getBoundingClientRect();
    return [...n.querySelectorAll('a')].map(a => { const r = a.getBoundingClientRect(); return { t: a.textContent.trim(), cur: a.hasAttribute('aria-current'), ok: r.left >= nr.left - 1 && r.right <= nr.right + 1, sw: n.scrollWidth, cw: n.clientWidth }; });
  });
  assert.equal(r.length, 7);
  assert.ok(r.find(x => x.cur).ok, 'purchases active tab fully visible: ' + JSON.stringify(r));
  // البيع and الفواتير reachable by scrolling
  const reach = await p2.evaluate(() => { const n = document.querySelector('.nova-topbar nav'); const o = []; for (const a of n.querySelectorAll('a')) { a.scrollIntoView({ inline: 'center', block: 'nearest' }); const nr = n.getBoundingClientRect(), ar = a.getBoundingClientRect(); o.push(ar.left >= nr.left - 1 && ar.right <= nr.right + 1); } return o; });
  assert.ok(reach.every(Boolean), 'all 7 purchases tabs reachable ' + reach);
  const pm = await p2.evaluate(() => { const s = getComputedStyle(document.querySelector('.nova-topbar nav')); return s.scrollSnapType + '|' + (s.webkitMaskImage || s.maskImage); });
  assert.ok(/x/.test(pm) && /gradient/.test(pm), 'purchases snap+fade ' + pm);
  console.log('  ok UX205 purchases: 7 tabs reachable, active visible, snap+fade present');
} finally { await browser.close(); }
