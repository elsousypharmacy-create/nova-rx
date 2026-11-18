// UX306: the floating stickers FAB must not overlap any products-table cell (1366x768 + 390x844). Fake data, non-GET blocked.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const hit = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG' });
    await ctx.route('**/*', r => {
      const q = r.request(), u = q.url();
      if (q.method() !== 'GET' && !u.startsWith('data:')) return r.abort();
      return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort();
    });
    const page = await ctx.newPage();
    await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
    await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
    await page.evaluate(() => document.querySelector('.nova-tab[data-page=products]').click());
    await page.waitForTimeout(1500);
    const fab = page.locator('#novaAiLaunch');
    const fb = (await fab.count()) && (await fab.isVisible()) ? await fab.boundingBox() : null;
    const cells = page.locator('.nova-page-view:visible table td, .nova-page-view:visible table th');
    const n = await cells.count();
    assert.ok(n > 0, vp.width + ': table cells exist');
    let checked = 0;
    for (const pos of [0, 1e6]) {
      await page.evaluate(y => { document.querySelectorAll('.nova-page-view').forEach(e => { e.scrollTop = y; }); window.scrollTo(0, y); }, pos);
      await page.waitForTimeout(200);
      for (let i = 0; i < n; i++) {
        const b = await cells.nth(i).boundingBox();
        if (!b || !b.width || !b.height) continue;
        checked++;
        if (fb) assert.ok(!hit(fb, b), `${vp.width}: FAB overlaps cell #${i}`);
      }
    }
    assert.equal(fb, null, vp.width + ': floating FAB not displayed on products');
    const hb = page.locator('#novaInventoryLabels');
    assert.ok(await hb.count() && await hb.first().isVisible(), vp.width + ': header stickers button visible');
    console.log(`  ${vp.width}: FAB hidden, ${checked} cell checks, header button visible`);
    await ctx.close();
  }
  console.log('ux306: ok');
} finally { await browser.close(); }
