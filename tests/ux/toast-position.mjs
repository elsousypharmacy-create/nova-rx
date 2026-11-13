// UX25: toast must not cover nav tabs or checkout footer buttons.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const hit = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
try {
  for (const vp of [{ width: 390, height: 844 }, { width: 1366, height: 768 }]) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG' });
    await ctx.route('**/*', r => {
      const u = r.request().url();
      return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort();
    });
    const page = await ctx.newPage();
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
    await page.keyboard.press('Enter');
    await page.waitForSelector('#toastContainer .toast');
    const check = async (label, selectors) => {
      const t = await page.locator('#toastContainer .toast').boundingBox();
      assert.ok(t, 'toast visible');
      for (const sel of selectors) {
        const els = page.locator(sel);
        for (let i = 0; i < await els.count(); i++) {
          const b = await els.nth(i).boundingBox();
          if (b) assert.ok(!hit(t, b), `${vp.width}: toast overlaps ${sel}[${i}] (${label})`);
        }
      }
      return t;
    };
    await check('sale', ['.nova-tab']);
    const text = (await page.locator('#toastContainer .toast').innerText()).replace('●', '').trim();
    assert.ok(text.length <= 40, `toast text ${text.length} chars: ${text}`);
    assert.ok(await page.locator('#toastContainer .toast[aria-live], #toastContainer .toast[role=status]').count(), 'aria-live');
    // checkout dialog: toast shown while open
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('checkoutModal').classList.contains('active'), null, { timeout: 2000 });
    await page.evaluate(() => document.querySelector('#toastContainer').replaceChildren());
    await page.locator('#inputCashReceived').fill('0');
    await page.locator('#btnConfirmPayment').click({ force: true });
    await page.waitForSelector('#toastContainer .toast');
    await check('checkout', ['.nova-tab', '#btnConfirmPayment', '#btnCancelCheckout']);
    console.log(`  ok ${vp.width}x${vp.height}`);
    await ctx.close();
  }
} finally { await browser.close(); }
