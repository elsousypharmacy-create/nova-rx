// Dependency-free checks for worker/procurement/normalize.js (Task 04:
// price normalization, pack parsing, comparable unit price, offer matching).
// Run: node tests/unit/procurement-normalize.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseProductName,
  comparableUnitPrice,
  productKey,
  matchOffersToItem,
} from '../../worker/procurement/normalize.js';

// --- Hand-written assertions on real fixture names ---------------------------
let p = parseProductName('AUGMENTIN 625MG 10 F.C. TAB.');
assert.equal(p.brand, 'AUGMENTIN');
assert.deepEqual(p.strength, { value: '625', unit: 'mg' });
assert.equal(p.form, 'tab');
assert.deepEqual(p.pack, { count: 10, unit: 'tab' });

p = parseProductName('AUGMENTIN 457MG/5ML SUSP. 70 ML');
assert.deepEqual(p.strength, { value: '457', unit: 'mg/5ml' });
assert.equal(p.form, 'susp');
assert.deepEqual(p.pack, { count: 70, unit: 'ml' });

p = parseProductName('CONCOR 5MG 30 TABLETS');
assert.deepEqual(p.strength, { value: '5', unit: 'mg' });
assert.equal(p.form, 'tab');
assert.deepEqual(p.pack, { count: 30, unit: 'tab' });

p = parseProductName('BRUFEN 600 MG 10 EFF. GR. IN SACHETS');
assert.deepEqual(p.strength, { value: '600', unit: 'mg' });
assert.deepEqual(p.pack, { count: 10, unit: 'sachet' });

p = parseProductName('DECLOPHEN 25MG 5 INFANTILE SUPP.');
assert.equal(p.form, 'supp');
assert.deepEqual(p.pack, { count: 5, unit: 'supp' });

p = parseProductName('MERAZODEL 40 MG VIAL. FOR I.V. INF.');
assert.deepEqual(p.strength, { value: '40', unit: 'mg' });
assert.equal(p.form, 'vial');
assert.deepEqual(p.pack, { count: 1, unit: 'vial' });

p = parseProductName('PANADOL EXTRA 24 F.C. TAB.');
assert.equal(p.strength, null);
assert.deepEqual(p.pack, { count: 24, unit: 'tab' });

p = parseProductName('AUGMENTIN 1 GM 14 TABLETS');
assert.deepEqual(p.strength, { value: '1', unit: 'g' });
assert.deepEqual(p.pack, { count: 14, unit: 'tab' });

p = parseProductName('AUGMENTIN ADULTS 1GM/125MG 12 SACHETS');
assert.deepEqual(p.strength, { value: '1000/125', unit: 'mg' });
assert.deepEqual(p.pack, { count: 12, unit: 'sachet' });

p = parseProductName('CATAFLAM 75MG/3ML 6 AMP.');
assert.deepEqual(p.strength, { value: '75', unit: 'mg/3ml' });
assert.equal(p.form, 'amp');
assert.deepEqual(p.pack, { count: 6, unit: 'amp' });

p = parseProductName('AUGMENTIN 6.25MG/ML INFANT DROPS 20 ML');
assert.deepEqual(p.strength, { value: '6.25', unit: 'mg/ml' });
assert.equal(p.form, 'drops');
assert.deepEqual(p.pack, { count: 20, unit: 'ml' });

p = parseProductName('BRIMONOCOND 0.2 % EYE DPS. 5 ML');
assert.deepEqual(p.strength, { value: '0.2', unit: '%' });
assert.equal(p.form, 'drops');
assert.deepEqual(p.pack, { count: 5, unit: 'ml' });

p = parseProductName('Panadol cold& flu day 24 tab');
assert.equal(p.brand, 'PANADOL COLD& FLU DAY');
assert.deepEqual(p.pack, { count: 24, unit: 'tab' });

p = parseProductName('MAGNABIOTIC 600MG VIAL');
assert.deepEqual(p.pack, { count: 1, unit: 'vial' });

p = parseProductName('CONCOR PLUS 5/12.5MG 30 F.C. TABLETS');
assert.deepEqual(p.strength, { value: '5/12.5', unit: 'mg' });

p = parseProductName('VILDAFORMIN 50-1000 MG 30 TAB');
assert.deepEqual(p.strength, { value: '50/1000', unit: 'mg' });

p = parseProductName('Zomegipral 40 gm 1 vail');
assert.deepEqual(p.strength, { value: '40', unit: 'g' });
assert.deepEqual(p.pack, { count: 1, unit: 'vial' });

// --- Arabic names ------------------------------------------------------------
p = parseProductName('بانادول ٥٠٠ مجم ٢٤ قرص');
assert.equal(p.brand, 'بانادول');
assert.deepEqual(p.strength, { value: '500', unit: 'mg' });
assert.equal(p.form, 'tab');
assert.deepEqual(p.pack, { count: 24, unit: 'tab' });

p = parseProductName('اوجمنتين ١ جم ١٤ قرص');
assert.deepEqual(p.strength, { value: '1', unit: 'g' });
assert.deepEqual(p.pack, { count: 14, unit: 'tab' });

p = parseProductName('بروفين ٤٠٠ مجم ٣٠ كبسولة');
assert.deepEqual(p.strength, { value: '400', unit: 'mg' });
assert.equal(p.form, 'cap');
assert.deepEqual(p.pack, { count: 30, unit: 'cap' });

p = parseProductName('شراب كحة ١٢٠ مل');
assert.equal(p.strength, null);
assert.equal(p.form, 'syrup');
assert.deepEqual(p.pack, { count: 120, unit: 'ml' });

p = parseProductName('زيروكسات ٢٠ مجم ٣٠ قرص');
assert.deepEqual(p.strength, { value: '20', unit: 'mg' });
assert.deepEqual(p.pack, { count: 30, unit: 'tab' });

// --- Table-driven pass over all 134 fixture names ----------------------------
const names = readFileSync(
  new URL('../fixtures/pharmaoverseas/names-sample.txt', import.meta.url),
  'utf8',
)
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
assert.equal(names.length, 134, 'fixture must contain 134 names');

let parsedCount = 0;
const failed = [];
for (const name of names) {
  let parsed = null;
  try {
    parsed = parseProductName(name);
  } catch (error) {
    failed.push(`${name} (threw: ${error.message})`);
    continue;
  }
  if (parsed.strength || parsed.pack) parsedCount += 1;
  else failed.push(name);
}
console.log(`parseProductName: strength-or-pack parsed for ${parsedCount}/${names.length} names`);
if (failed.length) console.log('unparsed names:', failed);
assert.ok(parsedCount >= 120, `expected >= 120/134 parsed, got ${parsedCount}`);

// --- productKey --------------------------------------------------------------
const key24 = productKey(parseProductName('Panadol Extra 500mg Optizorb 24 tabs'));
const key48 = productKey(parseProductName('Panadol Extra 500mg Optizorb 48 tabs'));
assert.ok(key24 && key48, 'keys must exist when strength is present');
assert.notEqual(key24, key48, 'different pack sizes must give different keys');
assert.equal(
  productKey(parseProductName('AUGMENTIN 625MG 10 F.C. TAB.')),
  'augmentin|625mg|tab|10',
);
assert.equal(
  productKey(parseProductName('PANADOL EXTRA 24 F.C. TAB.')),
  'panadol extra|-|tab|24',
  'no strength but known pack -> key with "-" (review fix)',
);
{
  const m = matchOffersToItem({ name: 'PANADOL EXTRA 24 F.C. TAB.' }, [
    { productName: 'PANADOL EXTRA 24 F.C. TAB.' },
    { productName: 'PANADOL EXTRA 48 F.C. TAB.' },
  ]);
  assert.equal(m[0].score, 1, 'same name without strength matches exactly');
  assert.equal(m[1].score, 0.8, 'same brand/form, other pack -> 0.8');
}
assert.equal(productKey(parseProductName('500MG 10 TAB')), null, 'no brand -> null key');

// --- comparableUnitPrice -----------------------------------------------------
const parsed24 = parseProductName('Panadol Extra 500mg Optizorb 24 tabs');
const parsed48 = parseProductName('Panadol Extra 500mg Optizorb 48 tabs');
const perTab24 = comparableUnitPrice({ unitPrice: 37.5 }, parsed24);
const perTab48 = comparableUnitPrice({ unitPrice: 75 }, parsed48);
assert.ok(Math.abs(perTab24 - perTab48) < 1e-9, 'same per-tablet price for 37.5/24 and 75/48');
assert.equal(
  comparableUnitPrice({ unitPrice: 100, netEffectivePrice: 90 }, parseProductName('CONCOR 5MG 30 TABLETS')),
  3,
  'netEffectivePrice wins over unitPrice',
);
assert.equal(comparableUnitPrice({ unitPrice: 10 }, parseProductName('SOME SYRUP')), null);

// --- matchOffersToItem -------------------------------------------------------
const offers = [
  { supplierId: 's', supplierProductId: '1', productName: 'CONCOR 5MG 30 TABLETS' },
  { supplierId: 's', supplierProductId: '2', productName: 'CONCOR 5MG 60 TABLETS' },
  { supplierId: 's', supplierProductId: '3', productName: 'CONCOR 10 MG 30 F.C. TABLETS' },
  { supplierId: 's', supplierProductId: '4', productName: 'AUGMENTIN 625MG 10 F.C. TAB.' },
];
const ranked = matchOffersToItem({ name: 'CONCOR 5MG 30 TABLETS' }, offers);
assert.equal(ranked[0].offer.supplierProductId, '1');
assert.equal(ranked[0].score, 1);
const packDiffers = ranked.find((r) => r.offer.supplierProductId === '2');
assert.equal(packDiffers.score, 0.8);
assert.ok(packDiffers.reasons.includes('pack-differs'));
const otherStrength = ranked.find((r) => r.offer.supplierProductId === '3');
assert.ok(
  !otherStrength || otherStrength.score < 0.8,
  'CONCOR 5MG must never match CONCOR 10MG at score >= 0.8',
);
if (otherStrength) assert.equal(otherStrength.needsReview, true);
assert.ok(
  !ranked.some((r) => r.offer.supplierProductId === '4'),
  'unrelated brand must be excluded',
);
const brandOnly = matchOffersToItem({ name: 'PANADOL EXTRA 24 F.C. TAB.' }, [
  { supplierId: 's', supplierProductId: '9', productName: 'PANADOL ADVANCE 500MG 48 TAB' },
]);
assert.equal(brandOnly.length, 0, 'different strength must not auto-merge without review flag');

console.log('procurement-normalize checks passed');
