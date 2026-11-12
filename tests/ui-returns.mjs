// U2: returns/void from a saved sale. Isolated (price list from the committed snapshot). Refund = share of what was actually paid, back to the original payment method.
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
// Seed a sale directly (the ledger API is what the sale screen calls): 2 lines, a line discount, sale total below the line sum.
await page.evaluate(() => window.novaSales.add({ id: 'sale-1', number: 'S-T1', at: new Date().toISOString(), customer: 'x', payment: 'card',
  lines: [{ name: 'A', barcode: '', price: 100, qty: 3, discount: 0 }, { name: 'B', barcode: '', price: 50, qty: 2, discount: 10 }],
  subtotal: 390, discount: 39, vat: 0, total: 351, received: 351, change: 0, source: 'STOCK LIVE' }));
const S = () => page.evaluate(() => window.novaSales.list().find(x => x.id === 'sale-1'));
await t('quote: refund is the share of what was actually paid (10% sale discount applied)', async () => {
  const q = await page.evaluate(() => window.novaSales.quoteReturn(window.novaSales.list().find(x => x.id === 'sale-1'), { 0: 1 }));
  assert.ok(q.ok); assert.equal(q.amount, 90); // 100 * (351/390)
});
await t('reason is required; empty and over-limit quantities are refused; nothing is stored on refusal', async () => {
  const r = await page.evaluate(() => { const s = window.novaSales.list().find(x => x.id === 'sale-1'); return [window.novaSales.addReturn(s, { 0: 1 }, '  ').error, window.novaSales.addReturn(s, {}, 'x').error, window.novaSales.addReturn(s, { 0: 4 }, 'x').error, window.novaSales.addReturn(s, { 0: 1.5 }, 'x').error, window.novaSales.returns().length]; });
  assert.deepEqual(r, ['reason', 'empty', 'too-many', 'invalid', 0]);
});
await t('UI: Invoices tab opens the return dialog, confirms a partial return, shows the returned amount', async () => {
  await page.locator('.nova-tab[data-page=invoices]').click(); await page.locator('[data-return="sale-1"]').click();
  await page.locator('[data-ret-idx="0"]').fill('1'); await page.waitForTimeout(100);
  assert.ok((await page.locator('#novaRetAmount').innerText()).includes('90.00'));
  await page.locator('#novaRetOk').click(); assert.ok((await page.locator('#novaRetMsg').innerText()).includes('سبب'), 'asks for a reason');
  await page.locator('#novaRetReason').fill('طلب العميل'); await page.locator('#novaRetOk').click(); await page.waitForTimeout(200);
  assert.equal(await page.locator('.nova-return-overlay').count(), 0);
  const ret = await page.evaluate(() => window.novaSales.returns()); assert.equal(ret.length, 1); assert.equal(ret[0].amount, 90); assert.equal(ret[0].method, 'card'); assert.equal(ret[0].reason, 'طلب العميل');
  assert.ok((await page.locator('body').innerText()).includes('90.00 ج.م'));
});
await t('the sale itself is never edited; returned quantity limits the next return', async () => {
  const s = await S(); assert.equal(s.total, 351); assert.equal(s.lines[0].qty, 3);
  const r = await page.evaluate(() => window.novaSales.addReturn(window.novaSales.list().find(x => x.id === 'sale-1'), { 0: 3 }, 'y').error); assert.equal(r, 'too-many');
});
await t('returning everything refunds exactly the total paid (no rounding drift)', async () => {
  const ok = await page.evaluate(() => { const s = window.novaSales.list().find(x => x.id === 'sale-1'); return window.novaSales.addReturn(s, { 0: 2, 1: 2 }, 'rest').ok; });
  assert.ok(ok); assert.equal(await page.evaluate(() => window.novaSales.returnedAmount('sale-1')), 351);
  assert.equal((await page.evaluate(() => window.novaSales.addReturn(window.novaSales.list().find(x => x.id === 'sale-1'), { 0: 1 }, 'z'))).error, 'too-many');
});
await t('returning a sale one unit at a time never drifts by a cent (last unit takes the remainder)', async () => {
  const r = await page.evaluate(() => { window.novaSales.add({ id: 'sale-4', number: 'S-T4', at: new Date().toISOString(), customer: '', payment: 'cash', lines: [{ name: 'D', price: 10, qty: 3, discount: 0 }], subtotal: 30, discount: 20, vat: 0, total: 10, received: 10, change: 0 });
    const s = () => window.novaSales.list().find(x => x.id === 'sale-4'); const a = [1, 2, 3].map(() => window.novaSales.addReturn(s(), { 0: 1 }, 'u').ret.amount); return [a, window.novaSales.returnedAmount('sale-4')]; });
  assert.deepEqual(r[0], [3.33, 3.33, 3.34]); assert.equal(r[1], 10);
});
await t('Reports show returns and net sales, and top sellers exclude returned units', async () => {
  await page.locator('.nova-tab[data-page=reports]').click(); await page.waitForTimeout(200);
  const txt = await page.locator('body').innerText();
  assert.ok(txt.includes('مرتجعات اليوم') && txt.includes('صافي اليوم') && txt.includes('صافي المبيعات'));
  assert.ok(txt.includes('0.00 ج.م'), 'net is zero after a full return');
});
await t('storage failure on return is reported, not thrown', async () => {
  await page.evaluate(() => window.novaSales.add({ id: 'sale-2', number: 'S-T2', at: new Date().toISOString(), customer: '', payment: 'cash', lines: [{ name: 'C', price: 10, qty: 1, discount: 0 }], subtotal: 10, discount: 0, vat: 0, total: 10, received: 10, change: 0 }));
  const e = await page.evaluate(() => { const o = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('quota'); }; try { return window.novaSales.addReturn(window.novaSales.list().find(x => x.id === 'sale-2'), { 0: 1 }, 'q').error; } finally { Storage.prototype.setItem = o; } });
  assert.equal(e, 'storage');
});
await t('hostile item names are inert in the dialog', async () => {
  await page.evaluate(() => window.novaSales.add({ id: 'sale-3', number: 'S-T3', at: new Date().toISOString(), customer: '', payment: 'cash', lines: [{ name: '<img src=x onerror=window.__pwn=1>', price: 10, qty: 1, discount: 0 }], subtotal: 10, discount: 0, vat: 0, total: 10, received: 10, change: 0 }));
  await page.locator('.nova-tab[data-page=invoices]').click(); await page.locator('[data-return="sale-3"]').click(); await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__pwn), undefined); assert.equal(await page.locator('.nova-return-overlay img').count(), 0);
  await page.locator('#novaRetCancel').click();
});
await t('no page errors', async () => assert.deepEqual(errors, []));
console.log('PASS ui returns:', n, 'cases'); await browser.close();
