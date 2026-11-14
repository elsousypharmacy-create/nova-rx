// UX223: return dialog traps Tab, labels h3, locks scroll, restores focus to opener.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue(); return r.abort(); });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
await page.evaluate(() => window.novaSales.add({ id: 'f1', number: 'S-f1', at: new Date().toISOString(), customer: '', payment: 'cash',
  lines: [{ name: 'A', barcode: 'A1', price: 100, qty: 4, discount: 0, unitFactor: 1, lots: [] }], subtotal: 400, discount: 0, vat: 0, total: 400, received: 400, change: 0 }));
await page.locator('.nova-tab[data-page=invoices]').click();
const inside = () => page.evaluate(() => !!document.activeElement.closest('.nova-return-overlay [role=dialog]'));
for (const how of ['Escape', 'close']) {
  await page.locator('[data-return="f1"]').focus(); await page.keyboard.press('Enter');
  await page.waitForSelector('.nova-return-overlay');
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
  const lab = await page.evaluate(() => { const d = document.querySelector('.nova-return-overlay [role=dialog]'); return d.getAttribute('aria-labelledby') === d.querySelector('h3').id && !!d.querySelector('h3').id; });
  assert.ok(lab);
  for (let i = 0; i < 30; i++) { await page.keyboard.press('Tab'); assert.ok(await inside(), 'Tab escaped at ' + i); }
  for (let i = 0; i < 30; i++) { await page.keyboard.press('Shift+Tab'); assert.ok(await inside(), 'Shift+Tab escaped at ' + i); }
  if (how === 'Escape') await page.keyboard.press('Escape'); else await page.locator('#novaRetCancel').click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.nova-return-overlay').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-return')), 'f1', 'focus restored after ' + how);
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
  console.log('  ok', how);
}
assert.deepEqual(errors, []);
console.log('PASS ux223'); await browser.close();
