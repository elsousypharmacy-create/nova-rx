// UX67: F8 unit quick switch, remembered unit, discount Enter returns focus to search.
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

  const unit = () => page.locator('#invoiceTableBody .unit-select').first().inputValue();
  const stripProd = await page.evaluate(() => window.NOVA_DEMO.products.find(p => window.novaUnits.availableUnits(p).includes('strip')));
  assert.ok(stripProd, 'a product with strip unit exists');
  const addByBarcode = async () => {
    await page.locator('#mainSearchInput').fill(stripProd.barcode);
    await page.keyboard.press('Enter');
  };
  await addByBarcode();
  assert.equal(await unit(), 'box');
  await page.keyboard.press('F8');
  const u1 = await unit();
  assert.notEqual(u1, 'box', 'F8 switches unit');
  const units = await page.evaluate(p => window.novaUnits.availableUnits(p), stripProd);
  assert.equal(u1, units[1]);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'mainSearchInput');
  // go to strip explicitly
  if (u1 !== 'strip') { await page.keyboard.press('F8'); }
  assert.equal(await unit(), 'strip');

  // next sale of the same product starts as strip
  await page.keyboard.press('F2');
  assert.equal(await page.locator('#invoiceTableBody tr').count(), 0);
  await addByBarcode();
  assert.equal(await unit(), 'strip', 'unit remembered');

  // F6, type 10, Enter -> focus back in search
  await page.keyboard.press('F6');
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'mainSearchInput');
  console.log('  ok F8 cycle, remembered unit, discount Enter focus');
  assert.deepEqual(errors, []);
  console.log('UX67 unit-quick OK');
} finally {
  await browser.close();
}
