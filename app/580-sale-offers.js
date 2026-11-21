/* #99 Offers and coupons (lazy screen). Engine used by the sale screen (app/120) + coupon box at checkout + settings card.
   Data (this device): localStorage 'nova-rx-offers-v1' = { offers: [...], coupons: [...] }.
   - offer type 'bxgy': buy X get Y free on the SAME item (every X+Y units, Y are free).
   - offer type 'pct': percent off a list of items (barcodes) and/or categories, inside a date range.
   - coupon: typed code at checkout, one use per sale, fixed or percent, minimum invoice amount, optional end date / max uses.
   Offer and coupon discounts are NOT manual discounts: the manager-approval limit only looks at manual discounts.
   Only a manager / owner may add or stop an offer (when accounts exist; fails closed if the account module is missing). */
(function () {
  'use strict';
  var KEY = 'nova-rx-offers-v1';
  function en() { try { return localStorage.getItem('nova-rx-language') === 'en'; } catch (_) { return false; } }
  function tr(a, e) { return en() ? e : a; }
  function r2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }
  function f2(x) { return Math.floor((x + 1e-9) * 100) / 100; }
  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function canEdit() {
    var A = window.novaAuth;
    if (!A || typeof A.hasAccounts !== 'function') return false;
    try {
      if (!A.hasAccounts()) return true;
      var me = A.current && A.current();
      return !!(me && (me.role === 'manager' || me.role === 'owner'));
    } catch (_) { return false; }
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && Array.isArray(s.offers) && Array.isArray(s.coupons)) return s;
    } catch (_) { /* empty */ }
    return { offers: [], coupons: [] };
  }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (_) { return false; } }
  function dayStart(d) { var t = d ? new Date(d + 'T00:00:00').getTime() : NaN; return isFinite(t) ? t : null; }
  function dayEnd(d) { var t = d ? new Date(d + 'T23:59:59.999').getTime() : NaN; return isFinite(t) ? t : null; }
  function inRange(o, now) {
    var a = dayStart(o.from), b = dayEnd(o.to);
    return (a == null || now >= a) && (b == null || now <= b);
  }
  function matches(o, l) {
    var ids = o.items || [], cats = o.categories || [];
    var b = norm(l.barcode), p = norm(l.productId), c = norm(l.category);
    return (!!b && ids.indexOf(b) >= 0) || (!!p && ids.indexOf(p) >= 0) || (!!c && cats.indexOf(c) >= 0);
  }
  function offerLabel(o) {
    return o.name || (o.type === 'bxgy' ? tr('اشتري ' + o.buy + ' وخد ' + o.get, 'Buy ' + o.buy + ' get ' + o.get) : tr('خصم ' + o.pct + '%', o.pct + '% off'));
  }

  /* lines: [{barcode, productId, category, qty, gross, discount}] (gross = qty x price before any discount; discount = manual line discount)
     o: { coupon, now }  ->  { total, offerTotal, couponDiscount, lines: [null | {discount, name}], coupon: null | {code, discount}, couponError } */
  function evaluate(lines, o) {
    o = o || {};
    var s = load(), now = o.now || Date.now();
    var res = { total: 0, offerTotal: 0, couponDiscount: 0, lines: [], coupon: null, couponError: null };
    var base = 0;
    (lines || []).forEach(function (l) {
      var qty = Number(l.qty) || 0, net = Math.max(0, (Number(l.gross) || 0) - (Number(l.discount) || 0));
      var best = 0, bestOffer = null;
      if (qty > 0 && net > 0) {
        s.offers.forEach(function (of) {
          if (!of.active || !inRange(of, now) || !matches(of, l)) return;
          var d = 0;
          if (of.type === 'bxgy') {
            var free = Math.floor(qty / (of.buy + of.get)) * of.get;
            d = free > 0 ? net * free / qty : 0;
          } else if (of.type === 'pct') d = net * of.pct / 100;
          d = Math.min(f2(net), r2(d));
          if (d > best) { best = d; bestOffer = of; }
        });
      }
      res.lines.push(best > 0 ? { discount: best, name: offerLabel(bestOffer), id: bestOffer.id } : null);
      res.offerTotal = r2(res.offerTotal + best);
      base += net - best;
    });
    var code = String(o.coupon || '').trim().toUpperCase();
    if (code) {
      var c = null;
      s.coupons.forEach(function (x) { if (x.code === code) c = x; });
      if (!c) res.couponError = 'unknown';
      else if (!c.active) res.couponError = 'inactive';
      else if (!inRange(c, now)) res.couponError = 'expired';
      else if (c.maxUses && (c.uses || []).length >= c.maxUses && (c.uses || []).indexOf(o.saleId) < 0) res.couponError = 'used-up';
      else if (base <= 0 || base + 1e-9 < (Number(c.min) || 0)) res.couponError = 'below-min';
      else {
        var d = Math.min(f2(base), r2(c.kind === 'pct' ? base * c.value / 100 : c.value));
        if (d > 0) { res.couponDiscount = d; res.coupon = { code: code, discount: d, kind: c.kind, value: c.value }; }
        else res.couponError = 'below-min';
      }
    }
    res.total = r2(res.offerTotal + res.couponDiscount);
    return res;
  }

  /* Record that a coupon was used by a sale (idempotent per sale id). */
  function commit(saleId, code) {
    code = String(code || '').trim().toUpperCase();
    if (!code || !saleId) return false;
    var s = load(), hit = false;
    s.coupons.forEach(function (c) {
      if (c.code !== code) return;
      c.uses = c.uses || [];
      if (c.uses.indexOf(saleId) < 0) c.uses.push(saleId);
      hit = true;
    });
    return hit && save(s);
  }

  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function list(l) { return String(l || '').split(/[\s,،;]+/).map(norm).filter(Boolean); }
  function fail(e) { return { ok: false, error: e }; }
  function addOffer(d) {
    if (!canEdit()) return fail('forbidden');
    d = d || {};
    var o = { id: uid('o'), type: d.type, active: true, from: d.from || '', to: d.to || '', items: list(d.items), categories: list(d.categories), createdAt: new Date().toISOString() };
    if (o.from && dayStart(o.from) == null || o.to && dayEnd(o.to) == null) return fail('bad-date');
    if (o.from && o.to && o.to < o.from) return fail('bad-date');
    if (d.type === 'bxgy') {
      o.buy = Number(d.buy); o.get = Number(d.get); o.categories = [];
      if (!(isFinite(o.buy) && isFinite(o.get) && o.buy >= 1 && o.get >= 1 && Math.floor(o.buy) === o.buy && Math.floor(o.get) === o.get)) return fail('bad-number');
      if (!o.items.length) return fail('need-items');
    } else if (d.type === 'pct') {
      o.pct = Number(d.pct);
      if (!(o.pct > 0 && o.pct <= 100)) return fail('bad-number');
      if (!o.items.length && !o.categories.length) return fail('need-items');
    } else return fail('bad-type');
    var s = load(); s.offers.push(o);
    return save(s) ? { ok: true, offer: o } : fail('storage');
  }
  function addCoupon(d) {
    if (!canEdit()) return fail('forbidden');
    d = d || {};
    var code = String(d.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,20}$/.test(code)) return fail('bad-code');
    var c = { code: code, kind: d.kind === 'fixed' ? 'fixed' : d.kind === 'pct' ? 'pct' : '', value: Number(d.value), min: d.min === '' || d.min == null ? 0 : Number(d.min), to: d.to || '', from: '', active: true, uses: [] };
    if (!c.kind || !(isFinite(c.value) && c.value > 0) || (c.kind === 'pct' && c.value > 100)) return fail('bad-number');
    if (c.kind === 'fixed') c.value = r2(c.value);
    if (!(isFinite(c.min) && c.min >= 0)) return fail('bad-number');
    if (c.to && dayEnd(c.to) == null) return fail('bad-date');
    if (d.maxUses !== '' && d.maxUses != null) { c.maxUses = Number(d.maxUses); if (!(isFinite(c.maxUses) && c.maxUses >= 1) || Math.floor(c.maxUses) !== c.maxUses) return fail('bad-number'); }
    var s = load();
    if (s.coupons.some(function (x) { return x.code === code; })) return fail('duplicate');
    s.coupons.push(c);
    return save(s) ? { ok: true, coupon: c } : fail('storage');
  }
  function stop(kind, id) {
    if (!canEdit()) return fail('forbidden');
    var s = load(), hit = false;
    (kind === 'coupon' ? s.coupons : s.offers).forEach(function (x) { if ((kind === 'coupon' ? x.code : x.id) === id && x.active) { x.active = false; x.stoppedAt = new Date().toISOString(); hit = true; } });
    return hit && save(s) ? { ok: true } : fail('not-found');
  }
  function hasActiveCoupon() { var now = Date.now(); return load().coupons.some(function (c) { return c.active && inRange(c, now); }); }

  window.novaOffers = { evaluate: evaluate, commit: commit, addOffer: addOffer, addCoupon: addCoupon, stop: stop, list: load, canEdit: canEdit, label: offerLabel };

  function toast(m, t) { if (typeof window.showToast === 'function') window.showToast(m, t || 'success'); }
  var ERR = {
    forbidden: ['التغيير للمدير أو المالك بس.', 'Only a manager or the owner can change this.'],
    'bad-date': ['التاريخ مش مظبوط.', 'The date is not valid.'],
    'bad-number': ['راجع الأرقام اللي كتبتها.', 'Check the numbers you typed.'],
    'need-items': ['اكتب باركود صنف أو أكتر (أو قسم للخصم بالنسبة).', 'Type at least one item barcode (or a category for a percent offer).'],
    'bad-code': ['الكود من 3 لـ 20 حرف أو رقم من غير مسافات.', 'The code must be 3 to 20 letters or digits with no spaces.'],
    duplicate: ['الكود ده موجود قبل كده.', 'This code already exists.'],
    storage: ['تعذر الحفظ على الجهاز.', 'Could not save on this device.'],
    'bad-type': ['نوع العرض مش مظبوط.', 'The offer type is not valid.']
  };
  function errText(e) { var p = ERR[e] || ERR.storage; return tr(p[0], p[1]); }

  /* ---- checkout coupon box ---- */
  var COUPON_ERR = {
    unknown: ['الكوبون ده مش موجود.', 'This coupon does not exist.'],
    inactive: ['الكوبون ده اتوقف.', 'This coupon was stopped.'],
    expired: ['الكوبون ده انتهى.', 'This coupon has expired.'],
    'used-up': ['الكوبون ده خلص استخدامه.', 'This coupon has no uses left.'],
    'below-min': ['قيمة الفاتورة أقل من الحد الأدنى للكوبون.', 'The invoice is below the coupon minimum.'],
    'not-ready': ['الكوبونات لسه بتتحمّل. حاول تاني.', 'Coupons are still loading. Try again.']
  };
  function couponBox() {
    var host = document.querySelector('#checkoutModal .checkout-amount-display');
    if (!host) return null;
    var box = document.getElementById('novaCouponBox');
    if (!box) {
      box = document.createElement('div'); box.id = 'novaCouponBox'; box.style.cssText = 'margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:center';
      var inp = document.createElement('input'); inp.id = 'novaCouponInput'; inp.type = 'text'; inp.className = 'form-control'; inp.autocomplete = 'off'; inp.maxLength = 20; inp.style.cssText = 'max-width:180px;min-height:36px'; inp.setAttribute('aria-label', tr('كود الكوبون', 'Coupon code')); inp.placeholder = tr('كود الكوبون', 'Coupon code');
      var b = document.createElement('button'); b.type = 'button'; b.id = 'novaCouponApply'; b.className = 'btn btn-secondary'; b.textContent = tr('تطبيق', 'Apply');
      var m = document.createElement('div'); m.id = 'novaCouponMsg'; m.setAttribute('role', 'status'); m.style.cssText = 'flex-basis:100%;font-size:12px;text-align:center';
      box.appendChild(inp); box.appendChild(b); box.appendChild(m);
      var apply = function () {
        var C = window.novaSaleCoupon; if (!C) return;
        var r = C.set(inp.value);
        if (r.cleared) { m.textContent = ''; return; }
        if (r.ok) { inp.value = String(C.get()); m.style.color = '#86efac'; m.textContent = tr('اتطبّق الكوبون: خصم ', 'Coupon applied: discount ') + r.discount.toFixed(2); }
        else { var p = COUPON_ERR[r.error] || COUPON_ERR.unknown; m.style.color = '#fecaca'; m.textContent = tr(p[0], p[1]); }
      };
      b.addEventListener('click', apply);
      // Enter here applies the coupon; it must never reach the global "Enter = confirm the sale" handler.
      box.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); apply(); } });
      host.appendChild(box);
    }
    return box;
  }
  function syncCouponBox() {
    var modal = document.getElementById('checkoutModal');
    if (!modal || !modal.classList.contains('active')) return;
    var box = couponBox(); if (!box) return;
    var C = window.novaSaleCoupon, cur = C ? C.get() : '';
    box.hidden = !(hasActiveCoupon() || cur);
    var inp = document.getElementById('novaCouponInput'); if (inp && document.activeElement !== inp) inp.value = cur;
    var m = document.getElementById('novaCouponMsg');
    if (m) {
      if (!cur) m.textContent = '';
      else if (C) { // re-check: the cart may have changed since Apply
        var r = C.set(cur);
        if (r.ok) { m.style.color = '#86efac'; m.textContent = tr('اتطبّق الكوبون: خصم ', 'Coupon applied: discount ') + r.discount.toFixed(2); }
        else { var p = COUPON_ERR[r.error] || COUPON_ERR.unknown; m.style.color = '#fecaca'; m.textContent = tr(p[0], p[1]); if (inp) inp.value = ''; }
      }
    }
  }
  (function () {
    var modal = document.getElementById('checkoutModal');
    if (modal && window.MutationObserver && !modal.__novaCouponObs) { modal.__novaCouponObs = true; new MutationObserver(syncCouponBox).observe(modal, { attributes: true, attributeFilter: ['class'] }); }
    syncCouponBox();
  })();

  /* ---- settings card (manager / owner) ---- */
  var CARD_ID = 'novaOffersCard';
  function el(tag, props, kids) { var e = document.createElement(tag); Object.keys(props || {}).forEach(function (k) { if (k === 'text') e.textContent = props[k]; else e[k] = props[k]; }); (kids || []).forEach(function (c) { e.appendChild(c); }); return e; }
  function field(card, label, id, type, ph) {
    card.appendChild(el('label', { htmlFor: id, text: label }));
    var i = el('input', { id: id, type: type, className: 'form-control' }); if (ph) i.placeholder = ph;
    card.appendChild(i); return i;
  }
  function build(grid) {
    var card = el('div', { className: 'nova-setting-card', id: CARD_ID });
    card.appendChild(el('h3', { text: tr('العروض والكوبونات', 'Offers and coupons') }));
    var ro = !canEdit();
    card.appendChild(el('label', { htmlFor: 'noType', text: tr('نوع العرض', 'Offer type') }));
    var type = el('select', { id: 'noType', className: 'form-control' });
    [['bxgy', tr('اشتري وخد (نفس الصنف)', 'Buy and get (same item)')], ['pct', tr('خصم نسبة على أصناف أو قسم', 'Percent off items or a category')]].forEach(function (o) { type.appendChild(el('option', { value: o[0], text: o[1] })); });
    card.appendChild(type);
    var items = field(card, tr('باركود الأصناف (افصل بفاصلة)', 'Item barcodes (comma separated)'), 'noItems', 'text');
    var cats = field(card, tr('القسم (للخصم بالنسبة)', 'Category (percent offers)'), 'noCats', 'text');
    var buy = field(card, tr('اشتري', 'Buy'), 'noBuy', 'number', '2');
    var get = field(card, tr('وخد مجانًا', 'Get free'), 'noGet', 'number', '1');
    var pct = field(card, tr('نسبة الخصم (%)', 'Discount (%)'), 'noPct', 'number', '10');
    var from = field(card, tr('من تاريخ', 'From date'), 'noFrom', 'date');
    var to = field(card, tr('لحد تاريخ', 'To date'), 'noTo', 'date');
    var addO = el('button', { type: 'button', id: 'noAdd', className: 'btn btn-primary', text: tr('إضافة العرض', 'Add offer') });
    card.appendChild(addO);

    card.appendChild(el('h3', { text: tr('كوبون', 'Coupon') }));
    var code = field(card, tr('كود الكوبون', 'Coupon code'), 'ncCode', 'text');
    card.appendChild(el('label', { htmlFor: 'ncKind', text: tr('نوع الخصم', 'Discount type') }));
    var kind = el('select', { id: 'ncKind', className: 'form-control' });
    [['pct', tr('نسبة %', 'Percent %')], ['fixed', tr('مبلغ ثابت بالجنيه', 'Fixed amount (EGP)')]].forEach(function (o) { kind.appendChild(el('option', { value: o[0], text: o[1] })); });
    card.appendChild(kind);
    var val = field(card, tr('القيمة', 'Value'), 'ncValue', 'number');
    var min = field(card, tr('أقل قيمة للفاتورة', 'Minimum invoice amount'), 'ncMin', 'number', '0');
    var cto = field(card, tr('بيخلص في', 'Ends on'), 'ncTo', 'date');
    var max = field(card, tr('أقصى عدد استخدامات (اختياري)', 'Max uses (optional)'), 'ncMax', 'number');
    var addC = el('button', { type: 'button', id: 'ncAdd', className: 'btn btn-primary', text: tr('إضافة الكوبون', 'Add coupon') });
    card.appendChild(addC);

    var note = el('p', { id: 'noNote', text: ro ? tr('التغيير للمدير أو المالك بس.', 'Only a manager or the owner can change this.') : tr('العرض بيتطبّق لوحده في البيع وبيظهر ملاحظة تحت الصنف. خصم العروض مش بيحتاج موافقة مدير.', 'Offers apply by themselves in the sale and show a note under the item. Offer discounts do not need manager approval.') });
    card.appendChild(note);
    var listBox = el('div', { id: 'noList' }); card.appendChild(listBox);
    if (ro) [type, items, cats, buy, get, pct, from, to, addO, code, kind, val, min, cto, max, addC].forEach(function (x) { x.disabled = true; });

    function render() {
      listBox.textContent = '';
      var s = load(), n = 0;
      s.offers.concat(s.coupons).forEach(function (x) {
        if (!x.active) return; n++;
        var isC = !!x.code;
        var label = isC ? tr('كوبون ', 'Coupon ') + x.code + ' — ' + (x.kind === 'pct' ? x.value + '%' : x.value + tr(' جنيه', ' EGP')) + (x.min ? tr(' (من ', ' (min ') + x.min + ')' : '') : offerLabel(x) + (x.from || x.to ? ' (' + (x.from || '…') + ' → ' + (x.to || '…') + ')' : '');
        var row = el('div', { className: 'noRow' }, [el('span', { text: label + ' ' })]);
        var b = el('button', { type: 'button', className: 'btn btn-danger', text: tr('إيقاف', 'Stop') }); b.disabled = ro;
        b.addEventListener('click', function () { var r = stop(isC ? 'coupon' : 'offer', isC ? x.code : x.id); if (!r.ok) { toast(errText(r.error), 'error'); return; } toast(tr('اتوقف.', 'Stopped.')); render(); if (typeof window.novaRecalc === 'function') window.novaRecalc(); });
        row.appendChild(b); listBox.appendChild(row);
      });
      if (!n) listBox.appendChild(el('p', { text: tr('مفيش عروض شغالة.', 'No active offers.') }));
    }
    addO.addEventListener('click', function () {
      var r = addOffer({ type: type.value, items: items.value, categories: cats.value, buy: buy.value, get: get.value, pct: pct.value, from: from.value, to: to.value });
      if (!r.ok) { toast(errText(r.error), 'error'); return; }
      [items, cats, buy, get, pct, from, to].forEach(function (x) { x.value = ''; });
      toast(tr('اتضاف العرض.', 'Offer added.')); render();
      if (typeof window.novaRecalc === 'function') window.novaRecalc();
    });
    addC.addEventListener('click', function () {
      var r = addCoupon({ code: code.value, kind: kind.value, value: val.value, min: min.value, to: cto.value, maxUses: max.value });
      if (!r.ok) { toast(errText(r.error), 'error'); return; }
      [code, val, min, cto, max].forEach(function (x) { x.value = ''; });
      toast(tr('اتضاف الكوبون.', 'Coupon added.')); render();
    });
    render();
    grid.appendChild(card);
  }
  function ensure() {
    var page = document.getElementById('novaPageView'); if (!page) return;
    var grid = page.querySelector('.nova-settings-grid'); if (!grid || document.getElementById(CARD_ID)) return;
    build(grid);
  }
  var page = document.getElementById('novaPageView');
  if (page && window.MutationObserver && !page.__noObserved) { page.__noObserved = true; new MutationObserver(ensure).observe(page, { childList: true }); }
  ensure();
})();
