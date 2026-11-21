// Task 5 (#94): optional cash rounding (setting nova-rx-round-step). Off by default. Cash only. Invoice total stays exact; sale.rounding records the difference.
// Usage: node tests/ux/sale-rounding.mjs
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

  // pure rounding
  const r = await page.evaluate(() => { const R = window.novaRounding; R.set(0.5); const a = [12.2, 12.3, 12.75, 0.1, 0].map(x => R.cashRound(x)); R.set(1); const b = [12.49, 12.5, 12.51].map(x => R.cashRound(x).due); R.set(0); return { a, b, off: R.cashRound(12.34), bad: R.set(99) }; });
  assert.deepEqual(r.a.map(x => x.due), [12, 12.5, 13, 0.1, 0], 'step 0.5 half up, tiny totals stay exact');
  assert.deepEqual(r.b, [12, 13, 13], 'step 1 half up');
  assert.deepEqual(r.off, { due: 12.34, rounding: 0 }, 'off by default');
  assert.equal(r.bad, false, 'absurd step refused');

  async function startSale() {
    await page.locator('#mainSearchInput').fill('بانادول');
    await page.waitForSelector('#suggestionsBox .suggestion-item');
    await page.locator('#suggestionsBox .suggestion-item').first().click();
    await page.waitForSelector('#btnCheckout:not([disabled])');
    await page.locator('#btnCheckout').click();
    await page.locator('#checkoutModal.active').waitFor();
    await page.locator('#btnCheckoutSkipCustomer, [data-skip-customer]').first().click({ timeout: 800 }).catch(() => {});
  }
  // off: exact
  await startSale();
  assert.ok(await page.locator('#checkoutRoundingNote').isHidden(), 'no note when off');
  await page.locator('#btnConfirmPayment').click();
  await page.waitForFunction(() => window.novaSales.list().length === 1);
  assert.equal(await page.evaluate(() => 'rounding' in window.novaSales.list()[0]), false);
  await page.locator('#btnReceiptNewSale').click();

  // on: step 5 EGP so the demo item (any price) rounds; pick a step that changes it
  const total = await page.evaluate(() => window.novaSales.list()[0].total);
  const step = total % 5 === 0 ? 0.5 : 5;
  await page.evaluate(s => window.novaRounding.set(s), step);
  const exp = await page.evaluate(t => window.novaRounding.cashRound(t), total);
  assert.notEqual(exp.rounding, 0, 'step changes the demo total ' + total);
  await startSale();
  assert.equal(await page.locator('#modalAmountDue').innerText().then(t => parseFloat(t.replace(/[^\d.]/g, ''))), exp.due, 'due shown rounded');
  assert.ok(await page.locator('#checkoutRoundingNote').isVisible(), 'rounding note shown');
  assert.equal(Number(await page.locator('#inputCashReceived').inputValue()), exp.due, 'cash prefilled with rounded due');
  await page.locator('#btnConfirmPayment').click();
  await page.waitForFunction(() => window.novaSales.list().length === 2);
  const s = await page.evaluate(() => window.novaSales.list()[0]);
  assert.equal(s.total, total, 'invoice total exact'); assert.equal(s.rounding, exp.rounding); assert.equal(s.collected, exp.due);
  assert.equal(s.tenders[0].amount, exp.due, 'cash tender is the rounded due');
  await page.locator('#btnReceiptNewSale').click();

  // card is never rounded
  await startSale();
  await page.locator('.pay-method-btn[data-method="card"]').click();
  assert.ok(await page.locator('#checkoutRoundingNote').isHidden(), 'no rounding on card');
  await page.locator('#btnConfirmPayment').click();
  await page.waitForFunction(() => window.novaSales.list().length === 3);
  const c = await page.evaluate(() => window.novaSales.list()[0]);
  assert.equal(c.collected, c.total); assert.equal('rounding' in c, false);
  assert.deepEqual(errors, []);
  console.log('sale-rounding passed');
} finally { await browser.close(); server.close(); }
