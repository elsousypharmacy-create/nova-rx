// UX17: measured interaction counts for fast keyboard/mouse sales.
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

  let keys = 0, clicks = 0;
  const press = async k => { keys++; await page.keyboard.press(k); };
  const state = () => page.evaluate(() => ({
    checkout: document.getElementById('checkoutModal').classList.contains('active'),
    receipt: document.getElementById('receiptModal').classList.contains('active')
  }));

  // --- 1. barcode sale: typed barcode + Enter, Enter, Enter, 0 clicks ---
  const product = await page.evaluate(() => window.NOVA_DEMO.products.find(p => p && p.barcode && p.price > 0));
  await page.locator('#mainSearchInput').fill(product.barcode); // typing, not counted
  await press('Enter');
  assert.equal(await page.locator('#invoiceTableBody tr').count(), 1, 'Enter adds barcode line');
  await press('Enter');
  await page.waitForFunction(() => document.getElementById('checkoutModal').classList.contains('active'), null, { timeout: 2000 });
  await press('Enter'); // confirms (cash defaults to exact)
  await page.waitForFunction(() => document.getElementById('receiptModal').classList.contains('active'), null, { timeout: 2000 });
  assert.ok(keys <= 3 && clicks === 0, `barcode sale used ${keys} keys, ${clicks} clicks`);
  console.log(`  ok barcode sale: ${keys} key presses, ${clicks} clicks`);

  // --- receipt Enter starts a new sale ---
  await press('Enter');
  assert.equal((await state()).receipt, false);
  assert.equal(await page.locator('#invoiceTableBody tr').count(), 0);

  // --- F1 help ---
  await page.keyboard.press('F1');
  assert.ok(await page.evaluate(() => document.getElementById('helpModal').classList.contains('active')));
  await page.keyboard.press('Escape');

  // --- 2. name + qty + 10% discount + card sale ---
  keys = 0; clicks = 0;
  await page.locator('#mainSearchInput').fill('جافيسكون *3'); // typing
  await press('Enter');                                          // 1: first suggestion, qty 3
  assert.equal(await page.locator('#invoiceTableBody .qty-input').first().inputValue(), '3');
  await press('F6');                                             // 2: focus % discount
  await page.keyboard.type('10');                                // typing
  await press('F9');                                             // 3: open checkout (discount applies on input)
  await page.waitForFunction(() => document.getElementById('checkoutModal').classList.contains('active'), null, { timeout: 2000 });
  await press('F10');                                            // 4: card
  assert.equal(await page.evaluate(() => document.querySelector('.pay-method-btn.active').dataset.method), 'card');
  await press('Enter');                                          // 5: confirm
  await page.waitForFunction(() => document.getElementById('receiptModal').classList.contains('active'), null, { timeout: 2000 });
  const saved = await page.evaluate(() => window.novaSales.list()[0]);
  assert.equal(saved.lines[0].qty, 3);
  console.log(`  name+qty+10%+card sale: ${keys} interactions`);
  assert.ok(keys <= 5 && clicks === 0, `card sale used ${keys} interactions`);
  assert.deepEqual(errors, []);
  console.log('UX17 sale-clicks OK');
} finally {
  await browser.close();
}
