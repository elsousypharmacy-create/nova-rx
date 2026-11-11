// U1-0: browser catalog layer. Unit part on the real export; browser part serves the repo statically and runs the module in Chromium.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { buildBrowserCatalog, toSaleProduct, loadNovaCatalog } from '../../catalog-browser.js';

let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok -', name); };
const root = new URL('../../', import.meta.url).pathname;
const items = JSON.parse(fs.readFileSync(path.join(root, 'data/emergency-stock.json'), 'utf8')).items;
const cat = buildBrowserCatalog(items);

await t('all valid rows load; rejected are counted, not hidden', () => {
  assert.equal(cat.size + cat.rejected, items.length);
  assert.ok(cat.size > 4000, `size ${cat.size}`);
});
await t('sale-screen shape: price number, name has Arabic, stock number or null', () => {
  const p = cat.byId(items[0].code);
  assert.equal(p.id, items[0].code); assert.equal(typeof p.price, 'number'); assert.equal(p.price, items[0].price);
  assert.equal(p.stock, items[0].units);
  for (const q of cat.products().slice(0, 500)) assert.ok(q.stock === null || Number.isFinite(q.stock));
});
await t('stock is null when the export has no units (never invented as 0)', () => {
  const noUnits = items.find(i => typeof i.units !== 'number');
  assert.ok(noUnits, 'export has rows without units');
  assert.equal(cat.byId(noUnits.code)?.stock ?? null, null);
});
await t('Arabic search returns sale-shaped products; barcode lookup is exact', () => {
  const r = cat.search('ديكلوبرو');
  assert.ok(r.length >= 1 && r.every(x => typeof x.name === 'string'));
  const withBc = cat.products().find(p => p.barcode);
  if (withBc) assert.equal(cat.byBarcode(withBc.barcode).id, withBc.id);
  assert.equal(cat.byBarcode('0000000000000'), null);
});
await t('toSaleProduct: bilingual name joined, single-language kept', () => {
  const base = { id: 'x', barcodes: [], price: 5, activeIngredient: '', form: '', category: '', active: true };
  assert.equal(toSaleProduct({ ...base, nameAr: 'بنادول', nameEn: 'Panadol' }, new Map()).name, 'بنادول (Panadol)');
  assert.equal(toSaleProduct({ ...base, nameAr: 'بنادول', nameEn: '' }, new Map()).name, 'بنادول');
});
await t('barcode lookup works on rows that carry a barcode (fixture; the export itself has none)', () => {
  const c = buildBrowserCatalog([{ code: 'A1', namear: 'بنادول', nameen: 'Panadol', price: '12.50', barcode: '6221000000017', units: 3 }]);
  const p = c.byBarcode('6221000000017');
  assert.equal(p.id, 'A1'); assert.equal(p.barcode, '6221000000017'); assert.equal(p.price, 12.5); assert.equal(p.stock, 3);
});
await t('loadNovaCatalog fails closed on HTTP errors', async () => {
  await assert.rejects(loadNovaCatalog(async () => ({ ok: false, status: 503 })), /snapshot-http-503/);
});

// ---- real browser ----
const { chromium } = await import('playwright');
const mime = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
fs.writeFileSync(path.join(root, '.u1-0-probe.html'), '<!doctype html><meta charset="utf-8"><script type="module" src="catalog-browser.js"></script>');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${base}/.u1-0-probe.html`);
  await page.evaluate(() => window.NovaCatalog.whenReady);
  const out = await page.evaluate(q => ({ ready: window.NovaCatalog.ready, err: window.NovaCatalog.error, hits: window.NovaCatalog.search(q).length, total: window.NovaCatalog.products().length }), 'ديكلوبرو');
  await t('browser: module loads the snapshot and searches', () => {
    assert.deepEqual(errors, []); assert.equal(out.ready, true); assert.equal(out.err, null);
    assert.ok(out.hits >= 1); assert.equal(out.total, cat.size);
  });
  const page2 = await browser.newPage();
  await page2.route('**/data/emergency-stock.json', r => r.fulfill({ status: 500, body: 'x' }));
  await page2.goto(`${base}/.u1-0-probe.html`);
  const bad = await page2.evaluate(async () => { await window.NovaCatalog.whenReady; return { ready: window.NovaCatalog.ready, err: window.NovaCatalog.error, hits: window.NovaCatalog.search('x').length }; });
  await t('browser: snapshot failure leaves ready=false with an error and empty results (screen falls back to demo)', () => {
    assert.equal(bad.ready, false); assert.equal(bad.err, 'snapshot-http-500'); assert.equal(bad.hits, 0);
  });
} finally { await browser.close(); server.close(); fs.rmSync(path.join(root, '.u1-0-probe.html'), { force: true }); }
console.log(`${n} passed`);
