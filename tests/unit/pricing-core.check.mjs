import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('../../pricing-core.js');
const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };
const code = f => { try { f(); } catch (e) { return e.code; } return null; };

// integer money + ONE rounding policy (half up)
assert.equal(P.toPiastres('12.5'), 1250);
assert.equal(P.toPiastres('0.1') + P.toPiastres('0.2'), 30, 'no float drift');
assert.equal(P.toPiastres('1,200.50'), 120050);
assert.equal(P.toPiastres('1.005'), 101, 'half up, not float 1.00');
assert.equal(P.toPiastres('1.004'), 100);
assert.equal(P.toPiastres(19.99), 1999);
assert.equal(code(() => P.toPiastres('abc')), 'bad-amount');
assert.equal(P.fromPiastres(1205), '12.05');
assert.equal(P.fromPiastres(5), '0.05');
assert.equal(P.divRound(5, 2), 3); assert.equal(P.divRound(4, 2), 2); assert.equal(P.divRound(-5, 2), -3); assert.equal(P.divRound(1, 3), 0);
assert.equal(P.mulDiv(1999, 1000, 10000), 200, '199.9 piastres rounds to 200');
assert.equal(code(() => P.divRound(1.5, 2)), 'bad-integer');

// rule validation
const base = { code: 'A', retail: 10000, cost: 8000, maxDiscountBps: 1000, effectiveFrom: '2026-01-01T00:00:00Z' };
assert.equal(P.validateRule(base), null);
assert.equal(P.validateRule({ ...base, retail: 100.5 }), 'retail-must-be-positive-integer');
assert.equal(P.validateRule({ ...base, retail: 0 }), 'retail-must-be-positive-integer');
assert.equal(P.validateRule({ ...base, maxDiscountBps: 10001 }), 'max-discount-out-of-range');
assert.equal(P.validateRule({ ...base, effectiveFrom: 'x' }), 'effective-from-required');
assert.equal(P.validateRule({ ...base, effectiveTo: '2025-01-01T00:00:00Z' }), 'effective-to-invalid');
assert.equal(P.validateRule({ ...base, code: ' ' }), 'code-required');

// effective date: latest rule in force, nothing before the first, nothing after effectiveTo
const rules = [base, { ...base, retail: 12000, effectiveFrom: '2026-06-01T00:00:00Z', maxDiscountBps: 500 },
  { code: 'B', retail: 500, maxDiscountBps: 0, effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: '2026-03-01T00:00:00Z' }];
assert.equal(P.ruleAt(rules, 'A', '2025-12-31T23:59:59Z'), null);
assert.equal(P.ruleAt(rules, 'A', '2026-05-31T00:00:00Z').retail, 10000);
assert.equal(P.ruleAt(rules, 'A', '2026-06-01T00:00:00Z').retail, 12000, 'from is inclusive');
assert.equal(P.ruleAt(rules, 'B', '2026-03-01T00:00:00Z'), null, 'to is exclusive');
assert.equal(P.ruleAt(rules, 'B', Date.parse('2026-02-01T00:00:00Z')).retail, 500);
assert.equal(code(() => P.ruleAt(rules, 'A', 'junk')), 'bad-date');

// discount limits (percent and fixed amount share one ceiling; exact boundary allowed, one piastre over refused)
const at = '2026-02-01T00:00:00Z';
let l = P.priceLine(rules, 'A', 3, { bps: 1000 }, at);
assert.deepEqual([l.gross, l.discount, l.net], [30000, 3000, 27000]);
assert.equal(code(() => P.priceLine(rules, 'A', 3, { bps: 1001 }, at)), 'discount-over-limit');
assert.equal(P.priceLine(rules, 'A', 3, { amount: 3000 }, at).net, 27000);
assert.equal(code(() => P.priceLine(rules, 'A', 3, { amount: 3001 }, at)), 'discount-over-limit');
assert.equal(code(() => P.priceLine(rules, 'A', 1, { amount: 10001 }, at)), 'discount-over-limit');
assert.equal(code(() => P.priceLine(rules, 'A', 1, { amount: -1 }, at)), 'bad-discount');
assert.equal(code(() => P.priceLine(rules, 'A', 1, { bps: 0.5 }, at)), 'bad-discount');
assert.equal(P.priceLine(rules, 'A', 1, null, at).net, 10000);
assert.equal(code(() => P.priceLine(rules, 'B', 1, { bps: 1 }, at)), 'discount-over-limit', 'max 0 = no discount');
assert.equal(code(() => P.priceLine(rules, 'A', 1, null, '2025-01-01T00:00:00Z')), 'no-rule');
assert.equal(code(() => P.priceLine(rules, 'A', 0, null, at)), 'bad-qty');
assert.equal(code(() => P.priceLine(rules, 'A', 1.5, null, at)), 'bad-qty');
// new rule applies after its date: lower limit
assert.equal(code(() => P.priceLine(rules, 'A', 1, { bps: 1000 }, '2026-07-01T00:00:00Z')), 'discount-over-limit');
assert.equal(P.priceLine(rules, 'A', 1, { bps: 500 }, '2026-07-01T00:00:00Z').net, 11400);
// rounding of a percent discount: 3 x 333 piastres at 10% -> 99.9 -> 100
assert.equal(P.priceLine([{ code: 'C', retail: 333, maxDiscountBps: 1000, effectiveFrom: '2026-01-01' }], 'C', 3, { bps: 1000 }, at).discount, 100);

// returns: refund the price PAID, never today's rule; sums to exactly the net; cannot exceed sold
const sold = P.priceLine(rules, 'A', 3, { amount: 1000 }, at);          // net 29000 for 3 -> 9667, 9666, 9667 style split
let st = { qty: 3, net: sold.net, returnedQty: 0, refunded: 0 }, total = 0;
for (let i = 0; i < 3; i++) { const r = P.refundLine(st, 1); total += r.amount; st = { ...st, returnedQty: r.returnedQty, refunded: r.refunded }; }
assert.equal(total, 29000, 'three single returns refund exactly what was paid');
assert.equal(code(() => P.refundLine(st, 1)), 'return-exceeds-sold');
assert.equal(P.refundLine({ qty: 3, net: 29000 }, 3).amount, 29000, 'all at once = net');
assert.equal(P.refundLine({ qty: 3, net: 29000 }, 1).amount, 9667);
assert.equal(P.refundLine({ qty: 4, net: 100 }, 1).amount, 25);
assert.equal(code(() => P.refundLine({ qty: 3, net: 29000 }, 4)), 'return-exceeds-sold');
assert.equal(code(() => P.refundLine({ qty: 3, net: 29000 }, 0)), 'bad-qty');
assert.equal(code(() => P.refundLine({ qty: 0, net: 1 }, 1)), 'bad-sold-line');
assert.equal(P.refundLine({ qty: 2, net: 0 }, 1).amount, 0, 'fully discounted line refunds zero');

// on-device store: history kept, bad rules refused
const store = P.createRulesStore(mem());
assert.ok(store.add(base)); assert.ok(store.add({ ...base, retail: 11000, effectiveFrom: '2026-04-01T00:00:00Z' }));
assert.equal(code(() => store.add(base)), 'duplicate-effective-from');
assert.equal(code(() => store.add({ ...base, retail: 1.5, effectiveFrom: '2027-01-01T00:00:00Z' })), 'retail-must-be-positive-integer');
assert.equal(store.list().length, 2);
assert.equal(store.at('A', '2026-02-01T00:00:00Z').retail, 10000);
assert.equal(store.at('A', '2026-05-01T00:00:00Z').retail, 11000);
console.log('pricing-core: all checks passed');
