// UX17: measured interaction counts for a fast sale (keyboard/mouse), local index.html.
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
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE' && window.novaPay, null, { timeout: 8000 });

  let clicks = 0, keys = 0;
  await page.exposeFunction('__click', () => { clicks++; });
  await page.evaluate(() => document.addEventListener('click', e => { if (e.isTrusted) window.__click(); }, true));
  const press = async k => { keys++; await page.keyboard.press(k); };
  const modal = id => page.locator(id).evaluate(el => el.classList.contains('active'));
  const search = page.locator('#mainSearchInput');
  const barcode = await page.evaluate(() => window.NOVA_DEMO.products.find(p => p && p.barcode && p.price > 0).barcode);

  // 1) barcode sale: typed barcode + Enter (add), Enter (checkout), Enter (confirm); 0 clicks
  await search.focus();
  await page.keyboard.type(barcode);
  await press('Enter');
  assert.equal(await page.locator('#invoiceTableBody tr').count(), 1);
  await press('Enter');
  assert.ok(await modal('#checkoutModal'), 'checkout opens on Enter with empty search');
  await press('Enter');
  await page.waitForFunction(() => document.getElementById('receiptModal').classList.contains('active'));
  assert.ok(keys <= 3 && clicks === 0, `barcode sale keys=${keys} clicks=${clicks}`);
  console.log(`  ok barcode sale: ${keys} key presses, ${clicks} clicks`);
  await page.keyboard.press('Enter'); // receipt Enter = new sale
  await page.waitForFunction(() => !document.getElementById('receiptModal').classList.contains('active'));
  assert.equal(await page.locator('#invoiceTableBody tr').count(), 0);
  console.log('  ok Enter on receipt starts new sale');

  // 2) name + qty + 10% + card: Enter, F6(+type 10), F9, F10, Enter
  keys = 0; clicks = 0;
  await search.focus();
  await page.keyboard.type('جافيسكون*3');
  await page.waitForTimeout(200);
  await press('Enter');
  assert.equal(await page.locator('#invoiceTableBody .qty-input').first().inputValue(), '3');
  await press('F6');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'inputPercentDiscount');
  await page.keyboard.type('10');
  await press('F9');
  assert.ok(await modal('#checkoutModal'));
  await press('F10');
  assert.equal(await page.locator('.pay-method-btn.active').getAttribute('data-method'), 'card');
  await press('Enter');
  await page.waitForFunction(() => document.getElementById('receiptModal').classList.contains('active'));
  assert.ok(keys + clicks <= 5 && clicks === 0, `card sale interactions=${keys + clicks}`);
  console.log(`  ok name+qty+10%+card sale: ${keys} key presses, ${clicks} clicks`);
  await press('Escape');

  // 3) prefix qty, F7, F1, F12
  await search.focus();
  await page.keyboard.type('*2 جافيسكون');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#invoiceTableBody .qty-input').first().inputValue(), '2');
  await page.keyboard.press('F7');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'inputFixedDiscount');
  await page.keyboard.press('F1');
  assert.ok(await modal('#helpModal'));
  await page.keyboard.press('Escape');
  console.log('  ok prefix qty, F7, F1');
  assert.deepEqual(errors, []);
  console.log('sale-clicks: PASS');
} finally { await browser.close(); }
