// UX326: small controls flagged by QA loop 314 have a real hit area of >=36px (desktop) / >=44px (touch):
// purchases #selectAll (via its .select-all-label wrapper), sticker-studio #pharmacistApproval,
// emergency-sales #exp and the price-file picker (#file via label #filePick). The hit area must be
// hittable over its whole box (elementFromPoint at the inset corners lands on the control/label, not a
// neighbour cell), and tapping the edge of the wrapper must toggle the checkbox. Fake/local data only;
// non-GET requests and external origins are blocked. Run with a static server on :8765:
//   python3 -m http.server 8765 --bind 127.0.0.1 & CHROME_PATH=/usr/bin/chromium node tests/ui-ux326-touch-targets.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const origin = new URL(BASE).origin;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const blocked = [];

// hit = element whose box is the tap target; ctl = the control it activates
const TARGETS = [
  { page: 'purchases.html', ctl: '#selectAll', hit: '.select-all-label', toggles: true, setup: '#loadMock', ready: '#rows tr[data-key]' },
  { page: 'sticker-studio.html', ctl: '#pharmacistApproval', hit: '#pharmacistApproval', toggles: true },
  { page: 'emergency-sales.html', ctl: '#exp', hit: '#exp', open: '#nData' },
  { page: 'emergency-sales.html', ctl: '#file', hit: '#filePick', open: '#nData' },
];

try {
  for (const vp of [{ n: 'desktop', width: 1366, height: 768, min: 36 }, { n: 'mobile', width: 390, height: 844, min: 44 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'ar-EG', serviceWorkers: 'block', hasTouch: vp.n === 'mobile', isMobile: vp.n === 'mobile' });
    await ctx.route('**/*', r => {
      const q = r.request(), u = q.url();
      if (q.method() !== 'GET' && q.method() !== 'HEAD') { blocked.push(q.method() + ' ' + u); return r.abort(); }
      return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    for (const t of TARGETS) {
      const label = `${vp.n} ${t.page} ${t.ctl}`;
      await page.goto(new URL(t.page, BASE).href, { waitUntil: 'load' });
      assert.equal(await page.getAttribute('html', 'dir'), 'rtl', `${label}: RTL`);
      if (t.open) await page.click(t.open);
      if (t.setup) { await page.evaluate(()=>{const m=document.querySelector('.tools-menu');if(m)m.open=true}); await page.click(t.setup); await page.waitForSelector(t.ready); } // local fake scenario
      await page.locator(t.hit).scrollIntoViewIfNeeded();
      const m = await page.evaluate(({ ctl, hit }) => {
        const c = document.querySelector(ctl), h = document.querySelector(hit), r = h.getBoundingClientRect();
        const owns = e => !!e && (h.contains(e) || e === c || (e.closest && e.closest('label') && e.closest('label').control === c));
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2; // edge midpoints (corners may be rounded) + centre
        const pts = [[r.left + 3, cy], [r.right - 3, cy], [cx, r.top + 3], [cx, r.bottom - 3], [cx, cy]];
        const activates = h === c || (h.tagName === 'LABEL' && h.control === c) || (h.closest('label') && h.closest('label').control === c);
        return { w: r.width, h: r.height, activates, misses: pts.filter(([x, y]) => !owns(document.elementFromPoint(x, y))).length,
          bg: getComputedStyle(document.body).backgroundColor };
      }, t);
      assert.ok(m.activates, `${label}: hit area activates the control`);
      assert.ok(m.w >= vp.min && m.h >= vp.min, `${label}: hit area ${Math.round(m.w)}x${Math.round(m.h)} >= ${vp.min}px`);
      assert.equal(m.misses, 0, `${label}: whole hit area is hittable (not covered by a neighbour)`);
      assert.match(m.bg, /^rgb\((\d|[1-4]\d), (\d|[1-4]\d), (\d|[1-4]\d)\)$/, `${label}: Black Edition dark background (${m.bg})`);
      if (t.toggles) {
        const before = await page.isChecked(t.ctl);
        const box = await page.locator(t.hit).boundingBox();
        const x = box.x + 3, y = box.y + box.height / 2; // tap the far (left) edge of the hit area, not the 22px box
        if (vp.n === 'mobile') await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
        assert.equal(await page.isChecked(t.ctl), !before, `${label}: edge tap toggles the checkbox`);
      }
      console.log(`PASS ${label}: ${Math.round(m.w)}x${Math.round(m.h)}`);
    }
    // the purchases header still lays out on one row on desktop (no visual layout change beyond 6px column)
    if (vp.n === 'desktop') {
      await page.goto(new URL('purchases.html', BASE).href, { waitUntil: 'load' });
      const th = await page.evaluate(() => [...document.querySelectorAll('.products thead th')].map(e => Math.round(e.getBoundingClientRect().top)));
      assert.equal(new Set(th).size, 1, 'desktop purchases: header cells on one row');
    }
    assert.deepEqual(errs, [], `${vp.n}: no page errors`);
    await ctx.close();
  }
  console.log(`UX326 PASS (blocked non-GET: ${blocked.length})`);
} finally {
  await browser.close();
}
