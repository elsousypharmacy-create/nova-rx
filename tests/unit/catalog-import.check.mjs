// CAT-04 unit checks: CSV/XLSX parsing, column mapping, row-error preview, dry-run (no write until confirmed),
// deduplication by stable source key, STOCK LIVE untouched, and reversible committed imports (rollback).
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  buildXlsxBytes,
  createCatalogImporter,
  guessColumnMapping,
  normalizeSourceKey,
  parseCsv,
  parseXlsx
} from '../../worker/catalog/catalog-import.js';

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok', name);
  } catch (e) {
    console.error('  FAIL', name, '\n   ', e && e.stack ? e.stack : e);
    process.exit(1);
  }
}

function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k)
  };
}

// Helper to build a deflated (method 8) XLSX with sharedStrings.xml and sparse cells
function buildDeflatedSharedStringsXlsx() {
  const files = [
    ['xl/sharedStrings.xml', '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>كود الصنف</t></si><si><t>اسم الصنف</t></si><si><t>الباركود</t></si><si><t>سعر الجمهور</t></si><si><t>بانادول أدفانس 500 مجم</t></si><si><t>أوميبرازول 20 مجم</t></si></sst>'],
    ['xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>X-101</t></is></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="inlineStr"><is><t>6221000099101</t></is></c><c r="D2"><v>45.5</v></c></row>' +
      '<row r="3"><c r="A3" t="inlineStr"><is><t>X-102</t></is></c><c r="B3" t="s"><v>5</v></c><c r="D3"><v>60</v></c></row>' + // sparse row: C3 omitted!
      '</sheetData></worksheet>']
  ];
  const enc = new TextEncoder();
  const localParts = [];
  const cdParts = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = enc.encode(name);
    const rawBytes = enc.encode(content);
    const compBytes = new Uint8Array(deflateRawSync(rawBytes));
    const lh = new Uint8Array(30 + nameBytes.length + compBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 8, true); // method 8 = deflate-raw
    lv.setUint32(18, compBytes.length, true);
    lv.setUint32(22, rawBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);
    lh.set(compBytes, 30 + nameBytes.length);
    localParts.push(lh);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, compBytes.length, true);
    cv.setUint32(24, rawBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    cdParts.push(cd);
    offset += lh.length;
  }
  const cdSize = cdParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let pos = 0;
  for (const p of localParts) { out.set(p, pos); pos += p.length; }
  for (const p of cdParts) { out.set(p, pos); pos += p.length; }
  out.set(eocd, pos);
  return out;
}

await test('CSV parser handles UTF-8 BOM, quoted commas/quotes, semicolon and tab delimiters, and rejects malformed files', () => {
  const csv = '\uFEFFcode,name,price,pack\r\n"IMP-01","بانادول, ""إكسترا"" 500 مجم",32.50,"24 قرص"\r\nIMP-02,كونكور 5 مجم,45,30 قرص\r\n\r\n';
  const res = parseCsv(csv, 'items.csv');
  assert.equal(res.ok, true);
  assert.deepEqual(res.headers, ['code', 'name', 'price', 'pack']);
  assert.equal(res.rows.length, 2);
  assert.equal(res.rows[0].rowNumber, 2);
  assert.equal(res.rows[0].values[1], 'بانادول, "إكسترا" 500 مجم');

  const semi = parseCsv('الكود;الصنف;السعر\n101;فيتامين سي;20');
  assert.equal(semi.ok, true);
  assert.equal(semi.rows[0].values[1], 'فيتامين سي');

  assert.equal(parseCsv('').ok, false);
  assert.equal(parseCsv('code,name,price\n').error, 'empty-file');
  assert.equal(parseCsv('code,name\n"unclosed,val').error, 'unclosed-quote');
});

await test('XLSX parser handles both stored inlineStr XLSX and deflated sharedStrings XLSX with sparse cells', async () => {
  const storedBytes = buildXlsxBytes([
    ['كود', 'الاسم', 'الباركود', 'السعر'],
    ['S-01', 'جافيسكون شراب', '6221000011111', 55.25],
    ['S-02', 'زيرتك 10 مجم', '6221000022222', 40]
  ]);
  const p1 = await parseXlsx(storedBytes, 'stored.xlsx');
  assert.equal(p1.ok, true);
  assert.deepEqual(p1.headers, ['كود', 'الاسم', 'الباركود', 'السعر']);
  assert.equal(p1.rows.length, 2);
  assert.deepEqual(p1.rows[0].values, ['S-01', 'جافيسكون شراب', '6221000011111', '55.25']);

  const deflatedBytes = buildDeflatedSharedStringsXlsx();
  const p2 = await parseXlsx(deflatedBytes, 'deflated.xlsx');
  assert.equal(p2.ok, true);
  assert.deepEqual(p2.headers, ['كود الصنف', 'اسم الصنف', 'الباركود', 'سعر الجمهور']);
  assert.equal(p2.rows.length, 2);
  assert.deepEqual(p2.rows[0].values, ['X-101', 'بانادول أدفانس 500 مجم', '6221000099101', '45.5']);
  // Sparse row 3 where C3 was omitted must align D3 ('60') at index 3, with '' at index 2
  assert.deepEqual(p2.rows[1].values, ['X-102', 'أوميبرازول 20 مجم', '', '60']);

  const bad = await parseXlsx(new Uint8Array([1, 2, 3, 4]), 'bad.xlsx');
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'invalid-xlsx');
});

await test('column mapping auto-detects Arabic/English headers and supports custom column remapping', () => {
  const auto = guessColumnMapping(['مفتاح المصدر', 'اسم الدواء', 'الباركود', 'سعر البيع', 'شرائط بالعلبة', 'وحدات بالشريط']);
  assert.equal(auto.sourceKey, 0);
  assert.equal(auto.name, 1);
  assert.equal(auto.barcode, 2);
  assert.equal(auto.price, 3);
  assert.equal(auto.stripsPerBox, 4);
  assert.equal(auto.unitsPerStrip, 5);

  const imp = createCatalogImporter();
  const sheet = parseCsv('ColA,ColB,ColC\nMy Drug,75.50,KEY-900');
  const dryCustom = imp.dryRun(sheet, { sourceKey: 2, name: 0, price: 1 });
  assert.equal(dryCustom.ok, true);
  assert.equal(dryCustom.validCount, 1);
  assert.equal(dryCustom.toImport[0].id, 'KEY-900');
  assert.equal(dryCustom.toImport[0].name, 'My Drug');
  assert.equal(dryCustom.toImport[0].price, 75.5);
});

await test('row-error preview flags missing source key, missing name, invalid price, invalid barcode, and inconsistent packaging', () => {
  const imp = createCatalogImporter();
  const csv = [
    'code,name,barcode,price,stripsPerBox,unitsPerStrip,unitsPerBox',
    ',صنف بدون كود,6221000000001,25,,,',
    'K-2,,6221000000002,25,,,',
    'K-3,صنف بسعر سالب,6221000000003,-10,,,',
    'K-4,صنف بباركود خاطئ,ABC12345,25,,,',
    'K-5,صنف بعبوة غير متسقة,6221000000005,25,3,10,25',
    'K-6,صنف سليم تماما,6221000000006,30,3,10,30'
  ].join('\n');
  const dry = imp.dryRun(csv);
  assert.equal(dry.ok, true);
  assert.equal(dry.totalRows, 6);
  assert.equal(dry.validCount, 1);
  assert.equal(dry.errorCount, 5);
  assert.deepEqual(dry.rowErrors.map(r => [r.rowNumber, r.errors[0]]), [
    [2, 'source-key-missing'],
    [3, 'name-missing'],
    [4, 'price-invalid'],
    [5, 'barcode-invalid'],
    [6, 'packaging-inconsistent']
  ]);
});

await test('dry run does not write until confirmed; deduplicates by stable source key; keeps STOCK LIVE untouched; rollback reverses commit', () => {
  const stockLive = [
    { id: '1001', code: '1001', barcode: '6221000001001', name: 'بانادول أصلي من STOCK LIVE', price: 18.00, real: true },
    { id: '1002', code: '1002', barcode: '6221000001002', name: 'أوجمنتين أصلي من STOCK LIVE', price: 89.00, real: true }
  ];
  const storage = makeMemoryStorage();
  const imp = createCatalogImporter({ stockLiveItems: stockLive, storage });

  const csv = [
    'code,name,barcode,price',
    '1001,محاولة تعديل صنف STOCK LIVE,6221000001001,999.00', // duplicate of STOCK LIVE code
    '9999,محاولة باركود STOCK LIVE,6221000001002,888.00',   // duplicate of STOCK LIVE barcode
    'NEW-01,دواء مستورد أول,6221000090001,42.50',           // valid new 1
    'new-٠١,تكرار نفس مفتاح المصدر في الملف,6221000090099,50.00', // duplicate source key in file (Arabic digits + case)
    'NEW-02,دواء مستورد ثاني,6221000090002,65.00'           // valid new 2
  ].join('\n');

  const dry = imp.dryRun(csv);
  assert.equal(dry.ok, true);
  assert.equal(dry.validCount, 2);
  assert.equal(dry.duplicateCount, 3);
  assert.deepEqual(dry.duplicates.map(d => [d.rowNumber, d.reason]), [
    [2, 'existing-stock-live'],
    [3, 'existing-stock-live'],
    [5, 'duplicate-in-file']
  ]);

  // Dry run must NOT write anything
  assert.equal(imp.getCatalog().length, 2);
  assert.equal(imp.getImportedItems().length, 0);
  assert.equal(storage.getItem('nova-rx-catalog-imports-v1'), null);

  // Unconfirmed commit is refused
  const unconfirmed = imp.commit(dry, { confirmed: false });
  assert.equal(unconfirmed.ok, false);
  assert.equal(unconfirmed.error, 'confirmation-required');
  assert.equal(imp.getCatalog().length, 2);

  // Confirmed commit writes the 2 new items and leaves STOCK LIVE untouched
  const committed = imp.commit(dry, { confirmed: true, fileName: 'batch1.csv' });
  assert.equal(committed.ok, true);
  assert.equal(committed.importedCount, 2);
  assert.equal(imp.getCatalog().length, 4);
  assert.deepEqual(imp.getStockLive(), stockLive);
  assert.equal(imp.getCatalog()[0].price, 18.00);
  assert.equal(imp.getCatalog()[0].name, 'بانادول أصلي من STOCK LIVE');

  // Re-running dryRun or commit on the same file deduplicates against committed imports
  const dryAgain = imp.dryRun(csv);
  assert.equal(dryAgain.validCount, 0);
  assert.equal(dryAgain.duplicateCount, 5);
  assert.equal(imp.commit(dryAgain, { confirmed: true }).error, 'nothing-to-import');

  // Rollback reverses the committed import and restores exact STOCK LIVE state
  const rolledBack = imp.rollback(committed.batch.id);
  assert.equal(rolledBack.ok, true);
  assert.equal(rolledBack.removedCount, 2);
  assert.equal(imp.getImportedItems().length, 0);
  assert.deepEqual(imp.getCatalog(), stockLive);
  assert.deepEqual(imp.getStockLive(), stockLive);
});

await test('normalizeSourceKey normalizes Arabic/Persian digits, case, and whitespace', () => {
  assert.equal(normalizeSourceKey('  IMP-٠٠١٢  '), 'imp-0012');
  assert.equal(normalizeSourceKey('۱۲۳۴۵'), '12345');
});

console.log(`PASS catalog-import unit checks: ${passed} cases`);
