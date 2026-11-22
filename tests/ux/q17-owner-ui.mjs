// Q17 owner UI decisions (22 Nov). B: receipt prints right after «تأكيد البيع» with no preview, back to a clean new sale;
// setting «عرض معاينة الإيصال قبل الطباعة» brings the preview back; a failed print shows «إعادة الطباعة».
// C: النواقص open / add / remove with no PIN (sending is tested in tests/supplier-orders-browser.mjs).
// E: segmented unit toggle on each cart line (one tap, U / Alt+U, unit prices, fits 390px).
// (0 = expenses in «الوردية» → tests/ux/ui-batch1.mjs + audit03; D = theme by time → tests/ux/ux415-theme.mjs.)
// Fake data only. SHOT_DIR=<dir> saves q17-* screenshots.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOT = process.env.SHOT_DIR || '';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const shot = async (page, name) => { if (SHOT) await page.screenshot({ path: SHOT + '/' + name + '.png' }); };
const NOON = Date.parse('2026-11-22T21:00:00+02:00'); // night -> dark theme, stable screenshots

async function open(vp, init, path = 'index.html', initArg) {
  const mobile = vp.width < 600;
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block', hasTouch: mobile, isMobile: mobile });
  await ctx.route('**/*', r => {
    const q = r.request(), u = q.url();
    if (u.includes('/emergency/stock.json')) return r.fulfill({ status: 200, contentType: 'application/json', body: snapshot });
    if (!['GET', 'HEAD'].includes(q.method())) return r.abort();
    return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort();
  });
  await ctx.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('__seed')) { localStorage.clear(); sessionStorage.setItem('__seed', '1'); localStorage.setItem('nova-rx-onboarding-done', '1'); }
      localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage');
    } catch {}
    window.__prints = 0; window.print = () => { window.__prints++; };
  });
  if (init) await ctx.addInitScript(init, initArg);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(NOON));
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.goto(BASE + path, { waitUntil: 'load' });
  if (path === 'index.html') {
    await page.waitForSelector('#mainSearchInput', { timeout: 15000 });
    await page.locator('#novaSplash').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => window.NOVA_DEMO && window.novaStock && window.novaReceipt, null, { timeout: 10000 });
    await page.waitForTimeout(400);
  }
  return { ctx, page, errors };
}
const multiUnit = page => page.evaluate(() => window.NOVA_DEMO.products.find(p => p.price > 0 && Number(p.stock) > 5 && window.novaUnits.availableUnits(p).length === 3));
const anyItem = page => page.evaluate(() => window.NOVA_DEMO.products.find(p => p.price > 0 && Number(p.stock) > 5));
async function add(page, barcode) { await page.locator('#mainSearchInput').fill(barcode); await page.keyboard.press('Enter'); await page.waitForTimeout(150); }
async function pay(page) {
  await page.locator('#btnCheckout').click(); await page.waitForTimeout(250);
  const skip = page.locator('#checkoutSkipCustomer, [data-skip-customer], #customerGateSkip');
  if (await skip.count() && await skip.first().isVisible()) { await skip.first().click(); await page.waitForTimeout(250); }
  await page.waitForFunction(() => document.getElementById('checkoutModal').classList.contains('active'), null, { timeout: 3000 });
  await page.locator('.pay-method-btn[data-method=cash]').click();
  await page.locator('#btnConfirmPayment').click(); await page.waitForTimeout(500);
}
const receiptOpen = page => page.evaluate(() => document.getElementById('receiptModal').classList.contains('active'));

try {
  // ---------- B: auto-print, no preview, clean new sale ----------
  for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const tag = vp.width;
    const { ctx, page, errors } = await open(vp);
    const it = await anyItem(page); await add(page, it.barcode);
    const before = await page.locator('#saleNumber, .sale-number, [data-sale-number]').first().innerText().catch(() => '');
    await pay(page);
    assert.equal(await page.evaluate(() => window.__prints), 1, tag + ': printed once right after «تأكيد البيع»');
    assert.equal(await receiptOpen(page), false, tag + ': no receipt preview');
    assert.equal(await page.locator('#checkoutModal.active').count(), 0, tag + ': checkout closed');
    assert.equal(await page.locator('#invoiceTableBody tr').count(), 0, tag + ': clean new sale');
    assert.equal(await page.evaluate(() => window.novaSales.list().length), 1, tag + ': sale saved');
    const printed = await page.locator('#receiptModal .nova-receipt-doc').getAttribute('data-receipt-number');
    assert.equal(printed, await page.evaluate(() => window.novaSales.list()[0].number), tag + ': the printed slip is this sale');
    if (before) assert.notEqual(await page.locator('#saleNumber, .sale-number, [data-sale-number]').first().innerText().catch(() => ''), '', tag + ': new number shown');
    // the slip is what the printer sees (print media shows the hidden receipt)
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('receiptModal')).visibility), 'visible', tag + ': print media shows the slip');
    await page.emulateMedia({ media: 'screen' });
    await shot(page, 'q17-B-after-sale-' + tag + '-after');
    // the next sale starts right away
    await add(page, it.barcode); assert.equal(await page.locator('#invoiceTableBody tr').count(), 1, tag + ': next sale works');
    assert.deepEqual(errors, [], tag + ': page errors');
    await ctx.close();
  }
  { // printer offline -> clear toast with «إعادة الطباعة»; retry prints the same sale (not a copy)
    const { ctx, page, errors } = await open({ width: 1366, height: 768 }, () => { try { localStorage.setItem('nova-rx-printer-connected-v1', '0'); } catch {} });
    const it = await anyItem(page); await add(page, it.barcode); await pay(page);
    assert.equal(await page.evaluate(() => window.__prints), 0, 'offline: nothing printed');
    const retry = page.locator('#novaPrintFailToast #btnRetryPrint');
    await retry.waitFor({ state: 'visible', timeout: 2000 });
    assert.match(await page.locator('#novaPrintFailToast').innerText(), /ما اتطبعش/);
    assert.equal(await retry.innerText(), 'إعادة الطباعة');
    assert.equal(await page.locator('#invoiceTableBody tr').count(), 0, 'offline: still a clean new sale');
    await shot(page, 'q17-B-print-failed-1366-after');
    await retry.click(); await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.__prints), 1, 'retry printed');
    assert.equal(await page.locator('#receiptModal .nova-receipt-doc').getAttribute('data-is-copy'), 'false', 'retry is the original, not a copy');
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  { // setting ON -> the old preview comes back (no auto print)
    const { ctx, page, errors } = await open({ width: 1366, height: 768 });
    await page.evaluate(() => document.querySelector('.nova-tab[data-page="settings"]').click());
    await page.evaluate(() => window.novaLazy && window.novaLazy.load()); await page.waitForTimeout(900);
    const cb = page.locator('#nssReceiptPreview'); await cb.waitFor({ timeout: 5000 });
    assert.equal(await cb.isChecked(), false, 'preview setting is OFF by default');
    assert.match(await page.locator('#novaSaleSettingsCard').innerText(), /عرض معاينة الإيصال قبل الطباعة/);
    await cb.scrollIntoViewIfNeeded(); await shot(page, 'q17-B-setting-1366-after');
    await cb.check(); assert.equal(await page.evaluate(() => localStorage.getItem('nova-rx-receipt-preview')), '1');
    await page.evaluate(() => document.querySelector('.nova-tab[data-page="sale"]').click()); await page.waitForTimeout(400);
    const it = await anyItem(page); await add(page, it.barcode); await pay(page);
    assert.equal(await receiptOpen(page), true, 'preview ON: receipt modal shown');
    assert.equal(await page.evaluate(() => window.__prints), 0, 'preview ON: no auto print');
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  console.log('ok B auto-print');

  // ---------- E: unit toggle ----------
  for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const tag = vp.width;
    const { ctx, page, errors } = await open(vp);
    const p = await multiUnit(page); assert.ok(p, 'a 3-unit product exists');
    await add(page, p.barcode);
    const seg = page.locator('#invoiceTableBody .unit-seg').first();
    assert.equal(await page.locator('#invoiceTableBody select').count(), 0, tag + ': no dropdown left');
    assert.deepEqual(await seg.locator('[data-unit]').evaluateAll(b => b.map(x => x.dataset.unit)), ['box', 'strip', 'tablet']);
    assert.deepEqual(await seg.locator('[data-unit] span').evaluateAll(b => b.map(x => x.textContent.trim())), ['علبة', 'شريط', 'قرص']);
    const prices = await page.evaluate(p => ['box', 'strip', 'tablet'].map(u => window.novaUnits.convert(p, 1, u).unitPrice.toFixed(2)), p);
    assert.deepEqual(await seg.locator('[data-unit]').evaluateAll(b => b.map(x => x.getAttribute('aria-label').split(' ').pop())), prices, tag + ': each segment carries its unit price');
    for (const b of await seg.locator('[data-unit]').all()) { const bb = await b.boundingBox(); assert.ok(bb.height >= 44 && bb.width >= 40, tag + ': tap size ' + JSON.stringify(bb)); assert.ok(bb.x >= 0 && bb.x + bb.width <= vp.width, tag + ': inside the screen'); }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), tag + ': no horizontal scroll');
    await shot(page, 'q17-E-unit-toggle-' + tag + '-after');
    // one tap
    await seg.locator('[data-unit=strip]').click(); await page.waitForTimeout(150);
    assert.equal(await page.locator('#invoiceTableBody .unit-seg [aria-checked=true]').getAttribute('data-unit'), 'strip', tag + ': one tap -> strip');
    assert.equal((await page.locator('#invoiceTableBody .col-price').first().innerText()).replace(/[^\d.]/g, ''), prices[1], tag + ': line price = strip price');
    // Alt+U from the search box cycles the last line; U on a focused toggle cycles that line
    await page.locator('#mainSearchInput').focus(); await page.keyboard.press('Alt+KeyU'); await page.waitForTimeout(150);
    assert.equal(await page.locator('#invoiceTableBody .unit-seg [aria-checked=true]').getAttribute('data-unit'), 'tablet', tag + ': Alt+U -> tablet');
    assert.equal(await page.locator('#mainSearchInput').inputValue(), '', tag + ': Alt+U typed nothing');
    await page.locator('#mainSearchInput').fill('u'); assert.equal(await page.locator('#invoiceTableBody .unit-seg [aria-checked=true]').getAttribute('data-unit'), 'tablet', tag + ': plain typing in search is not a shortcut'); await page.locator('#mainSearchInput').fill('');
    await page.locator('#invoiceTableBody .unit-seg [aria-checked=true]').focus(); await page.keyboard.press('KeyU'); await page.waitForTimeout(150);
    assert.equal(await page.locator('#invoiceTableBody .unit-seg [aria-checked=true]').getAttribute('data-unit'), 'box', tag + ': U wraps to box');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.unit), 'box', tag + ': focus stays on the toggle');
    // single-unit item: one fixed pill, nothing to toggle
    const one = await page.evaluate(() => window.NOVA_DEMO.products.find(p => p.price > 0 && Number(p.stock) > 5 && window.novaUnits.availableUnits(p).length === 1));
    if (one) { await add(page, one.barcode); const last = page.locator('#invoiceTableBody tr').last(); assert.equal(await last.locator('.unit-seg [data-unit]').count(), 1); assert.equal(await last.locator('.unit-seg [data-unit]').isDisabled(), true, tag + ': single unit is not a toggle'); }
    // the sale records the chosen unit
    await seg.locator('[data-unit=strip]').click(); await page.waitForTimeout(100);
    await pay(page);
    assert.equal(await page.evaluate(() => window.novaSales.list()[0].lines.find(l => l.unit === 'strip') ? 'strip' : 'none'), 'strip', tag + ': sold as strip');
    assert.deepEqual(errors, [], tag + ': page errors');
    await ctx.close();
  }
  console.log('ok E unit toggle');

  // ---------- C: النواقص without PIN ----------
  for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const tag = vp.width;
    const { ctx, page, errors } = await open(vp, snap => { try { localStorage.setItem('nova-stock-snapshot-v1', snap); } catch {} }, 'purchases.html', snapshot);
    let stockCalls = 0; await page.route('**/api/purchases/stock', r => { stockCalls++; return r.fulfill({ status: 403, json: { ok: false, error: 'source-auth-required' } }); });
    await page.waitForFunction(() => document.getElementById('panelNeeds') && document.getElementById('panelNeeds').dataset.state === 'ready', null, { timeout: 5000 });
    assert.equal(await page.locator('#panelNeeds').getAttribute('data-local'), '1', tag + ': opened from the device, no PIN');
    assert.equal(await page.locator('#needsLockWrap').isVisible(), false, tag + ': no PIN card on open');
    assert.equal(stockCalls, 0, tag + ': no stock request without a PIN');
    assert.equal(await page.locator('#needsSearchInput').isVisible(), true, tag + ': add-item search available');
    await shot(page, 'q17-C-needs-open-no-pin-' + tag + '-after');
    // add an item from the local catalog, then remove it — no PIN asked
    await page.locator('#needsSearchInput').fill('جافيسكون'); await page.waitForTimeout(400);
    const opt = page.locator('#needsSearchDropdown [role=option]').first();
    await opt.waitFor({ timeout: 3000 });
    {
      await opt.click(); await page.waitForTimeout(300);
      assert.ok(await page.locator('#rows tr.needs-row').count() >= 1, tag + ': item added without PIN');
      await shot(page, 'q17-C-needs-added-no-pin-' + tag + '-after');
      const del = page.locator('#rows tr.needs-row [data-action=delete]').first();
      if (!(await del.isVisible())) await page.evaluate(() => document.querySelector('#rows tr.needs-row [data-action=delete]').click()); else await del.click();
      await page.waitForTimeout(300); assert.equal(await page.locator('#rows tr.needs-row').count(), 0, tag + ': removed without PIN');
      assert.equal(await page.locator('#lockNeedsBtn').isVisible(), false, tag + ': no lock button without a PIN');
      assert.equal(await page.locator('#needsLockWrap').isVisible(), false, tag + ': still no PIN card');
    }
    assert.deepEqual(errors, [], tag + ': page errors');
    await ctx.close();
  }
  console.log('ok C needs without PIN');
  console.log('q17-owner-ui: all checks passed');
} finally { await browser.close(); }
