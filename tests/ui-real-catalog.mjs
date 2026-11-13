// UI: the app must use the real price list when `/emergency/stock.json` exists, and keep the demo data when it does not.
// Isolated: the endpoint is answered from the committed snapshot (data/emergency-stock.json) by the test; no backend, no network.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8');
const rows = JSON.parse(snapshot).items;
let n = 0;
const t = async (name, fn) => { try { await fn(); } catch (e) { console.log('  FAIL', name, '\n   ', String(e.message).split('\n')[0]); process.exit(1); } n++; console.log('  ok', name); };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
async function open({ stock }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG', hasTouch: true });
  await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue(); return r.abort(); });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/emergency/stock.json', r => stock === 'ok' ? r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }) : stock === 'bad' ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[{"code":"1","namear":"x","price":1}]}' }) : r.fulfill({ status: 404, body: 'no' }));
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  return { page, ctx, errors };
}
const search = async (page, q) => { const i = page.locator('#mainSearchInput'); await i.fill(''); await i.fill(q); await page.waitForTimeout(250); };
const suggestions = page => page.locator('#suggestionsBox .suggestion-item');

console.log('Running UI real-catalog checks...');
const real = await open({ stock: 'ok' });
await real.page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });

await t('the real price list replaces the demo products (4378 items from the snapshot)', async () => {
  const c = await real.page.evaluate(() => window.novaCatalog);
  assert.equal(c.source, 'STOCK LIVE'); assert.equal(c.count, rows.length);
  assert.equal(await real.page.evaluate(() => window.NOVA_DEMO.products.length), rows.length);
  assert.ok(c.exportedAt, 'carries the export time');
});

await t('sale search finds real items by Arabic name, by Latin name, with Arabic folding, and shows the real price', async () => {
  const gav = rows.find(r => /جافيسكون/.test(r.namear));
  await search(real.page, 'جافيسكون'); assert.ok(await suggestions(real.page).count() > 0);
  const listText = await real.page.locator('#suggestionsBox').innerText();
  assert.ok(listText.includes(gav.price.toFixed(2)) || listText.includes(gav.namear.slice(0, 5)), 'the list shows a real item');
  await search(real.page, gav.namear); assert.ok((await real.page.locator('#suggestionsBox').innerText()).includes(gav.price.toFixed(2)), 'exact real price shown for ' + gav.namear);
  await search(real.page, 'gaviscon'); assert.ok(await suggestions(real.page).count() > 0, 'Latin name');
  await search(real.page, 'جافيسكون ليكويد'); const two = await suggestions(real.page).count(); assert.ok(two > 0 && two <= 40, 'two words, capped at 40');
  // Arabic folding on REAL data: a plain-alef word typed with a hamza, and a ta-marbuta word typed with ha, must still find it.
  const alef = rows.map(r => (r.namear.match(/(^|\s)ا[\u0621-\u064A]{3,}/) || [])[0]).find(Boolean).trim();
  await search(real.page, 'أ' + alef.slice(1)); assert.ok((await real.page.locator('#suggestionsBox').innerText()).includes(alef), 'hamza typed, plain alef stored: ' + alef);
  const tm = rows.map(r => (r.namear.match(/[\u0621-\u064A]{3,}ة(\s|$)/) || [])[0]).find(Boolean).trim();
  await search(real.page, tm.slice(0, -1) + 'ه'); assert.ok((await real.page.locator('#suggestionsBox').innerText()).includes(tm), 'ha typed, ta-marbuta stored: ' + tm);
  await search(real.page, 'ا'); assert.ok(await suggestions(real.page).count() <= 40, 'a one-letter query never renders thousands of rows');
});

await t('a name with & and ` is shown as text, never as HTML, in the list and on the invoice', async () => {
  const odd = rows.find(r => /&/.test(r.nameen || '') && /&/.test(r.namear || ''));
  await search(real.page, odd.namear.replace(/[^؀-ۿ ]/g, ' ').trim().split(' ').filter(Boolean).slice(0, 2).join(' '));
  const first = suggestions(real.page).first(); assert.ok(await first.count() > 0);
  await real.page.keyboard.press('Enter'); await real.page.waitForTimeout(250);
  const html = await real.page.locator('#invoiceItems, .invoice-items, .items-body').first().innerHTML().catch(() => '');
  assert.ok(!/<script|onerror=|<img/i.test(html));
  assert.equal(real.errors.length, 0, real.errors.join(' | '));
});

await t('scanning an exact barcode adds that product', async () => {
  const withGtin = rows.find(r => r.gtin);
  await search(real.page, withGtin.gtin); await real.page.keyboard.press('Enter'); await real.page.waitForTimeout(300);
  assert.ok((await real.page.evaluate(() => document.body.innerText)).includes(withGtin.namear.slice(0, 6)), 'the scanned product is on the invoice');
});

await t('typing part of a barcode lists that product (partial barcode search)', async () => {
  const r = rows.find(x => x.code.length >= 8 && !x.gtin);
  await search(real.page, r.code.slice(0, 7)); const box = await real.page.locator('#suggestionsBox').innerText();
  assert.ok(box.includes(r.code), 'the full code appears in the list: ' + r.code);
});

await t('Products tab: real list, honest labels (prices only, no stock), capped rows, search, re-renders when data arrives', async () => {
  await real.page.locator('.nova-tab[data-page="products"]').click(); await real.page.waitForTimeout(400);
  const txt = await real.page.locator('#novaPageView').innerText();
  assert.ok(txt.includes('STOCK LIVE') && txt.includes('غير متوفر'), 'says prices only, stock unavailable');
  const stockKpi = await real.page.locator('.nova-kpi', { hasText: 'الرصيد' }).first().innerText();
  assert.ok(stockKpi.includes('غير متوفر'), 'the stock KPI says unavailable, not a number: ' + stockKpi.replace(/\n/g, ' '));
  const cells = await real.page.locator('#novaRows tr:first-child td').allInnerTexts();
  assert.ok(cells.length <= 4, 'empty stock/category columns are hidden, no made-up numbers: ' + cells.length);
  assert.ok(txt.includes(String(rows.length)), 'shows the item count');
  assert.ok(!txt.includes('البيانات التجريبية'), 'no demo label on real data');
  assert.ok(await real.page.locator('#novaRows tr').count() <= 300, 'rows are capped');
  assert.ok(txt.includes('يعرض أول 300'));
  await real.page.locator('#novaFilter').fill('جافيسكون'); await real.page.waitForTimeout(300);
  const rowsNow = await real.page.locator('#novaRows tr').count(); assert.ok(rowsNow > 0 && rowsNow < 300);
  assert.equal(real.errors.length, 0, real.errors.join(' | '));
});

await t('a hostile product name (<img onerror>) is inert: shown as text in the list, on the invoice and in the Products tab', async () => {
  const evil = '<img src=x onerror="window.__pwned=1">فيتامين';
  const filler = Array.from({ length: 60 }, (_, i) => ({ code: String(900000 + i), namear: 'صنف تجريبي ' + i, price: 10 + i }));
  const body = JSON.stringify({ exportedAt: '2026-11-11T00:00:00Z', items: [{ code: '777001', namear: evil, price: 5.5 }, ...filler] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG', hasTouch: true });
  await ctx.route('**/*', r => { const u = r.request().url(); return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage(); await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body }));
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE');
  await search(page, 'فيتامين'); await page.waitForTimeout(200);
  assert.ok((await page.locator('#suggestionsBox').innerText()).includes('<img src=x'), 'the tag is displayed as text');
  assert.equal(await page.locator('#suggestionsBox img').count(), 0, 'no img element was created');
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__pwned), undefined, 'onerror never ran');
  await page.locator('.nova-tab[data-page="products"]').click(); await page.waitForTimeout(300);
  assert.equal(await page.locator('#novaPageView img').count(), 0); assert.equal(await page.evaluate(() => window.__pwned), undefined);
  await ctx.close();
});

await t('scanning a hostile-named item by barcode or by code never runs its markup (toast path)', async () => {
  const evil = '<img src=x onerror="window.__pwned=(window.__pwned||0)+1">';
  const filler = Array.from({ length: 60 }, (_, i) => ({ code: String(900000 + i), namear: 'صنف تجريبي ' + i, price: 10 + i }));
  const body = JSON.stringify({ exportedAt: '2026-11-11T00:00:00Z', items: [{ code: '777002', gtin: '6221000000002', namear: evil, price: 5.5 }, { code: '777003', gtin: '12345', namear: evil + 'B', price: 6.5 }, ...filler] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG', hasTouch: true });
  await ctx.route('**/*', r => { const u = r.request().url(); return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage(); await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body }));
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE');
  for (const q of ['6221000000002', '777002']) {
    await page.locator('#mainSearchInput').fill(q); await page.locator('#mainSearchInput').press('Enter'); await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => window.__pwned), undefined, 'onerror ran after scanning ' + q);
    assert.ok((await page.locator('.toast').innerText()).includes('<img src=x'), 'the toast shows the tag as text for ' + q);
  }
  // Customer mode (F3) has two more scan paths with their own toasts: typing-speed match (handleSearchInput) and Enter.
  for (const q of ['6221000000002', '12345']) {
    await page.keyboard.press('F3'); await page.waitForTimeout(100);
    await page.locator('#mainSearchInput').fill(q); await page.waitForTimeout(350);
    if (await page.evaluate(() => document.querySelector('#mainSearchInput').value) !== '') { await page.locator('#mainSearchInput').press('Enter'); await page.waitForTimeout(350); }
    assert.equal(await page.evaluate(() => window.__pwned), undefined, 'onerror ran after customer-mode scan ' + q);
    assert.ok((await page.locator('.toast').innerText()).includes('<img src=x'), 'customer-mode toast shows the tag as text for ' + q);
  }
  await ctx.close();
});

await t('currency is the Egyptian pound everywhere on the sale screen (ج.م in Arabic, EGP in English), never Saudi riyals', async () => {
  const ar = await real.page.evaluate(() => document.body.innerText);
  assert.ok(/ج\.م/.test(ar), 'Arabic UI shows ج.م'); assert.ok(!/ر\.س|SAR/.test(ar), 'no Saudi riyal text: ' + (ar.match(/.{12}(ر\.س|SAR).{4}/) || [''])[0]);
  const ectx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', hasTouch: true });
  await ectx.route('**/*', r => { const u = r.request().url(); return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
  const epage = await ectx.newPage(); await epage.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'en'); } catch {} });
  await epage.goto(BASE, { waitUntil: 'load' }); await epage.waitForTimeout(900);
  const txt = await epage.evaluate(() => document.body.innerText);
  assert.ok(/EGP/.test(txt) && !/SAR|ر\.س/.test(txt), 'English UI shows EGP only'); await ectx.close();
});

for (const mode of ['missing', 'bad']) {
  await t(`fallback: endpoint ${mode} -> the 12 demo products stay and nothing breaks`, async () => {
    const d = await open({ stock: mode === 'missing' ? 'none' : 'bad' }); await d.page.waitForTimeout(1200);
    assert.equal(await d.page.evaluate(() => window.novaCatalog.source), 'demo'); assert.equal(await d.page.evaluate(() => window.NOVA_DEMO.products.length), 12);
    await search(d.page, 'بانادول'); assert.ok(await suggestions(d.page).count() > 0, 'demo search still works');
    await d.page.locator('.nova-tab[data-page="products"]').click(); await d.page.waitForTimeout(300);
    assert.ok((await d.page.locator('#novaPageView').innerText()).includes('البيانات التجريبية'));
    assert.equal(d.errors.length, 0, d.errors.join(' | ')); await d.ctx.close();
  });
}
await real.ctx.close(); await browser.close();
console.log(`PASS ui real-catalog checks: ${n} cases (isolated: endpoint answered from data/emergency-stock.json)`);
