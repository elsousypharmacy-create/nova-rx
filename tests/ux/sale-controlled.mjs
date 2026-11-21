// Task 7 (CTRL-01 wiring): a controlled drug in the cart opens the patient/ID/doctor dialog before the sale is saved.
// Cancel = no sale, no register row. Fill = sale saved + register row linked to the sale id. Uncontrolled cart = no dialog.
// Usage: node tests/ux/sale-controlled.mjs  (NOVA_URL optional; otherwise a local static server is started)
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
  await page.waitForFunction(() => !!window.novaControlled);

  const sales = () => page.evaluate(() => window.novaSales.list().length);
  const regCount = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('nova-rx-controlled-log-v1') || '[]').length; } catch { return -1; } });
  async function addProduct() {
    await page.locator('#mainSearchInput').fill('بانادول');
    await page.waitForSelector('#suggestionsBox .suggestion-item');
    await page.locator('#suggestionsBox .suggestion-item').first().click();
    await page.waitForSelector('#btnCheckout:not([disabled])');
  }
  async function openPay() {
    await page.locator('#btnCheckout').click();
    await page.locator('#checkoutModal.active').waitFor();
    await page.locator('#checkoutModal [data-skip-customer], #btnCheckoutSkipCustomer').first().click({ timeout: 800 }).catch(() => {});
  }

  // Use the first suggestion's key as the controlled item.
  const key = await page.evaluate(() => { const r = window.novaSearch.search('بانادول', 1); return window.novaStock.keyOf(r[0]); });

  // 1) uncontrolled: no dialog, sale saved
  await addProduct(); await openPay();
  await page.locator('#btnConfirmPayment').click();
  await page.waitForFunction(() => window.novaSales.list().length === 1);
  assert.equal(await page.locator('.nova-ctrl-field').count(), 0, 'no controlled dialog for a normal item');
  await page.locator('#btnReceiptNewSale').click();

  // 2) controlled + cancel: no sale
  await page.evaluate(k => window.novaControlled.setControlled(k, true, 'test'), key);
  await addProduct(); await openPay();
  await page.locator('#btnConfirmPayment').click();
  await page.locator('[data-action="cancel"]').waitFor();
  await page.locator('[data-action="cancel"]').click();
  await page.waitForTimeout(400);
  assert.equal(await sales(), 1, 'cancelled capture saves no sale');
  assert.equal(await regCount(), 0, 'no register row after cancel');
  assert.ok(await page.locator('#checkoutModal.active').count(), 'checkout stays open');
  assert.ok(!(await page.locator('#btnConfirmPayment').isDisabled()), 'confirm usable again');

  // 3) controlled + filled: sale + register row linked
  await page.locator('#btnConfirmPayment').click();
  await page.locator('form input[name="patientName"]').fill('مريض تجريبي');
  await page.locator('form input[name="nationalId"]').fill('29001011234567');
  await page.locator('form input[name="doctor"]').fill('د. تجربة');
  await page.locator('[data-action="save"]').click();
  await page.waitForFunction(() => window.novaSales.list().length === 2);
  const reg = await page.evaluate(() => JSON.parse(localStorage.getItem('nova-rx-controlled-log-v1') || '[]'));
  const sale = await page.evaluate(() => window.novaSales.list()[0] && window.novaSales.list()[0].id);
  assert.equal(reg.length, 1, 'one register row');
  assert.equal(reg[0].patientName, 'مريض تجريبي');
  assert.ok(reg[0].saleId && (await page.evaluate(() => window.novaSales.list().some(s => true))), 'linked to a sale');
  assert.ok((await page.evaluate(id => window.novaSales.list().some(s => s.id === id), reg[0].saleId)), 'saleId matches a saved sale');
  assert.deepEqual(errors, []);
  console.log('sale-controlled passed');
} finally { await browser.close(); server.close(); }
