// UX207: stickers FAB must not cover products table cells (price/barcode) when scrolled to the end, at 1366 and 390.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8');
const hit = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG' });
    await ctx.route('**/*', r => { const u = r.request().url(); return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
    const page = await ctx.newPage();
    await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
    await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
    await page.locator('.nova-tab[data-page="products"]').click();
    await page.waitForSelector('#novaAiLaunch', { state: 'visible' });
    // let idle chunks render all rows, then scroll every scroller to the end
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      document.querySelectorAll('.nova-page-view').forEach(e => { e.scrollTop = e.scrollHeight; });
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await page.waitForTimeout(300);
    const f = await page.locator('#novaAiLaunch').boundingBox();
    assert.ok(f, vp.width + ': FAB has box');
    const cells = page.locator('.nova-page-view:visible table td, .nova-page-view:visible table th');
    const n = await cells.count();
    assert.ok(n > 0, vp.width + ': products table cells exist');
    let checked = 0;
    for (let i = 0; i < n; i++) {
      const b = await cells.nth(i).boundingBox();
      if (!b || b.width === 0 || b.height === 0) continue;
      checked++;
      assert.ok(!hit(f, b), `${vp.width}: FAB overlaps table cell #${i} (${JSON.stringify(b)}) vs FAB ${JSON.stringify(f)}`);
    }
    console.log(`  ${vp.width}: FAB ${JSON.stringify(f)}, ${checked} cells checked, no overlap`);
    await ctx.close();
  }
  console.log('ui-ux207-fab-overlap: all ok');
} finally { await browser.close(); }
