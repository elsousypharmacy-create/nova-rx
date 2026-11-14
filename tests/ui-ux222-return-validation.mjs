// UX222: return dialog clears stale error, shows inline qty validation (aria-invalid), clamps on blur.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8');
let n = 0;
const t = async (name, fn) => { try { await fn(); } catch (e) { console.log('  FAIL', name, '\n   ', String(e.message).split('\n')[0]); process.exit(1); } n++; console.log('  ok', name); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue(); return r.abort(); });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
await page.evaluate(() => window.novaSales.add({ id: 'sale-u', number: 'S-U', at: new Date().toISOString(), customer: 'x', payment: 'cash', lines: [{ name: 'A', barcode: '', price: 100, qty: 3, discount: 0 }], subtotal: 300, discount: 0, vat: 0, total: 300, received: 300, change: 0, source: 'STOCK LIVE' }));
await page.locator('.nova-tab[data-page=invoices]').click(); await page.locator('[data-return="sale-u"]').click();
const q = page.locator('[data-ret-idx="0"]'), err = page.locator('[data-ret-err="0"]'), msg = page.locator('#novaRetMsg');
await t('input attrs: inputmode numeric, step 1', async () => { assert.equal(await q.getAttribute('inputmode'), 'numeric'); assert.equal(await q.getAttribute('step'), '1'); });
await t('reason error clears when a chip is picked', async () => {
  await q.fill('1'); await page.locator('#novaRetOk').click(); assert.ok((await msg.innerText()).includes('سبب'));
  await page.locator('[data-ret-chip]').first().click(); assert.equal((await msg.innerText()).trim(), '');
});
await t('reason error clears when typing a reason', async () => {
  await page.locator('#novaRetReason').fill(''); await page.locator('#novaRetOk').click(); assert.ok((await msg.innerText()).includes('سبب'));
  await page.locator('#novaRetReason').fill('x'); assert.equal((await msg.innerText()).trim(), '');
});
await t('over-max shows inline max message + aria-invalid', async () => {
  await q.fill('5'); assert.equal(await q.getAttribute('aria-invalid'), 'true'); assert.equal((await err.innerText()).trim(), 'الحد الأقصى 3');
});
await t('fraction shows inline message + aria-invalid', async () => {
  await q.fill('1.5'); assert.equal(await q.getAttribute('aria-invalid'), 'true'); assert.ok((await err.innerText()).includes('صحيح'));
});
await t('negative shows inline message + aria-invalid', async () => {
  await q.fill('-1'); assert.equal(await q.getAttribute('aria-invalid'), 'true'); assert.ok((await err.innerText()).includes('سالبة'));
});
await t('blur clamps and clears the error', async () => {
  await q.fill('5'); await q.blur(); assert.equal(await q.inputValue(), '3'); assert.equal(await q.getAttribute('aria-invalid'), null); assert.equal((await err.innerText()).trim(), '');
  assert.ok((await page.locator('#novaRetAmount').innerText()).includes('300.00'));
  await q.fill('-2'); await q.blur(); assert.equal(await q.inputValue(), '0');
});
await t('no page errors', async () => assert.deepEqual(errors, []));
console.log('PASS ui ux222:', n, 'cases'); await browser.close();
