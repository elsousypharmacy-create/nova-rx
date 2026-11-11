import assert from 'node:assert/strict';
import { sanitizeCatalogText, normalizeArabicSearchKey, normalizeBarcode, normalizeProductRecord, createUnifiedCatalog } from '../../worker/catalog/unified-catalog.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok', name); };
console.log('unified-catalog core checks (CAT-01)');

t('text is sanitized', () => assert.equal(sanitizeCatalogText('  Panadol \n  Extra\t'), 'Panadol Extra'));

t('Arabic search key folds diacritics, alef/ya/ta marbuta, tatweel and Arabic-Indic digits', () => {
  assert.equal(normalizeArabicSearchKey('أُسبِرين ٥٠٠ مجـم'), normalizeArabicSearchKey('اسبرين 500 مجم'));
  assert.equal(normalizeArabicSearchKey('مُضاد حيوي'), 'مضاد حيوي');
  assert.equal(normalizeArabicSearchKey('كريمة'), normalizeArabicSearchKey('كريمه'));
});

t('barcode: digits only, Arabic-Indic converted, separators removed, letters rejected (not stripped)', () => {
  assert.equal(normalizeBarcode(' 6221-0010 0201 '), '622100100201');
  assert.equal(normalizeBarcode('٦٢٢١٠٠١٠٠٢٠١'), '622100100201');
  assert.equal(normalizeBarcode('AB12345678'), null, 'letters must not be silently stripped');
  assert.equal(normalizeBarcode('123'), null, 'too short to be a barcode');
  assert.equal(normalizeBarcode(''), null);
  assert.equal(normalizeBarcode(null), null);
});

t('record keeps Arabic and English names, several barcodes, ingredient, strength, form, pack size, category', () => {
  const r = normalizeProductRecord({ code: '30018658', namear: 'جافيسكون ليكويد 250مل', nameen: 'GAVISCON LIQUID 250ML', barcodes: ['5000158100000', '٥٠٠٠١٥٨١٠٠٠٠٠', '5000158100017'], activeIngredient: 'Sodium alginate', strength: '250 mg/5ml', form: 'suspension', packSize: 1, category: 'GI', price: 144 });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const p = r.product;
  assert.equal(p.id, '30018658');
  assert.equal(p.nameAr, 'جافيسكون ليكويد 250مل');
  assert.equal(p.nameEn, 'GAVISCON LIQUID 250ML');
  assert.deepEqual(p.barcodes, ['5000158100000', '5000158100017'], 'deduplicated, order kept');
  assert.equal(p.activeIngredient, 'Sodium alginate');
  assert.equal(p.strength, '250 mg/5ml');
  assert.equal(p.form, 'suspension');
  assert.equal(p.packSize, 1);
  assert.equal(p.category, 'GI');
  assert.equal(p.price, 144);
});

t('legacy fields still work: gtin, single barcode, name in either language', () => {
  assert.deepEqual(normalizeProductRecord({ id: 'a', name: 'Panadol Extra', barcode: '12345678' }).product.barcodes, ['12345678']);
  assert.deepEqual(normalizeProductRecord({ id: 'a', name: 'بنادول', gtin: '6221001002013' }).product.barcodes, ['6221001002013']);
  assert.equal(normalizeProductRecord({ id: 'a', name: 'Panadol' }).product.nameEn, 'Panadol');
  assert.equal(normalizeProductRecord({ id: 'a', name: 'بنادول' }).product.nameAr, 'بنادول');
});

t('invalid data is rejected with a reason, never defaulted', () => {
  const bad = (rec, code) => { const r = normalizeProductRecord(rec); assert.equal(r.ok, false, code); assert.ok(r.errors.includes(code), `${code} in ${r.errors}`); };
  bad({ name: 'x' }, 'id-missing');
  bad({ id: '1' }, 'name-missing');
  bad({ id: '1', name: 'x', price: 'abc' }, 'price-invalid');
  bad({ id: '1', name: 'x', price: -5 }, 'price-invalid');
  bad({ id: '1', name: 'x', packSize: 0 }, 'packSize-invalid');
  bad({ id: '1', name: 'x', packSize: -2 }, 'packSize-invalid');
  bad({ id: '1', name: 'x', packSize: 'many' }, 'packSize-invalid');
  bad({ id: '1', name: 'x', barcode: 'AB12345678' }, 'barcode-invalid');
  assert.equal(normalizeProductRecord(null).ok, false);
  assert.equal(normalizeProductRecord('text').ok, false);
});

t('missing price stays null (not 0); missing pack size defaults to 1', () => {
  const p = normalizeProductRecord({ id: '1', name: 'x' }).product;
  assert.equal(p.price, null);
  assert.equal(p.packSize, 1);
});

t('catalog add refuses a duplicate id or barcode instead of overwriting', () => {
  const c = createUnifiedCatalog();
  const first = c.add({ id: '1', name: 'Panadol', barcode: '12345678' });
  assert.equal(first.ok, true);
  assert.ok(first.product.id);
  const sameId = c.add({ id: '1', name: 'Other', barcode: '87654321' });
  assert.equal(sameId.ok, false); assert.equal(sameId.reason, 'duplicate-id');
  const sameBarcode = c.add({ id: '2', name: 'Other', barcode: '12345678' });
  assert.equal(sameBarcode.ok, false); assert.equal(sameBarcode.reason, 'duplicate-barcode');
  assert.equal(c.findByBarcode('12345678').id, '1', 'original mapping untouched');
  assert.equal(c.getAll().length, 1);
});

t('bulk load reports rejected rows instead of dropping them silently', () => {
  const c = createUnifiedCatalog([{ id: '1', name: 'ok' }, { name: 'no id' }, { id: '3', name: 'bad', price: 'x' }]);
  assert.equal(c.getAll().length, 1);
  assert.equal(c.rejected.length, 2);
  assert.deepEqual(c.rejected.map(r => r.index), [1, 2]);
});

t('search: Arabic folding, both languages, ingredient, token AND, barcode', () => {
  const c = createUnifiedCatalog([
    { id: '1', nameAr: 'أسبرين ٥٠٠ مجم', nameEn: 'ASPIRIN 500MG', activeIngredient: 'Acetylsalicylic acid', barcode: '6221000000017' },
    { id: '2', nameAr: 'بنادول اكسترا', nameEn: 'PANADOL EXTRA', barcode: '6221000000024' },
  ]);
  assert.deepEqual(c.search('اسبرين 500').map(p => p.id), ['1']);
  assert.deepEqual(c.search('panadol').map(p => p.id), ['2']);
  assert.deepEqual(c.search('acetylsalicylic').map(p => p.id), ['1']);
  assert.deepEqual(c.search('بنادول 500').map(p => p.id), [], 'every token must match');
  assert.deepEqual(c.search('6221000000024').map(p => p.id), ['2']);
  assert.deepEqual(c.search('zzz').map(p => p.id), []);
});

t('products are frozen so callers cannot corrupt the indexes', () => {
  const c = createUnifiedCatalog([{ id: '1', name: 'x', barcode: '12345678' }]);
  const p = c.findById('1');
  assert.throws(() => { 'use strict'; p.id = '9'; }, TypeError);
  assert.throws(() => { 'use strict'; p.barcodes.push('11111111'); }, TypeError);
});

t('price and pack size: strict decimals, blank means unknown, never 0 by accident (review finding)', () => {
  const price = v => normalizeProductRecord({ id: '1', name: 'x', price: v });
  for (const blank of ['', '  ', '\t\n']) { const r = price(blank); assert.equal(r.ok, true); assert.equal(r.product.price, null, JSON.stringify(blank)); }
  for (const bad of ['0x10', '1e3', '12abc', '--5', '-5', '1.2.3', '1,25', '1,2500', [], {}, true, '٫', 'Infinity', 'NaN']) assert.ok(price(bad).errors.includes('price-invalid'), `${JSON.stringify(bad)} must be rejected`);
  assert.equal(price('1,250.50').product.price, 1250.5);
  assert.equal(price('٣٥٫٧٥').product.price, 35.75, 'Arabic digits and Arabic decimal separator');
  assert.equal(price('٣٬٠٠٠').product.price, 3000, 'Arabic thousands separator');
  assert.equal(price(0).product.price, 0, 'a real 0 stays 0');
  assert.equal(price('0').product.price, 0);
  const pack = v => normalizeProductRecord({ id: '1', name: 'x', packSize: v });
  for (const bad of ['0x10', '1e1', '0', '-3', [], true, 'abc']) assert.ok(pack(bad).errors.includes('packSize-invalid'), `${JSON.stringify(bad)} must be rejected`);
  assert.equal(pack('٢٤').product.packSize, 24);
  assert.equal(pack(' ').product.packSize, 1, 'blank pack size = not given');
});

t('inactive flags from imports: false, 0, "false", "0", "no", "inactive" deactivate; anything else stays active', () => {
  for (const v of [false, 0, 'false', 'FALSE', '0', 'no', 'inactive']) assert.equal(normalizeProductRecord({ id: '1', name: 'x', active: v }).product.active, false, String(v));
  for (const v of [true, 1, 'true', undefined, 'yes', '']) assert.equal(normalizeProductRecord({ id: '1', name: 'x', active: v }).product.active, true, String(v));
});

t('search finds an id typed with Arabic-Indic digits', () => {
  const c = createUnifiedCatalog([{ id: '123', name: 'x' }]);
  assert.deepEqual(c.search('١٢٣').map(p => p.id), ['123']);
});

t('rejected rows cannot be edited from outside', () => {
  const c = createUnifiedCatalog([{ name: 'no id' }]);
  assert.equal(c.rejected.length, 1);
  assert.throws(() => { c.rejected.length = 0; }, TypeError);
  assert.throws(() => c.rejected.push({}), TypeError);
  assert.throws(() => { c.rejected[0].errors.push('x'); }, TypeError);
  assert.equal(c.rejected.length, 1);
});

console.log(`PASS unified-catalog core checks (CAT-01): ${n} cases`);
