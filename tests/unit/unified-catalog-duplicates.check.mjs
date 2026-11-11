import assert from 'node:assert/strict';
import { createUnifiedCatalog } from '../../worker/catalog/unified-catalog.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok', name); };
console.log('unified-catalog duplicate review checks (CAT-01)');

const base = () => createUnifiedCatalog([
  { id: 'A1', nameAr: 'بنادول اكسترا 24 قرص', nameEn: 'PANADOL EXTRA 24TAB', barcode: '6221000000017', packSize: 24 },
  { id: 'A2', nameAr: 'بنادول اكسترا ٢٤ قرص', nameEn: 'PANADOL EXTRA 24 TAB', barcode: '6221000000024', packSize: 24 },
  { id: 'B1', nameAr: 'فيتامين سي', nameEn: 'VITAMIN C', barcode: '6221000000031', packSize: 10 },
  { id: 'B2', nameAr: 'اوجمنتين', nameEn: 'AUGMENTIN', barcode: '6221000000031', packSize: 14 },
]);

t('duplicates are detected by shared barcode and by normalized name + pack size', () => {
  // B1/B2 share a barcode only if both were accepted: the catalog refuses the second one, so it must be listed as rejected
  const c = base();
  assert.equal(c.getAll().length, 3);
  assert.equal(c.rejected.length, 1);
  assert.equal(c.rejected[0].errors.includes('duplicate-barcode'), true);
  const groups = c.detectDuplicates();
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].ids.sort(), ['A1', 'A2']);
  assert.equal(groups[0].reason, 'name');
  assert.ok(groups[0].key);
});

t('different pack size is not a duplicate', () => {
  const c = createUnifiedCatalog([
    { id: '1', nameAr: 'بنادول', nameEn: 'PANADOL', packSize: 12 },
    { id: '2', nameAr: 'بنادول', nameEn: 'PANADOL', packSize: 24 },
  ]);
  assert.equal(c.detectDuplicates().length, 0);
});

t('merge needs a named pharmacist reviewer and a detected candidate pair', () => {
  const c = base();
  assert.throws(() => c.merge('A1', 'A2', {}), /reviewer/);
  assert.throws(() => c.merge('A1', 'A2', { reviewedBy: '  ' }), /reviewer/);
  assert.throws(() => c.merge('A1', 'A2'), /reviewer/);
  assert.throws(() => c.merge('A1', 'B1', { reviewedBy: 'Dr Ahmed' }), /not a duplicate candidate/);
  assert.equal(c.getAll().length, 3, 'nothing merged by the failed attempts');
});

t('approved merge keeps one record, unions barcodes, keeps an alias and an audit entry', () => {
  const c = base();
  const r = c.merge('A1', 'A2', { reviewedBy: 'Dr Ahmed' });
  assert.equal(r.ok, true);
  assert.equal(c.getAll().length, 2);
  assert.equal(c.getAll().some(p => p.id === 'A2'), false, 'dropped record no longer listed');
  assert.equal(c.findById('A2').id, 'A1', 'old id resolves to the kept record');
  assert.deepEqual([...c.findById('A1').barcodes].sort(), ['6221000000017', '6221000000024']);
  assert.equal(c.findByBarcode('6221000000024').id, 'A1');
  assert.equal(c.resolveId('A2'), 'A1', 'old id still resolves');
  assert.equal(c.mergeLog.length, 1);
  assert.equal(c.mergeLog[0].reviewedBy, 'Dr Ahmed');
  assert.equal(c.mergeLog[0].keptId, 'A1');
  assert.equal(c.mergeLog[0].droppedId, 'A2');
  assert.equal(c.detectDuplicates().length, 0);
});


t('same name and pack size but different strength or form is not a duplicate (review finding)', () => {
  const mk = (a, b) => createUnifiedCatalog([
    { id: '1', nameAr: 'بانادول', nameEn: 'PANADOL', packSize: 24, ...a },
    { id: '2', nameAr: 'بانادول', nameEn: 'PANADOL', packSize: 24, ...b },
  ]);
  assert.equal(mk({ strength: '500 mg' }, { strength: '1000 mg' }).detectDuplicates().length, 0);
  assert.equal(mk({ form: 'tablet' }, { form: 'syrup' }).detectDuplicates().length, 0);
  assert.equal(mk({ strength: '500 mg' }, { strength: '500  MG' }).detectDuplicates().length, 1, 'same strength after normalisation');
  assert.equal(mk({}, {}).detectDuplicates().length, 1);
});

t('merge history cannot be wiped or edited from outside (review finding)', () => {
  const c = base();
  c.merge('A1', 'A2', { reviewedBy: 'Dr Ahmed' });
  assert.throws(() => { c.mergeLog.length = 0; }, TypeError);
  assert.throws(() => c.mergeLog.push({}), TypeError);
  assert.throws(() => { c.mergeLog[0].reviewedBy = 'x'; }, TypeError);
  assert.equal(c.mergeLog.length, 1);
  assert.equal(c.mergeLog[0].reviewedBy, 'Dr Ahmed');
});

t('merge log records the values that were discarded so the decision is reviewable', () => {
  const c = createUnifiedCatalog([
    { id: 'P1', nameAr: 'اسبرين', nameEn: 'ASPIRIN', price: 10, packSize: 20, active: true },
    { id: 'P2', nameAr: 'اسبرين', nameEn: 'ASPIRIN', price: 99, packSize: 20, active: false, unit: 'strip' },
  ]);
  const r = c.merge('P1', 'P2', { reviewedBy: 'Dr Ahmed' });
  assert.equal(r.product.price, 10, 'kept record wins');
  assert.deepEqual(c.mergeLog[0].discarded, { price: 99, active: false, unit: 'strip' });
});

console.log(`PASS unified-catalog duplicate checks (CAT-01): ${n} cases`);
