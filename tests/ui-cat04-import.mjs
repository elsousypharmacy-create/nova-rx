// N32 (CAT-04): local CSV/XLSX catalog import with column mapping, row-error preview, dry-run (no write until confirmed),
// deduplication by stable source key, STOCK LIVE untouched, and reversible committed imports (rollback).
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snap = JSON.parse(readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8'));
const stockItems = snap.items.slice(0, 80).map((r, i) => ({
  ...r,
  code: String(100000 + i),
  gtin: String(6221000100000 + i),
  namear: i === 0 ? 'بانادول أصلي من STOCK LIVE' : (r.namear || 'صنف أصلي ' + i),
  price: i === 0 ? 25.00 : (Number(r.price) || 15)
}));

const dir = mkdtempSync(join(tmpdir(), 'nova-cat04-'));
let n = 0;
const t = async (name, fn) => {
  try { await fn(); n++; console.log('  ok', name); }
  catch (e) { console.error('  FAIL', name, '\n   ', e && e.stack ? e.stack : e); process.exit(1); }
};

function buildDeflatedXlsx(rows) {
  const strings = [];
  const strIdx = s => { const k = String(s); let i = strings.indexOf(k); if (i < 0) { i = strings.length; strings.push(k); } return i; };
  const colLet = idx => String.fromCharCode(65 + idx);
  const xEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const rowsXml = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((c, ci) => {
    const ref = `${colLet(ci)}${ri + 1}`;
    if (typeof c === 'number') return `<c r="${ref}"><v>${c}</v></c>`;
    return `<c r="${ref}" t="s"><v>${strIdx(c)}</v></c>`;
  }).join('') + `</row>`).join('');
  const sstXml = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    strings.map(s => `<si><t>${xEsc(s)}</t></si>`).join('') + `</sst>`;
  const sheetXml = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
  const files = [['xl/sharedStrings.xml', sstXml], ['xl/worksheets/sheet1.xml', sheetXml]];
  const enc = new TextEncoder(), lParts = [], cParts = [];
  let off = 0;
  for (const [name, content] of files) {
    const nb = enc.encode(name), raw = enc.encode(content), comp = new Uint8Array(deflateRawSync(raw));
    const lh = new Uint8Array(30 + nb.length + comp.length), lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, 8, true);
    lv.setUint32(18, comp.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, nb.length, true);
    lh.set(nb, 30); lh.set(comp, 30 + nb.length); lParts.push(lh);
    const cd = new Uint8Array(46 + nb.length), cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(10, 8, true);
    cv.setUint32(20, comp.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, nb.length, true); cv.setUint32(42, off, true);
    cd.set(nb, 46); cParts.push(cd); off += lh.length;
  }
  const cdSz = cParts.reduce((s, p) => s + p.length, 0), eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cdSz, true); ev.setUint32(16, off, true);
  const out = new Uint8Array(off + cdSz + 22); let p = 0;
  for (const x of lParts) { out.set(x, p); p += x.length; }
  for (const x of cParts) { out.set(x, p); p += x.length; }
  out.set(eocd, p);
  return out;
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
await ctx.route('**/*', r => {
  const u = r.request().url();
  if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue();
  return r.abort();
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('**/emergency/stock.json', r => r.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ exportedAt: snap.exportedAt, items: stockItems })
}));
await page.addInitScript(() => {
  try {
    if (!sessionStorage.getItem('cat04_init')) {
      localStorage.clear();
      sessionStorage.setItem('cat04_init', '1');
    }
    localStorage.setItem('nova-rx-language', 'ar');
    localStorage.removeItem('nova.activePage');
  } catch {}
});

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE' && window.novaCatalogImport, null, { timeout: 8000 });
await page.locator('.nova-tab[data-page="products"]').click();

console.log('Running N32 CAT-04 catalog import UI checks...');

await t('CSV dry-run previews row errors and source-key duplicates without writing to catalog or touching STOCK LIVE', async () => {
  const csvContent = [
    'كود الصنف,اسم الصنف,الباركود,سعر البيع,شرائط بالعلبة,وحدات بالشريط,وحدات بالعلبة',
    '100000,محاولة الكتابة فوق STOCK LIVE,6221000100000,999.00,,,',      // row 2: duplicate of STOCK LIVE code 100000
    'CSV-501,كتافلام 50 مجم مستورد,6221000500501,48.50,2,10,20',        // row 3: valid 1
    'csv-٥٠١,كتافلام مكرر بنفس مفتاح المصدر,6221000500999,60.00,,,',    // row 4: duplicate sourceKey in file
    ',صنف بدون مفتاح مصدر,6221000500502,30.00,,,',                      // row 5: error source-key-missing
    'CSV-503,,6221000500503,30.00,,,',                                   // row 6: error name-missing
    'CSV-504,صنف بسعر غير صالح,6221000500504,-15,,,',                   // row 7: error price-invalid
    'CSV-505,صنف بباركود خاطئ,BADCODE,30.00,,,',                        // row 8: error barcode-invalid
    'CSV-506,صنف بعبوة غير متسقة,6221000500506,30.00,3,10,25',          // row 9: error packaging-inconsistent
    'CSV-502,نيكسيوم 40 مجم مستورد,6221000500502,120.00,,,'              // row 10: valid 2
  ].join('\n');

  const csvFile = join(dir, 'batch1.csv');
  writeFileSync(csvFile, csvContent, 'utf8');

  await page.locator('#novaCatalogImportBtn').click();
  await page.locator('#novaCatalogImportFile').setInputFiles(csvFile);
  await page.waitForTimeout(200);

  assert.equal(await page.locator('[data-import-stat="total"]').innerText(), '9');
  assert.equal(await page.locator('[data-import-stat="valid"]').innerText(), '2');
  assert.equal(await page.locator('[data-import-stat="duplicates"]').innerText(), '2');
  assert.equal(await page.locator('[data-import-stat="errors"]').innerText(), '5');

  // Verify row-error preview lists rows 5, 6, 7, 8, 9 with exact error codes
  const errCodes = await page.locator('#novaCatalogErrorPreview [data-error-row]').evaluateAll(
    trs => trs.map(tr => [Number(tr.dataset.errorRow), tr.querySelector('[data-error-codes]').dataset.errorCodes])
  );
  assert.deepEqual(errCodes, [
    [5, 'source-key-missing'],
    [6, 'name-missing'],
    [7, 'price-invalid'],
    [8, 'barcode-invalid'],
    [9, 'packaging-inconsistent']
  ]);

  // Verify duplicate preview lists row 2 (existing-stock-live) and row 4 (duplicate-in-file)
  const dupReasons = await page.locator('#novaCatalogDuplicatePreview [data-duplicate-row]').evaluateAll(
    trs => trs.map(tr => [Number(tr.dataset.duplicateRow), tr.querySelector('[data-duplicate-reason]').dataset.duplicateReason])
  );
  assert.deepEqual(dupReasons, [
    [2, 'existing-stock-live'],
    [4, 'duplicate-in-file']
  ]);

  // Dry run must NOT write anything before confirmation
  const stateBefore = await page.evaluate(() => ({
    len: window.NOVA_DEMO.products.length,
    source: window.novaCatalog.source,
    firstPrice: window.NOVA_DEMO.products[0].price,
    firstName: window.NOVA_DEMO.products[0].name,
    stored: localStorage.getItem('nova-rx-catalog-imports-v1')
  }));
  assert.equal(stateBefore.len, stockItems.length);
  assert.equal(stateBefore.source, 'STOCK LIVE');
  assert.equal(stateBefore.firstPrice, 25.00);
  assert.equal(stateBefore.firstName, 'بانادول أصلي من STOCK LIVE');
  assert.equal(stateBefore.stored, null);
});

await t('confirming commit writes only valid deduplicated rows, keeps STOCK LIVE untouched, and deduplicates re-imports', async () => {
  await page.locator('#novaCatalogCommitBtn').click();
  await page.waitForTimeout(200);

  const afterCommit = await page.evaluate(() => ({
    len: window.NOVA_DEMO.products.length,
    source: window.novaCatalog.source,
    stockLiveCount: window.novaCatalog.count,
    firstItem: window.NOVA_DEMO.products[0],
    imported: window.novaCatalogImport.getImportedItems(),
    foundPos: window.novaSearch.search('كتافلام 50').map(p => p.id)
  }));

  assert.equal(afterCommit.len, stockItems.length + 2);
  assert.equal(afterCommit.source, 'STOCK LIVE');
  assert.equal(afterCommit.stockLiveCount, stockItems.length);
  assert.equal(afterCommit.firstItem.price, 25.00);
  assert.equal(afterCommit.firstItem.name, 'بانادول أصلي من STOCK LIVE');
  assert.deepEqual(afterCommit.imported.map(x => x.id), ['CSV-501', 'CSV-502']);
  assert.ok(afterCommit.foundPos.includes('CSV-501'), 'imported item is searchable in POS');

  // Re-uploading the exact same CSV deduplicates all valid rows against existing-imported (validCount = 0)
  const csvFile = join(dir, 'batch1.csv');
  await page.locator('#novaCatalogImportFile').setInputFiles(csvFile);
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-import-stat="valid"]').innerText(), '0');
  assert.equal(await page.locator('[data-import-stat="duplicates"]').innerText(), '4');
  assert.equal(await page.locator('#novaCatalogCommitBtn').isDisabled(), true);
  await page.locator('#novaCatalogCancelBtn').click();
});

await t('XLSX import with custom column mapping and hostile text escaping works, and rollback reverses committed imports', async () => {
  const xlsxBytes = buildDeflatedXlsx([
    ['Col_Name', 'Col_Price', 'Col_SourceKey', 'Col_Barcode'],
    ['ألداكتون 100 مجم (XLSX)', 72.5, 'XLSX-801', '6221000800801'],
    ['<img src=x onerror="window.__xss=1">دواء آمن', 35, 'XLSX-802', '6221000800802']
  ]);
  const xlsxFile = join(dir, 'custom-cols.xlsx');
  writeFileSync(xlsxFile, xlsxBytes);

  await page.locator('#novaCatalogImportFile').setInputFiles(xlsxFile);
  await page.waitForTimeout(200);

  // Remap columns via UI dropdowns: Col_SourceKey (2), Col_Name (0), Col_Barcode (3), Col_Price (1)
  await page.locator('select[data-map-field="sourceKey"]').selectOption('2');
  await page.locator('select[data-map-field="name"]').selectOption('0');
  await page.locator('select[data-map-field="barcode"]').selectOption('3');
  await page.locator('select[data-map-field="price"]').selectOption('1');
  await page.waitForTimeout(150);

  assert.equal(await page.locator('[data-import-stat="valid"]').innerText(), '2');
  assert.equal(await page.locator('[data-import-stat="errors"]').innerText(), '0');

  // Still a dry run before clicking Confirm
  assert.equal(await page.evaluate(() => window.NOVA_DEMO.products.length), stockItems.length + 2);

  // Confirm XLSX import
  await page.locator('#novaCatalogCommitBtn').click();
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.NOVA_DEMO.products.length), stockItems.length + 4);
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'hostile markup in XLSX never executed');

  // Rollback the latest import (XLSX batch of 2 items)
  await page.locator('#novaCatalogRollbackBtn').click();
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.NOVA_DEMO.products.length), stockItems.length + 2);
  assert.deepEqual(await page.evaluate(() => window.novaCatalogImport.getImportedItems().map(x => x.id)), ['CSV-501', 'CSV-502']);

  // Rollback the remaining import (CSV batch of 2 items) -> restores exact STOCK LIVE catalog
  await page.locator('#novaCatalogRollbackBtn').click();
  await page.waitForTimeout(200);
  const finalState = await page.evaluate(() => ({
    len: window.NOVA_DEMO.products.length,
    importedLen: window.novaCatalogImport.getImportedItems().length,
    source: window.novaCatalog.source,
    firstName: window.NOVA_DEMO.products[0].name,
    firstPrice: window.NOVA_DEMO.products[0].price
  }));
  assert.equal(finalState.len, stockItems.length);
  assert.equal(finalState.importedLen, 0);
  assert.equal(finalState.source, 'STOCK LIVE');
  assert.equal(finalState.firstName, 'بانادول أصلي من STOCK LIVE');
  assert.equal(finalState.firstPrice, 25.00);
});

await t('no page errors', async () => assert.deepEqual(errors, []));

await ctx.close();
await browser.close();
console.log(`PASS N32 CAT-04 catalog import UI checks: ${n} cases`);
