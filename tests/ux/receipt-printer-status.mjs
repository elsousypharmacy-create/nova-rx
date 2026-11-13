// UX22: receipt shows exactly one printer status; reconnect strip only when disconnected.
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

  const product = await page.evaluate(() => window.NOVA_DEMO.products.find(p => p && p.barcode && p.price > 0));
  await page.locator('#mainSearchInput').fill(product.barcode);
  const keys = [];
  for (const k of ['Enter', 'Enter', 'Enter']) {
    keys.push(k); await page.keyboard.press(k);
    if (keys.length === 2) await page.waitForFunction(() => document.getElementById('checkoutModal').classList.contains('active'), null, { timeout: 2000 });
  }
  await page.waitForFunction(() => document.getElementById('receiptModal').classList.contains('active'), null, { timeout: 2000 });

  const probe = () => page.evaluate(() => {
    const vis = e => !!e && !e.hidden && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
    const modal = document.getElementById('receiptModal');
    const status = [...modal.querySelectorAll('#btnPrinterStatus')].filter(vis);
    const textual = [...modal.querySelectorAll('.modal-body *')].filter(e => e.children.length === 0 && vis(e) && /الطابعة (متصلة|غير متصلة|غير معروفة)/.test(e.textContent) && !e.closest('#receiptSlipContent'));
    return { count: status.length, textual: textual.length, text: status[0] && status[0].textContent.trim(), strip: vis(document.getElementById('receiptPrinterAlert')), reconnect: vis(document.getElementById('btnReconnectPrinter')) };
  });

  let s = await probe();
  assert.equal(s.count, 1, 'one status element (unknown)');
  assert.equal(s.textual, 1, 'one printer status text (unknown)');
  assert.equal(s.text, 'الطابعة غير معروفة');
  assert.equal(s.strip, false, 'strip hidden before first check');

  await page.evaluate(() => window.novaReceipt.setPrinterConnected(true));
  s = await probe();
  assert.equal(s.count, 1); assert.equal(s.textual, 1);
  assert.equal(s.text, 'الطابعة متصلة'); assert.equal(s.strip, false); assert.equal(s.reconnect, false);

  await page.evaluate(() => window.novaReceipt.setPrinterConnected(false));
  s = await probe();
  assert.equal(s.count, 1); assert.equal(s.textual, 1, 'single status text when disconnected');
  assert.equal(s.text, 'الطابعة غير متصلة'); assert.equal(s.strip, true); assert.equal(s.reconnect, true);

  await page.evaluate(() => window.novaReceipt.setPrinterConnected(true));
  s = await probe();
  assert.equal(s.strip, false, 'strip hidden again after reconnect');

  keys.push('Enter'); await page.keyboard.press('Enter'); // 4th Enter: new sale
  assert.equal(await page.evaluate(() => document.getElementById('receiptModal').classList.contains('active')), false);
  assert.deepEqual(keys, ['Enter', 'Enter', 'Enter', 'Enter']);
  assert.deepEqual(errors, [], 'no console errors: ' + errors.join('|'));
  console.log('  ok receipt printer status: single state, strip only when disconnected');
} finally { await browser.close(); }
