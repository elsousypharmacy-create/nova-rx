// Task 2 (#93): wallet / InstaPay / Fawry payment method. Needs a transaction reference; recorded as its own tender method;
// the same reference on a second sale is refused. No real wallet integration. Usage: node tests/ux/sale-wallet.mjs
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
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG', serviceWorkers: 'block' });
  await ctx.route('**/*', r => { const q = r.request(); return q.url().startsWith(BASE) || q.url().startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await (await page.addInitScript({ content: "try{var P=function(){localStorage.setItem('nova-rx-receipt-preview','1')},C=Storage.prototype.clear;Storage.prototype.clear=function(){C.call(this);if(this===localStorage)P()};P()}catch(e){}" }), page).addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#btnAddLoyalty');

  // pure plan checks
  const plans = await page.evaluate(() => {
    const P = window.novaPay.plan;
    return [P(100, { alt: { method: 'instapay', amount: 100, ref: ' ABC123 ' } }, false), P(100, { alt: { method: 'fawry', amount: 100, ref: '' } }, false),
      P(100, { alt: { method: 'bitcoin', amount: 100, ref: 'x' } }, false), P(100, { cash: 40, alt: { method: 'wallet', amount: 60, ref: 'R1' } }, false), P(100, { card: 50, alt: { method: 'wallet', amount: 60, ref: 'R1' } }, false)];
  });
  assert.deepEqual(plans[0].tenders, [{ method: 'instapay', amount: 100, ref: 'ABC123' }]); assert.equal(plans[0].payment, 'instapay'); assert.equal(plans[0].collected, 100);
  assert.equal(plans[1].error, 'ref-needed');
  assert.notEqual(plans[2].tenders && plans[2].tenders[0] && plans[2].tenders[0].method, 'bitcoin', 'unknown method is not a wallet tender');
  assert.equal(plans[3].payment, 'mixed'); assert.equal(plans[3].tenders.length, 2);
  assert.equal(plans[4].error, 'over-allocated');

  async function startSale() {
    await page.locator('#mainSearchInput').fill('بانادول');
    await page.waitForSelector('#suggestionsBox .suggestion-item');
    await page.locator('#suggestionsBox .suggestion-item').first().click();
    await page.waitForSelector('#btnCheckout:not([disabled])');
    await page.locator('#btnCheckout').click();
    await page.locator('#checkoutModal.active').waitFor();
    await page.locator('#btnCheckoutSkipCustomer, [data-skip-customer]').first().click({ timeout: 800 }).catch(() => {});
    await page.locator('.pay-method-btn[data-method="wallet"]').click();
  }

  await startSale();
  assert.ok(await page.locator('#walletDetailsBox').isVisible(), 'wallet box shown');
  assert.ok(!(await page.locator('#cashDetailsBox').isVisible()), 'cash box hidden');
  assert.ok(await page.locator('#btnConfirmPayment').isDisabled(), 'no reference => cannot confirm');
  await page.locator('#inputWalletKind').selectOption('instapay');
  await page.locator('#inputWalletRef').fill('TX-100200');
  assert.ok(!(await page.locator('#btnConfirmPayment').isDisabled()), 'reference => can confirm');
  await page.locator('#btnConfirmPayment').click();
  await page.waitForFunction(() => window.novaSales.list().length === 1);
  const s = await page.evaluate(() => window.novaSales.list()[0]);
  assert.equal(s.payment, 'instapay'); assert.deepEqual(s.tenders.map(t => [t.method, t.ref]), [['instapay', 'TX-100200']]);
  assert.equal(s.collected, s.total, 'collected in full');
  await page.locator('#btnReceiptNewSale').click();

  // duplicate reference on a second sale is refused
  await startSale();
  await page.locator('#inputWalletKind').selectOption('instapay');
  await page.locator('#inputWalletRef').fill('tx-100200');
  assert.ok(await page.locator('#btnConfirmPayment').isDisabled(), 'duplicate reference blocked');
  assert.ok(await page.locator('#walletRefHint').isVisible(), 'duplicate hint shown');
  await page.locator('#inputWalletRef').fill('TX-100201');
  assert.ok(!(await page.locator('#btnConfirmPayment').isDisabled()), 'new reference ok');
  await page.locator('#inputWalletKind').selectOption('fawry');
  await page.locator('#inputWalletRef').press('Enter');
  await page.waitForFunction(() => window.novaSales.list().length === 2);
  assert.equal(await page.evaluate(() => window.novaSales.list()[0].payment), 'fawry');
  assert.equal(await page.evaluate(() => window.NovaFmt.payLabel('fawry')), 'فوري');
  assert.deepEqual(errors, []);
  console.log('sale-wallet passed');
} finally { await browser.close(); server.close(); }
