// Task #99: offers and coupons at the sale screen (app/580-sale-offers.js lazy + hooks in app/120).
// Offer / coupon discounts count as discount but never ask for manager approval; only manual discounts do.
// Usage: node tests/ux/sale-offers.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const f = path.resolve(ROOT, '.' + p);
  if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('nf'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const BC = '6281001234568'; // Panadol Extra (demo catalog)
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG', serviceWorkers: 'block' });
  await ctx.route('**/*', r => { const q = r.request(); return q.url().startsWith(BASE) || q.url().startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await (await page.addInitScript({ content: "try{var P=function(){localStorage.setItem('nova-rx-receipt-preview','1')},C=Storage.prototype.clear;Storage.prototype.clear=function(){C.call(this);if(this===localStorage)P()};P()}catch(e){}" }), page).addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#btnAddLoyalty');
  await page.evaluate(() => window.novaLazy.load());
  assert.ok(await page.evaluate(() => !!window.novaOffers), 'engine loads lazily');

  // ---- pure engine ----
  const seed = o => page.evaluate(o2 => localStorage.setItem('nova-rx-offers-v1', JSON.stringify(o2)), o);
  const ev = (lines, o) => page.evaluate(([l, x]) => window.novaOffers.evaluate(l, x), [lines, o]);
  const L = (qty, gross, extra = {}) => ({ barcode: BC, category: 'Analgesic', qty, gross, discount: 0, ...extra });
  await seed({ offers: [{ id: 'a', type: 'bxgy', active: true, buy: 2, get: 1, items: [BC], categories: [], from: '', to: '' }], coupons: [] });
  assert.equal((await ev([L(3, 36)])).total, 12, 'buy 2 get 1: 3 units, 1 free');
  assert.equal((await ev([L(2, 24)])).total, 0, 'not enough units yet');
  assert.equal((await ev([L(6, 72)])).total, 24, 'two groups');
  assert.equal((await ev([L(3, 36, { barcode: 'x' })])).total, 0, 'other item: no offer');
  await seed({ offers: [{ id: 'b', type: 'pct', active: true, pct: 10, items: [], categories: ['analgesic'], from: '2000-01-01', to: '2000-12-31' }, { id: 'c', type: 'pct', active: true, pct: 20, items: [], categories: ['analgesic'], from: '2000-01-01', to: '2999-01-01' }, { id: 'd', type: 'pct', active: false, pct: 90, items: [BC], categories: [], from: '', to: '' }], coupons: [] });
  const e1 = await ev([L(1, 100)]);
  assert.equal(e1.total, 20, 'expired + stopped offers ignored, the live one applies (best single offer per line, no stacking)');
  await seed({ offers: [], coupons: [
    { code: 'P10', kind: 'pct', value: 10, min: 50, active: true, uses: [], to: '' },
    { code: 'F5', kind: 'fixed', value: 5, min: 0, active: true, uses: [], to: '', maxUses: 1 },
    { code: 'OLD', kind: 'pct', value: 10, min: 0, active: true, uses: [], to: '2000-01-01' },
    { code: 'OFF', kind: 'pct', value: 10, min: 0, active: false, uses: [], to: '' }] });
  assert.equal((await ev([L(1, 100)], { coupon: 'p10' })).couponDiscount, 10, 'percent coupon, case-insensitive');
  assert.equal((await ev([L(1, 40)], { coupon: 'P10' })).couponError, 'below-min');
  assert.equal((await ev([L(1, 3)], { coupon: 'F5' })).couponDiscount, 3, 'fixed coupon never exceeds the invoice');
  assert.equal((await ev([L(1, 10)], { coupon: 'OLD' })).couponError, 'expired');
  assert.equal((await ev([L(1, 10)], { coupon: 'OFF' })).couponError, 'inactive');
  assert.equal((await ev([L(1, 10)], { coupon: 'NOPE' })).couponError, 'unknown');

  // ---- accounts: only manager/owner may add offers ----
  const signIn = (name, pw) => page.evaluate(async ([n, p]) => { await window.novaAuth.signIn(n, p); }, [name, pw]);
  await page.evaluate(async () => {
    const A = window.novaAuth;
    await A.createAccount({ name: 'مالك تجربة', role: 'owner', password: 'owner-pass-1' });
    await A.signIn('مالك تجربة', 'owner-pass-1');
    await A.createAccount({ name: 'مدير تجربة', role: 'manager', password: 'mgr-pass-1' });
    await A.createAccount({ name: 'كاشير تجربة', role: 'cashier', password: 'cash-pass-1' });
  });
  assert.equal((await page.evaluate(() => window.novaOffers.addOffer({ type: 'bxgy', buy: Infinity, get: 1, items: 'x' }))).error, 'bad-number', 'Infinity buy refused');
  assert.equal((await page.evaluate(() => window.novaOffers.addCoupon({ code: 'inf1', kind: 'fixed', value: Infinity }))).error, 'bad-number', 'Infinity value refused');
  assert.equal((await page.evaluate(() => window.novaOffers.addCoupon({ code: 'inf2', kind: 'fixed', value: 5, maxUses: Infinity }))).error, 'bad-number', 'Infinity maxUses refused');
  await signIn('كاشير تجربة', 'cash-pass-1');
  const add = () => page.evaluate(b => window.novaOffers.addOffer({ type: 'pct', pct: 10, items: b }), BC);
  assert.deepEqual(await add(), { ok: false, error: 'forbidden' }, 'cashier cannot add an offer');
  assert.deepEqual(await page.evaluate(() => window.novaOffers.addCoupon({ code: 'ZZZ', kind: 'pct', value: 5 })), { ok: false, error: 'forbidden' });
  assert.equal(await page.evaluate(() => window.novaOffers.stop('coupon', 'P10').ok), false, 'cashier cannot stop');
  await signIn('مالك تجربة', 'owner-pass-1');
  assert.equal((await add()).ok, true, 'owner can add');
  assert.equal((await page.evaluate(() => window.novaOffers.addOffer({ type: 'bxgy', buy: 0, get: 1, items: 'x' }))).error, 'bad-number');
  assert.equal((await page.evaluate(() => window.novaOffers.addOffer({ type: 'pct', pct: 10 }))).error, 'need-items');
  assert.equal((await page.evaluate(() => window.novaOffers.addCoupon({ code: 'p10', kind: 'fixed', value: 1 }))).error, 'duplicate');
  await signIn('كاشير تجربة', 'cash-pass-1');

  // ---- sale screen ----
  async function addProduct() {
    await page.locator('#mainSearchInput').fill('بانادول');
    await page.waitForSelector('#suggestionsBox .suggestion-item');
    await page.locator('#suggestionsBox .suggestion-item').first().click();
    await page.waitForSelector('#btnCheckout:not([disabled])');
  }
  async function toCheckout() {
    await page.locator('#btnCheckout').click();
    await page.locator('#checkoutModal.active').waitFor();
    await page.locator('#btnCheckoutSkipCustomer, [data-skip-customer]').first().click({ timeout: 800 }).catch(() => {});
  }
  const nSales = () => page.evaluate(() => window.novaSales.list().length);

  // 1) buy 2 get 1 on the same item: line note, discount counts, NO manager dialog (33% is far above the 10% manual limit)
  await seed({ offers: [{ id: 'a', type: 'bxgy', active: true, name: 'اشتري 2 وخد 1', buy: 2, get: 1, items: [BC], categories: [], from: '', to: '' }], coupons: [] });
  await addProduct();
  const price = Number((await page.locator('#invoiceTableBody .col-price').first().innerText()).replace(/[^\d.]/g, ''));
  assert.ok(price > 0);
  assert.equal(await page.locator('.item-offer').count(), 0, '1 unit: no offer yet');
  await page.locator('[data-act="inc"]').first().click();
  await page.locator('[data-act="inc"]').first().click();
  await page.waitForSelector('.item-offer');
  assert.equal(Number(await page.locator('.item-offer').first().getAttribute('data-offer-discount')), price, 'one free unit');
  assert.match(await page.locator('.item-offer').first().innerText(), /عرض/);
  await toCheckout();
  await page.locator('#btnConfirmPayment').click();
  await page.waitForFunction(() => window.novaSales.list().length === 1);
  assert.equal(await page.locator('#novaSaleApproval').count(), 0, 'offer discount needs no manager approval');
  const s1 = await page.evaluate(() => window.novaSales.list()[0]);
  assert.equal(s1.discount, price); assert.equal(s1.offers.discount, price); assert.equal(s1.offers.items.length, 1);
  assert.equal(Math.round(s1.total * 100), Math.round(price * 2 * 100), 'total = 3 units - 1 free');
  assert.equal(s1.discountApproval, undefined);
  await page.locator('#btnReceiptNewSale').click();

  // 2) a MANUAL discount above the limit still asks for approval even when an offer is present
  await addProduct(); await page.locator('[data-act="inc"]').first().click(); await page.locator('[data-act="inc"]').first().click();
  await page.evaluate(() => { const i = document.getElementById('inputPercentDiscount'); i.value = '50'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await toCheckout();
  await page.locator('#btnConfirmPayment').click();
  await page.locator('#novaSaleApproval').waitFor();
  await page.locator('[data-sa-cancel]').click();
  await page.waitForTimeout(300);
  assert.equal(await nSales(), 1, 'manual 50% still needs a manager');
  await page.locator('#btnConfirmPayment').click();
  await page.locator('#novaSaUser').fill('مدير تجربة'); await page.locator('#novaSaPw').fill('mgr-pass-1'); await page.locator('[data-sa-ok]').click();
  await page.waitForFunction(() => window.novaSales.list().length === 2);
  const s1b = await page.evaluate(() => window.novaSales.list()[0]);
  assert.equal(s1b.discountApproval.approvedBy, 'مدير تجربة'); assert.ok(s1b.discountApproval.pct < 50 && s1b.discountApproval.pct > 10, 'approval pct counts only the manual part: ' + s1b.discountApproval.pct);
  assert.equal(s1b.offers.discount, price, 'offer still recorded separately');
  await page.locator('#btnReceiptNewSale').click();
  // 3) coupon at checkout: fixed 5, one use per sale, max uses 1, invalid codes refused, Enter in the box does not confirm the sale
  await seed({ offers: [], coupons: [
    { code: 'FIX5', kind: 'fixed', value: 5, min: 0, active: true, uses: [], to: '', maxUses: 1 },
    { code: 'BIG', kind: 'pct', value: 10, min: 1000, active: true, uses: [], to: '' }] });
  const before = await nSales();
  await addProduct();
  const price3 = Number((await page.locator('#invoiceTableBody .col-price').first().innerText()).replace(/[^\d.]/g, ''));
  await toCheckout();
  await page.locator('#novaCouponBox').waitFor();
  await page.locator('#novaCouponInput').fill('nope');
  await page.locator('#novaCouponInput').press('Enter');
  assert.match(await page.locator('#novaCouponMsg').innerText(), /مش موجود/);
  assert.equal(await nSales(), before, 'Enter in the coupon box must not confirm the sale');
  await page.locator('#novaCouponInput').fill('big');
  await page.locator('#novaCouponApply').click();
  assert.match(await page.locator('#novaCouponMsg').innerText(), /الحد الأدنى/);
  await page.locator('#novaCouponInput').fill('fix5');
  await page.locator('#novaCouponApply').click();
  assert.match(await page.locator('#novaCouponMsg').innerText(), /اتطبّق/);
  assert.equal(await page.locator('#modalAmountDue').innerText().then(t => parseFloat(t.replace(/[^\d.]/g, ''))), price3 - 5, 'due reduced by the coupon');
  assert.equal(Number(await page.locator('#inputCashReceived').inputValue()), price3 - 5, 'cash refilled');
  await page.locator('#btnConfirmPayment').click();
  await page.waitForFunction(n => window.novaSales.list().length === n + 1, before);
  assert.equal(await page.locator('#novaSaleApproval').count(), 0, 'coupon needs no manager approval');
  const s2 = await page.evaluate(() => window.novaSales.list()[0]);
  assert.equal(s2.offers.coupon.code, 'FIX5'); assert.equal(s2.offers.coupon.discount, 5); assert.equal(s2.discount, 5);
  assert.equal(Math.round(s2.total * 100), Math.round((price3 - 5) * 100));
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('nova-rx-offers-v1')).coupons[0].uses.length), 1, 'use recorded once');
  await page.locator('#btnReceiptNewSale').click();
  // used up now
  await addProduct(); await toCheckout();
  await page.locator('#novaCouponInput').fill('FIX5');
  await page.locator('#novaCouponApply').click();
  assert.match(await page.locator('#novaCouponMsg').innerText(), /خلص/);
  assert.equal(await page.evaluate(() => window.novaSaleCoupon.get()), '', 'rejected code is not kept');
  await page.locator('#btnConfirmPayment').click();
  await page.waitForFunction(n => window.novaSales.list().length === n + 2, before);
  const s3 = await page.evaluate(() => window.novaSales.list()[0]);
  assert.equal(s3.offers, undefined); assert.equal(s3.discount, 0);
  await page.locator('#btnReceiptNewSale').click();

  // 5) review fixes (Gemini u/2): validation, cent rounding, silent total changes
  // a 100% coupon on a fractional (strip) price never discounts more than the line is worth
  await seed({ offers: [], coupons: [{ code: 'ALL', kind: 'pct', value: 100, min: 0, active: true, uses: [], to: '' }] });
  const frac = await ev([L(2, 20 / 3)], { coupon: 'ALL', saleId: 'f1' });
  assert.ok(frac.coupon.discount <= 20 / 3 + 1e-9, 'coupon <= line value: ' + frac.coupon.discount);
  assert.equal(frac.coupon.discount, Math.round(frac.coupon.discount * 100) / 100, 'coupon discount is whole cents');
  assert.equal(frac.total, frac.coupon.discount, 'total equals the coupon discount');
  // a coupon that goes invalid between Apply and Confirm must NOT complete the sale at a higher total
  await seed({ offers: [], coupons: [{ code: 'FIX5', kind: 'fixed', value: 5, min: 0, active: true, uses: [], to: '' }] });
  const n5 = await nSales();
  await addProduct(); await toCheckout();
  await page.locator('#novaCouponInput').fill('fix5'); await page.locator('#novaCouponApply').click();
  await page.waitForFunction(() => window.novaSaleCoupon.get() === 'FIX5');
  await page.evaluate(() => { const o = JSON.parse(localStorage.getItem('nova-rx-offers-v1')); o.coupons[0].active = false; localStorage.setItem('nova-rx-offers-v1', JSON.stringify(o)); });
  await page.locator('#btnConfirmPayment').click();
  await page.waitForTimeout(500);
  assert.equal(await nSales(), n5, 'sale NOT completed after the coupon became invalid');
  assert.equal(await page.evaluate(() => window.novaSaleCoupon.get()), '', 'invalid coupon dropped');
  assert.ok(await page.locator('#checkoutModal.active').count(), 'checkout stays open to re-confirm');
  await page.locator('#btnConfirmPayment').click();
  await page.waitForFunction(n => window.novaSales.list().length === n + 1, n5);
  await page.locator('#btnReceiptNewSale').click();
  // 4) settings card renders for the owner and is read-only for a cashier
  await page.evaluate(() => { location.hash = '#settings'; });
  await page.waitForSelector('#novaOffersCard');
  assert.ok(await page.locator('#noAdd').isDisabled(), 'cashier: card is read-only');
  assert.deepEqual(errors, []);
  console.log('sale-offers passed');
} finally { await browser.close(); server.close(); }
