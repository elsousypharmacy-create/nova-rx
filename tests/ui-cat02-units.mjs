// N19 / CAT-02: per-item unit conversions (box/strip/tablet), selling in a smaller unit deducts the exact fraction from stock; unknown/unavailable conversions are refused.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const executablePath = [process.env.CHROME_PATH, chromium.executablePath(), '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
let n = 0;
const t = async (name, fn) => {
  try { await fn(); } catch (e) { console.log('  FAIL', name, '\n   ', String(e.message).split('\n')[0]); process.exit(1); }
  n++; console.log('  ok', name);
};

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
await ctx.route('**/*', r => {
  const u = r.request().url();
  if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue();
  return r.abort();
});
await ctx.route('**/emergency/stock.json', r => r.fulfill({ status: 404, body: '' }));
await ctx.addInitScript(() => {
  try {
    if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); }
    localStorage.setItem('nova-rx-language', 'ar');
    localStorage.removeItem('nova.activePage');
  } catch {}
});

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.novaUnits && window.novaStock && window.novaSales, null, { timeout: 8000 });

const CONCOR = '6281001234567';  // 3 strips x 10 tablets = 30 tablets/box
const PANADOL = '6281001234568'; // 2 strips x 12 tablets = 24 tablets/box
const OTRIVIN = '6281001234578'; // spray: no strip/tablet conversion

await page.evaluate(({ concor, panadol }) => {
  const c = window.NOVA_DEMO.products.find(x => x.barcode === concor);
  c.price = 30.00; c.stock = 2;
  const p = window.NOVA_DEMO.products.find(x => x.barcode === panadol);
  p.price = 12.00; p.stock = 1;
}, { concor: CONCOR, panadol: PANADOL });

const addByBarcode = async barcode => {
  const i = page.locator('#mainSearchInput');
  await i.fill('');
  await i.fill(barcode);
  await page.waitForTimeout(200);
  await page.locator('#suggestionsBox .suggestion-item').first().click();
};

const checkoutAndConfirm = async () => {
  await page.locator('#btnCheckout').click();
  await page.waitForTimeout(250);
  const skip = page.locator('#checkoutSkipCustomer, [data-skip-customer], #customerGateSkip, #gateSkipCustomer');
  if (await skip.count() && await skip.first().isVisible()) {
    await skip.first().click();
    await page.waitForTimeout(250);
  }
  await page.locator('#inputCashReceived').fill('1000');
  await page.locator('#btnConfirmPayment').click();
  await page.waitForTimeout(300);
  await page.locator('#btnCloseReceipt').click();
  await page.waitForTimeout(150);
};

await t('selling 1 strip deducts 1/3 box from stock and prices the strip accurately', async () => {
  await addByBarcode(CONCOR);
  const sel = page.locator('#invoiceTableBody select.unit-select').first();
  assert.deepEqual(await sel.locator('option').evaluateAll(opts => opts.map(o => o.value)), ['box', 'strip', 'tablet']);
  await sel.selectOption('strip');
  assert.equal((await page.locator('#invoiceTableBody .col-price').first().innerText()).trim(), '10.00');
  assert.equal((await page.locator('#invoiceTableBody .col-total').first().innerText()).trim(), '10.00');
  await checkoutAndConfirm();

  const avail = await page.evaluate(b => window.novaStock.available(b), CONCOR);
  assert.equal(avail, 1.666666667); // 2 - 1/3 boxes
  const lastSale = await page.evaluate(() => window.novaSales.list()[0]);
  assert.equal(lastSale.lines[0].unit, 'strip');
  assert.equal(lastSale.lines[0].unitFactor, 3);
  assert.equal(lastSale.lines[0].price, 10);
});

await t('selling 5 tablets deducts 5/30 (1/6) box from stock, combining with earlier strip sale to 1.5 boxes left', async () => {
  await addByBarcode(CONCOR);
  await page.locator('#invoiceTableBody select.unit-select').first().selectOption('tablet');
  await page.locator('#invoiceTableBody input.qty-input').first().fill('5');
  await page.locator('#invoiceTableBody input.qty-input').first().dispatchEvent('change');
  assert.equal((await page.locator('#invoiceTableBody .col-price').first().innerText()).trim(), '1.00');
  assert.equal((await page.locator('#invoiceTableBody .col-total').first().innerText()).trim(), '5.00');
  await checkoutAndConfirm();

  const avail = await page.evaluate(b => window.novaStock.available(b), CONCOR);
  assert.equal(avail, 1.5); // 2 - 1/3 - 5/30 = 1.5 boxes
});

await t('fractional stock boundary: after selling 1 strip of a 1-box item, selling 1 full box is refused but selling the remaining 1 strip succeeds', async () => {
  await addByBarcode(PANADOL);
  await page.locator('#invoiceTableBody select.unit-select').first().selectOption('strip');
  await checkoutAndConfirm();
  assert.equal(await page.evaluate(b => window.novaStock.available(b), PANADOL), 0.5);

  // Try to sell 1 full box when only 0.5 box remains -> refused
  await addByBarcode(PANADOL);
  await page.locator('#btnCheckout').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#checkoutModal.active').count(), 0);
  assert.ok((await page.locator('body').innerText()).includes('المخزون لا يكفي'));

  // Switch the same line to 12 tablets (= 0.5 box) -> succeeds and brings stock to 0
  await page.locator('#invoiceTableBody select.unit-select').first().selectOption('tablet');
  await page.locator('#invoiceTableBody input.qty-input').first().fill('12');
  await page.locator('#invoiceTableBody input.qty-input').first().dispatchEvent('change');
  await checkoutAndConfirm();
  assert.equal(await page.evaluate(b => window.novaStock.available(b), PANADOL), 0);
});

await t('unknown units and unavailable conversions are refused across UI, novaUnits, and novaStock', async () => {
  await addByBarcode(OTRIVIN);
  const opts = await page.locator('#invoiceTableBody select.unit-select option').evaluateAll(o => o.map(x => x.value));
  assert.deepEqual(opts, ['box'], 'spray product without strip/tablet packaging only exposes box');

  const res = await page.evaluate(b => {
    const U = window.novaUnits, S = window.novaStock;
    return {
      unknownUnit: U.convert(b, 1, 'bottle'),
      emptyUnit: U.convert(b, 1, ''),
      unavailableStrip: U.convert(b, 1, 'strip'),
      unavailableTablet: U.convert(b, 1, 'tablet'),
      fractionalQty: U.convert(b, 0.5, 'box'),
      zeroQty: U.convert(b, 0, 'box'),
      uiRefusedStrip: U.setLineUnit('PRD012', 'strip'),
      uiRefusedUnknown: U.setLineUnit('PRD012', 'gallon'),
      stockCheckUnknown: S.check('owner-1', [{ barcode: b, name: 'Otrivin', qty: 1, unit: 'bottle' }]),
      stockReserveUnavailable: S.reserve('owner-1', [{ barcode: b, name: 'Otrivin', qty: 1, unit: 'strip' }]),
    };
  }, OTRIVIN);

  assert.equal(res.unknownUnit.ok, false); assert.equal(res.unknownUnit.error, 'unit-unknown');
  assert.equal(res.emptyUnit.ok, false); assert.equal(res.emptyUnit.error, 'unit-unknown');
  assert.equal(res.unavailableStrip.ok, false); assert.equal(res.unavailableStrip.error, 'unit-unavailable');
  assert.equal(res.unavailableTablet.ok, false); assert.equal(res.unavailableTablet.error, 'unit-unavailable');
  assert.equal(res.fractionalQty.ok, false); assert.equal(res.fractionalQty.error, 'quantity-invalid');
  assert.equal(res.zeroQty.ok, false); assert.equal(res.zeroQty.error, 'quantity-invalid');
  assert.equal(res.uiRefusedStrip.ok, false); assert.equal(res.uiRefusedStrip.error, 'unit-unavailable');
  assert.equal(res.uiRefusedUnknown.ok, false); assert.equal(res.uiRefusedUnknown.error, 'unit-unknown');
  assert.equal(res.stockCheckUnknown.ok, false); assert.equal(res.stockCheckUnknown.error, 'unit-unknown');
  assert.equal(res.stockReserveUnavailable.ok, false); assert.equal(res.stockReserveUnavailable.error, 'unit-unavailable');
});

await t('per-item packaging saved in localStorage persists and rejects invalid or inconsistent definitions', async () => {
  const check = await page.evaluate(b => {
    const U = window.novaUnits;
    const bad1 = U.setPackaging(b, { stripsPerBox: -2 });
    const bad2 = U.setPackaging(b, { stripsPerBox: 3, unitsPerStrip: 10, unitsPerBox: 25 });
    const good = U.setPackaging(b, { stripsPerBox: 4, unitsPerStrip: 5 });
    const conv = U.convert(b, 2, 'strip');
    return { bad1, bad2, good, conv, stored: JSON.parse(localStorage.getItem('nova-rx-packaging-v1') || '{}')[b] };
  }, OTRIVIN);

  assert.equal(check.bad1.ok, false); assert.equal(check.bad1.error, 'packaging-invalid');
  assert.equal(check.bad2.ok, false); assert.equal(check.bad2.error, 'packaging-inconsistent');
  assert.equal(check.good.ok, true);
  assert.deepEqual(check.stored, { stripsPerBox: 4, unitsPerStrip: 5, unitsPerBox: 20 });
  assert.equal(check.conv.ok, true);
  assert.equal(check.conv.stockFraction, 0.5); // 2 strips out of 4 strips/box
});

await t('no page errors', async () => assert.deepEqual(errors, []));

await browser.close();
console.log(`PASS ui CAT-02 units: ${n} cases`);
