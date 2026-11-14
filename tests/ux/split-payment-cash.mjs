// UX60: split payment auto-fills the cash remainder; change and receipt stay consistent.
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
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
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

  const product = await page.evaluate(() => window.NOVA_DEMO.products.find(p => p && p.barcode && p.price > 0));
  await page.locator('#mainSearchInput').fill(product.barcode);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('checkoutModal').classList.contains('active'), null, { timeout: 2000 });
  await page.click('.pay-method-btn[data-method="split"]');
  const total = await page.evaluate(() => Number(document.getElementById('inputCashReceived').value));
  const card = Math.round(total * 0.4 * 100) / 100;
  const rest = (Math.round((total - card) * 100) / 100).toFixed(2);

  await page.locator('#inputCardAmount').fill(String(card));
  assert.equal(await page.inputValue('#inputCashReceived'), rest, 'cash = total - card');
  assert.match(await page.textContent('#displayChangeDue'), /^\s*0\.00/, 'change 0.00');

  // Enter in card field focuses cash (remainder > 0)
  await page.locator('#inputCardAmount').press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'inputCashReceived');

  // card > total rejected with toast
  await page.locator('#inputCardAmount').fill(String(total + 10));
  assert.equal(await page.inputValue('#inputCashReceived'), '0.00');
  await page.click('#btnConfirmPayment');
  assert.ok(await page.evaluate(() => document.getElementById('checkoutModal').classList.contains('active')), 'modal stays open');
  assert.ok(await page.evaluate(() => /أكبر من الإجمالي/.test(document.body.innerText)), 'over-allocation toast');

  // valid split completes; receipt not showing change = card amount
  await page.locator('#inputCardAmount').fill(String(card));
  await page.click('#btnConfirmPayment');
  await page.waitForFunction(() => document.getElementById('receiptModal').classList.contains('active'), null, { timeout: 2000 });
  const text = await page.evaluate(() => document.getElementById('receiptModal').innerText);
  assert.ok(!text.includes(`الباقي: ${card.toFixed(2)}`) && !new RegExp('الباقي:?\\s*' + card.toFixed(2)).test(text), 'receipt shows no change equal to the card amount');
  const s = await page.evaluate(() => window.novaSales.list()[0]);
  assert.equal(s.change, 0);
  assert.equal(s.received, Number(rest));
  assert.deepEqual(errors, []);
  console.log('UX60 split-payment-cash OK');
} finally {
  await browser.close();
}
