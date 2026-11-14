// UX69: first-run hint card + F1 shortcuts chip.
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
  const ready = async () => {
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE' && window.novaPay, null, { timeout: 8000 });
  };
  await ready();
  const card = page.locator('#novaFirstRunHint'), chip = page.locator('#novaHelpChip');
  assert.ok(await card.isVisible(), 'hint visible on fresh storage');
  assert.equal(await card.locator('li').count(), 3, '3 steps');
  assert.ok(await chip.isVisible(), 'chip visible');
  await chip.click();
  assert.ok(await page.locator('#helpModal').evaluate(e => e.classList.contains('active')), 'chip opens help');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('helpModal').classList.contains('active'));
  console.log('  ok fresh: 3 steps + chip opens help');

  const product = await page.evaluate(() => window.NOVA_DEMO.products.find(p => p && p.barcode && p.price > 0));
  await page.locator('#mainSearchInput').click();
  await page.locator('#mainSearchInput').fill(product.barcode);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#invoiceTableBody tr').length === 1);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('checkoutModal').classList.contains('active'), null, { timeout: 3000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('receiptModal').classList.contains('active'), null, { timeout: 3000 });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.novaPay, null, { timeout: 8000 });
  assert.ok(!(await card.isVisible()), 'hint gone after first sale + reload');
  assert.ok(await chip.isVisible(), 'chip stays');
  console.log('  ok after sale: card gone, chip stays');
  assert.deepEqual(errors, [], 'no console errors: ' + errors.join('|'));
} finally { await browser.close(); }
