// CAT-05 search: Arabic folding and barcode edge cases (N06). Own tiny catalog, no real data.
import assert from 'node:assert/strict';
import { createUnifiedCatalog } from '../../worker/catalog/unified-catalog.js';
import { createSearchIndex } from '../../worker/catalog/catalog-search.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok', name); };
console.log('catalog search Arabic folding and barcode checks (N06)');

const items = [
  { id: 'a1', nameAr: 'أسبرين', nameEn: 'ASPIRIN' },
  { id: 'a2', nameAr: 'إيبوبروفين', nameEn: 'IBUPROFEN' },
  { id: 'a3', nameAr: 'آمنة', nameEn: 'AMNA' },
  { id: 'tm', nameAr: 'كريمة الوجه', nameEn: 'FACE CREAM' },
  { id: 'hh', nameAr: 'مرهم عنايه', nameEn: 'CARE OINTMENT' },
  { id: 'ym', nameAr: 'دواء مستشفى', nameEn: 'HOSPITAL DRUG' },
  { id: 'am', nameAr: 'سلوى', nameEn: 'SALWA' },
  { id: 'd500', nameAr: 'قرص 500 مجم', nameEn: 'TAB 500' },
  { id: 'b1', nameAr: 'منتج ألف', nameEn: 'ITEM ALPHA', barcodes: ['6221000000017'] },
  { id: 'b2', nameAr: 'منتج باء 6221000000017', nameEn: 'ITEM BETA 6221000000017' },
  { id: '12345', nameAr: 'منتج كود', nameEn: 'ITEM CODE' },
];
const index = createSearchIndex(createUnifiedCatalog(items));
const ids = (q, o) => index.search(q, o).map(r => r.product.id);

t('alef forms أ إ آ ا all find each other', () => {
  for (const q of ['أسبرين', 'اسبرين', 'إسبرين', 'آسبرين']) assert.deepEqual(ids(q), ['a1'], q);
  for (const q of ['ايبوبروفين', 'إيبوبروفين', 'أيبوبروفين']) assert.deepEqual(ids(q), ['a2'], q);
  assert.deepEqual(ids('امنة'), ['a3']);
  assert.deepEqual(ids('آمنة'), ['a3']);
});
t('taa marbuta and haa are the same ending', () => {
  assert.deepEqual(ids('كريمه الوجه'), ['tm']);
  assert.deepEqual(ids('كريمة الوجه'), ['tm']);
  assert.deepEqual(ids('عنايه'), ['hh']);
  assert.deepEqual(ids('عناية'), ['hh']);
});
t('yaa and alef maqsura are the same letter', () => {
  assert.deepEqual(ids('مستشفي'), ['ym']);
  assert.deepEqual(ids('مستشفى'), ['ym']);
  assert.deepEqual(ids('سلوي'), ['am']);
  assert.deepEqual(ids('سلوى'), ['am']);
});
t('diacritics and tatweel are ignored', () => {
  assert.deepEqual(ids('أَسْبِرِين'), ['a1']);
  assert.deepEqual(ids('اســبرين'), ['a1']);
});
t('Arabic-Indic and Persian digits match whole numbers like Latin digits', () => {
  assert.deepEqual(ids('٥٠٠'), ['d500']);
  assert.deepEqual(ids('۵۰۰'), ['d500']);
  assert.deepEqual(ids('500'), ['d500']);
  assert.deepEqual(ids('قرص ٥٠٠'), ['d500']);
  assert.deepEqual(ids('٥٠'), [], 'partial number never matches');
});
t('exact barcode wins, in Latin and Arabic-Indic digits, and is returned alone', () => {
  for (const q of ['6221000000017', '٦٢٢١٠٠٠٠٠٠٠١٧', ' 6221000000017 ']) {
    const r = index.search(q);
    assert.deepEqual(r.map(x => x.product.id), ['b1'], q);
    assert.equal(r[0].reason, 'barcode');
  }
});
t('unknown barcode-shaped number returns nothing, not a fuzzy guess', () => {
  assert.deepEqual(ids('6221000000999'), []);
  assert.deepEqual(ids('٦٢٢١٠٠٠٠٠٠٩٩٩'), []);
});
t('product code is exact, also in Arabic-Indic digits', () => {
  assert.deepEqual(ids('12345'), ['12345']);
  assert.deepEqual(ids('١٢٣٤٥'), ['12345']);
  assert.equal(index.search('12345')[0].reason, 'code');
});
t('empty, whitespace and non-string queries are empty', () => {
  for (const q of ['', '   ', null, undefined, 5]) assert.deepEqual(index.search(q), []);
});

console.log(`${n} passed`);
