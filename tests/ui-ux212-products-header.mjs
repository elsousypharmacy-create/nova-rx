// UX212: products header — merged count card, compact stock notice chip, single-line action buttons on mobile.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG', hasTouch: true });
  await ctx.route('**/*', r => { const u = r.request().url(); return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
  await page.locator('.nova-tab[data-page="products"]').click();
  await page.waitForSelector('#novaProductsKpis');
  const kpiTexts = () => page.locator('#novaProductsKpis .nova-kpi small').allInnerTexts();
  let k = await kpiTexts();
  assert.ok(!k.includes('نتيجة البحث'), 'no results card when search empty: ' + k);
  assert.equal(k.filter(x => x === 'عدد الأصناف').length, 1);
  assert.match(await page.locator('#novaProductsKpis .nova-kpi strong').first().innerText(), /صنف/);
  const h = await page.locator('#novaProductsKpis').evaluate(e => e.getBoundingClientRect().height);
  console.log('  KPI height', h);
  assert.ok(h <= 90, 'KPI area <= 90px, got ' + h);
  const chip = page.locator('#novaStockNotice');
  assert.ok((await chip.innerText()).includes('غير متوفر من مصدر الأسعار'));
  assert.ok((await chip.evaluate(e => e.getBoundingClientRect().height)) <= 32, 'chip compact');
  const btns = await page.locator('.nova-products-toolbar .nova-inventory-action').evaluateAll(els => els.map(e => { const c = getComputedStyle(e); return { ws: c.whiteSpace, h: e.getBoundingClientRect().height, lh: parseFloat(c.lineHeight) }; }));
  assert.equal(btns.length, 3);
  for (const b of btns) { assert.equal(b.ws, 'nowrap'); assert.ok(b.h <= 48, 'button single line height ' + b.h); }
  const sw = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  assert.ok(sw, 'no horizontal overflow');
  await page.fill('#novaFilter', 'جافيسكون');
  await page.waitForTimeout(300);
  k = await kpiTexts();
  assert.ok(k.includes('نتيجة البحث'), 'results card when filtering: ' + k);
  console.log('ui-ux212-products-header: all ok');
} finally { await browser.close(); }
