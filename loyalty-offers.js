/* NOVA Rx — CRM-03 local loyalty and offers (pure logic, no DOM, no network, frontend/local only).
   Append-only ledger for customer points (earn with expiry, FIFO redemption, return clawback with partial-return exactness
   and deficit tracking when points were already spent) and vouchers/offers (validity window, global & per-customer use limits,
   minimum spend, and strict enforcement of approved price and discount caps).
   Amounts are pounds in the API, integer piastres (x100) internally. Works as <script> (window.NovaLoyalty) and in Node. */
(function (root) {
  'use strict';

  var BPS = 10000;
  var DAY = 86400000;

  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
  function str(v, code) { if (typeof v !== 'string' || !v.trim()) fail(code); return v.trim(); }

  function toCents(n, allowZero) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0 || (!allowZero && n === 0)) fail('bad-amount');
    var c = Math.round(n * 100);
    if (Math.abs(c / 100 - n) > 1e-9) fail('bad-amount');
    return c;
  }
  function toPounds(c) { return c / 100; }

  /* Half-up integer division round(a * num / den), den > 0. */
  function mulDiv(a, num, den) {
    if (!isInt(a) || !isInt(num) || !isInt(den) || den <= 0) fail('bad-integer');
    var p = a * num, s = p < 0 ? -1 : 1, x = Math.abs(p);
    var q = Math.floor(x / den), r = x - q * den;
    if (r * 2 >= den) q += 1;
    return s * q;
  }

  function parseTime(t, code) {
    if (typeof t === 'number' && isFinite(t)) return Math.floor(t);
    var ms = Date.parse(t);
    if (!isFinite(ms)) fail(code || 'bad-date');
    return ms;
  }

  /* Verify that existingDiscount + addedDiscount does not exceed approved maxDiscountBps or drop below approved minPrice.
     Amounts in cents; throws 'discount-cap-exceeded'. */
  function enforceCapCents(grossC, existingDiscC, addedDiscC, maxDiscountBps, minApprovedNetC) {
    if (!isInt(grossC) || grossC < 0) fail('bad-amount');
    if (!isInt(existingDiscC) || existingDiscC < 0 || !isInt(addedDiscC) || addedDiscC < 0) fail('bad-discount');
    var totalDisc = existingDiscC + addedDiscC;
    if (totalDisc > grossC) fail('discount-cap-exceeded');
    if (maxDiscountBps != null) {
      if (!isInt(maxDiscountBps) || maxDiscountBps < 0 || maxDiscountBps > BPS) fail('bad-discount-cap');
      var maxDiscC = mulDiv(grossC, maxDiscountBps, BPS);
      if (totalDisc > maxDiscC) fail('discount-cap-exceeded');
    }
    if (minApprovedNetC != null) {
      if (!isInt(minApprovedNetC) || minApprovedNetC < 0) fail('bad-price-cap');
      if (grossC - totalDisc < minApprovedNetC) fail('discount-cap-exceeded');
    }
    return {
      gross: toPounds(grossC),
      existingDiscount: toPounds(existingDiscC),
      addedDiscount: toPounds(addedDiscC),
      totalDiscount: toPounds(totalDisc),
      net: toPounds(grossC - totalDisc)
    };
  }

  /* Public helper: check approved price/discount cap in pounds. */
  function checkDiscountCap(o) {
    o = o || {};
    var grossC = toCents(o.gross, true);
    var existingC = o.currentDiscount == null ? 0 : toCents(o.currentDiscount, true);
    var addedC = o.addedDiscount == null ? 0 : toCents(o.addedDiscount, true);
    var minNetC = o.minApprovedNet == null ? null : toCents(o.minApprovedNet, true);
    return enforceCapCents(grossC, existingC, addedC, o.maxDiscountBps, minNetC);
  }

  /* opts: { now(): ms, pointsPerPound: 1, pointValuePounds: 0.1, expiryDays: 365 } */
  function createLoyaltyStore(storage, key, opts) {
    key = key || 'nova.loyalty';
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    var pointsPerPound = opts.pointsPerPound == null ? 1 : opts.pointsPerPound;
    var pointValueCents = opts.pointValuePounds == null ? 10 : toCents(opts.pointValuePounds, false);
    var expiryDays = opts.expiryDays == null ? 365 : opts.expiryDays;
    if (!isInt(pointsPerPound) || pointsPerPound <= 0) fail('bad-config');
    if (!isInt(expiryDays) || expiryDays <= 0) fail('bad-config');

    function load() {
      var raw = storage.getItem(key);
      if (!raw) return { moves: [], vouchers: {} };
      var s;
      try { s = JSON.parse(raw); } catch (e) { fail('loyalty-corrupt'); }
      if (!s || typeof s !== 'object' || !Array.isArray(s.moves) || !s.vouchers || typeof s.vouchers !== 'object') {
        fail('loyalty-corrupt');
      }
      return s;
    }
    function save(s) {
      try { storage.setItem(key, JSON.stringify(s)); } catch (e) { fail('loyalty-write-failed'); }
    }
    function byId(s, id) {
      for (var i = 0; i < s.moves.length; i++) if (s.moves[i].id === id) return s.moves[i];
      return null;
    }
    function isReversed(s, id) {
      return s.moves.some(function (m) { return m.type === 'reversal' && m.target === id; });
    }

    /* Replay customer point movements chronologically to compute live lots, expired points, and any return deficit.
       Each earn creates a lot { earnId, saleId, at, expiresAt, earned, remaining }.
       Redemptions consume non-expired lots FIFO by (expiresAt, at).
       Return clawbacks deduct from the original sale's lot first, then other non-expired lots FIFO, then record deficit;
       subsequent earns pay down deficit first before adding available points. */
    function computeCustomerState(s, customerId, asOf) {
      var t = asOf == null ? now() : parseTime(asOf);
      var lots = [];
      var deficit = 0;
      var totalEarned = 0;
      var totalRedeemed = 0;
      var totalClawedBack = 0;

      function activeLotsAt(when) {
        return lots
          .filter(function (l) { return l.remaining > 0 && l.expiresAt > when; })
          .sort(function (a, b) { return a.expiresAt - b.expiresAt || a.at - b.at; });
      }

      s.moves.forEach(function (m) {
        if (m.customerId !== customerId || isReversed(s, m.id)) return;
        if (m.type === 'earn') {
          totalEarned += m.points;
          var rem = m.points;
          if (deficit > 0) {
            var offset = Math.min(deficit, rem);
            deficit -= offset;
            rem -= offset;
          }
          lots.push({
            earnId: m.id,
            saleId: m.saleId,
            at: m.at,
            expiresAt: m.expiresAt,
            earned: m.points,
            remaining: rem
          });
        } else if (m.type === 'redeem') {
          totalRedeemed += m.points;
          var need = m.points;
          activeLotsAt(m.at).forEach(function (l) {
            if (need <= 0) return;
            var take = Math.min(need, l.remaining);
            l.remaining -= take;
            need -= take;
          });
          if (need > 0) deficit += need;
        } else if (m.type === 'return-clawback') {
          totalClawedBack += m.points;
          var claw = m.points;
          var orig = lots.filter(function (l) { return l.saleId === m.saleId && l.remaining > 0; })[0];
          if (orig) {
            var fromOrig = Math.min(claw, orig.remaining);
            orig.remaining -= fromOrig;
            claw -= fromOrig;
          }
          if (claw > 0) {
            activeLotsAt(m.at).forEach(function (l) {
              if (claw <= 0) return;
              var take = Math.min(claw, l.remaining);
              l.remaining -= take;
              claw -= take;
            });
          }
          if (claw > 0) deficit += claw;
        }
      });

      var available = 0, expired = 0;
      lots.forEach(function (l) {
        if (l.remaining <= 0) return;
        if (l.expiresAt <= t) expired += l.remaining;
        else available += l.remaining;
      });

      return {
        customerId: customerId,
        available: available,
        expired: expired,
        deficit: deficit,
        netBalance: available - deficit,
        totalEarned: totalEarned,
        totalRedeemed: totalRedeemed,
        totalClawedBack: totalClawedBack,
        lots: copy(lots)
      };
    }

    /* Earn points on a sale. Idempotent by saleId.
       o: { saleId, customerId, netAmount, points?, at?, expiresAt? } */
    function earnPoints(o) {
      o = o || {};
      var saleId = str(o.saleId, 'missing-sale-id');
      var customerId = str(o.customerId, 'missing-customer');
      var netC = toCents(o.netAmount, true);
      var s = load();
      var ex = byId(s, 'earn-' + saleId);
      if (ex) return copy(ex);
      var at = o.at == null ? now() : parseTime(o.at);
      var exp = o.expiresAt == null ? at + expiryDays * DAY : parseTime(o.expiresAt);
      if (exp <= at) fail('bad-expiry');
      var pts = o.points == null ? Math.floor((netC * pointsPerPound) / 100) : o.points;
      if (!isInt(pts) || pts < 0) fail('bad-points');
      var m = {
        id: 'earn-' + saleId,
        type: 'earn',
        saleId: saleId,
        customerId: customerId,
        netCents: netC,
        points: pts,
        at: at,
        expiresAt: exp
      };
      s.moves.push(m);
      save(s);
      return copy(m);
    }

    /* Redeem points for a discount on a sale/line, strictly enforcing approved price/discount caps.
       o: { id, customerId, points, gross, currentDiscount?, maxDiscountBps?, minApprovedNet?, at? } */
    function redeemPoints(o) {
      o = o || {};
      var id = str(o.id, 'missing-key');
      var customerId = str(o.customerId, 'missing-customer');
      if (!isInt(o.points) || o.points <= 0) fail('bad-points');
      var s = load();
      var ex = byId(s, 'red-' + id);
      if (ex) {
        return {
          id: ex.id,
          customerId: ex.customerId,
          points: ex.points,
          discountAmount: toPounds(ex.discountCents),
          availableAfter: computeCustomerState(s, customerId, ex.at).available
        };
      }
      var at = o.at == null ? now() : parseTime(o.at);
      var st = computeCustomerState(s, customerId, at);
      if (o.points > st.available) fail('insufficient-points');

      var discC = o.points * pointValueCents;
      if (o.gross != null) {
        var grossC = toCents(o.gross, true);
        var curDiscC = o.currentDiscount == null ? 0 : toCents(o.currentDiscount, true);
        var minNetC = o.minApprovedNet == null ? null : toCents(o.minApprovedNet, true);
        enforceCapCents(grossC, curDiscC, discC, o.maxDiscountBps, minNetC);
      }

      var m = {
        id: 'red-' + id,
        type: 'redeem',
        ref: id,
        customerId: customerId,
        points: o.points,
        discountCents: discC,
        at: at
      };
      s.moves.push(m);
      save(s);
      return {
        id: m.id,
        customerId: customerId,
        points: o.points,
        discountAmount: toPounds(discC),
        availableAfter: st.available - o.points
      };
    }

    /* Effect of a sale return on loyalty points.
       Claws back pro-rated points (exact remainder on final return so partial returns sum to earned points).
       o: { id, saleId, returnedAmount, at? } */
    function returnSale(o) {
      o = o || {};
      var id = str(o.id, 'missing-key');
      var saleId = str(o.saleId, 'missing-sale-id');
      var retC = toCents(o.returnedAmount, false);
      var s = load();
      var ex = byId(s, 'ret-' + id);
      if (ex) {
        var stEx = computeCustomerState(s, ex.customerId, ex.at);
        return {
          id: ex.id,
          saleId: ex.saleId,
          customerId: ex.customerId,
          pointsClawedBack: ex.points,
          availableAfter: stEx.available,
          deficitAfter: stEx.deficit,
          netBalanceAfter: stEx.netBalance
        };
      }
      var earn = byId(s, 'earn-' + saleId);
      if (!earn || isReversed(s, earn.id)) fail('unknown-sale');

      var prevReturnedC = 0, prevClawedPts = 0;
      s.moves.forEach(function (m) {
        if (m.type === 'return-clawback' && m.saleId === saleId && !isReversed(s, m.id)) {
          prevReturnedC += m.returnedCents;
          prevClawedPts += m.points;
        }
      });
      if (prevReturnedC + retC > earn.netCents) fail('return-exceeds-sale');

      var cumReturnedC = prevReturnedC + retC;
      var targetClawPts = cumReturnedC === earn.netCents
        ? earn.points
        : mulDiv(earn.points, cumReturnedC, earn.netCents);
      var clawPts = targetClawPts - prevClawedPts;
      if (clawPts < 0) clawPts = 0;

      var at = o.at == null ? now() : parseTime(o.at);
      var m = {
        id: 'ret-' + id,
        type: 'return-clawback',
        ref: id,
        saleId: saleId,
        customerId: earn.customerId,
        returnedCents: retC,
        points: clawPts,
        at: at
      };
      s.moves.push(m);
      save(s);

      var st = computeCustomerState(s, earn.customerId, at);
      return {
        id: m.id,
        saleId: saleId,
        customerId: earn.customerId,
        pointsClawedBack: clawPts,
        availableAfter: st.available,
        deficitAfter: st.deficit,
        netBalanceAfter: st.netBalance
      };
    }

    function balance(customerId, asOf) {
      return computeCustomerState(load(), str(customerId, 'missing-customer'), asOf);
    }

    /* ---------- Vouchers & Offers ---------- */
    /* v: { code, kind: 'percent' | 'fixed', value (bps for percent, pounds for fixed),
            validFrom, validTo, maxUses?, maxUsesPerCustomer?, minSpend?, maxDiscountAmount? } */
    function defineVoucher(v) {
      v = v || {};
      var code = str(v.code, 'voucher-code-required').toUpperCase();
      if (v.kind !== 'percent' && v.kind !== 'fixed') fail('bad-voucher-kind');
      var val = v.kind === 'percent' ? v.value : toCents(v.value, false);
      if (v.kind === 'percent' && (!isInt(val) || val <= 0 || val > BPS)) fail('bad-voucher-value');
      var from = parseTime(v.validFrom, 'bad-voucher-dates');
      var to = parseTime(v.validTo, 'bad-voucher-dates');
      if (to <= from) fail('bad-voucher-dates');
      if (v.maxUses != null && (!isInt(v.maxUses) || v.maxUses < 1)) fail('bad-use-limit');
      if (v.maxUsesPerCustomer != null && (!isInt(v.maxUsesPerCustomer) || v.maxUsesPerCustomer < 1)) fail('bad-use-limit');
      var minSpendC = v.minSpend == null ? 0 : toCents(v.minSpend, true);
      var maxDiscC = v.maxDiscountAmount == null ? null : toCents(v.maxDiscountAmount, false);

      var s = load();
      if (s.vouchers[code]) fail('duplicate-voucher');
      var rec = {
        code: code,
        kind: v.kind,
        value: val,
        validFrom: from,
        validTo: to,
        maxUses: v.maxUses == null ? null : v.maxUses,
        maxUsesPerCustomer: v.maxUsesPerCustomer == null ? null : v.maxUsesPerCustomer,
        minSpendCents: minSpendC,
        maxDiscountCents: maxDiscC
      };
      s.vouchers[code] = rec;
      save(s);
      return copy(rec);
    }

    function voucherUseStats(s, code, customerId) {
      var total = 0, byCust = 0;
      s.moves.forEach(function (m) {
        if (m.type === 'voucher-use' && m.code === code && !isReversed(s, m.id)) {
          total += 1;
          if (customerId && m.customerId === customerId) byCust += 1;
        }
      });
      return { totalUses: total, customerUses: byCust };
    }

    /* Evaluate a voucher against a sale/line without recording a use yet.
       o: { code, customerId?, gross, currentDiscount?, maxDiscountBps?, minApprovedNet?, at? } */
    function evaluateVoucher(s, o) {
      o = o || {};
      var code = str(o.code, 'voucher-code-required').toUpperCase();
      var v = s.vouchers[code];
      if (!v) fail('unknown-voucher');
      var at = o.at == null ? now() : parseTime(o.at);
      if (at < v.validFrom) fail('voucher-not-yet-active');
      if (at >= v.validTo) fail('voucher-expired');

      var custId = o.customerId ? String(o.customerId).trim() : null;
      if (v.maxUsesPerCustomer != null && !custId) fail('missing-customer');

      var stats = voucherUseStats(s, code, custId);
      if (v.maxUses != null && stats.totalUses >= v.maxUses) fail('voucher-max-uses-reached');
      if (v.maxUsesPerCustomer != null && stats.customerUses >= v.maxUsesPerCustomer) fail('customer-use-limit-reached');

      var grossC = toCents(o.gross, false);
      if (grossC < v.minSpendCents) fail('below-min-spend');

      var discC = v.kind === 'percent' ? mulDiv(grossC, v.value, BPS) : v.value;
      if (v.maxDiscountCents != null && discC > v.maxDiscountCents) discC = v.maxDiscountCents;

      var curDiscC = o.currentDiscount == null ? 0 : toCents(o.currentDiscount, true);
      var minNetC = o.minApprovedNet == null ? null : toCents(o.minApprovedNet, true);
      var capCheck = enforceCapCents(grossC, curDiscC, discC, o.maxDiscountBps, minNetC);

      return {
        code: code,
        discountCents: discC,
        discountAmount: toPounds(discC),
        netAmount: capCheck.net,
        totalDiscount: capCheck.totalDiscount,
        usesRemaining: v.maxUses == null ? null : v.maxUses - stats.totalUses,
        customerUsesRemaining: v.maxUsesPerCustomer == null ? null : v.maxUsesPerCustomer - stats.customerUses,
        at: at,
        customerId: custId
      };
    }

    function applyVoucher(o) {
      return evaluateVoucher(load(), o);
    }

    /* Record voucher redemption (idempotent by id). Enforces expiry, use limits, min spend, and approved caps. */
    function redeemVoucher(o) {
      o = o || {};
      var id = str(o.id, 'missing-key');
      var s = load();
      var ex = byId(s, 'vuse-' + id);
      if (ex) {
        return {
          id: ex.id,
          code: ex.code,
          customerId: ex.customerId,
          discountAmount: toPounds(ex.discountCents),
          netAmount: toPounds(ex.grossCents - ex.existingDiscountCents - ex.discountCents)
        };
      }
      var ev = evaluateVoucher(s, o);
      var grossC = toCents(o.gross, false);
      var curDiscC = o.currentDiscount == null ? 0 : toCents(o.currentDiscount, true);
      var m = {
        id: 'vuse-' + id,
        type: 'voucher-use',
        ref: id,
        code: ev.code,
        customerId: ev.customerId,
        grossCents: grossC,
        existingDiscountCents: curDiscC,
        discountCents: ev.discountCents,
        at: ev.at
      };
      s.moves.push(m);
      save(s);
      return {
        id: m.id,
        code: m.code,
        customerId: m.customerId,
        discountAmount: ev.discountAmount,
        netAmount: ev.netAmount
      };
    }

    /* Reverse an earlier movement (e.g., cancelled sale / voided voucher use). Idempotent. */
    function reverse(moveId, reason) {
      var s = load();
      var m = byId(s, str(moveId, 'missing-key'));
      if (!m) fail('unknown-movement');
      if (m.type === 'reversal') fail('cannot-reverse-reversal');
      if (isReversed(s, m.id)) {
        return copy(s.moves.filter(function (x) { return x.type === 'reversal' && x.target === m.id; })[0]);
      }
      var r = {
        id: 'rv-' + (s.moves.length + 1),
        type: 'reversal',
        target: m.id,
        customerId: m.customerId || null,
        reason: str(reason, 'reason-required'),
        at: now()
      };
      s.moves.push(r);
      save(s);
      return copy(r);
    }

    return {
      earnPoints: earnPoints,
      redeemPoints: redeemPoints,
      returnSale: returnSale,
      balance: balance,
      defineVoucher: defineVoucher,
      applyVoucher: applyVoucher,
      redeemVoucher: redeemVoucher,
      reverse: reverse,
      checkDiscountCap: checkDiscountCap
    };
  }

  var api = {
    BPS: BPS,
    mulDiv: mulDiv,
    checkDiscountCap: checkDiscountCap,
    createLoyaltyStore: createLoyaltyStore
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaLoyalty = api;
})(typeof window !== 'undefined' ? window : globalThis);
