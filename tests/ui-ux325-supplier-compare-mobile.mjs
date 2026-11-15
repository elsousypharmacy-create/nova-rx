// UX325: supplier-compare has no page-level horizontal scroll at 390px; the table becomes a card list
// (every cell fully inside the viewport, labelled), the notice wraps, the pager stays attached,
// and on desktop the table header is sticky. Fake fixture data only; non-GET requests are blocked.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const origin = new URL(BASE).origin;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const blocked = [];
try {
  for (const vp of [{ n: 'desktop', width: 1366, height: 768 }, { n: 'mobile', width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'ar-EG', serviceWorkers: 'block', hasTouch: vp.n === 'mobile' });
    await ctx.route('**/*', r => {
      const q = r.request(), u = q.url();
      if (q.method() !== 'GET' && q.method() !== 'HEAD') { blocked.push(q.method() + ' ' + u); return r.abort(); }
      return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(new URL('supplier-compare.html', BASE).href, { waitUntil: 'load' });
    await page.waitForSelector('#rows tr');
    assert.equal(await page.getAttribute('html', 'dir'), 'rtl', `${vp.n}: RTL`);
    const m = await page.evaluate(() => {
      const r = e => e.getBoundingClientRect();
      const out = e => { const b = r(e); return b.left < -1 || b.right > innerWidth + 1; };
      const badge = document.querySelector('.badge'), pager = document.querySelector('.pager');
      const lastRow = [...document.querySelectorAll('#rows tr')].pop();
      const th = document.querySelector('thead th');
      return {
        sw: document.documentElement.scrollWidth, iw: innerWidth,
        cellsOut: [...document.querySelectorAll('#rows td, #rows td *')].filter(out).length,
        badgeOut: out(badge), pagerOut: [...pager.querySelectorAll('*')].filter(out).length,
        pagerGap: Math.round(r(pager).top - r(lastRow).bottom),
        labels: [...document.querySelectorAll('#rows tr:first-child td')].map(td => td.dataset.label),
        firstTdDisplay: getComputedStyle(document.querySelector('#rows td')).display,
        theadVisible: r(document.querySelector('thead')).height > 2,
        thPos: getComputedStyle(th).position,
        nameFits: [...document.querySelectorAll('#rows td[data-label="الصنف"] > span')].every(s => s.scrollWidth <= s.clientWidth + 1 && !out(s)),
        bg: getComputedStyle(document.body).backgroundColor,
      };
    });
    assert.ok(m.sw <= m.iw, `${vp.n}: scrollWidth ${m.sw} <= innerWidth ${m.iw}`);
    assert.equal(m.cellsOut, 0, `${vp.n}: no cell outside viewport`);
    assert.equal(m.badgeOut, false, `${vp.n}: notice inside viewport`);
    assert.equal(m.pagerOut, 0, `${vp.n}: pager inside viewport`);
    assert.ok(m.pagerGap >= 0 && m.pagerGap <= 40, `${vp.n}: pager attached to list (gap ${m.pagerGap})`);
    assert.equal(m.labels.length, 8, `${vp.n}: 8 labelled cells`);
    assert.ok(m.nameFits, `${vp.n}: product names not truncated`);
    assert.match(m.bg, /^rgb\((\d|[1-3]\d), (\d|[1-3]\d), (\d|[1-3]\d)\)$/, `${vp.n}: dark Black Edition background (${m.bg})`);
    if (vp.n === 'mobile') {
      assert.equal(m.firstTdDisplay, 'flex', 'mobile: card list layout');
      assert.equal(m.theadVisible, false, 'mobile: header visually hidden (labels per card)');
      // pagination still works and stays contained
      await page.click('#next');
      const after = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, info: document.getElementById('pageInfo').textContent }));
      assert.ok(after.sw <= 390, `mobile page 2: scrollWidth ${after.sw}`);
      assert.match(after.info, /صفحة 2/);
    } else {
      assert.equal(m.firstTdDisplay, 'table-cell', 'desktop: real table');
      assert.equal(m.theadVisible, true, 'desktop: header visible');
      assert.equal(m.thPos, 'sticky', 'desktop: sticky header');
    }
    assert.deepEqual(errs, [], `${vp.n}: no page errors`);
    console.log(`ui-ux325 ${vp.n}: ok (scrollWidth ${m.sw}/${m.iw}, pager gap ${m.pagerGap}px)`);
    await ctx.close();
  }
  assert.deepEqual(blocked, [], 'no write requests attempted');
  console.log('ui-ux325-supplier-compare-mobile: all ok');
} finally { await browser.close(); }
