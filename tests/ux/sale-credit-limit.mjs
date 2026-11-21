// Task 6 (#116 wiring): a credit (آجل) sale that pushes the customer past the limit needs a manager approval.
// Under the limit = no dialog. Over + cancel = no sale. Over + approve = sale saved with creditApproval + debt charged.
// Usage: node tests/ux/sale-credit-limit.mjs  (local static server, all non-GET aborted)
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
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#btnAddLoyalty');
  await page.evaluate(() => window.novaLazy.load());
  await page.waitForFunction(() => !!window.novaCreditLimit);

  const sales = () => page.evaluate(() => window.novaSales.list().length);
  const ledger = fn => page.evaluate(`(${fn.toString()})(window.NovaCredit.createCreditLedger(localStorage, 'nova.credit'))`);
  async function startCreditSale() {
    await page.locator('#btnAddLoyalty').click();
    await page.locator('#mainSearchInput').fill('طارق');
    await page.waitForSelector('#suggestionsBox .suggestion-item');
    await page.locator('#suggestionsBox .suggestion-item').first().click();
    await page.waitForTimeout(200);
    await page.locator('#mainSearchInput').fill('');
    await page.locator('#mainSearchInput').focus();
    await page.keyboard.press('Enter');
    await page.locator('#mainSearchInput').fill('بانادول');
    await page.waitForSelector('#suggestionsBox .suggestion-item');
    await page.locator('#suggestionsBox .suggestion-item').first().click();
    await page.waitForSelector('#btnCheckout:not([disabled])');
    await page.locator('#btnCheckout').click();
    await page.locator('.pay-method-btn[data-method="credit"]').click();
    await page.locator('#btnConfirmPayment').click();
  }

  // 1) no limit: setup credit sale, no dialog
  await startCreditSale();
  await page.waitForFunction(() => window.novaSales.list().length === 1);
  assert.equal(await page.locator('#novaSaleApproval').count(), 0, 'no approval when the customer has no limit');
  await page.locator('#btnReceiptNewSale').click();
  const cid = await ledger(l => l.customers()[0].customerId);
  const debt = await ledger(l => l.customers()[0].balance);
  assert.ok(debt > 0, 'debt recorded');

  // 2) limit = current debt, any more credit exceeds: dialog, cancel => no sale
  await ledger(l => 0); await page.evaluate(([id, d]) => window.NovaCredit.createCreditLedger(localStorage, 'nova.credit').setLimit(id, d), [cid, debt]);
  await startCreditSale();
  await page.locator('#novaSaleApproval').waitFor();
  assert.match(await page.locator('#novaSaleApproval').innerText(), /حد الائتمان/, 'dialog explains the credit limit');
  await page.locator('[data-sa-cancel]').click();
  await page.waitForTimeout(400);
  assert.equal(await sales(), 1, 'cancelled approval saves no sale');
  assert.equal(await ledger(l => l.balance(l.customers()[0].customerId)), debt, 'no extra debt after cancel');
  assert.ok(await page.locator('#checkoutModal.active').count(), 'checkout stays open');
  assert.ok(!(await page.locator('#btnConfirmPayment').isDisabled()), 'confirm usable again');

  // 3) approve (no accounts on the device => typed name, marked unverified)
  await page.locator('#btnConfirmPayment').click();
  await page.locator('#novaSaUser').fill('مدير تجريبي');
  await page.locator('[data-sa-ok]').click();
  await page.waitForFunction(() => window.novaSales.list().length === 2);
  const rec = await page.evaluate(() => window.novaSales.list().find(s => s.creditApproval));
  assert.ok(rec && rec.creditApproval.approvedBy === 'مدير تجريبي' && rec.creditApproval.unverified === true, 'sale carries the approval');
  assert.ok((await ledger(l => l.balance(l.customers()[0].customerId))) > debt, 'debt charged after approval');
  await page.locator('#btnReceiptNewSale').click();

  // 4) high limit: no dialog
  await page.evaluate(id => window.NovaCredit.createCreditLedger(localStorage, 'nova.credit').setLimit(id, 100000), cid);
  await startCreditSale();
  await page.waitForFunction(() => window.novaSales.list().length === 3);
  assert.equal(await page.locator('#novaSaleApproval').count(), 0, 'no dialog under the limit');
  assert.deepEqual(errors, []);
  console.log('sale-credit-limit passed');
} finally { await browser.close(); server.close(); }
