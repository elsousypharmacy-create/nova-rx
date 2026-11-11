import assert from 'node:assert/strict';
import { createUnifiedCatalog, normalizeProductRecord } from '../../worker/catalog/unified-catalog.js';
import { toBaseUnits, canonicalPackaging } from '../../worker/catalog/unit-conversion.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok', name); };
console.log('catalog packaging link checks (CAT-01 x CAT-02)');
const rec = (over = {}) => ({ id: 'P1', nameAr: 'بنادول', nameEn: 'PANADOL', price: 48, ...over });
const val = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };

t('a product carries a validated, frozen packaging in canonical names', () => {
  const r = normalizeProductRecord(rec({ packaging: { unitsPerStrip: 12, stripsPerBox: 2, boxesPerCarton: 10 } }));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.product.packaging, { unitsPerStrip: 12, stripsPerBox: 2, boxesPerCarton: 10 });
  assert.equal(Object.isFrozen(r.product.packaging), true);
  assert.throws(() => { r.product.packaging.unitsPerStrip = 99; }, TypeError);
});

t('legacy names, numeric text and Arabic digits are accepted and stored as canonical numbers', () => {
  const r = normalizeProductRecord(rec({ packaging: { tabletsPerStrip: '١٢', stripsPerBox: '2', packsPerCarton: 10 } }));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.product.packaging, { unitsPerStrip: 12, stripsPerBox: 2, boxesPerCarton: 10 });
});

t('no packaging means null (not a guess), and an empty definition is also null', () => {
  for (const v of [undefined, null, {}, '']) assert.equal(normalizeProductRecord(rec({ packaging: v })).product.packaging, null, JSON.stringify(v));
});

t('invalid packaging rejects the product with the CAT-02 reason', () => {
  const bad = (packaging, code) => { const r = normalizeProductRecord(rec({ packaging })); assert.equal(r.ok, false, JSON.stringify(packaging)); assert.ok(r.errors.includes(code), `${code} in ${r.errors}`); };
  bad({ unitsPerStrip: '0x1A' }, 'packaging-invalid:unitsPerStrip');
  bad({ unitsPerStrip: 0 }, 'packaging-invalid:unitsPerStrip');
  bad({ stripsPerBox: 2.5, unitsPerStrip: 10 }, 'packaging-invalid:stripsPerBox');
  bad({ unitsPerBox: 31, stripsPerBox: 3, unitsPerStrip: 10 }, 'packaging-inconsistent');
  bad({ unitsPerBox: 1e6, boxesPerCarton: 1e6 }, 'packaging-invalid:boxesPerCarton');
  bad([], 'packaging-invalid:definition'); bad('box', 'packaging-invalid:definition'); bad(12, 'packaging-invalid:definition'); bad(true, 'packaging-invalid:definition');
});

t('canonicalPackaging is exported by CAT-02 and returns the factors too', () => {
  const c = canonicalPackaging({ unitsPerStrip: 10, stripsPerBox: 3 });
  assert.deepEqual(c.packaging, { unitsPerStrip: 10, stripsPerBox: 3 }); assert.deepEqual(c.factors, { unit: 1, strip: 10, box: 30 });
  assert.equal(canonicalPackaging(null).packaging, null);
});

t('packagingOf feeds CAT-02 conversions straight from the catalog', () => {
  const c = createUnifiedCatalog([rec({ packaging: { unitsPerStrip: 12, stripsPerBox: 2 } }), rec({ id: 'P2', nameAr: 'بدون', nameEn: 'NOPACK' })]);
  const def = c.packagingOf('P1');
  assert.equal(val(toBaseUnits(3, 'box', def)), 72); assert.equal(val(toBaseUnits(2, 'strip', def)), 24);
  assert.equal(toBaseUnits(1, 'carton', def).error, 'unit-unavailable', 'a carton was never defined for this product');
  assert.equal(c.packagingOf('P2'), null); assert.equal(c.packagingOf('nope'), null);
  assert.equal(c.findById('P1').packaging.unitsPerStrip, 12);
});

t('merge keeps the kept record\'s packaging, adopts the dropped one when none exists, and logs a discarded different one', () => {
  const mk = (a, b) => createUnifiedCatalog([rec({ id: 'A', packaging: a }), rec({ id: 'B', packaging: b })]);
  let c = mk({ unitsPerBox: 24 }, undefined); c.merge('A', 'B', { reviewedBy: 'Dr Ahmed' }); assert.deepEqual(c.packagingOf('A'), { unitsPerBox: 24 });
  c = mk(undefined, { unitsPerBox: 24 }); c.merge('A', 'B', { reviewedBy: 'Dr Ahmed' }); assert.deepEqual(c.packagingOf('A'), { unitsPerBox: 24 });
  assert.deepEqual(c.packagingOf('B'), { unitsPerBox: 24 }, 'the merged-away id still resolves to the kept product\'s packaging');
  assert.equal(c.mergeLog[0].discarded.packaging, undefined);
  c = mk({ unitsPerBox: 24 }, { unitsPerBox: 24 }); c.merge('A', 'B', { reviewedBy: 'Dr Ahmed' }); assert.equal(c.mergeLog[0].discarded.packaging, undefined, 'identical packaging is not a discarded value');
});

t('duplicates with different box sizes are different products', () => {
  const mk = (a, b) => createUnifiedCatalog([rec({ id: 'A', packaging: a }), rec({ id: 'B', packaging: b })]);
  assert.equal(mk({ unitsPerBox: 24 }, { unitsPerBox: 12 }).detectDuplicates().length, 0);
  assert.equal(mk({ unitsPerBox: 24 }, { unitsPerBox: 24 }).detectDuplicates().length, 1);
  assert.equal(mk({ unitsPerBox: 24 }, undefined).detectDuplicates().length, 1, 'one side unknown: still a candidate for the pharmacist');
  assert.equal(mk({ unitsPerStrip: 12, stripsPerBox: 2 }, { unitsPerBox: 24 }).detectDuplicates().length, 1, 'same box size written two ways');
});

t('a discarded different packaging is recorded in the merge log for the pharmacist to see', () => {
  const c = createUnifiedCatalog([rec({ id: 'A', packaging: { unitsPerBox: 24 } }), rec({ id: 'B', packaging: { unitsPerBox: 24, boxesPerCarton: 10 } })]);
  assert.equal(c.detectDuplicates().length, 1);
  c.merge('A', 'B', { reviewedBy: 'Dr Ahmed' });
  assert.deepEqual(c.mergeLog[0].discarded.packaging, { unitsPerBox: 24, boxesPerCarton: 10 });
  assert.deepEqual(c.packagingOf('A'), { unitsPerBox: 24 });
});

console.log(`PASS catalog packaging link checks (CAT-01 x CAT-02): ${n} cases`);
