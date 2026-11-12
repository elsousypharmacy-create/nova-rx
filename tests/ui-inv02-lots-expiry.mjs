// N18 / INV-02: track lot/expiry per stock entry, pick FEFO when selling, block selling expired stock by default, and show a configurable near-expiry warning (default 90 days).
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
let n = 0;
const t = async (name, fn) => {
  try { await fn(); }
  catch (e) { console.log('  FAIL', name, '\n   ', String(e.message).split('\n')[0]); process.exit(1); }
  n++; console.log('  ok', name);
};

const isoDaysFromNow = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const EXP_DATE = isoDaysFromNow(-15);
const NEAR_DATE = isoDaysFromNow(45);
const FAR_DATE = isoDaysFromNow(200);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
await ctx.route('**/*', r => {
  const u = r.request().url();
  if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue();
  return r.abort();
});
await ctx.route('**/emergency/stock.json', r => r.fulfill({ status: 404, body: '' }));
await ctx.addInitScript(() => {
  try {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.clear();
      sessionStorage.setItem('seeded', '1');
    }
    localStorage.setItem('nova-rx-language', 'ar');
    localStorage.removeItem('nova.activePage');
  } catch {}
});

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.novaStock && typeof window.novaStock.fefoPick === 'function', null, { timeout: 8000 });

const CONCOR = '6281001234567';
const PANADOL = '6281001234568';

const addByBarcode = async barcode => {
  const i = page.locator('#mainSearchInput');
  await i.fill('');
  await i.fill(barcode);
  await page.waitForTimeout(200);
  await page.locator('#suggestionsBox .suggestion-item').first().click();
  await page.waitForTimeout(100);
};

const checkoutAndPay = async () => {
  await page.locator('#btnCheckout').click();
  await page.waitForTimeout(200);
  const skip = page.locator('#checkoutSkipCustomer, [data-skip-customer], #customerGateSkip, #gateSkipCustomer');
  if (await skip.count() && await skip.first().isVisible()) {
    await skip.first().click();
    await page.waitForTimeout(200);
  }
  if (await page.locator('#checkoutModal.active').count()) {
    await page.locator('#inputCashReceived').fill('100000');
    await page.locator('#btnConfirmPayment').click();
    await page.waitForTimeout(300);
    if (await page.locator('#btnCloseReceipt').isVisible().catch(() => false)) {
      await page.locator('#btnCloseReceipt').click();
      await page.waitForTimeout(150);
    }
    return true;
  }
  return false;
};

await t('defaults: near-expiry warning is 90 days, expired stock is blocked by default, invalid lots are rejected', async () => {
  const res = await page.evaluate(() => ({
    warnDays: window.novaStock.nearExpiryDays(),
    blockExp: window.novaStock.isBlockExpired(),
    bad1: window.novaStock.addLot({ key: '', lot: 'L1', expiry: '2027-01-01', qty: 5 }).ok,
    bad2: window.novaStock.addLot({ key: '6281001234567', lot: '', expiry: '2027-01-01', qty: 5 }).ok,
    bad3: window.novaStock.addLot({ key: '6281001234567', lot: 'L1', expiry: 'not-a-date', qty: 5 }).ok,
    bad4: window.novaStock.addLot({ key: '6281001234567', lot: 'L1', expiry: '2027-01-01', qty: 0 }).ok,
    badDays: window.novaStock.setNearExpiryDays(-5).ok
  }));
  assert.deepEqual(res, { warnDays: 90, blockExp: true, bad1: false, bad2: false, bad3: false, bad4: false, badDays: false });
});

await t('track lot/expiry per stock entry and sort by FEFO while excluding expired stock from available', async () => {
  await page.evaluate(({ concor, exp, near, far }) => {
    window.novaStock.addLot({ barcode: concor, lot: 'LOT-FAR', expiry: far, qty: 4, cost: 25, location: 'A1' });
    window.novaStock.addLot({ barcode: concor, lot: 'LOT-EXP', expiry: exp, qty: 5, cost: 20, location: 'A0' });
    window.novaStock.addLot({ barcode: concor, lot: 'LOT-NEAR', expiry: near, qty: 2, cost: 22, location: 'A2' });
  }, { concor: CONCOR, exp: EXP_DATE, near: NEAR_DATE, far: FAR_DATE });

  const info = await page.evaluate(c => ({
    lots: window.novaStock.lots(c).map(l => ({ lot: l.lot, onHand: l.onHand, expired: l.expired, nearExpiry: l.nearExpiry })),
    available: window.novaStock.available(c)
  }), CONCOR);

  assert.deepEqual(info.lots, [
    { lot: 'LOT-EXP', onHand: 5, expired: true, nearExpiry: false },
    { lot: 'LOT-NEAR', onHand: 2, expired: false, nearExpiry: true },
    { lot: 'LOT-FAR', onHand: 4, expired: false, nearExpiry: false }
  ]);
  assert.equal(info.available, 6, 'only non-expired lots count toward available stock');
});

await t('FEFO pick & near-expiry warning on invoice: skips expired lot, picks earliest valid lot, warns at <= 90 days', async () => {
  await addByBarcode(CONCOR);
  const fefoLot = await page.locator('#invoiceTableBody [data-fefo-lot]').getAttribute('data-fefo-lot');
  assert.equal(fefoLot, 'LOT-NEAR', 'FEFO picks LOT-NEAR (+45d) skipping LOT-EXP (-15d) and before LOT-FAR (+200d)');
  assert.equal(await page.locator('#invoiceTableBody [data-near-expiry="LOT-NEAR"]').count(), 1, 'shows near-expiry warning badge for +45d lot');
});

await t('selling across multiple lots deducts in FEFO order and records lot allocations on the sale', async () => {
  // Increase qty to 3: should take all 2 from LOT-NEAR and 1 from LOT-FAR
  await page.locator('#invoiceTableBody .qty-btn[data-act="inc"]').click();
  await page.locator('#invoiceTableBody .qty-btn[data-act="inc"]').click();
  await page.waitForTimeout(100);

  const paid = await checkoutAndPay();
  assert.equal(paid, true, 'sale of 3 units succeeds from LOT-NEAR (2) + LOT-FAR (1)');

  const after = await page.evaluate(c => ({
    sale: window.novaSales.list()[0],
    lots: window.novaStock.lots(c).map(l => ({ lot: l.lot, onHand: l.onHand })),
    available: window.novaStock.available(c)
  }), CONCOR);

  assert.equal(after.sale.lines[0].lot, 'LOT-NEAR');
  assert.deepEqual(after.sale.lines[0].lots, [
    { lot: 'LOT-NEAR', expiry: NEAR_DATE, qty: 2 },
    { lot: 'LOT-FAR', expiry: FAR_DATE, qty: 1 }
  ]);
  assert.deepEqual(after.lots, [
    { lot: 'LOT-EXP', onHand: 5 },
    { lot: 'LOT-NEAR', onHand: 0 },
    { lot: 'LOT-FAR', onHand: 3 }
  ]);
  assert.equal(after.available, 3);
});

await t('configurable near-expiry warning threshold via Settings UI and API updates warnings dynamically', async () => {
  // Add Concor again (qty 1): next FEFO lot is LOT-FAR (+200d), which is > 90d so no warning by default
  await addByBarcode(CONCOR);
  assert.equal(await page.locator('#invoiceTableBody [data-fefo-lot]').getAttribute('data-fefo-lot'), 'LOT-FAR');
  assert.equal(await page.locator('#invoiceTableBody [data-near-expiry]').count(), 0, '200d lot is not warned at 90d threshold');

  // Open Settings tab and change threshold to 250 days
  await page.locator('.nova-tab[data-page="settings"]').click();
  await page.waitForTimeout(150);
  const input = page.locator('#novaNearExpiryDays');
  assert.equal(await input.inputValue(), '90');
  await input.fill('250');
  await input.dispatchEvent('change');
  assert.equal(await page.evaluate(() => window.novaStock.nearExpiryDays()), 250);

  // Return to Sale tab: LOT-FAR (+200d <= 250d) now shows near-expiry warning
  await page.locator('.nova-tab[data-page="sale"]').click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#invoiceTableBody [data-near-expiry="LOT-FAR"]').count(), 1, '200d lot warns when threshold is 250d');

  // Reset threshold back to 90 days
  await page.evaluate(() => window.novaStock.setNearExpiryDays(90));
  assert.equal(await page.locator('#invoiceTableBody [data-near-expiry]').count(), 0);
  await page.keyboard.press('F4');
  await page.waitForTimeout(100);
});

await t('block selling expired stock by default: product with only expired stock is blocked at checkout', async () => {
  await page.evaluate(({ panadol, exp }) => {
    window.novaStock.setLots(panadol, [{ lot: 'EXP-ONLY-1', expiry: exp, qty: 8 }]);
  }, { panadol: PANADOL, exp: EXP_DATE });

  await addByBarcode(PANADOL);
  assert.equal(await page.locator('#invoiceTableBody [data-expired-blocked="true"]').count(), 1, 'invoice row shows expired-blocked alert');
  assert.ok((await page.locator('#toastContainer').innerText()).includes('ممنوع بيع صنف منتهي الصلاحية'));

  const salesBefore = await page.evaluate(() => window.novaSales.list().length);
  const paid = await checkoutAndPay();
  assert.equal(paid, false, 'checkout modal refuses to open for expired stock');
  assert.equal(await page.evaluate(() => window.novaSales.list().length), salesBefore, 'no sale recorded for expired stock');
  assert.ok((await page.locator('#toastContainer').innerText()).includes('ممنوع بيع صنف منتهي الصلاحية'));
});

await t('returning sold units restores lot balance in FEFO tracking', async () => {
  const restored = await page.evaluate(c => {
    const sale = window.novaSales.list()[0];
    window.novaSales.addReturn(sale, { 0: 2 }, 'test return');
    return {
      lots: window.novaStock.lots(c).map(l => ({ lot: l.lot, onHand: l.onHand })),
      available: window.novaStock.available(c)
    };
  }, CONCOR);
  assert.equal(restored.available, 5, 'returning 2 of 3 sold units leaves 5 available out of 6 non-expired');
});

await t('no page errors', async () => {
  assert.deepEqual(errors, []);
});

await browser.close();
console.log('PASS ui inv02 lots/expiry:', n, 'cases');
