// UX64: inline oversell warning on the cart line + one-click fix.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); }
      localStorage.setItem('nova-rx-language', 'ar');
      localStorage.removeItem('nova.activePage');
    } catch {}
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE' && window.novaPay, null, { timeout: 8000 });

  // Pick a catalog product and pin its stock to 42.
  const name = await page.evaluate(() => {
    const p = window.NOVA_DEMO.products.find(x => x && x.barcode && x.price > 0 && !window.novaStock.hasLots(window.novaStock.keyOf(x)));
    p.stock = 42;
    return p.name;
  });
  await page.locator('#mainSearchInput').fill(name.split(' ')[0] + ' *500');
  await page.keyboard.press('Enter');
  const note = page.locator('#invoiceTableBody .item-oversell');
  await note.waitFor({ timeout: 2000 });
  assert.match(await note.innerText(), /المتاح 42/);
  assert.equal(await page.locator('#invoiceTableBody .qty-input').first().inputValue(), '500');
  console.log('  ok *500 shows inline «المتاح 42»');

  // checkout stays blocked while oversold
  await page.keyboard.press('F9');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.getElementById('checkoutModal').classList.contains('active')), false, 'checkout blocked');

  await page.locator('.btn-oversell-fix').click();
  assert.equal(await page.locator('#invoiceTableBody .qty-input').first().inputValue(), '42');
  assert.equal(await page.locator('#invoiceTableBody .item-oversell').count(), 0);
  console.log('  ok one click sets qty 42 and clears the note');

  assert.deepEqual(errors, []);
  console.log('UX64 oversell-inline OK');
} finally {
  await browser.close();
}
