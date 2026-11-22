/* #94 / #100 settings card (lazy, settings page): cash rounding step (nova-rx-round-step) and the discount limit
   that needs a manager (nova-rx-discount-limit-pct). Only a manager/owner may change them when accounts exist. */
(function () {
  'use strict';
  var CARD_ID = 'novaSaleSettingsCard';
  var ROUND_KEY = 'nova-rx-round-step', DISC_KEY = 'nova-rx-discount-limit-pct';
  function en() { try { return localStorage.getItem('nova-rx-language') === 'en'; } catch (_) { return false; } }
  function tr(a, e) { return en() ? e : a; }
  function canEdit() {
    var A = window.novaAuth;
    if (!A || typeof A.hasAccounts !== 'function') return false;
    try {
      if (!A.hasAccounts()) return true;
      var me = A.current && A.current();
      return !!(me && (me.role === 'manager' || me.role === 'owner'));
    } catch (_) { return false; }
  }
  function get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function roundStep() { var v = parseFloat(get(ROUND_KEY)); return v === 0.25 || v === 0.5 || v === 1 ? v : 0; }
  function discLimit() { var v = parseFloat(get(DISC_KEY)); return isFinite(v) && v >= 0 && v <= 100 ? v : 10; }
  function toast(m, t) { if (typeof window.showToast === 'function') window.showToast(m, t || 'success'); }

  function build(grid) {
    var card = document.createElement('div');
    card.className = 'nova-setting-card';
    card.id = CARD_ID;
    var h = document.createElement('h3'); h.textContent = tr('قواعد البيع', 'Sale rules'); card.appendChild(h);

    var l1 = document.createElement('label'); l1.htmlFor = 'nssRound'; l1.textContent = tr('تقريب الدفع النقدي', 'Cash rounding'); card.appendChild(l1);
    var s = document.createElement('select'); s.id = 'nssRound'; s.className = 'form-control';
    [[0, tr('بدون تقريب', 'No rounding')], [0.25, tr('لأقرب ربع جنيه', 'Nearest 0.25 EGP')], [0.5, tr('لأقرب نص جنيه', 'Nearest 0.50 EGP')], [1, tr('لأقرب جنيه', 'Nearest 1 EGP')]].forEach(function (o) {
      var op = document.createElement('option'); op.value = String(o[0]); op.textContent = o[1]; s.appendChild(op);
    });
    s.value = String(roundStep());
    card.appendChild(s);

    var l2 = document.createElement('label'); l2.htmlFor = 'nssDisc'; l2.textContent = tr('أقصى خصم من غير موافقة مدير (%)', 'Largest discount without manager approval (%)'); card.appendChild(l2);
    var d = document.createElement('input'); d.id = 'nssDisc'; d.type = 'number'; d.min = '0'; d.max = '100'; d.step = '1'; d.className = 'form-control'; d.value = String(discLimit());
    card.appendChild(d);

    // q17 B: receipt prints right away after «تأكيد البيع»; this device setting (default OFF) brings the old preview back
    var pv = document.createElement('label'); pv.className = 'nova-check-row'; pv.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer';
    var pc = document.createElement('input'); pc.type = 'checkbox'; pc.id = 'nssReceiptPreview'; pc.checked = get('nova-rx-receipt-preview') === '1';
    pv.appendChild(pc); pv.appendChild(document.createTextNode(tr('عرض معاينة الإيصال قبل الطباعة', 'Show the receipt preview before printing')));
    pc.addEventListener('change', function () {
      try { if (pc.checked) localStorage.setItem('nova-rx-receipt-preview', '1'); else localStorage.removeItem('nova-rx-receipt-preview'); } catch (_) { toast(tr('تعذر الحفظ على الجهاز.', 'Could not save on this device.'), 'error'); return; }
      toast(pc.checked ? tr('هتظهر معاينة الإيصال قبل الطباعة.', 'The receipt preview will show before printing.') : tr('الإيصال هيتطبع على طول بعد البيع.', 'The receipt will print right after the sale.'));
    });
    card.appendChild(pv);

    var note = document.createElement('p'); note.id = 'nssNote';
    note.textContent = canEdit() ? tr('التقريب للنقدي بس، والإجمالي في الفاتورة بيفضل مظبوط.', 'Rounding applies to cash only. The invoice total stays exact.') : tr('التغيير للمدير أو المالك بس.', 'Only a manager or the owner can change this.');
    card.appendChild(note);

    var btn = document.createElement('button'); btn.type = 'button'; btn.id = 'nssSave'; btn.className = 'btn btn-primary'; btn.textContent = tr('حفظ قواعد البيع', 'Save sale rules');
    card.appendChild(btn);
    if (!canEdit()) { s.disabled = true; d.disabled = true; btn.disabled = true; }

    btn.addEventListener('click', function () {
      if (!canEdit()) { toast(tr('التغيير للمدير أو المالك بس.', 'Only a manager or the owner can change this.'), 'error'); return; }
      var raw = String(d.value).trim(), pct = Number(raw);
      if (raw === '' || !isFinite(pct) || pct < 0 || pct > 100) { toast(tr('حد الخصم لازم يكون من 0 لـ 100.', 'The discount limit must be from 0 to 100.'), 'error'); d.focus(); return; }
      try {
        localStorage.setItem(DISC_KEY, String(pct));
        var st = Number(s.value);
        if (window.novaRounding && typeof window.novaRounding.set === 'function') window.novaRounding.set(st);
        else if (st > 0) localStorage.setItem(ROUND_KEY, String(st)); else localStorage.removeItem(ROUND_KEY);
      } catch (_) { toast(tr('تعذر الحفظ على الجهاز.', 'Could not save on this device.'), 'error'); return; }
      toast(tr('اتحفظت قواعد البيع.', 'Sale rules saved.'));
    });
    grid.appendChild(card);
  }

  function ensure() {
    var page = document.getElementById('novaPageView'); if (!page) return;
    var grid = page.querySelector('.nova-settings-grid'); if (!grid || document.getElementById(CARD_ID)) return;
    build(grid);
  }
  var page = document.getElementById('novaPageView');
  if (page && window.MutationObserver && !page.__nssObserved) { page.__nssObserved = true; new MutationObserver(ensure).observe(page, { childList: true }); }
  ensure();
  window.novaSaleSettings = { roundStep: roundStep, discountLimit: discLimit };
})();
