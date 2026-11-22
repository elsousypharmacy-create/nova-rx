// #109 Egyptian drug track-and-trace DataMatrix (GS1) (block 622 in app/594-ops-screens.js + the eager hook in app/120 findExactBarcodeProduct;
// queue 11, rcv24). Draft Gemini u/1, review Gemini u/0, fixed by Claude B.
//  - parse(): ]d2/]C1 prefix or none, AIs 01/17/10/21 in any order, FNC1 = ASCII 29 or missing, YYMMDD with DD=00 = end of month (leap year),
//    GTIN-14 -> EAN-13 without the leading 0, plain EAN-13 is not GS1;
//  - the REAL scanner path (window.novaScanner.scan) adds the item for a GS1 scan and refuses an expired pack with an Arabic message,
//    BEFORE 594 is loaded (hook fallback) and after; a normal EAN-13 scan is unchanged;
//  - the inspector card is on the products page (the sale screen hides #novaPageView) and shows the Arabic refusal.
// Usage: node tests/ux/gs1-datamatrix.mjs   (own static server; CHROME_PATH optional)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
let blockLazy = true;
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
const GS = String.fromCharCode(29);
const FUTURE = ']d201062810012345671728120010EG2026A' + GS + '21SN99887766';   // PRD001, 2028-12-31
const EXPIRED = ']d201062810012345691722011510OLD01' + GS + '21SER0001';        // PRD003, 2022-01-15
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG', serviceWorkers: 'block' });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (!u.startsWith(BASE) && !u.startsWith('data:')) return r.abort();
    if (blockLazy && /app-594-ops-screens\./.test(u)) return r.abort();
    return r.continue();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#btnAddLoyalty');

  const scanAll = () => page.evaluate(([f, e]) => {
    const toasts = [];
    const lines = () => document.querySelectorAll('#invoiceItemsBody tr, .invoice-line, [data-line-idx]').length;
    const mo = new MutationObserver(() => { document.querySelectorAll('.toast, .nova-toast, #toastContainer *').forEach(t => toasts.push(t.textContent)); });
    mo.observe(document.body, { childList: true, subtree: true });
    const out = { lazy: !!window.novaGs1 };
    out.future = window.novaScanner.scan(f);
    out.expired = window.novaScanner.scan(e);
    out.plain = window.novaScanner.scan('6281001234568');
    out.noFnc1 = window.novaScanner.scan('01062810012345702112345ABC1727103110B77'); // PRD004, 01 21 17 10 without FNC1
    return new Promise(res => setTimeout(() => { mo.disconnect(); out.toasts = toasts.join(' | '); res(out); }, 300));
  }, [FUTURE, EXPIRED]);

  const b = await scanAll();
  assert.equal(b.lazy, false, '594 not loaded yet');
  assert.equal(b.future.ok, true, 'GS1 scan adds the item before 594 loads'); assert.equal(b.future.product.id, 'PRD001');
  assert.equal(b.expired.ok, false, 'expired pack refused before 594 loads');
  assert.equal(b.plain.ok, true); assert.equal(b.plain.product.id, 'PRD002', 'plain EAN-13 unchanged');
  assert.equal(b.noFnc1.ok, true); assert.equal(b.noFnc1.product.id, 'PRD004');
  assert.match(b.toasts, /منتهية الصلاحية/, 'Arabic refusal toast');

  blockLazy = false;
  await page.evaluate(() => window.novaLazy.load());
  await page.waitForFunction(() => !!window.novaGs1);
  const a = await scanAll();
  assert.equal(a.future.ok, true); assert.equal(a.future.product.id, 'PRD001');
  assert.equal(a.expired.ok, false, 'expired pack refused after 594 loads');
  assert.equal(a.plain.product.id, 'PRD002');
  assert.equal(a.noFnc1.product.id, 'PRD004');

  const r = await page.evaluate(([f, e, GS]) => {
    const P = s => window.novaGs1.parse(s);
    return {
      f: P(f), e: P(e),
      leap: P(']C101062810012345671728020010LOT1'),
      noFnc1: P('01062810012345681729061510LOT4521SER123456'),
      order: P('01062810012345702112345ABC' + GS + '1727103110B77'),
      leadGs: P(GS + '010628100123456717290615'),
      badMonth: P('010628100123456717291315'),
      plain: P('6281001234567'),
      cut: P('0106281001234'),
      notStr: P(null)
    };
  }, [FUTURE, EXPIRED, GS]);
  assert.equal(r.f.gtin, '06281001234567'); assert.equal(r.f.ean13, '6281001234567');
  assert.equal(r.f.expiry, '2028-12-31', 'DD=00 -> last day'); assert.equal(r.f.batch, 'EG2026A'); assert.equal(r.f.serial, 'SN99887766'); assert.equal(r.f.expired, false);
  assert.equal(r.e.expired, true); assert.equal(r.e.expiry, '2022-01-15');
  assert.equal(r.leap.expiry, '2028-02-29', 'leap February DD=00');
  assert.equal(r.noFnc1.batch, 'LOT45'); assert.equal(r.noFnc1.serial, 'SER123456'); assert.equal(r.noFnc1.expiry, '2029-06-15');
  assert.equal(r.order.serial, '12345ABC'); assert.equal(r.order.expiry, '2027-10-31'); assert.equal(r.order.batch, 'B77');
  assert.equal(r.leadGs.gtin, '06281001234567', 'leading FNC1 ignored');
  assert.equal(r.badMonth.expiry, '', 'month 13 is not a date');
  assert.equal(r.plain, null, 'plain EAN-13 is not GS1'); assert.equal(r.cut, null); assert.equal(r.notStr, null);

  await page.evaluate(() => { const x = document.querySelector('.nova-tab[data-page="products"]'); if (x) x.click(); });
  await page.evaluate(id => window.novaPageViews.openTool(id), 'novaGs1Card'); await page.waitForTimeout(400); // Q21-2c: the card is a tool in «الأدوات»
  await page.waitForSelector('#novaGs1Card', { state: 'visible', timeout: 5000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'no overflow at 390px');
  await page.fill('#novaGs1Input', ']d201062810012345691722011510OLD01');
  await page.click('#novaGs1ParseBtn');
  assert.match(await page.textContent('#novaGs1Result'), /منتهية الصلاحية/, 'card shows the Arabic refusal');
  assert.deepEqual(errors, [], 'page errors: ' + errors.join('; '));
  console.log('gs1-datamatrix PASS');
} finally {
  await browser.close();
  server.close();
}
