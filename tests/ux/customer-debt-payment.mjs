// UX11: customer debt column + one-dialog «سداد». Local static server, all non-GET aborted.
// Usage: node tests/ux/customer-debt-payment.mjs
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
  await ctx.route('**/*', r => { const q = r.request(); return q.url().startsWith(BASE) || q.url().startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#btnAttachLoyalty');

  // Setup (not counted): credit sale to the first demo customer.
  await page.locator('#btnAttachLoyalty').click();
  await page.locator('#mainSearchInput').fill('طارق');
  await page.waitForSelector('#suggestionsBox .suggestion-item');
  await page.locator('#suggestionsBox .suggestion-item').first().click();
  await page.waitForTimeout(200);
  await page.locator('#mainSearchInput').fill('');
  await page.locator('#mainSearchInput').focus();
  await page.keyboard.press('Enter'); // customer step done -> product mode
  await page.locator('#mainSearchInput').fill('بانادول');
  await page.waitForSelector('#suggestionsBox .suggestion-item');
  await page.locator('#suggestionsBox .suggestion-item').first().click();
  await page.waitForSelector('#btnCheckout:not([disabled])');
  await page.locator('#btnCheckout').click();
  await page.locator('.pay-method-btn[data-method="credit"]').click();
  await page.locator('#btnConfirmPayment').click();
  await page.waitForFunction(() => { try { return window.NovaCredit.createCreditLedger(localStorage, 'nova.credit').customers().length > 0; } catch { return false; } });
  await page.locator('#btnReceiptNewSale').click(); // setup: close receipt
  const debt = await page.evaluate(() => window.NovaCredit.createCreditLedger(localStorage, 'nova.credit').customers()[0].balance);
  assert.ok(debt > 0, 'credit sale recorded a debt');

  let clicks = 0;
  const click = async sel => { clicks++; await page.locator(sel).first().click(); };
  await click('.nova-tab[data-page="customers"]');            // 1
  const cell = page.locator('td[data-debt]', { has: page.locator('[data-pay-debt]') }).first();
  await cell.waitFor();
  assert.match(await cell.innerText(), /\d/, 'debt shown');
  assert.equal(await cell.evaluate(e => getComputedStyle(e).color), 'rgb(255, 93, 93)', 'debt red');
  await click('[data-pay-debt]');                              // 2
  assert.equal(await page.locator('#novaPayAmt').inputValue(), String(debt), 'prefilled full balance');
  assert.equal(await page.locator('#novaPayMethod').inputValue(), 'cash', 'default cash');
  assert.equal(await page.locator('#novaPayDebt').getAttribute('dir'), 'rtl');
  await click('#novaPayOk');                                   // 3
  await page.waitForSelector('#novaPayDebt', { state: 'detached' });
  assert.equal(await page.locator('[data-pay-debt]').count(), 0, 'no debt buttons left');
  const after = await page.evaluate(() => window.NovaCredit.createCreditLedger(localStorage, 'nova.credit').customers().reduce((t, c) => t + c.balance, 0));
  assert.equal(after, 0, 'balance is 0');
  assert.ok(clicks <= 4, `clicks ${clicks} <= 4`);
  assert.deepEqual(errors, []);
  console.log(`customer-debt-payment passed (clicks=${clicks}, debt=${debt})`);
} finally { await browser.close(); server.close(); }
