import assert from 'node:assert/strict';
import {
  normalizePackHierarchy,
  toBaseUnits,
  fromBaseUnits,
  computeConvertedLinePrice
} from '../../worker/catalog/unit-conversion.js';

// Test 1: normalizePackHierarchy
const packDef = {
  packsPerCarton: 10,
  stripsPerBox: 3,
  tabletsPerStrip: 10
};
const hierarchy = normalizePackHierarchy(packDef);
assert.equal(hierarchy.factors.strip, 10, 'Strip factor should be 10 tablets');
assert.equal(hierarchy.factors.box, 30, 'Box factor should be 30 tablets');
assert.equal(hierarchy.factors.carton, 300, 'Carton factor should be 300 tablets');

// Test 2: toBaseUnits
assert.equal(toBaseUnits(2, 'carton', packDef), 600, '2 cartons should equal 600 tablets');
assert.equal(toBaseUnits(1, 'box', packDef), 30, '1 box should equal 30 tablets');
assert.equal(toBaseUnits(2, 'strip', packDef), 20, '2 strips should equal 20 tablets');
assert.equal(toBaseUnits(5, 'tablet', packDef), 5, '5 tablets should equal 5 tablets');

// Test 3: fromBaseUnits
assert.equal(fromBaseUnits(300, 'carton', packDef), 1, '300 tablets should equal 1 carton');
assert.equal(fromBaseUnits(60, 'box', packDef), 2, '60 tablets should equal 2 boxes');
assert.equal(fromBaseUnits(30, 'strip', packDef), 3, '30 tablets should equal 3 strips');
assert.equal(fromBaseUnits(15, 'tablet', packDef), 15, '15 tablets should equal 15 tablets');

// Test 4: computeConvertedLinePrice
const stripPrice = computeConvertedLinePrice(60, 'box', 'strip', packDef, 1);
assert.equal(stripPrice, 20, 'Strip price should be 20 EGP');

const tabletPrice = computeConvertedLinePrice(60, 'box', 'tablet', packDef, 5);
assert.equal(tabletPrice, 10, '5 tablets price should be 10 EGP');

console.log('PASS unit-conversion unit checks (CAT-02)');
