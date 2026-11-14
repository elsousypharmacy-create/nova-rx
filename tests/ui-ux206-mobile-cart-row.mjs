// UX206: mobile (390px) cart row fits the viewport: name, - qty +, unit price, line total, 44px delete; price != total label.
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
  await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
  await page.locator('#mainSearchInput').fill('جافيسكون');
  await page.waitForTimeout(300);
  await page.locator('#suggestionsBox .suggestion-item').first().click();
  // long Latin-ish name to stress clipping
  await page.evaluate(() => { document.querySelector('#invoiceTableBody .item-title').textContent = 'Augmentin 1 gm 14 tablets (UK) extra long product name for wrapping test 1234567890'; });
  const sel = ['.item-title', '.qty-btn[data-act="dec"]', '.qty-input', '.qty-btn[data-act="inc"]', '.unit-select', '.col-price', '.col-total', '.btn-icon-del'];
  const check = async (label) => {
    const rects = await page.evaluate(sels => { const tr = document.querySelector('#invoiceTableBody tr'); const o = { vw: innerWidth, sw: document.documentElement.scrollWidth, tr: tr.getBoundingClientRect().toJSON() };
      o.items = sels.map(s => { const e = tr.querySelector(s); const r = e.getBoundingClientRect(); return { s, l: r.left, r: r.right, w: r.width, h: r.height, sc: e.scrollWidth > e.clientWidth + 1 && !/item-title/.test(s) && e.tagName !== 'INPUT' }; }); return o; }, sel);
    assert.ok(rects.sw <= rects.vw, label + ' horizontal overflow');
    for (const it of rects.items) { assert.ok(it.w > 0, label + ' hidden ' + it.s); assert.ok(it.l >= 0 && it.r <= rects.vw, `${label} ${it.s} outside viewport ${it.l}-${it.r}`); }
    const by = Object.fromEntries(rects.items.map(i => [i.s, i]));
    assert.ok(by['.btn-icon-del'].w >= 44 && by['.btn-icon-del'].h >= 44, 'delete 44px');
    for (const s of ['.qty-btn[data-act="dec"]', '.qty-btn[data-act="inc"]']) assert.ok(by[s].w >= 44 && by[s].h >= 44, s + ' tappable');
    assert.ok(by['.col-price'].r <= by['.col-total'].l + 1 || by['.col-total'].r <= by['.col-price'].l + 1, 'price/total do not overlap');
  };
  await check('qty1');
  const txt = await page.evaluate(() => { const tr = document.querySelector('#invoiceTableBody tr'); return { p: getComputedStyle(tr.querySelector('.col-price'), '::before').content, t: getComputedStyle(tr.querySelector('.col-total'), '::before').content }; });
  assert.notEqual(txt.p, txt.t, 'unit price must be visually distinct from line total');
  for (let i = 0; i < 4; i++) await page.locator('#invoiceTableBody .qty-btn[data-act="inc"]').click();
  assert.equal(await page.locator('#invoiceTableBody .qty-input').inputValue(), '5');
  await check('qty5');
  await page.evaluate(() => { const t = document.querySelector('#invoiceTableBody .col-total'); t.textContent = '12345.00'; });
  await check('big-total');
  console.log('ui-ux206-mobile-cart-row: all ok');
} finally { await browser.close(); }
