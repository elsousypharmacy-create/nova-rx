// UX32: payment dialog layout, credit guard, focus order.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
async function open(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'ar-EG' });
  await ctx.route('**/*', r => { const u = r.request().url(); return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE' && window.novaPay, null, { timeout: 8000 });
  const product = await page.evaluate(() => window.NOVA_DEMO.products.find(p => p && p.barcode && p.price > 0));
  await page.locator('#mainSearchInput').fill(product.barcode);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('checkoutModal').classList.contains('active'), null, { timeout: 2000 });
  await page.waitForTimeout(600); // let the open transition settle
  return page;
}
const rows = page => page.evaluate(() => [...new Set([...document.querySelectorAll('.pay-method-btn')].map(b => Math.round(b.getBoundingClientRect().top)))].length);
const active = page => page.evaluate(() => document.activeElement.id);
try {
  let page = await open(1366, 768);
  assert.equal(await rows(page), 1, 'desktop: one row');
  assert.ok(!(await page.locator('.pay-methods-grid').innerText()).includes('مشترك'), 'renamed');
  assert.ok((await page.locator('.pay-methods-grid').innerText()).includes('مختلط'));
  // focus after F10 / F12
  await page.keyboard.press('F10');
  assert.equal(await active(page), 'btnConfirmPayment', 'F10 focuses confirm');
  await page.keyboard.press('F12');
  assert.equal(await active(page), 'inputCashReceived', 'F12 focuses cash');
  // walk-in credit guard
  await page.keyboard.press('F11');
  assert.ok(await page.locator('#btnConfirmPayment').isDisabled(), 'confirm disabled');
  assert.ok(await page.locator('#checkoutCreditHint').isVisible(), 'hint visible');
  assert.equal(await page.locator('#checkoutCreditHint').innerText(), 'اختر عميلاً لإتمام البيع الآجل');
  assert.equal(await active(page), 'checkoutAddCustomer', 'focus add customer');
  await page.keyboard.press('F12');
  assert.ok(!(await page.locator('#btnConfirmPayment').isDisabled()), 'cash re-enables');
  assert.ok(!(await page.locator('#checkoutCreditHint').isVisible()));
  // tab order: methods -> amount -> confirm -> cancel
  await page.locator('.pay-method-btn[data-method="cash"]').focus();
  const seq = [];
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); seq.push(await page.evaluate(() => document.activeElement.dataset.method || document.activeElement.id)); }
  assert.deepEqual(seq, ['card', 'credit', 'split', 'inputCashReceived', 'btnConfirmPayment', 'btnCancelCheckout'], 'tab order: methods -> amount -> confirm -> cancel');
  await page.context().close();

  page = await open(390, 844);
  const geo = await page.evaluate(() => [...document.querySelectorAll('.pay-method-btn')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.left)]; }));
  const tops = [...new Set(geo.map(g => g[0]))];
  assert.equal(tops.length, 2, 'mobile: two rows');
  assert.equal(geo.filter(g => g[0] === tops[0]).length, 2, 'two per row');
  console.log('  ok checkout polish');
  await page.context().close();
} finally { await browser.close(); }
