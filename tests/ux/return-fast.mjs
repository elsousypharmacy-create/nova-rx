// UX14: return everything in <= 5 clicks including the invoices tab; refund equals invoice total.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue(); return r.abort(); });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
await page.evaluate(() => window.novaSales.add({ id: 'f1', number: 'S-f1', at: new Date().toISOString(), customer: '', payment: 'cash',
  lines: [{ name: 'A', barcode: 'A1', price: 100, qty: 2, discount: 0, unitFactor: 1, lots: [{ lot: 'L1', expiry: '2027-01-01', qty: 2, cost: 10 }] },
          { name: 'B', barcode: 'B1', price: 50, qty: 3, discount: 0, unitFactor: 1, lots: [{ lot: 'L2', expiry: '2027-01-01', qty: 3, cost: 5 }] }],
  subtotal: 350, discount: 0, vat: 0, total: 350, received: 350, change: 0 }));
let clicks = 0;
const click = async loc => { clicks++; await loc.click(); };
await click(page.locator('.nova-tab[data-page=invoices]'));
await click(page.locator('[data-return="f1"]'));
await click(page.locator('#novaRetAll'));
await click(page.locator('[data-ret-chip]').first());
assert.ok((await page.locator('#novaRetReason').inputValue()).length > 0);
await click(page.locator('#novaRetOk'));
await page.locator('#novaRetOk').waitFor({ state: 'detached' });
const refund = await page.evaluate(() => { const r = window.novaSales.returnedAmount('f1'); return r; });
assert.equal(refund, 350);
assert.ok(clicks <= 5, 'clicks=' + clicks);
assert.deepEqual(errors, []);
console.log('  ok return-fast clicks=' + clicks + ' refund=' + refund);
await browser.close();
