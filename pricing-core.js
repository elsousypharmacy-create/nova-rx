/* NOVA Rx — CAT-03 pricing rules (pure logic, no DOM, no network).
   Money is an integer number of piastres (1 EGP = 100). One rounding policy: half up (away from zero for negatives),
   done in integer arithmetic only. Works as a <script> (window.NovaPricing) and in Node (module.exports). */
(function (root) {
  'use strict';

  var BPS = 10000;                       // 100 % = 10000 basis points
  var MAX_SAFE = 9007199254740991;

  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
  function fail(code) { var e = new Error(code); e.code = code; throw e; }

  /* THE rounding policy: round(a / b) half up, a and b integers, b > 0. */
  function divRound(a, b) {
    if (!isInt(a) || !isInt(b) || b <= 0) fail('bad-integer');
    var s = a < 0 ? -1 : 1, x = Math.abs(a);
    var q = Math.floor(x / b), r = x - q * b;
    if (r * 2 >= b) q += 1;
    return s * q;
  }
  /* round(amount * num / den) without float error for realistic sizes. */
  function mulDiv(amount, num, den) {
    if (!isInt(amount) || !isInt(num)) fail('bad-integer');
    var p = amount * num;
    if (Math.abs(p) > MAX_SAFE) fail('overflow');
    return divRound(p, den);
  }

  /* "12.5" | 12.5 -> 1250. Parsed as a decimal string, never multiplied as a float. Extra digits round half up. */
  function toPiastres(v) {
    var m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(v == null ? '' : v).trim().replace(/,/g, ''));
    if (!m) fail('bad-amount');
    var frac = (m[3] || '') + '000';
    var n = Number(m[2]) * 100 + Number(frac.slice(0, 2));
    if (Number(frac[2]) >= 5) n += 1;
    if (n > MAX_SAFE) fail('overflow');
    return m[1] && n ? -n : n;
  }
  function fromPiastres(p) {
    if (!isInt(p)) fail('bad-integer');
    var s = p < 0 ? '-' : '', a = Math.abs(p);
    return s + Math.floor(a / 100) + '.' + ('0' + (a % 100)).slice(-2);
  }

  /* ---------- rules ---------- */
  /* rule = { code, retail, cost, maxDiscountBps, effectiveFrom (ISO date/time), effectiveTo? } — money in piastres. */
  function validateRule(r) {
    if (!r || !String(r.code || '').trim()) return 'code-required';
    if (!isInt(r.retail) || r.retail <= 0) return 'retail-must-be-positive-integer';
    if (r.cost != null && (!isInt(r.cost) || r.cost < 0)) return 'cost-must-be-integer';
    if (!isInt(r.maxDiscountBps) || r.maxDiscountBps < 0 || r.maxDiscountBps > BPS) return 'max-discount-out-of-range';
    var f = Date.parse(r.effectiveFrom);
    if (!isFinite(f)) return 'effective-from-required';
    if (r.effectiveTo != null) { var t = Date.parse(r.effectiveTo); if (!isFinite(t) || t <= f) return 'effective-to-invalid'; }
    return null;
  }

  /* The rule in force at `at`: latest effectiveFrom that is <= at and not past effectiveTo. null if none. */
  function ruleAt(rules, code, at) {
    var when = typeof at === 'number' ? at : Date.parse(at);
    if (!isFinite(when)) fail('bad-date');
    var best = null;
    (rules || []).forEach(function (r) {
      if (r.code !== code) return;
      var f = Date.parse(r.effectiveFrom);
      if (f > when) return;
      if (r.effectiveTo != null && Date.parse(r.effectiveTo) <= when) return;
      if (!best || f > Date.parse(best.effectiveFrom)) best = r;
    });
    return best;
  }

  /* discount = { bps } or { amount } (amount in piastres, whole line). Returns integer piastres, never above gross. */
  function discountAmount(gross, discount) {
    if (!discount) return 0;
    if (discount.bps != null) {
      if (!isInt(discount.bps) || discount.bps < 0 || discount.bps > BPS) fail('bad-discount');
      return mulDiv(gross, discount.bps, BPS);
    }
    if (!isInt(discount.amount) || discount.amount < 0) fail('bad-discount');
    return discount.amount;
  }

  /* Price one sale line from the rule in force. Throws 'no-rule', 'discount-over-limit'. */
  function priceLine(rules, code, qty, discount, at) {
    if (!isInt(qty) || qty < 1) fail('bad-qty');
    var rule = ruleAt(rules, code, at);
    if (!rule) fail('no-rule');
    var gross = rule.retail * qty;
    if (gross > MAX_SAFE) fail('overflow');
    if (discount && discount.bps != null && discount.bps > rule.maxDiscountBps) fail('discount-over-limit');
    var d = discountAmount(gross, discount);
    if (d > gross) fail('discount-over-limit');
    // the limit is checked on the integer amount, so a fixed amount and a percent are held to the same ceiling
    if (d > mulDiv(gross, rule.maxDiscountBps, BPS)) fail('discount-over-limit');
    return { code: code, qty: qty, unit: rule.retail, gross: gross, discount: d, net: gross - d,
             maxDiscountBps: rule.maxDiscountBps, ruleFrom: rule.effectiveFrom };
  }

  /* Refund for returning `qty` of a sold line. Uses the price actually paid (net of its discount), never today's rule.
     sold = { qty, net, returnedQty, refunded }; the last unit gets the remainder, so refunds add up to exactly `net`. */
  function refundLine(sold, qty) {
    var rq = sold.returnedQty || 0, rf = sold.refunded || 0;
    if (!isInt(sold.qty) || !isInt(sold.net) || sold.qty < 1 || sold.net < 0) fail('bad-sold-line');
    if (!isInt(qty) || qty < 1) fail('bad-qty');
    if (rq + qty > sold.qty) fail('return-exceeds-sold');
    var amount = rq + qty === sold.qty ? sold.net - rf : mulDiv(sold.net, rq + qty, sold.qty) - rf;
    if (amount < 0 || rf + amount > sold.net) fail('refund-exceeds-paid');
    return { qty: qty, amount: amount, returnedQty: rq + qty, refunded: rf + amount };
  }

  /* ---------- on-device store (localStorage-like), same pattern as the emergency queue ---------- */
  function createRulesStore(storage, key) {
    key = key || 'novaPricingRules';
    function read() { try { var v = JSON.parse(storage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
    return {
      list: read,
      at: function (code, at) { return ruleAt(read(), code, at); },
      /* Adding a rule never edits history: a new effectiveFrom supersedes, older rows stay. */
      add: function (rule) {
        var p = validateRule(rule); if (p) fail(p);
        var a = read();
        if (a.some(function (r) { return r.code === rule.code && r.effectiveFrom === rule.effectiveFrom; })) fail('duplicate-effective-from');
        a.push(JSON.parse(JSON.stringify(rule)));
        storage.setItem(key, JSON.stringify(a));
        return true;
      }
    };
  }

  var api = { BPS: BPS, divRound: divRound, mulDiv: mulDiv, toPiastres: toPiastres, fromPiastres: fromPiastres,
    validateRule: validateRule, ruleAt: ruleAt, discountAmount: discountAmount, priceLine: priceLine,
    refundLine: refundLine, createRulesStore: createRulesStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NovaPricing = api;
})(typeof window !== 'undefined' ? window : globalThis);
