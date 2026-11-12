// POS-01: one-screen sale flow (search/scan, quantity, discount, payment on one screen; keyboard & touch keep focus; 3-item invoice <= 20s).
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8');
let passed = 0;
const t = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    console.log('  FAIL', name, '\n   ', String(e.stack || e.message).split('\n').slice(0, 3).join('\n'));
    process.exit(1);
  }
  passed++;
  console.log('  ok', name);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox']
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG', hasTouch: true });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue();
    return r.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.clear();
        sessionStorage.setItem('seeded', '1');
      }
      localStorage.setItem('nova-rx-language', 'ar');
      localStorage.removeItem('nova.activePage');
    } catch {}
  });

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE' && window.novaPay, null, { timeout: 8000 });

  const activeId = () => page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.className));

  await t('initial focus starts on #mainSearchInput in Product mode', async () => {
    assert.equal(await activeId(), 'mainSearchInput');
  });

  await t('touch/click on autocomplete suggestion adds item and keeps focus on #mainSearchInput', async () => {
    await page.locator('#mainSearchInput').fill('جافيسكون');
    await page.waitForTimeout(150);
    await page.locator('#suggestionsBox .suggestion-item').first().click();
    assert.equal(await page.locator('#invoiceTableBody tr').count(), 1);
    assert.equal(await activeId(), 'mainSearchInput');
  });

  await t('touch/click on quantity + and - buttons updates qty without losing focus to body', async () => {
    await page.locator('#invoiceTableBody .qty-btn[data-act="inc"]').first().click();
    assert.equal(await page.locator('#invoiceTableBody .qty-input').first().inputValue(), '2');
    assert.equal(await activeId(), 'mainSearchInput');

    await page.locator('#invoiceTableBody .qty-btn[data-act="dec"]').first().click();
    assert.equal(await page.locator('#invoiceTableBody .qty-input').first().inputValue(), '1');
    assert.equal(await activeId(), 'mainSearchInput');
  });

  await t('typing quantity in .qty-input and pressing Enter updates qty and returns focus to #mainSearchInput', async () => {
    const qInput = page.locator('#invoiceTableBody .qty-input').first();
    await qInput.click();
    await qInput.fill('3');
    await qInput.press('Enter');
    assert.equal(await page.locator('#invoiceTableBody .qty-input').first().inputValue(), '3');
    assert.equal(await activeId(), 'mainSearchInput');
  });

  await t('entering discount and pressing Enter applies discount and returns focus to #mainSearchInput', async () => {
    const disc = page.locator('#inputPercentDiscount');
    await disc.click();
    await disc.fill('10');
    await disc.press('Enter');
    assert.equal(await activeId(), 'mainSearchInput');
    const discVisible = await page.evaluate(() => getComputedStyle(document.getElementById('discountRow')).display !== 'none');
    assert.ok(discVisible);
  });

  await t('clear invoice (F4) resets lines and keeps focus on #mainSearchInput', async () => {
    await page.keyboard.press('F4');
    assert.equal(await page.locator('#invoiceTableBody tr').count(), 0);
    assert.equal(await activeId(), 'mainSearchInput');
  });

  await t('3-item invoice (search + barcode scan + qty + discount + F9 + Enter payment) stays on one screen and finishes in <= 20s', async () => {
    const barcodes = await page.evaluate(() => {
      const items = window.NOVA_DEMO.products.filter(p => p && p.barcode && p.price > 0 && !/جافيسكون|gaviscon/i.test(p.name)).slice(0, 2);
      return items.map(p => p.barcode);
    });
    const t0 = Date.now();

    // Item 1: search by Arabic name + Enter
    await page.locator('#mainSearchInput').fill('جافيسكون');
    await page.locator('#mainSearchInput').press('Enter');
    assert.equal(await activeId(), 'mainSearchInput');

    // Item 2: barcode scan + Enter
    await page.locator('#mainSearchInput').fill(barcodes[0]);
    await page.locator('#mainSearchInput').press('Enter');
    assert.equal(await activeId(), 'mainSearchInput');

    // Item 3: second barcode scan + Enter
    await page.locator('#mainSearchInput').fill(barcodes[1]);
    await page.locator('#mainSearchInput').press('Enter');
    assert.equal(await activeId(), 'mainSearchInput');
    assert.equal(await page.locator('#invoiceTableBody tr').count(), 3);

    // Adjust quantity on row 1 via touch/click +
    await page.locator('#invoiceTableBody .qty-btn[data-act="inc"]').first().click();
    assert.equal(await activeId(), 'mainSearchInput');

    // Apply fixed discount + Enter
    await page.locator('#inputFixedDiscount').fill('5');
    await page.locator('#inputFixedDiscount').press('Enter');
    assert.equal(await activeId(), 'mainSearchInput');

    // Verify search, quantity, discount, and checkout button are all visible on the same screen inside viewport
    const oneScreen = await page.evaluate(() => {
      const inVp = sel => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
      };
      return {
        page: document.body.dataset.activePage || 'sale',
        search: inVp('#mainSearchInput'),
        qty: inVp('#invoiceTableBody .qty-input'),
        discount: inVp('#inputFixedDiscount') && inVp('#inputPercentDiscount'),
        total: inVp('#displayGrandTotal'),
        checkout: inVp('#btnCheckout')
      };
    });
    assert.equal(oneScreen.page, 'sale');
    assert.ok(oneScreen.search && oneScreen.qty && oneScreen.discount && oneScreen.total && oneScreen.checkout, JSON.stringify(oneScreen));

    // Open payment on the same screen with F9 -> #inputCashReceived focused immediately
    await page.keyboard.press('F9');
    await page.waitForFunction(() => document.getElementById('checkoutModal').classList.contains('active'), null, { timeout: 2000 });
    assert.equal(await activeId(), 'inputCashReceived');

    // Touch/click quick-cash button keeps focus on #inputCashReceived
    await page.locator('.quick-cash-btn[data-val="exact"]').click();
    assert.equal(await activeId(), 'inputCashReceived');

    // Press Enter in checkout modal to confirm payment
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('receiptModal').classList.contains('active'), null, { timeout: 2000 });

    const elapsedMs = Date.now() - t0;
    assert.ok(elapsedMs <= 20000, `Expected <= 20000ms, got ${elapsedMs}ms`);

    const saved = await page.evaluate(() => window.novaSales.list()[0]);
    assert.ok(saved);
    assert.equal(saved.status, 'final');
    assert.equal(saved.lines.length, 3);
    assert.equal(saved.lines[0].qty, 2);
    assert.equal(saved.discount, 5);

    // Close receipt with Escape -> starts new sale and focuses #mainSearchInput
    await page.keyboard.press('Escape');
    assert.equal(await activeId(), 'mainSearchInput');
  });

  await t('no page errors', async () => {
    assert.deepEqual(errors, []);
  });

  console.log(`POS-01 OK (${passed} checks)`);
} finally {
  await browser.close();
}
