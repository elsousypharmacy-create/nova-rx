import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createLoyaltyStore, checkDiscountCap } = createRequire(import.meta.url)('../../loyalty-offers.js');

const DAY = 86400000, T0 = 1700000000000;
function mem() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, raw: m }; }
let T = T0;
const mk = (s = mem(), opts = {}) => createLoyaltyStore(s, 'k', { now: () => T, pointsPerPound: 1, pointValuePounds: 0.1, expiryDays: 30, ...opts });
let n = 0;
const t = (name, fn) => { T = T0; fn(); n++; console.log('ok', name); };

t('earnPoints is idempotent by saleId, calculates integer points from net amount, and persists', () => {
  const s = mem(), l = mk(s);
  const e1 = l.earnPoints({ saleId: 'S1', customerId: 'c1', netAmount: 125.75 });
  const e2 = l.earnPoints({ saleId: 'S1', customerId: 'c1', netAmount: 999 });
  assert.equal(e1.points, 125);
  assert.equal(e2.points, 125);
  assert.equal(l.balance('c1').available, 125);
  assert.equal(mk(s).balance('c1').available, 125);
});

t('rejects corrupt storage without overwriting and surfaces write failures cleanly', () => {
  const s = mem(), l = mk(s);
  l.earnPoints({ saleId: 'S1', customerId: 'c1', netAmount: 50 });
  s.setItem('k', '{bad-json');
  assert.throws(() => l.balance('c1'), { code: 'loyalty-corrupt' });
  assert.equal(s.raw.k, '{bad-json');

  const s2 = mem(), l2 = mk(s2);
  l2.earnPoints({ saleId: 'S1', customerId: 'c1', netAmount: 50 });
  s2.setItem = () => { throw new Error('disk full'); };
  assert.throws(() => l2.earnPoints({ saleId: 'S2', customerId: 'c1', netAmount: 10 }), { code: 'loyalty-write-failed' });
  assert.equal(l2.balance('c1').available, 50);
});

t('point expiry rules: expired lots cannot be redeemed and FIFO consumes earliest-expiring non-expired lots first', () => {
  const l = mk();
  l.earnPoints({ saleId: 'S1', customerId: 'c1', netAmount: 100, at: T0, expiresAt: T0 + 10 * DAY });
  l.earnPoints({ saleId: 'S2', customerId: 'c1', netAmount: 80, at: T0 + DAY, expiresAt: T0 + 25 * DAY });

  // At T0 + 5 days, both lots are valid; redeeming 60 consumes from S1 first
  T = T0 + 5 * DAY;
  const r = l.redeemPoints({ id: 'R1', customerId: 'c1', points: 60, gross: 100, maxDiscountBps: 1000 });
  assert.equal(r.discountAmount, 6);
  assert.equal(r.availableAfter, 120);

  // At T0 + 10 days (exact boundary), the remaining 40 points of S1 expire; only S2 (80 pts) remains available
  T = T0 + 10 * DAY;
  const bal = l.balance('c1');
  assert.equal(bal.available, 80);
  assert.equal(bal.expired, 40);
  assert.throws(() => l.redeemPoints({ id: 'R2', customerId: 'c1', points: 81, gross: 200, maxDiscountBps: 5000 }), { code: 'insufficient-points' });
});

t('redeemPoints enforces approved discount caps (bps ceiling and minimum approved net price) and is idempotent', () => {
  const l = mk();
  l.earnPoints({ saleId: 'S1', customerId: 'c1', netAmount: 500 }); // 500 pts = 50 EGP value
  // Gross 100 EGP, maxDiscountBps 1000 (10% = 10 EGP max). Existing discount 4 EGP -> max 60 points (6 EGP) allowed
  assert.throws(
    () => l.redeemPoints({ id: 'R1', customerId: 'c1', points: 61, gross: 100, currentDiscount: 4, maxDiscountBps: 1000 }),
    { code: 'discount-cap-exceeded' }
  );
  // Approved minimum net price floor (e.g., cost/approved floor 95 EGP) blocks 6 EGP discount on 100 EGP gross
  assert.throws(
    () => l.redeemPoints({ id: 'R1', customerId: 'c1', points: 60, gross: 100, currentDiscount: 0, maxDiscountBps: 2000, minApprovedNet: 95 }),
    { code: 'discount-cap-exceeded' }
  );
  // Exact boundary (4 EGP existing + 6 EGP points = 10 EGP = 1000 bps) succeeds and is idempotent
  const ok1 = l.redeemPoints({ id: 'R1', customerId: 'c1', points: 60, gross: 100, currentDiscount: 4, maxDiscountBps: 1000 });
  const ok2 = l.redeemPoints({ id: 'R1', customerId: 'c1', points: 60, gross: 100, currentDiscount: 4, maxDiscountBps: 1000 });
  assert.equal(ok1.discountAmount, 6);
  assert.equal(ok2.discountAmount, 6);
  assert.equal(l.balance('c1').available, 440);
});

t('effect of return on points: partial returns pro-rate and sum to exact earned points; blocks returning more than sold', () => {
  const l = mk();
  l.earnPoints({ saleId: 'S1', customerId: 'c1', netAmount: 100, points: 33 }); // 33 points on 100 EGP
  const r1 = l.returnSale({ id: 'RET1', saleId: 'S1', returnedAmount: 30 });
  const r2 = l.returnSale({ id: 'RET2', saleId: 'S1', returnedAmount: 30 });
  const r3 = l.returnSale({ id: 'RET3', saleId: 'S1', returnedAmount: 40 });
  assert.equal(r1.pointsClawedBack + r2.pointsClawedBack + r3.pointsClawedBack, 33, 'partial returns claw back exact total earned');
  assert.equal(l.balance('c1').available, 0);
  assert.throws(() => l.returnSale({ id: 'RET4', saleId: 'S1', returnedAmount: 0.01 }), { code: 'return-exceeds-sale' });
});

t('return after points were already redeemed creates a point deficit that future earns pay down first', () => {
  const l = mk();
  l.earnPoints({ saleId: 'S1', customerId: 'c1', netAmount: 100 }); // +100 pts
  l.redeemPoints({ id: 'R1', customerId: 'c1', points: 80, gross: 200, maxDiscountBps: 5000 }); // 20 pts left
  const ret = l.returnSale({ id: 'RET1', saleId: 'S1', returnedAmount: 100 }); // claws back 100 pts -> 20 from lot, 80 deficit
  assert.equal(ret.pointsClawedBack, 100);
  assert.equal(ret.availableAfter, 0);
  assert.equal(ret.deficitAfter, 80);
  assert.equal(ret.netBalanceAfter, -80);

  // Next purchase earns 110 pts -> pays down 80 deficit first, leaving 30 available
  l.earnPoints({ saleId: 'S2', customerId: 'c1', netAmount: 110 });
  const b = l.balance('c1');
  assert.equal(b.deficit, 0);
  assert.equal(b.available, 30);
  assert.equal(b.netBalance, 30);
});

t('vouchers: validity window (not-yet-active and expired), minimum spend, global and per-customer use limits', () => {
  const l = mk();
  l.defineVoucher({
    code: 'ramadan10',
    kind: 'percent',
    value: 1000, // 10%
    validFrom: T0 + DAY,
    validTo: T0 + 10 * DAY,
    maxUses: 2,
    maxUsesPerCustomer: 1,
    minSpend: 50,
    maxDiscountAmount: 15
  });
  assert.throws(() => l.defineVoucher({ code: 'RAMADAN10', kind: 'fixed', value: 5, validFrom: T0, validTo: T0 + DAY }), { code: 'duplicate-voucher' });

  // Before validFrom
  assert.throws(() => l.applyVoucher({ code: 'RAMADAN10', customerId: 'c1', gross: 100 }), { code: 'voucher-not-yet-active' });

  // During validity window
  T = T0 + 2 * DAY;
  assert.throws(() => l.applyVoucher({ code: 'RAMADAN10', customerId: 'c1', gross: 49.99 }), { code: 'below-min-spend' });
  assert.throws(() => l.applyVoucher({ code: 'RAMADAN10', gross: 100 }), { code: 'missing-customer' });

  // Cap on voucher itself: 10% of 200 is 20, capped by maxDiscountAmount=15
  const preview = l.applyVoucher({ code: 'RAMADAN10', customerId: 'c1', gross: 200, maxDiscountBps: 1000 });
  assert.equal(preview.discountAmount, 15);

  // Redeem once for c1 (idempotent by id)
  const u1 = l.redeemVoucher({ id: 'U1', code: 'RAMADAN10', customerId: 'c1', gross: 100, maxDiscountBps: 1000 });
  const u1Again = l.redeemVoucher({ id: 'U1', code: 'RAMADAN10', customerId: 'c1', gross: 100, maxDiscountBps: 1000 });
  assert.equal(u1.discountAmount, 10);
  assert.equal(u1Again.discountAmount, 10);

  // Per-customer limit (1) blocks second use by c1
  assert.throws(() => l.redeemVoucher({ id: 'U2', code: 'RAMADAN10', customerId: 'c1', gross: 100 }), { code: 'customer-use-limit-reached' });

  // Second customer c2 succeeds, reaching global maxUses (2)
  l.redeemVoucher({ id: 'U2', code: 'RAMADAN10', customerId: 'c2', gross: 100 });
  assert.throws(() => l.redeemVoucher({ id: 'U3', code: 'RAMADAN10', customerId: 'c3', gross: 100 }), { code: 'voucher-max-uses-reached' });

  // Reversing U2 frees one global slot; after validTo it expires
  l.reverse('vuse-U2', 'sale voided');
  T = T0 + 10 * DAY;
  assert.throws(() => l.redeemVoucher({ id: 'U3', code: 'RAMADAN10', customerId: 'c3', gross: 100 }), { code: 'voucher-expired' });
});

t('vouchers cannot exceed approved price/discount caps when combined with existing discounts', () => {
  const l = mk();
  l.defineVoucher({ code: 'SAVE20', kind: 'fixed', value: 20, validFrom: T0, validTo: T0 + 5 * DAY });

  // Gross 100, approved maxDiscountBps = 2500 (25 EGP). Existing line discount = 10 EGP + 20 EGP voucher = 30 EGP -> blocked
  assert.throws(
    () => l.redeemVoucher({ id: 'V1', code: 'SAVE20', gross: 100, currentDiscount: 10, maxDiscountBps: 2500 }),
    { code: 'discount-cap-exceeded' }
  );
  // Existing discount 5 EGP + 20 EGP voucher = 25 EGP (exact 2500 bps cap) -> allowed
  const res = l.redeemVoucher({ id: 'V1', code: 'SAVE20', gross: 100, currentDiscount: 5, maxDiscountBps: 2500 });
  assert.equal(res.discountAmount, 20);
  assert.equal(res.netAmount, 75);

  // Direct helper checkDiscountCap also enforces both bps ceiling and minApprovedNet floor
  assert.equal(checkDiscountCap({ gross: 100, currentDiscount: 5, addedDiscount: 10, maxDiscountBps: 1500, minApprovedNet: 85 }).net, 85);
  assert.throws(() => checkDiscountCap({ gross: 100, currentDiscount: 5, addedDiscount: 10.01, maxDiscountBps: 1500 }), { code: 'discount-cap-exceeded' });
});

console.log(n, 'passed');
