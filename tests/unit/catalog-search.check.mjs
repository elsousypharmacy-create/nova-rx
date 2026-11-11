import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createUnifiedCatalog } from '../../worker/catalog/unified-catalog.js';
import { createSearchIndex } from '../../worker/catalog/catalog-search.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok', name); };
console.log('catalog search checks (CAT-05)');

const items = [
  { id: 'p500', nameAr: 'بانادول 500 مجم', nameEn: 'PANADOL 500MG', strength: '500 mg', form: 'tablet', packSize: 24, barcodes: ['6221000000017'], packaging: { unitsPerBox: 24 } },
  { id: 'p1000', nameAr: 'بانادول 1000 مجم', nameEn: 'PANADOL 1000MG', strength: '1000 mg', form: 'tablet', packSize: 12, barcode: '6221000000024' },
  { id: 'p1500', nameAr: 'دواء 1500', nameEn: 'DRUG 1500' },
  { id: 'pex', nameAr: 'بانادول اكسترا', nameEn: 'PANADOL EXTRA', packSize: 24, barcode: '6221000000031' },
  { id: 'psyr', nameAr: 'بانادول شراب', nameEn: 'PANADOL SYRUP', form: 'syrup', barcode: '6221000000048' },
  { id: 'gav', nameAr: 'جافيسكون ليكويد', nameEn: 'GAVISCON LIQUID', activeIngredient: 'Sodium alginate' },
  { id: 'asp', nameAr: 'أسبرين', nameEn: 'ASPIRIN' },
  { id: 'old', nameAr: 'ابتدائي بانادول', nameEn: 'ALPHA PANADOL OLD', active: false },
  { id: 'caf', nameAr: 'كريمة الوجه', nameEn: 'FACE CREAM' },
  { id: '٧٧٠٠١', nameAr: 'كود عربي', nameEn: 'ARABIC CODE ITEM' },
  { id: 'zc', nameAr: 'زيرتك', nameEn: 'ZYRTEC' }, { id: 'zs', nameAr: 'زيرتس', nameEn: 'ZYRTES' },
  { id: 'cA', nameAr: 'مضاد', nameEn: 'ZED COUGH SYRUP' }, { id: 'cB', nameAr: 'كحه', nameEn: 'COUGH FOR SYRUP' },
  { id: 'tX', nameAr: 'مقوي أ', nameEn: 'TONIC A 100' }, { id: 'tY', nameAr: 'مقوي ب', nameEn: 'TONIC B', strength: '100 mg' },
  { id: 'sX', nameAr: 'صابون أ', nameEn: 'SOAP BAR 12' }, { id: 'sY', nameAr: 'صابون ب', nameEn: 'SOAP Z', packSize: 12 },
  { id: 'hm', nameAr: 'رئس', nameEn: 'HAMZA ONE' }, { id: 'hw', nameAr: 'مؤن', nameEn: 'HAMZA TWO' },
  { id: 'old2', nameAr: 'بانادول', nameEn: 'PANADOL', active: false },
  { id: 'cr1', nameAr: 'ا عنايه', nameEn: 'AAA CARE CAREFUL' }, { id: 'cr2', nameAr: 'ي حذر', nameEn: 'ZZZ CARE' },
  { id: 'ref', nameAr: 'مرجع', nameEn: 'REF 12345678' },
];
const catalog = createUnifiedCatalog(items);
assert.equal(catalog.rejected.length, 0, JSON.stringify(catalog.rejected));
const idx = createSearchIndex(catalog);
const ids = (q, o) => idx.search(q, o).map(r => r.product.id);

t('exact, prefix and phrase: the closest name ranks first', () => {
  assert.equal(ids('panadol extra')[0], 'pex');
  assert.equal(ids('panad').includes('pex'), true);
  assert.equal(ids('gavis')[0], 'gav');
  assert.deepEqual(ids('face cream'), ['caf']);
  assert.deepEqual(ids('aspirin'), ['asp']);
});

t('Arabic is folded: alef/hamza, ta marbuta, ya, diacritics, Arabic digits', () => {
  assert.deepEqual(ids('اسبرين'), ['asp']); assert.deepEqual(ids('أسبِرِين'), ['asp']);
  assert.deepEqual(ids('كريمه الوجه'), ['caf']); assert.deepEqual(ids('كريمة'), ['caf']);
  assert.equal(ids('بانادول ٥٠٠')[0], 'p500');
  assert.equal(ids('جافيسكو')[0], 'gav');
});

t('typos: one edit on a 4+ letter word, two on 8+, a swap counts as one; short words and numbers are not fuzzy', () => {
  assert.equal(ids('panadool')[0] !== undefined, true); assert.ok(ids('panadool').includes('pex'));
  assert.ok(ids('gaviscn').includes('gav')); assert.ok(ids('gavsicon').includes('gav'));
  assert.ok(ids('aspirn').includes('asp')); assert.ok(ids('apsirin').includes('asp'));
  assert.ok(ids('gaviscoon liqud').includes('gav'), 'two typos in two words');
  assert.deepEqual(ids('asx'), [], 'three-letter words are not fuzzy');
  assert.deepEqual(ids('pxnadol zzz'), [], 'every word must match something');
  assert.ok(!ids('5000').includes('p500'), 'numbers are never fuzzy');
});

t('numbers match whole numbers only: 500 does not find 1500, and 500mg / مجم500 split correctly', () => {
  assert.ok(ids('500').includes('p500')); assert.ok(!ids('500').includes('p1500')); assert.ok(!ids('500').includes('p1000'));
  assert.deepEqual(ids('1500'), ['p1500']);
  assert.ok(ids('500mg').includes('p500')); assert.ok(!ids('500mg').includes('p1500'));
  assert.deepEqual(ids('50'), [], 'a number is not a prefix of another number');
});

t('strength and pack distinguish products with the same name', () => {
  assert.equal(ids('panadol 500')[0], 'p500'); assert.equal(ids('panadol 1000')[0], 'p1000');
  assert.ok(ids('panadol 500').indexOf('p1000') === -1, 'the other strength is not a match');
  assert.equal(ids('panadol 24')[0] === 'p500' || ids('panadol 24')[0] === 'pex', true, 'the 24-unit packs come first');
  assert.ok(ids('panadol 24').includes('p500') && ids('panadol 24').includes('pex'));
  assert.equal(ids('panadol syrup')[0], 'psyr'); assert.equal(ids('بانادول شراب')[0], 'psyr');
  assert.equal(ids('sodium alginate')[0], 'gav', 'active ingredient is searchable');
});

t('barcode: exact match, separators and Arabic digits normalised, unknown barcode finds nothing', () => {
  assert.deepEqual(ids('6221000000024'), ['p1000']); assert.deepEqual(ids('6221-0000-00024'), ['p1000']);
  assert.deepEqual(ids('٦٢٢١٠٠٠٠٠٠٠١٧'), ['p500']);
  assert.deepEqual(ids('6221000000099'), []);
  assert.deepEqual(ids('62210000'), [], 'a prefix of a barcode is not a barcode');
  assert.equal(idx.search('6221000000031')[0].reason, 'barcode');
});

t('product code: exact match, also typed with Arabic digits', () => {
  assert.deepEqual(ids('p500'), ['p500']);
  assert.deepEqual(ids('٧٧٠٠١'), ['٧٧٠٠١']); assert.deepEqual(ids('77001'), ['٧٧٠٠١'], 'digits are folded on both sides, so either spelling finds it');
  assert.deepEqual(ids('P500'), ['p500'], 'codes are case-insensitive');
});

t('empty, blank and garbage queries return nothing; inactive products come last; the limit is respected', () => {
  for (const q of ['', '   ', null, undefined, '!!!', '؟؟؟', 12, {}, []]) assert.deepEqual(idx.search(q), [], String(q));
  const res = idx.search('panadol'); assert.ok(res.length >= 6);
  const firstInactive = res.findIndex(x => x.product.active === false);
  assert.ok(firstInactive > 0 && res.slice(firstInactive).every(x => x.product.active === false), 'every inactive product comes after every active one');
  assert.ok(res.slice(0, firstInactive).every(x => x.product.active !== false));
  assert.notEqual(res[0].product.id, 'old2', 'an inactive exact-name product does not outrank active ones');
  const r = res.map(x => x.product.id); assert.ok(r.includes('old') && r.includes('old2'));
  assert.equal(ids('panadol', { limit: 2 }).length, 2); assert.ok(ids('panadol', { limit: 0 }).length >= 1); assert.ok(ids('panadol', { limit: 10000 }).length <= 100);
  assert.deepEqual(ids('panadol'), ids('panadol'), 'deterministic');
});

t('the index is a snapshot: refresh() picks up additions and merges', () => {
  const c = createUnifiedCatalog([{ id: 'a1', nameAr: 'فيتامين سي', nameEn: 'VITAMIN C' }]);
  const i = createSearchIndex(c);
  assert.deepEqual(i.search('zinc').map(r => r.product.id), []);
  c.add({ id: 'a2', nameAr: 'زنك', nameEn: 'ZINC' });
  assert.deepEqual(i.search('zinc').map(r => r.product.id), [], 'not yet');
  i.refresh(); assert.deepEqual(i.search('zinc').map(r => r.product.id), ['a2']); assert.equal(i.size, 2);
});

t('hostile queries are harmless: huge, regex characters, prototype names', () => {
  const start = performance.now();
  assert.deepEqual(ids('x'.repeat(20000)), []); assert.deepEqual(ids('(a+)+$ [z-a] \\\\'), []);
  assert.deepEqual(ids('__proto__ constructor toString hasOwnProperty'), []); assert.equal(({}).polluted, undefined);
  assert.ok(ids(('panadol ').repeat(500)).length > 0);
  assert.ok(performance.now() - start < 1000, 'bounded work');
});

t('typo limits: a 7-letter word allows one edit, an 8-letter word two; an exact word is never widened by typo matching', () => {
  assert.ok(ids('aspirn').includes('asp'));                      // 1 edit on 7 letters
  assert.deepEqual(ids('aspxrxn'), [], '2 edits on a 7-letter word are not enough');
  assert.ok(ids('gaxiscxn').includes('gav'), '2 edits on an 8-letter word are allowed');
  assert.deepEqual(ids('zyrtec'), ['zc'], 'ZYRTES is one edit away but the exact word wins and is not widened');
  assert.deepEqual(ids('zyrtes'), ['zs']);
  assert.deepEqual(ids('zyrtex').sort(), ['zc', 'zs'], 'nothing exact: both neighbours are offered');
});

t('ranking: phrase match beats scattered words; strength and pack fields beat a number that only appears in a name', () => {
  assert.equal(ids('cough syrup')[0], 'cA', 'the exact phrase first, although the other label sorts earlier');
  assert.equal(ids('tonic 100')[0], 'tY', 'the product whose STRENGTH is 100');
  assert.equal(ids('soap 12')[0], 'sY', 'the product whose PACK is 12');
});

t('Arabic hamza carriers fold: the same word typed with or without them', () => {
  assert.deepEqual(ids('ريس'), ['hm']); assert.deepEqual(ids('رئس'), ['hm']);      // 3-letter words are never typo-matched, so this is folding
  assert.deepEqual(ids('مون'), ['hw']); assert.deepEqual(ids('مؤن'), ['hw']);
});

t('a barcode-shaped number is never a name search: a name containing the same digits is not returned', () => {
  assert.deepEqual(ids('12345678'), []);
  assert.deepEqual(ids('ref'), ['ref']);
});

t('an exact word match is not weakened by a longer word that merely starts with it', () => {
  assert.deepEqual(ids('care'), ['cr1', 'cr2'], 'AAA CARE CAREFUL keeps its exact-match score and wins the tie on name');
});

t('the result limit has a hard cap even on a big catalog', () => {
  const big = createUnifiedCatalog(Array.from({ length: 300 }, (_, i) => ({ id: `w${i}`, nameAr: `ودجت ${i}`, nameEn: `WIDGET ${i}` })));
  const bi = createSearchIndex(big);
  assert.equal(bi.search('widget', { limit: 10000 }).length, 100); assert.equal(bi.search('widget').length, 20); assert.equal(bi.search('widget', { limit: 7 }).length, 7);
});

// ---- the real export: 4378 rows, no live data ------------------------------------------------------------------
const exportItems = JSON.parse(fs.readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8')).items;
const t0 = performance.now(); const realCatalog = createUnifiedCatalog(exportItems); const real = createSearchIndex(realCatalog); const buildMs = performance.now() - t0;
const rids = (q, o) => real.search(q, o).map(r => r.product.id);
const lc = s => String(s ?? '').toLowerCase();

t('real export: Latin name search finds every Panadol and tolerates a typo', () => {
  const expected = exportItems.filter(i => lc(i.nameen).includes('panadol')).map(i => i.code).sort();
  assert.ok(expected.length >= 5, `export has Panadol rows: ${expected.length}`);
  assert.deepEqual(rids('panadol', { limit: 100 }).sort(), expected);
  const typo = rids('panadool', { limit: 100 }); for (const id of expected) assert.ok(typo.includes(id), `typo finds ${id}`);
});

t('real export: Arabic names, prefixes and mixed Arabic/Latin queries work', () => {
  const arExpected = exportItems.filter(i => (i.namear || '').includes('جافيسكون')).map(i => i.code);
  assert.ok(arExpected.length > 0);
  const got = rids('جافيسكون', { limit: 100 }); for (const id of arExpected) assert.ok(got.includes(id));
  assert.ok(rids('جافيسك').length >= 1);
  const both = exportItems.find(i => i.namear && i.nameen && lc(i.nameen).includes('gaviscon'));
  assert.ok(rids(`${both.nameen.split(' ')[0].replace('*', '')} ${both.nameen.split(' ')[1]}`, { limit: 100 }).includes(both.code));
});

t('real export: numeric tokens respect word boundaries on real names', () => {
  const r = real.search('500', { limit: 100 });
  assert.ok(r.length > 0);
  for (const x of r) { const text = `${x.product.nameAr} ${x.product.nameEn} ${x.product.strength}`; assert.ok(/(^|\D)500(\D|$)/.test(text.replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))), `"${text}" contains 500 as a whole number`); }
});

t('real export: every product with a gtin is found by its barcode', () => {
  const withGtin = exportItems.filter(i => i.gtin); assert.ok(withGtin.length >= 5);
  for (const i of withGtin) assert.deepEqual(rids(String(i.gtin)), [i.code]);
});

t('real export: local latency p95 is under 150 ms (acceptance) on 300 mixed queries', () => {
  const sample = exportItems.filter((_, k) => k % 14 === 0).slice(0, 300);
  const queries = sample.map((i, k) => { const w = (i.nameen || i.namear).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean); return [w[0], w.slice(0, 2).join(' '), w[0].slice(0, -1) + 'x', i.namear?.split(' ')[0] ?? w[0]][k % 4]; });
  for (const q of queries.slice(0, 20)) real.search(q);          // warm up
  const times = queries.map(q => { const a = performance.now(); real.search(q); return performance.now() - a; }).sort((x, y) => x - y);
  const p50 = times[Math.floor(times.length * 0.5)], p95 = times[Math.floor(times.length * 0.95)], max = times.at(-1);
  console.log(`      index build ${buildMs.toFixed(0)} ms for ${real.size} products; ${queries.length} queries: p50 ${p50.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${max.toFixed(2)} ms`);
  assert.ok(real.size === 4378); assert.ok(buildMs < 3000, `index build ${buildMs}`); assert.ok(p95 < 150, `p95 ${p95} ms`);
});

console.log(`PASS catalog search checks (CAT-05): ${n} cases`);
