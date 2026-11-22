// #108 extra barcodes per item (block 620 in app/594-ops-screens.js + the eager hook in app/120 findExactBarcodeProduct; queue 11, rcv24).
// Draft Gemini u/1, review Gemini u/0, fixed by Claude B. No mocks of the POS:
//  - the REAL scanner path (window.novaScanner.scan -> findExactBarcodeProduct) finds an item by an extra barcode
//    BEFORE 594 is loaded (hook reads localStorage directly) and offline, and still after 594 loads;
//  - the normal barcode keeps winning; unknown codes still fail;
//  - add(): 8-14 digits only (Arabic-Indic accepted, spaces stripped), unique across extra codes AND items' own barcodes,
//    the item must exist, real novaPerms 'prices.edit' (cashier refused, nothing stored).
// Usage: node tests/ux/alt-barcodes.mjs   (own static server; CHROME_PATH optional)
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
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG', serviceWorkers: 'block' });
  // 594 (lazy) is held back until we allow it: proves the hook works before the lazy file exists
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (!u.startsWith(BASE) && !u.startsWith('data:')) return r.abort();
    if (blockLazy && /app-594-ops-screens\./.test(u)) return r.abort();
    return r.continue();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.clear(); sessionStorage.setItem('seeded', '1');
        // an extra code saved earlier (as 620 stores it)
        localStorage.setItem('nova-rx-alt-barcodes', JSON.stringify([{ itemKey: 'PRD003', code: '6229990000017', addedAt: '2026-11-22T08:00:00.000Z', addedBy: '' }]));
      }
      localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage');
    } catch {}
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#btnAddLoyalty');
  await ctx.setOffline(true);
  const before = await page.evaluate(() => ({
    lazy: !!window.novaAltBarcodes,
    alt: window.novaScanner.scan('6229990000017'),
    normal: window.novaScanner.scan('6281001234568'),
    unknown: window.novaScanner.scan('6229990000999')
  }));
  assert.equal(before.lazy, false, '594 not loaded yet');
  assert.equal(before.alt.ok, true, 'extra barcode found by the real scanner before 594 loads, offline');
  assert.equal(before.alt.product.id, 'PRD003');
  assert.equal(before.normal.ok, true); assert.equal(before.normal.product.id, 'PRD002', 'normal barcode unchanged');
  assert.equal(before.unknown.ok, false, 'unknown code still not found');

  await ctx.setOffline(false);
  blockLazy = false;
  await page.evaluate(() => window.novaLazy.load());
  await page.waitForFunction(() => !!window.novaAltBarcodes);
  await page.evaluate(() => { const b = document.querySelector('.nova-tab[data-page="products"]'); if (b) b.click(); });
  await page.evaluate(id => window.novaPageViews.openTool(id), 'novaAltBarcodesCard'); await page.waitForTimeout(400); // Q21-2c: the card is a tool in «الأدوات»
  await page.waitForSelector('#novaAltBarcodesCard', { state: 'visible', timeout: 5000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'no overflow at 390px');

  const r = await page.evaluate(() => {
    const A = window.novaAltBarcodes, out = {};
    out.tooShort = A.add('PRD001', '1234567');
    out.nonDigit = A.add('PRD001', '1234ABCD');
    out.ownBarcode = A.add('PRD001', '6281001234568');         // PRD002's own barcode
    out.noItem = A.add('NOPE', '6221000000005');
    out.added = A.add('PRD001', ' ٦٢٢١ ٠٠٠٠٠٠٠٠١ ');            // Arabic-Indic + spaces
    out.dupSame = A.add('PRD001', '6221000000001');
    out.dupOther = A.add('PRD002', '6221000000001');
    out.dupStored = A.add('PRD001', '6229990000017');            // PRD003's extra code
    out.lookup = A.lookup('٦٢٢١٠٠٠٠٠٠٠٠١');
    out.list = A.list('PRD001');
    out.scanAfter = window.novaScanner.scan('6221000000001');
    const real = window.novaPerms;
    window.novaPerms = window.NovaPerms.create({ storage: localStorage, current: () => ({ id: 'c', name: 'ك', role: 'cashier' }), hasAccounts: () => true });
    const n0 = localStorage.getItem('nova-rx-alt-barcodes');
    out.cashierAdd = A.add('PRD004', '6221000000003');
    out.cashierRemove = A.remove('PRD001', '6221000000001');
    out.cashierStored = localStorage.getItem('nova-rx-alt-barcodes') === n0;
    window.novaPerms = { require: () => { throw new Error('x'); } };
    out.threw = A.add('PRD004', '6221000000003');
    window.novaPerms = real;
    out.removed = A.remove('PRD001', '6221000000001');
    out.lookupAfter = A.lookup('6221000000001');
    out.scanRemoved = window.novaScanner.scan('6221000000001');
    localStorage.setItem('nova-rx-alt-barcodes', 'corrupt[');
    out.corrupt = A.list('PRD001').length;
    out.scanCorrupt = window.novaScanner.scan('6229990000017');
    return out;
  });
  assert.equal(r.tooShort.error, 'invalid-code'); assert.equal(r.nonDigit.error, 'invalid-code');
  assert.equal(r.ownBarcode.error, 'duplicate', "an item's own barcode cannot be an extra code");
  assert.equal(r.noItem.error, 'item-not-found');
  assert.equal(r.added.ok, true); assert.equal(r.added.record.code, '6221000000001', 'Arabic-Indic digits + spaces normalized');
  assert.equal(r.dupSame.error, 'duplicate'); assert.equal(r.dupOther.error, 'duplicate'); assert.equal(r.dupStored.error, 'duplicate');
  assert.equal(r.lookup, 'PRD001'); assert.deepEqual(r.list, ['6221000000001']);
  assert.equal(r.scanAfter.ok, true); assert.equal(r.scanAfter.product.id, 'PRD001', 'real scanner finds the new extra code');
  assert.equal(r.cashierAdd.error, 'forbidden'); assert.equal(r.cashierRemove.error, 'forbidden'); assert.equal(r.cashierStored, true, 'cashier changes nothing');
  assert.equal(r.threw.error, 'forbidden');
  assert.equal(r.removed.ok, true); assert.equal(r.lookupAfter, null); assert.equal(r.scanRemoved.ok, false);
  assert.equal(r.corrupt, 0); assert.equal(r.scanCorrupt.ok, false, 'corrupt storage: no crash, no match');
  assert.deepEqual(errors, [], 'page errors: ' + errors.join('; '));
  console.log('alt-barcodes PASS');
} finally {
  await browser.close();
  server.close();
}
