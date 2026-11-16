// UX440: header buttons (WhatsApp / refresh) >=44px hit target, accessible names, focus ring. Fake data only, non-GET blocked.
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
    for (const id of ['novaWaBtn', 'btnRefreshApp']) {
      const l = p.locator('#' + id);
      const box = await l.boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44, `${vp.width} #${id} ${JSON.stringify(box)}`);
      assert.ok((await l.getAttribute('aria-label') || '').trim().length > 2, id + ' aria-label');
      assert.ok((await l.getAttribute('title') || '').trim().length > 2, id + ' title');
      await l.focus();
      await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
      const o = await l.evaluate(e => { const s = getComputedStyle(e); return { w: s.outlineWidth, st: s.outlineStyle }; });
      assert.ok(o.st !== 'none' && parseFloat(o.w) >= 2, `${vp.width} #${id} focus ring ${JSON.stringify(o)}`);
    }
    assert.equal(await p.locator('#btnRefreshApp').getAttribute('aria-label'), 'تحديث التطبيق');
    n++; console.log('  ok', vp.width); await ctx.close();
  }
  console.log('passed', n);
} finally { await b.close(); }
