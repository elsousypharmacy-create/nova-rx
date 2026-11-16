// UX443: reports empty state, demo watermark, mobile nav fade/snap. Fake data only, non-GET blocked.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let n = 0;
try {
  for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const ctx = await b.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
    await ctx.route('**/*', r => {
      const q = r.request();
      if (q.method() !== 'GET') return r.abort();
      return q.url().startsWith(new URL(BASE).origin) ? r.continue() : r.abort();
    });
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: 'load' }); await p.waitForTimeout(1200);
    await p.locator('[data-page="reports"]').first().click(); await p.waitForTimeout(500);
    const tag = vp.width + 'px';
    assert.equal(await p.locator('#novaRepEmpty').count(), 1, tag + ' empty card');
    assert.equal(await p.locator('#novaPrintDay, #novaShiftPrint, #novaShiftClose, #novaShiftCount').count(), 0, tag + ' print/shift hidden');
    assert.ok((await p.locator('#novaRepLocked').innerText()).length > 20, tag + ' explanation shown');
    assert.match(await p.locator('#novaRepSkeleton').innerText(), /غير حقيقية|not real/, tag + ' skeleton labelled');
    const d = p.locator('#novaDemoData');
    if (await d.count()) {
      assert.equal(await d.getAttribute('data-demo'), '1');
      await d.locator('summary').click();
      assert.match(await d.locator('.nova-demo-badge').innerText(), /تجريبي/, tag + ' demo badge');
      assert.match(await d.evaluate(e => getComputedStyle(e, '::after').content), /DEMO/, tag + ' watermark');
    }
    if (vp.width === 390) {
      const r = await p.evaluate(() => { const nv = document.querySelector('.nova-nav'), s = getComputedStyle(nv), a = document.querySelector('.nova-tab.active').getBoundingClientRect(), nb = nv.getBoundingClientRect(); return { mask: s.maskImage || s.webkitMaskImage, snap: s.scrollSnapType, off: Math.abs((a.left + a.right) / 2 - (nb.left + nb.right) / 2) }; });
      assert.match(r.mask, /linear-gradient/); assert.match(r.snap, /x/); assert.ok(r.off < 40, 'active tab centred, off=' + r.off);
    }
    n++; console.log('  ok', vp.width); await ctx.close();
  }
  console.log('passed', n);
} finally { await b.close(); }
