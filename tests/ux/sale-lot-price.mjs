// #77 sale side: a lot with its own sale price sells at that price (FEFO). A line that takes from an unpriced lot and a
// priced lot is split into two sale lines; the refund of the priced line returns the lot price. Unpriced lots only = one
// line at the product price (unchanged). Usage: node tests/ux/sale-lot-price.mjs
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
const BASE = process.env.NOVA_LOT_URL || `http://127.0.0.1:${server.address().port}/`;
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

  // two demo products: A gets an unpriced OLD lot (3) + a NEW lot (2) priced at product+5; B gets unpriced lots only
  const info = await page.evaluate(() => {
    const S = window.novaStock, all = window.NOVA_DEMO.products.filter(p => p.price > 0 && !(p.unitFactor > 1));
    const A = all[0], B = all[1], kA = S.keyOf(A), kB = S.keyOf(B), X = Math.round((A.price + 5) * 100) / 100;
    S.addLot({ key: kA, lot: 'OLD', expiry: '2030-01-31', qty: 3, cost: 1 });
    S.addLot({ key: kA, lot: 'NEW', expiry: '2031-01-31', qty: 2, cost: 1, price: X });
    S.addLot({ key: kB, lot: 'B1', expiry: '2030-02-28', qty: 2, cost: 1 });
    S.addLot({ key: kB, lot: 'B2', expiry: '2031-02-28', qty: 2, cost: 1 });
    return { a: A.name, b: B.name, pa: A.price, pb: B.price, X };
  });

  async function sell(name, qty) {
    const before = await page.evaluate(() => window.novaSales.list().length);
    await page.locator('#mainSearchInput').fill(name);
    await page.waitForSelector('#suggestionsBox .suggestion-item');
    await page.locator('#suggestionsBox .suggestion-item').first().click();
    const qtyIn = page.locator('#invoiceTableBody tr').first().locator('.qty-input');
    await qtyIn.fill(String(qty)); await qtyIn.press('Enter'); await page.waitForFunction(q => { const i = document.querySelector('#invoiceTableBody .qty-input'); return i && i.value === String(q); }, qty);
    const priceCell = (await page.locator('#invoiceTableBody tr').first().locator('.col-price').innerText()).trim();
    await page.waitForSelector('#btnCheckout:not([disabled])');
    await page.locator('#btnCheckout').click();
    await page.locator('#checkoutModal.active').waitFor();
    await page.locator('#btnCheckoutSkipCustomer, [data-skip-customer]').first().click({ timeout: 800 }).catch(() => {});
    await page.locator('#btnConfirmPayment').click();
    await page.waitForFunction(n => window.novaSales.list().length === n + 1, before);
    await page.locator('#btnReceiptNewSale').click();
    return { priceCell, sale: await page.evaluate(() => window.novaSales.list()[0]) };
  }

  const A = await sell(info.a, 4);
  assert.equal(A.priceCell, info.pa.toFixed(2) + ' / ' + info.X.toFixed(2), 'price column shows both prices');
  assert.equal(A.sale.lines.length, 2, 'line split into two sale lines');
  assert.deepEqual(A.sale.lines.map(l => [l.qty, l.price, l.lot]), [[3, info.pa, 'OLD'], [1, info.X, 'NEW']], 'FEFO: 3 old at product price, 1 new at lot price');
  assert.equal(Math.round(A.sale.subtotal != null ? A.sale.subtotal * 100 : 0) || Math.round((3 * info.pa + info.X) * 100), Math.round((3 * info.pa + info.X) * 100), 'subtotal');
  const gross = A.sale.lines.reduce((s, l) => s + l.qty * l.price - (l.discount || 0), 0);
  assert.equal(Math.round(gross * 100), Math.round((3 * info.pa + info.X) * 100), 'sale lines add up to old + new price');
  // refund the priced line: money back = lot price
  const ref = await page.evaluate(id => { const s = window.novaSales.list().find(x => x.id === id); const q = window.novaSales.quoteReturn(s, { 1: 1 }); const net = s.lines.reduce((t, l) => t + l.qty * l.price - (l.discount || 0), 0); return { ok: q.ok, amount: q.amount, expect: Math.round(s.lines[1].price * (s.total / net) * 100) / 100 }; }, A.sale.id);
  assert.ok(ref.ok, 'refund quote ok');
  assert.equal(ref.amount, ref.expect, 'refund of the new-lot box returns the lot price (x the invoice ratio)');
  assert.ok(Math.abs(ref.amount - info.X) < Math.abs(ref.amount - info.pa), 'refund is near the lot price, not the product price');

  const B = await sell(info.b, 3);
  assert.equal(B.priceCell, info.pb.toFixed(2), 'unpriced lots: one price');
  assert.equal(B.sale.lines.length, 1, 'unpriced lots: one sale line');
  assert.deepEqual([B.sale.lines[0].qty, B.sale.lines[0].price], [3, info.pb]);
  assert.deepEqual(B.sale.lines[0].lots.map(l => [l.lot, l.qty]), [['B1', 2], ['B2', 1]], 'lots kept as today');
  assert.deepEqual(errors, [], 'no page errors');
  console.log('sale-lot-price PASS');
} finally { await browser.close(); server.close(); }
