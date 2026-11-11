import assert from 'node:assert/strict';
import { linePrice, unitPrice, allocateLinePrices } from '../../worker/catalog/unit-conversion.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok', name); };
const full = { unitsPerStrip: 10, stripsPerBox: 3, boxesPerCarton: 10 };
const seven = { unitsPerStrip: 10, stripsPerBox: 7 };
const val = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const err = (r, code, note = '') => { assert.equal(r.ok, false, `expected ${code} ${note}`); assert.equal(r.error, code); };
console.log('unit-conversion price checks (CAT-02)');

t('price per unit follows the price unit', () => {
  assert.equal(val(unitPrice(60, 'box', 'strip', full)), 20);
  assert.equal(val(unitPrice(60, 'box', 'unit', full)), 2);
  assert.equal(val(unitPrice(60, 'box', 'carton', full)), 600);
});

t('line price: 1 box strip price, 5 tablets, and zero quantity is zero (not one)', () => {
  assert.equal(val(linePrice(60, 'box', 'strip', 1, full)), 20);
  assert.equal(val(linePrice(60, 'box', 'unit', 5, full)), 10);
  assert.equal(val(linePrice(60, 'box', 'strip', 0, full)), 0);
  assert.equal(val(linePrice(60, 'box', 'box', 1, full)), 60);
});

t('bad input is refused, never priced as 0 or 1', () => {
  err(linePrice('abc', 'box', 'strip', 1, full), 'price-invalid');
  err(linePrice(-1, 'box', 'strip', 1, full), 'price-invalid');
  err(linePrice(60, 'box', 'strip', -1, full), 'quantity-invalid');
  err(linePrice(60, 'box', 'strip', 'x', full), 'quantity-invalid');
  err(linePrice(60, 'bottle', 'strip', 1, full), 'unit-unknown');
  err(linePrice(60, 'box', 'strip', 1, {}), 'unit-unavailable');
  err(linePrice(12.755, 'box', 'strip', 1, full), 'price-invalid');
});

t('money is rounded to cents once per line, half up', () => {
  assert.equal(val(linePrice(100, 'box', 'strip', 1, seven)), 14.29);
  assert.equal(val(linePrice(100, 'box', 'strip', 7, seven)), 100, 'a whole box sold as strips costs the box price');
  assert.equal(val(linePrice(0.5, 'box', 'unit', 1, { unitsPerBox: 2 })), 0.25);
  assert.equal(val(linePrice(0.01, 'box', 'unit', 1, { unitsPerBox: 2 })), 0.01, '0.005 rounds half up');
  err(linePrice(100, 'box', 'strip', 0.25, seven), 'fractional-base-units');
});

t('split lines add up to the box price exactly (largest remainder)', () => {
  const lines = Array.from({ length: 7 }, () => ({ unit: 'strip', qty: 1 }));
  const r = allocateLinePrices(100, 'box', lines, seven);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.lines.length, 7);
  assert.ok(r.lines.every(x => x === 14.28 || x === 14.29), r.lines.join());
  assert.equal(r.lines.filter(x => x === 14.29).length, 4);
  assert.equal(Math.round(r.lines.reduce((s, x) => s + x * 100, 0)), 10000);
  assert.equal(r.total, 100);
});

t('mixed units allocate consistently and never drift from the total', () => {
  const r = allocateLinePrices(100, 'box', [{ unit: 'strip', qty: 3 }, { unit: 'strip', qty: 4 }], seven);
  assert.equal(r.total, 100);
  assert.equal(Math.round((r.lines[0] + r.lines[1]) * 100), 10000);
  for (const price of [33.33, 99.99, 1, 0.07, 1234.56]) for (const parts of [3, 7, 10]) {
    const rr = allocateLinePrices(price, 'box', Array.from({ length: parts }, () => ({ unit: 'unit', qty: 1 })), { unitsPerBox: parts });
    assert.equal(rr.ok, true);
    assert.equal(Math.round(rr.lines.reduce((s, x) => s + x * 100, 0)), Math.round(price * 100), `${price}/${parts}`);
  }
});

t('allocation refuses unknown units and fractional base quantities', () => {
  err(allocateLinePrices(100, 'box', [{ unit: 'bottle', qty: 1 }], seven), 'unit-unknown');
  err(allocateLinePrices(100, 'box', [{ unit: 'strip', qty: 0.25 }], seven), 'fractional-base-units');
  err(allocateLinePrices(100, 'box', [], seven), 'lines-empty');
  err(allocateLinePrices(100, 'box', [{ unit: 'strip', qty: -1 }], seven), 'quantity-invalid');
});

t('money stays inside the exact range: no precision loss (review blocking 2)', () => {
  err(linePrice(1e15, 'box', 'box', 1e6, full), 'price-invalid', 'the review example is refused outright');
  err(linePrice(1e10, 'box', 'box', 1e6, full), 'out-of-range', 'largest valid price times a huge quantity');
  err(linePrice(1e10 + 1, 'box', 'box', 1, full), 'price-invalid');
  err(linePrice(1e9, 'box', 'unit', 1e9, { unitsPerBox: 1 }), 'out-of-range', 'line above 1e11 EGP');
  assert.equal(val(linePrice(1e9, 'box', 'box', 1, full)), 1e9);
  err(allocateLinePrices(1e9, 'box', [{ unit: 'box', qty: 1e6 }], full), 'out-of-range');
  err(linePrice('0x10', 'box', 'strip', 1, full), 'price-invalid');
  err(linePrice('1e3', 'box', 'strip', 1, full), 'price-invalid');
  assert.equal(val(linePrice('٦٠٫٥٠', 'box', 'box', 1, full)), 60.5);
});

t('a positive price that rounds to 0.00 is flagged, not silently zero (review non-blocking)', () => {
  const r = linePrice(0.01, 'box', 'strip', 1, full);
  assert.equal(r.ok, true); assert.equal(r.value, 0); assert.equal(r.warning, 'rounded-to-zero');
  assert.equal(linePrice(60, 'box', 'strip', 1, full).warning, undefined);
  assert.equal(linePrice(0, 'box', 'strip', 1, full).warning, undefined, 'a free item is not a rounding case');
  assert.equal(linePrice(60, 'box', 'strip', 0, full).warning, undefined, 'quantity 0 is not a rounding case');
});

console.log(`PASS unit-conversion price checks (CAT-02): ${n} cases`);
