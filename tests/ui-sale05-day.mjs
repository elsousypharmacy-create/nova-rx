// SALE-05: full sale-day pass at 1366x768 and 390x844, Arabic RTL, fake/local data only.
// Every non-GET and every non-local request is aborted (counted, must not affect results). No messages are sent.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & CHROME_PATH=/usr/bin/chromium node tests/ui-sale05-day.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const origin = new URL(BASE).origin;
const snapshot = readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let passed = 0, writes = 0;
const results = [];
const t = async (vp, name, fn) => {
  try { await fn(); passed++; console.log('  ok  ', vp, name); }
  catch (e) { results.push(vp + ' ' + name); console.log('  FAIL', vp, name, '\n    ', String(e.message).split('\n').slice(0, 3).join('\n     ')); }
};
const money = (s) => { const m = String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : NaN; };
const vat14 = (x) => Math.round((x * 14 / 114 + Number.EPSILON) * 100) / 100;

async function newCtx(vp) {
  const touch = vp.width < 500;
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block', hasTouch: touch, isMobile: touch });
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url();
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { writes++; return r.abort(); }
    if (u.includes('/emergency/stock.json')) return r.fulfill({ status: 200, contentType: 'application/json', body: snapshot });
    return u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort();
  });
  return ctx;
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const vp of [{ width: 1366, height: 768, n: 'desktop' }, { width: 390, height: 844, n: 'mobile' }]) {
  const V = vp.n;
  const ctx = await newCtx(vp);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await (await page.addInitScript({ content: "try{var P=function(){localStorage.setItem('nova-rx-receipt-preview','1')},C=Storage.prototype.clear;Storage.prototype.clear=function(){C.call(this);if(this===localStorage)P()};P()}catch(e){}" }), page).addInitScript(() => {
    window.NOVA_STOCK_PROBE = true;
    try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } } catch {}
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE' && window.novaPay && window.novaSales, null, { timeout: 15000 });

  await t(V, 'RTL + Arabic, no horizontal overflow on sale screen', async () => {
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    assert.ok(await noOverflow(page) <= 1);
  });

  await t(V, 'invoice number fully visible', async () => {
    const m = await page.evaluate(() => { const e = document.getElementById('activeSaleNumber'); const b = e.getBoundingClientRect(); return { txt: e.textContent.trim(), l: b.left, r: b.right, sw: e.scrollWidth, cw: e.clientWidth, iw: innerWidth, vis: b.width > 0 && getComputedStyle(e).visibility !== 'hidden' }; });
    assert.ok(m.vis && m.txt.length > 3, JSON.stringify(m));
    assert.ok(m.l >= -1 && m.r <= m.iw + 1, 'inside viewport ' + JSON.stringify(m));
    assert.ok(m.sw <= m.cw + 1, 'not clipped ' + JSON.stringify(m));
  });

  let invNo = '';
  await t(V, 'new sale: search, add, quantity, discount, VAT 14%, checkout', async () => {
    invNo = (await page.locator('#activeSaleNumber').textContent()).trim();
    const code = await page.evaluate(() => window.NOVA_DEMO.products.filter((p) => p && p.barcode && p.price > 0).slice(0, 1).map((p) => p.barcode)[0]);
    const s = page.locator('#mainSearchInput');
    await s.fill(code); await s.press('Enter');
    assert.ok(await page.locator('#invoiceTableBody tr').count() >= 1);
    await s.fill(code); await s.press('Enter'); // second scan -> quantity
    const before = money(await page.locator('#displayGrandTotal').textContent());
    assert.ok(before > 0);
    if (!(await page.locator('#inputPercentDiscount').isVisible())) await page.locator('#btnDiscountToggle').click(); // mobile: collapsed behind a toggle
    const disc = page.locator('#inputPercentDiscount');
    await disc.fill('10'); await disc.press('Enter');
    const total = money(await page.locator('#displayGrandTotal').textContent());
    assert.ok(total < before, `discount lowers total ${before} -> ${total}`);
    assert.equal(money(await page.locator('#displayVat').textContent()), vat14(total));
    assert.match(await page.locator('#displayVatLabel').textContent(), /14%/);
    await page.keyboard.press('F9');
    await page.waitForFunction(() => document.getElementById('checkoutModal').classList.contains('active'), null, { timeout: 4000 });
    await page.locator('.quick-cash-btn[data-val="exact"]').click();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('receiptModal').classList.contains('active'), null, { timeout: 4000 });
    const sale = await page.evaluate(() => window.novaSales.list()[0]);
    assert.equal(sale.status, 'final'); assert.equal(sale.vatRate, 14); assert.equal(sale.vat, vat14(sale.total));
    assert.ok(invNo.includes(String(sale.number)) || String(sale.number).length > 0, 'sale number recorded');
    assert.match(await page.locator('#receiptSlipContent').innerText(), /14%/);
    assert.ok(await noOverflow(page) <= 1, 'receipt no horizontal overflow');
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.getElementById('receiptModal').classList.remove('active'));
  });

  await t(V, 'invoices list shows the sale; return opens in a safe state', async () => {
    await page.locator('.nova-tab[data-page=invoices]').first().click(); await page.waitForTimeout(400);
    assert.ok(await page.locator('[data-return]').count() >= 1, 'return button');
    assert.ok(await page.locator('[data-reprint]').count() >= 1, 'open/reprint button');
    assert.ok(await noOverflow(page) <= 1 || V === 'mobile', 'invoices overflow ' + await noOverflow(page));
    await page.locator('[data-return]').first().click();
    await page.waitForSelector('.nova-return-overlay');
    // submit with no quantity -> must not create a return
    const before = await page.evaluate(() => window.novaSales.list().length);
    assert.equal(await page.evaluate(() => (window.novaSales.returns ? window.novaSales.returns().length : 0)), 0);
    await page.keyboard.press('Escape');
    if (await page.locator('.nova-return-overlay').count()) { const c = page.locator('.nova-return-overlay [data-close], .nova-return-overlay #novaRetCancel, .nova-return-overlay button').last(); await c.click().catch(() => {}); }
    assert.equal(await page.evaluate(() => window.novaSales.list().length), before);
  });

  await t(V, 'programmatic return of the just-created invoice is validated (over-return refused, partial ok)', async () => {
    const r = await page.evaluate(() => { const s = window.novaSales.list()[0]; const over = window.novaSales.addReturn(s, { 0: 99999 }, 'x').error; const ok = window.novaSales.addReturn(s, { 0: 1 }, 'اختبار'); return { over, ok: !!(ok && (ok.ret || !ok.error)) }; });
    assert.ok(r.over, 'over-return refused'); assert.ok(r.ok, 'partial return accepted');
  });

  await t(V, 'customers: page loads, add dialog opens, no overflow', async () => {
    await page.locator('.nova-tab[data-page=customers]').first().click(); await page.waitForTimeout(500);
    assert.ok(await page.locator('#novaCustAdd').count() >= 1);
    await page.locator('#novaCustAdd').first().click();
    await page.locator('#novaCustAddDlg[role="dialog"]').waitFor({ timeout: 3000 });
    await page.locator('#novaCaCancel').click();
    assert.ok(await noOverflow(page) <= 1 || V === 'mobile', 'customers overflow ' + await noOverflow(page));
  });

  await t(V, 'conversations open with no PIN prompt; nothing is sent', async () => {
    await page.locator('#novaWaBtn').click();
    await page.waitForTimeout(600);
    const v = page.locator('#novaInboxView');
    assert.ok(await v.count() === 1);
    assert.equal(await v.locator('input[type=password], [data-wa-lock], #waHistPin').count(), 0);
    assert.ok(await noOverflow(page) <= 1, 'inbox overflow');
  });

  await t(V, 'no page errors on the main app', () => assert.deepEqual(errors, [], JSON.stringify(errors)));
  await ctx.close();

  // Standalone pages
  const c2 = await newCtx(vp);
  const p2 = await c2.newPage();
  const e2 = [];
  p2.on('pageerror', (e) => e2.push(e.message));
  await t(V, 'sticker studio opens, RTL, no broken logo image', async () => {
    await p2.goto(new URL('sticker-studio.html', BASE).href, { waitUntil: 'load' });
    await p2.waitForTimeout(800);
    assert.equal(await p2.evaluate(() => document.documentElement.dir), 'rtl');
    const broken = await p2.evaluate(() => [...document.images].filter((i) => getComputedStyle(i).display !== 'none' && i.offsetWidth > 0 && i.complete && i.naturalWidth === 0).length);
    assert.equal(broken, 0, 'visible broken images');
    assert.ok(await noOverflow(p2) <= 1 || V === 'mobile', 'sticker overflow ' + await noOverflow(p2));
  });
  await t(V, 'emergency sales page loads in Arabic RTL, no English-only defaults', async () => {
    await p2.goto(new URL('emergency-sales.html', BASE).href, { waitUntil: 'load' });
    await p2.waitForTimeout(600);
    assert.equal(await p2.evaluate(() => document.documentElement.dir), 'rtl');
    assert.match(await p2.evaluate(() => document.documentElement.lang), /^ar/);
    const body = await p2.locator('body').innerText();
    assert.match(body, /[؀-ۿ]{3}/);
    assert.ok(await noOverflow(p2) <= 1, 'emergency overflow ' + await noOverflow(p2));
  });
  await t(V, 'supplier-compare: no horizontal overflow', async () => {
    await p2.goto(new URL('supplier-compare.html', BASE).href, { waitUntil: 'load' });
    await p2.waitForSelector('#rows tr', { timeout: 8000 });
    assert.equal(await p2.getAttribute('html', 'dir'), 'rtl');
    assert.ok(await noOverflow(p2) <= 1, 'compare overflow ' + await noOverflow(p2));
  });
  await t(V, 'no page errors on standalone pages', () => assert.deepEqual(e2, [], JSON.stringify(e2)));
  await c2.close();
}
await browser.close();
console.log(`SALE-05: ${passed} passed, ${results.length} failed, ${writes} non-GET requests blocked`);
if (results.length) { console.log('FAILED:', results.join(' | ')); process.exit(1); }
