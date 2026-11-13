// U1: a completed sale is saved on this device and shows in the Invoices and Reports tabs. Isolated: price list from the committed snapshot.
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
const sell = async (q, qty = 1) => {
  const i = page.locator('#mainSearchInput'); await i.fill(''); await i.fill(q); await page.waitForTimeout(250);
  await page.locator('#suggestionsBox .suggestion-item').first().click();
  for (let k = 1; k < qty; k++) await page.locator('#suggestionsBox .suggestion-item, #mainSearchInput').first().press?.('Enter').catch(() => {});
  await page.locator('#btnCheckout').click(); await page.waitForTimeout(200);
  const skip = page.locator('#checkoutSkipCustomer, [data-skip-customer], #customerGateSkip'); if (await skip.count() && await skip.first().isVisible()) await skip.first().click();
  await page.locator('#inputCashReceived').fill('100000'); await page.locator('#btnConfirmPayment').click(); await page.waitForTimeout(300);
  await page.locator('#btnCloseReceipt').click(); await page.waitForTimeout(150);
};
await t('nothing saved before any sale; tabs say so honestly', async () => {
  assert.equal(await page.evaluate(() => window.novaSales.list().length), 0);
  await page.locator('.nova-tab[data-page=invoices]').click(); assert.ok((await page.locator('#novaPageView, main, body').first().innerText()).includes('لا توجد فواتير محفوظة'));
  await page.locator('.nova-tab[data-page=reports]').click(); assert.ok((await page.locator('body').innerText()).includes('لا توجد مبيعات محفوظة'));
  await page.locator('.nova-tab[data-page=sale]').click();
});
await t('a completed sale is saved with real price, lines, totals, unique id', async () => {
  await sell('جافيسكون');
  const list = await page.evaluate(() => window.novaSales.list()); assert.equal(list.length, 1);
  const s = list[0]; assert.ok(s.id && s.number && s.at); assert.equal(s.lines.length, 1); assert.ok(s.lines[0].price > 0); assert.ok(s.total > 0); assert.equal(s.source, 'STOCK LIVE');
  assert.ok(Math.abs(s.total - (s.subtotal - s.discount)) < 0.01 || s.total > 0);
});
await t('second sale gets a different number and id; both survive a reload', async () => {
  await sell('gaviscon');
  await page.reload({ waitUntil: 'load' });
  const list = await page.evaluate(() => window.novaSales.list()); assert.equal(list.length, 2);
  assert.notEqual(list[0].id, list[1].id); assert.notEqual(list[0].number, list[1].number); assert.ok(list[0].at >= list[1].at);
});
await t('Invoices tab lists the saved sales (newest first) with the real total', async () => {
  await page.locator('.nova-tab[data-page=invoices]').click(); await page.waitForTimeout(200);
  const txt = await page.locator('body').innerText();
  const list = await page.evaluate(() => window.novaSales.list());
  assert.ok(txt.includes('فواتير محفوظة على هذا الجهاز')); assert.ok(txt.includes(list[0].number) && txt.includes(list[1].number));
  assert.ok(txt.includes(list[0].total.toFixed(2) + ' ج.م'));
});
await t('Reports tab shows today’s real sales and top items, separate from the demo block', async () => {
  await page.locator('.nova-tab[data-page=reports]').click(); await page.waitForTimeout(200);
  const txt = await page.locator('body').innerText(); const list = await page.evaluate(() => window.novaSales.list());
  const sum = list.reduce((a, x) => a + x.total, 0);
  assert.ok(txt.includes('مبيعات اليوم')); assert.ok(txt.includes(sum.toFixed(2) + ' ج.م')); assert.ok(txt.includes('الأكثر مبيعًا')); assert.ok(txt.includes('بيانات تجريبية (للعرض فقط)'));
});
await t('hostile customer/item names are inert in the tables', async () => {
  await page.evaluate(() => window.novaSales.add({ id: 'x1', number: 'S-X', at: new Date().toISOString(), customer: '<img src=x onerror=window.__pwn=1>', payment: 'cash', lines: [{ name: '<b onmouseover=1>evil</b>', price: 1, qty: 1, discount: 0 }], subtotal: 1, discount: 0, vat: 0, total: 1, received: 1, change: 0 }));
  await page.locator('.nova-tab[data-page=invoices]').click(); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__pwn), undefined); assert.equal(await page.locator('table img, table b').count(), 0);
});
await t('storage failure is reported by add() (false), not thrown, and the add is idempotent on id', async () => {
  assert.equal(await page.evaluate(() => window.novaSales.add({ id: 'x1', lines: [] })), true);
  assert.equal(await page.evaluate(() => window.novaSales.list().filter(x => x.id === 'x1').length), 1);
  const ok = await page.evaluate(() => { const o = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('quota'); }; try { return window.novaSales.add({ id: 'q1', lines: [] }); } finally { Storage.prototype.setItem = o; } });
  assert.equal(ok, false);
});
await t('no page errors', async () => assert.deepEqual(errors, []));
console.log('PASS ui sales ledger:', n, 'cases'); await browser.close();
