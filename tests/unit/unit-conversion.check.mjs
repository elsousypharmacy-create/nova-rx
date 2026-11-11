import assert from 'node:assert/strict';
import { canonicalUnit, normalizePackaging, toBaseUnits, fromBaseUnits, convertQuantity, splitBaseUnits } from '../../worker/catalog/unit-conversion.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok', name); };
const full = { unitsPerStrip: 10, stripsPerBox: 3, boxesPerCarton: 10 };
const val = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const err = (r, code) => { assert.equal(r.ok, false, `expected ${code}`); assert.equal(r.error, code); };
console.log('unit-conversion checks (CAT-02)');

t('unit names: English and Arabic synonyms, unknown is null', () => {
  for (const [a, b] of [['tablet', 'unit'], ['piece', 'unit'], ['قرص', 'unit'], ['وحدة', 'unit'], ['شريط', 'strip'], ['Strip', 'strip'], ['علبة', 'box'], ['pack', 'box'], ['كرتونة', 'carton'], [' CARTON ', 'carton']]) assert.equal(canonicalUnit(a), b, a);
  assert.equal(canonicalUnit('bottle'), null);
  assert.equal(canonicalUnit(''), null);
  assert.equal(canonicalUnit(null), null);
});

t('packaging: factors are derived, legacy field names still accepted', () => {
  const p = normalizePackaging(full);
  assert.equal(p.ok, true);
  assert.deepEqual(p.factors, { unit: 1, strip: 10, box: 30, carton: 300 });
  assert.deepEqual(normalizePackaging({ tabletsPerStrip: 10, stripsPerBox: 3, packsPerCarton: 10 }).factors, p.factors);
  assert.deepEqual(normalizePackaging({ unitsPerBox: 1 }).factors, { unit: 1, box: 1 }, 'single-unit pack must be declared explicitly');
});

t('packaging: nothing is guessed from missing or partial definitions', () => {
  assert.deepEqual(normalizePackaging({}).factors, { unit: 1 });
  assert.deepEqual(normalizePackaging(undefined).factors, { unit: 1 });
  assert.deepEqual(normalizePackaging({ stripsPerBox: 3 }).factors, { unit: 1 }, 'strips per box without units per strip: box unknown');
  assert.deepEqual(normalizePackaging({ unitsPerStrip: 10 }).factors, { unit: 1, strip: 10 });
  assert.deepEqual(normalizePackaging({ boxesPerCarton: 10 }).factors, { unit: 1 }, 'carton needs a known box');
});

t('packaging: invalid or inconsistent values are rejected, not coerced', () => {
  for (const bad of [{ unitsPerStrip: 0 }, { unitsPerStrip: -10 }, { stripsPerBox: 2.5 }, { boxesPerCarton: 'x' }, { unitsPerBox: NaN }, { unitsPerStrip: Infinity }]) {
    const p = normalizePackaging(bad);
    assert.equal(p.ok, false, JSON.stringify(bad));
    assert.match(p.error, /^packaging-invalid:/);
  }
  err(normalizePackaging({ unitsPerBox: 31, stripsPerBox: 3, unitsPerStrip: 10 }), 'packaging-inconsistent');
  assert.equal(normalizePackaging({ unitsPerBox: 30, stripsPerBox: 3, unitsPerStrip: 10 }).ok, true);
});

t('to base units: carton, box, strip, unit', () => {
  assert.equal(val(toBaseUnits(2, 'carton', full)), 600);
  assert.equal(val(toBaseUnits(1, 'علبة', full)), 30);
  assert.equal(val(toBaseUnits(2, 'strip', full)), 20);
  assert.equal(val(toBaseUnits(5, 'tablet', full)), 5);
  assert.equal(val(toBaseUnits(0, 'box', full)), 0);
});

t('from base units', () => {
  assert.equal(val(fromBaseUnits(300, 'carton', full)), 1);
  assert.equal(val(fromBaseUnits(60, 'box', full)), 2);
  assert.equal(val(fromBaseUnits(30, 'strip', full)), 3);
  assert.equal(val(fromBaseUnits(15, 'tablet', full)), 15);
  assert.equal(val(fromBaseUnits(15, 'strip', full)), 1.5);
});

t('unknown unit is refused (no silent factor of 1)', () => {
  err(toBaseUnits(2, 'bottle', full), 'unit-unknown');
  err(toBaseUnits(2, '', full), 'unit-unknown');
  err(fromBaseUnits(2, 'bottle', full), 'unit-unknown');
  err(convertQuantity(1, 'box', 'bottle', full), 'unit-unknown');
});

t('a unit the product has no packaging for is refused', () => {
  err(toBaseUnits(1, 'box', {}), 'unit-unavailable');
  err(toBaseUnits(1, 'carton', { unitsPerStrip: 10, stripsPerBox: 3 }), 'unit-unavailable');
  err(toBaseUnits(1, 'strip', { unitsPerBox: 1 }), 'unit-unavailable');
  assert.equal(val(toBaseUnits(7, 'unit', {})), 7, 'base unit always works');
});

t('invalid quantity is refused', () => {
  for (const q of [-5, 'abc', NaN, Infinity, null, undefined, '']) err(toBaseUnits(q, 'box', full), 'quantity-invalid');
  assert.equal(val(toBaseUnits('3', 'box', full)), 90, 'numeric string accepted');
});

t('whole-unit rule: half a tablet cannot be stocked or sold', () => {
  assert.equal(val(toBaseUnits(0.5, 'strip', { unitsPerStrip: 7 })), 3.5, 'allowed for arithmetic');
  err(toBaseUnits(0.5, 'strip', { unitsPerStrip: 7 }, { requireWhole: true }), 'fractional-base-units');
  assert.equal(val(toBaseUnits(1.5, 'strip', full, { requireWhole: true })), 15);
  err(toBaseUnits(1.5, 'unit', full, { requireWhole: true }), 'fractional-base-units');
});

t('no floating point noise', () => {
  assert.equal(val(toBaseUnits(0.1, 'box', { unitsPerBox: 3 })), 0.3);
  assert.equal(val(toBaseUnits(1.1, 'box', { unitsPerBox: 3 })), 3.3);
});

t('round trip: base -> unit -> base is exact for every level', () => {
  for (const unit of ['carton', 'box', 'strip', 'unit']) for (let q = 0; q <= 200; q++) {
    const base = val(toBaseUnits(q, unit, full));
    assert.equal(val(fromBaseUnits(base, unit, full)), q, `${unit} ${q}`);
  }
});

t('convert between units (buy in cartons, sell in strips)', () => {
  assert.equal(val(convertQuantity(2, 'carton', 'box', full)), 20);
  assert.equal(val(convertQuantity(60, 'unit', 'box', full)), 2);
  assert.equal(val(convertQuantity(3, 'box', 'strip', full)), 9);
  err(convertQuantity(1, 'carton', 'box', {}), 'unit-unavailable');
});

t('split a base quantity into whole carton/box/strip/unit', () => {
  assert.deepEqual(val(splitBaseUnits(75, full)), { carton: 0, box: 2, strip: 1, unit: 5 });
  assert.deepEqual(val(splitBaseUnits(612, full)), { carton: 2, box: 0, strip: 1, unit: 2 });
  assert.deepEqual(val(splitBaseUnits(7, {})), { unit: 7 }, 'only the units the product has');
  err(splitBaseUnits(7.5, full), 'fractional-base-units');
  err(splitBaseUnits(-1, full), 'quantity-invalid');
});

console.log(`PASS unit-conversion checks (CAT-02): ${n} cases`);
