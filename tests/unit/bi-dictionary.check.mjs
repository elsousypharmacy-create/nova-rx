import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const B = createRequire(import.meta.url)('../../bi-dictionary.js');
const code = f => { try { f(); } catch (e) { return e.code; } return null; };

assert.deepEqual(B.ORDER.slice(0, 7), ['gross', 'discount', 'return', 'net', 'cost', 'margin', 'marginPct']);
for (const k of B.ORDER) { assert.ok(B.INDICATORS[k].ar && B.INDICATORS[k].en && B.INDICATORS[k].rule, k); }
assert.ok(B.INDICATORS.visits);

const r = B.compute({ gross: 10000, discount: 500, return: 1500, cost: 6000, visits: 3 });
assert.equal(r.net, 8000); assert.equal(r.margin, 2000); assert.equal(r.marginPct, 2500); assert.equal(r.visits, 3);
assert.equal(B.compute({ gross: 0 }).marginPct, 0, 'no division by zero');
assert.equal(code(() => B.compute({ gross: -1 })), 'negative-input');
assert.equal(code(() => B.compute({ gross: 1.5 })), 'bad-integer');

const inv = [
  { status: 'paid', lines: [{ qty: 2, price: 5000, cost: 3000, discount: 200 }], discount: 300, returns: [{ amount: 1000, cost: 600 }] },
  { status: 'cancelled', lines: [{ qty: 9, price: 9999, cost: 1 }] },
  { status: 'paid', lines: [{ qty: 1, price: 2000, cost: 1000 }] }
];
const f = B.fromInvoices(inv);
assert.deepEqual(f, B.compute({ gross: 12000, discount: 500, return: 1000, cost: 6400, visits: 2 }));
assert.equal(f.net, 10500); assert.equal(f.margin, 4100);
assert.equal(B.fromInvoices([]).visits, 0);

assert.equal(B.fmt('net', 10500), '105.00'); assert.equal(B.fmt('margin', -5), '-0.05');
assert.equal(B.fmt('marginPct', 3905), '39.05%'); assert.equal(B.fmt('visits', 2), '2');
assert.equal(B.label('net', 'ar'), 'الصافي'); assert.equal(B.label('net', 'en'), 'Net');
assert.equal(code(() => B.label('nope')), 'unknown-indicator');
const csv = B.toCsv(f, 'ar');
assert.ok(csv.startsWith('﻿indicator,value\r\n')); assert.ok(csv.includes('الصافي,105.00'));
console.log('bi-dictionary.check: OK');
