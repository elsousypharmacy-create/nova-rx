/* NOVA Rx — CREDIT-LIMIT (#116) «حد الائتمان للعميل». Reviewed Gemini Neon draft, integrated by Claude; loaded lazily (app/548) on the
   customers page. window.novaCreditLimit.check(customerId, amount) is for the sale screen (wired by the sale lane).
   Vanilla JS, no framework, no template literals.
   Integrates with app/130-pages-nav.js via DOM hooks (MutationObserver) and credit-ledger.js.
   Exports pure helpers via module.exports in Node; attaches window.novaCreditLimit in browser. */
(function (root) {
  'use strict';

  var LEDGER_KEY = 'nova.credit';
  var LOG_KEY = 'nova-rx-credit-limit-log-v1';
  var TOLERANCE = 0.005;

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /**
   * Pure credit limit check.
   * @param {number} balance - current customer debt (>= 0)
   * @param {number|null|undefined} limit - credit limit or null/undefined for no limit
   * @param {number} extraAmount - additional credit amount being requested (>= 0)
   * @returns {{ ok: boolean, limit: number|null, balance: number, available: number|null, after: number }}
   */
  function checkLimit(balance, limit, extraAmount) {
    var bal = (typeof balance === 'number' && isFinite(balance)) ? round2(balance) : 0;
    var extra = (typeof extraAmount === 'number' && isFinite(extraAmount) && extraAmount > 0) ? round2(extraAmount) : 0;
    var lim = (limit === null || limit === undefined) ? null : ((typeof limit === 'number' && isFinite(limit) && limit >= 0) ? round2(limit) : null);
    var after = round2(bal + extra);
    if (lim === null) {
      return { ok: true, limit: null, balance: bal, available: null, after: after };
    }
    var available = round2(lim - bal);
    var ok = after <= lim + TOLERANCE;
    return { ok: ok, limit: lim, balance: bal, available: available, after: after };
  }

  /**
   * Pure badge status helper for customers list.
   * @returns {'over'|'near'|'ok'}
   */
  function badgeStatus(balance, limit) {
    if (limit === null || limit === undefined || typeof limit !== 'number' || !isFinite(limit) || limit < 0) {
      return 'ok';
    }
    var bal = (typeof balance === 'number' && isFinite(balance)) ? balance : 0;
    if (bal > limit + TOLERANCE) return 'over';
    if (limit > 0 && bal >= (limit * 0.8) - TOLERANCE) return 'near';
    return 'ok';
  }

  // Node / CommonJS export for unit tests
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      checkLimit: checkLimit,
      badgeStatus: badgeStatus,
      TOLERANCE: TOLERANCE
    };
  }

  // Stop here if running outside browser
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  var lastCustId = null, lastAt = 0;
  var scheduled = false;

  function getLedger() {
    if (!window.NovaCredit || typeof window.NovaCredit.createCreditLedger !== 'function') return null;
    try {
      return window.NovaCredit.createCreditLedger(window.localStorage, LEDGER_KEY);
    } catch (e) {
      return null;
    }
  }

  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var v = round2(n);
    if (window.NovaFmt && typeof window.NovaFmt.money === 'function') {
      return window.NovaFmt.money(v);
    }
    return v.toFixed(2) + ' ج.م';
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeDigits(str) {
    return String(str == null ? '' : str)
      .replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); })
      .replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); })
      .trim();
  }

  function currentActor() {
    try {
      var au = window.novaAuth && typeof window.novaAuth.current === 'function' ? window.novaAuth.current() : null;
      if (au && (au.name || au.id)) return String(au.name || au.id);
    } catch (e) {}
    return 'local';
  }

  function canManageAccounts() {
    if (!window.novaPerms || typeof window.novaPerms.require !== 'function') {
      return !window.novaAuth;   // no auth system on this build: nothing to check; auth present but perms not ready: refuse
    }
    try {
      var res = window.novaPerms.require('accounts.manage');
      return res !== false;
    } catch (e) {
      return false;
    }
  }

  function appendLog(customerId, fromVal, toVal, by) {
    try {
      var raw = window.localStorage.getItem(LOG_KEY);
      var arr = [];
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) arr = parsed;
      }
      arr.push({
        customerId: String(customerId),
        from: fromVal === undefined ? null : fromVal,
        to: toVal === undefined ? null : toVal,
        by: by ? String(by) : currentActor(),
        at: new Date().toISOString()
      });
      window.localStorage.setItem(LOG_KEY, JSON.stringify(arr));
    } catch (e) {
      // Ignore storage quota errors on audit log so limit update still succeeds
    }
  }

  function notify(msg) {
    if (typeof window.novaToast === 'function') {
      window.novaToast(msg);
      return;
    }
    var t = document.getElementById('toastContainer');
    if (t) {
      t.innerHTML = '<div class="toast" role="status"><span dir="auto">' + escHtml(msg) + '</span></div>';
      setTimeout(function () { t.replaceChildren(); }, 3000);
    }
  }

  // --- Public API for sale screen & external callers ---

  function apiLimit(customerId) {
    var l = getLedger();
    if (!l || customerId == null || String(customerId) === '') return null;
    try {
      return l.limitOf(String(customerId));
    } catch (e) {
      return null;
    }
  }

  function apiCheck(customerId, extraAmount) {
    var l = getLedger();
    var id = String(customerId == null ? '' : customerId);
    var bal = 0;
    var lim = null;
    if (l && id) {
      try { bal = l.balance(id); } catch (e) { bal = 0; }
      try { lim = l.limitOf(id); } catch (e) { lim = null; }
    }
    return checkLimit(bal, lim, extraAmount);
  }

  function apiSetLimit(customerId, value, by) {
    if (!canManageAccounts()) throw new Error('forbidden');
    var l = getLedger();
    if (!l) throw new Error('ledger-unavailable');
    var id = String(customerId == null ? '' : customerId);
    if (!id) throw new Error('missing-customer');
    var prev = l.limitOf(id);
    var next = (value === null || value === '' || value === undefined) ? null : Number(value);
    if (next !== null && (!isFinite(next) || next < 0)) {
      throw new Error('bad-limit');
    }
    if (next !== null) next = round2(next);
    l.setLimit(id, next);
    appendLog(id, prev, next, by);
    scheduleScan();
    return next;
  }

  window.novaCreditLimit = {
    check: apiCheck,
    limit: apiLimit,
    setLimit: apiSetLimit
  };

  // --- Track which customer row opened #novaCustDetail ---

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var row = t.closest('tr[data-cust-row]');
    if (row) {
      lastCustId = row.getAttribute('data-cust-row'); lastAt = Date.now();
    }
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var t = e.target;
    if (!t || !t.closest) return;
    var row = t.closest('tr[data-cust-row]');
    if (row) {
      lastCustId = row.getAttribute('data-cust-row'); lastAt = Date.now();
    }
  }, true);

  function resolveDialogCustomerId(dlg) {
    var titleEl = dlg.querySelector('#novaCustDetailT');
    var sq = function (x) { return String(x || '').replace(/\s+/g, ''); };
    var full = sq(titleEl ? titleEl.textContent : ''), arOnly = sq(titleEl ? titleEl.textContent.replace(/\s*\([^)]*\)\s*$/, '') : '');
    if (!full) return null;
    var rowName = function (r) { var a = r.querySelector('.nova-cust-ar'); return sq(a ? a.textContent : ''); };
    var same = function (r) { var n = rowName(r); return !!n && (n === full || n === arOnly); };
    if (lastCustId && Date.now() - lastAt < 3000) {
      var last = document.querySelector('tr[data-cust-row="' + String(lastCustId).replace(/"/g, '') + '"]');
      if (last && same(last)) return lastCustId;
    }
    var hits = [].slice.call(document.querySelectorAll('tr[data-cust-row]')).filter(same);
    return hits.length === 1 ? hits[0].getAttribute('data-cust-row') : null;
  }

  // --- 1. Customer Details Dialog Injection ---

  function renderLimitSection(container, customerId) {
    var l = getLedger();
    var bal = 0;
    var lim = null;
    var ag = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 };

    if (l) {
      try { bal = l.balance(customerId); } catch (e) {}
      try { lim = l.limitOf(customerId); } catch (e) {}
      try { ag = l.aging(customerId); } catch (e) {}
    }

    var chk = checkLimit(bal, lim, 0);
    var availColor = (chk.available !== null && chk.available < 0) ? '#ff5d5d' : '#79c9eb';
    var limLabel = lim === null ? 'بدون حد' : fmtMoney(lim);
    var availLabel = chk.available === null ? '—' : fmtMoney(chk.available);

    var html = ''
      + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">'
      +   '<span style="color:#9eacb9;font-weight:700">حد الائتمان</span>'
      +   '<div style="display:flex;align-items:center;gap:8px">'
      +     '<strong data-cl-limit-val>' + escHtml(limLabel) + '</strong>'
      +     '<button type="button" class="btn btn-secondary" data-cl-edit style="min-height:36px;padding:4px 10px;font-size:13px">تعديل الحد</button>'
      +   '</div>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;font-size:13px">'
      +   '<div style="background:#14181d;border:1px solid #343b44;border-radius:8px;padding:6px 8px">'
      +     '<div style="color:#9eacb9;font-size:12px">الرصيد الحالي</div>'
      +     '<strong data-cl-balance style="color:' + (bal > 0 ? '#ff8a8f' : '#e8eef3') + '">' + escHtml(fmtMoney(bal)) + '</strong>'
      +   '</div>'
      +   '<div style="background:#14181d;border:1px solid #343b44;border-radius:8px;padding:6px 8px">'
      +     '<div style="color:#9eacb9;font-size:12px">المتاح</div>'
      +     '<strong data-cl-available style="color:' + availColor + '">' + escHtml(availLabel) + '</strong>'
      +   '</div>'
      + '</div>'
      + '<div style="font-size:12px;color:#9eacb9;margin-bottom:4px">تعمير المديونية</div>'
      + '<div data-cl-aging style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;text-align:center;font-size:11px">'
      +   '<div style="background:#14181d;border:1px solid #343b44;border-radius:6px;padding:4px 2px"><div style="color:#9eacb9">جاري</div><strong>' + escHtml(round2(ag.current)) + '</strong></div>'
      +   '<div style="background:#14181d;border:1px solid #343b44;border-radius:6px;padding:4px 2px"><div style="color:#9eacb9">1-30</div><strong>' + escHtml(round2(ag.d1_30)) + '</strong></div>'
      +   '<div style="background:#14181d;border:1px solid #343b44;border-radius:6px;padding:4px 2px"><div style="color:#9eacb9">31-60</div><strong>' + escHtml(round2(ag.d31_60)) + '</strong></div>'
      +   '<div style="background:#14181d;border:1px solid #343b44;border-radius:6px;padding:4px 2px"><div style="color:#9eacb9">61-90</div><strong>' + escHtml(round2(ag.d61_90)) + '</strong></div>'
      +   '<div style="background:#14181d;border:1px solid #343b44;border-radius:6px;padding:4px 2px"><div style="color:#ff8a8f">90+</div><strong>' + escHtml(round2(ag.d90_plus)) + '</strong></div>'
      + '</div>'
      + '<div data-cl-perm-err role="alert" style="color:#ff8a8f;font-size:13px;margin-top:6px;min-height:0"></div>'
      + '<div data-cl-form-wrap></div>';

    container.innerHTML = html;

    var editBtn = container.querySelector('[data-cl-edit]');
    var permErr = container.querySelector('[data-cl-perm-err]');
    var formWrap = container.querySelector('[data-cl-form-wrap]');

    editBtn.addEventListener('click', function () {
      permErr.textContent = '';
      if (!canManageAccounts()) {
        permErr.textContent = 'محتاج صلاحية مدير';
        return;
      }
      if (formWrap.querySelector('[data-cl-form]')) {
        formWrap.innerHTML = '';
        return;
      }
      var initVal = lim === null ? '' : String(lim);
      formWrap.innerHTML = ''
        + '<div data-cl-form style="margin-top:10px;padding-top:10px;border-top:1px solid #343b44">'
        +   '<label for="novaClInput" style="display:block;font-size:13px;margin-bottom:4px;color:#e8eef3">حد الائتمان الجديد (سيبه فاضي = بدون حد)</label>'
        +   '<input id="novaClInput" type="text" inputmode="decimal" autocomplete="off" dir="ltr" value="' + escHtml(initVal) + '" placeholder="بدون حد" style="width:100%;min-height:40px;padding:6px 10px;background:#14181d;color:#e8eef3;border:1px solid #343b44;border-radius:8px;box-sizing:border-box;text-align:left">'
        +   '<div data-cl-err role="alert" style="color:#ff8a8f;font-size:12px;min-height:18px;margin-top:4px"></div>'
        +   '<div style="display:flex;gap:8px;margin-top:6px">'
        +     '<button type="button" class="btn btn-primary" data-cl-save style="min-height:40px;flex:1">حفظ</button>'
        +     '<button type="button" class="btn btn-secondary" data-cl-cancel style="min-height:40px">إلغاء</button>'
        +   '</div>'
        + '</div>';

      var inp = formWrap.querySelector('#novaClInput');
      var errEl = formWrap.querySelector('[data-cl-err]');
      var saveBtn = formWrap.querySelector('[data-cl-save]');
      var cancelBtn = formWrap.querySelector('[data-cl-cancel]');

      inp.focus();
      inp.select();

      function doSave() {
        errEl.textContent = '';
        var raw = normalizeDigits(inp.value).replace(/[٫,]/g, '.');
        var nextVal = null;
        if (raw !== '') {
          var num = /^\d+(\.\d{1,2})?$/.test(raw) ? Number(raw) : NaN;
          if (!isFinite(num) || num < 0) {
            errEl.textContent = 'اكتب رقم 0 أو أكبر، أو سيبه فاضي لـ بدون حد';
            inp.focus();
            return;
          }
          nextVal = round2(num);
        }
        try {
          apiSetLimit(customerId, nextVal);
          renderLimitSection(container, customerId);
          var eb = container.querySelector('[data-cl-edit]'); if (eb) eb.focus();
          notify(nextVal === null ? 'تم إلغاء حد الائتمان' : 'تم تحديث حد الائتمان إلى ' + fmtMoney(nextVal));
        } catch (e) {
          errEl.textContent = 'تعذر حفظ حد الائتمان';
        }
      }

      saveBtn.addEventListener('click', doSave);
      cancelBtn.addEventListener('click', function () {
        formWrap.innerHTML = '';
        editBtn.focus();
      });
      inp.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          ev.stopPropagation();
          doSave();
        }
      });
    });
  }

  function enhanceCustomerDialog() {
    var dlg = document.getElementById('novaCustDetail');
    if (!dlg) return;
    if (dlg.querySelector('#novaCustCreditLimit')) return;

    var customerId = resolveDialogCustomerId(dlg);
    if (!customerId) {
      // the list may be re-rendering right now: try again shortly (bounded), never guess
      var tries = Number(dlg.getAttribute('data-cl-tries') || 0);
      if (tries < 5) { dlg.setAttribute('data-cl-tries', String(tries + 1)); setTimeout(scheduleScan, 300); }
      return;
    }

    var card = dlg.firstElementChild;
    if (!card) return;

    var section = document.createElement('section');
    section.id = 'novaCustCreditLimit';
    section.setAttribute('aria-label', 'حد الائتمان');
    section.setAttribute('data-cl-cust', customerId);
    section.style.cssText = 'margin-top:12px;padding:10px;background:#1b2027;border:1px solid #343b44;border-radius:10px';

    // Insert before the action buttons row (last div in card)
    var actions = card.lastElementChild;
    if (actions && actions.tagName === 'DIV') {
      card.insertBefore(section, actions);
    } else {
      card.appendChild(section);
    }

    renderLimitSection(section, customerId);
    mountCustomerEdit(card, actions, customerId);
  }

  function mountCustomerEdit(card, actions, customerId) {
    if (!actions || actions.querySelector('[data-ce-btn]')) return;
    var custs = (window.NOVA_DEMO && Array.isArray(window.NOVA_DEMO.customers)) ? window.NOVA_DEMO.customers : [];
    var cust = custs.find(function (c) { return String(c.id) === String(customerId); });
    if (!cust) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nova-return-btn btn btn-secondary';
    btn.style.minHeight = '44px';
    btn.setAttribute('data-ce-btn', '');
    btn.textContent = 'تعديل البيانات'; // Edit details
    actions.insertBefore(btn, actions.firstChild);

    var wrap = document.createElement('div');
    wrap.id = 'novaCustEditWrap';
    card.insertBefore(wrap, actions);

    btn.addEventListener('click', function () {
      if (wrap.firstChild) { wrap.innerHTML = ''; return; }
      wrap.innerHTML = ''
        + '<div data-ce-form style="margin-top:12px;padding:10px;background:#1b2027;border:1px solid #343b44;border-radius:10px">'
        +   '<label for="novaCeName" style="display:block;font-size:13px;margin-bottom:4px">الاسم</label>' // Name
        +   '<input id="novaCeName" type="text" value="' + escHtml(cust.name) + '" style="width:100%;min-height:40px;padding:6px 10px;background:#14181d;color:#e8eef3;border:1px solid #343b44;border-radius:8px;box-sizing:border-box;margin-bottom:8px">'
        +   '<label for="novaCePhone" style="display:block;font-size:13px;margin-bottom:4px">رقم الهاتف (9 إلى 15 رقمًا)</label>' // Phone number (9 to 15 digits)
        +   '<input id="novaCePhone" type="tel" inputmode="tel" dir="ltr" value="' + escHtml(cust.phone) + '" style="width:100%;min-height:40px;padding:6px 10px;background:#14181d;color:#e8eef3;border:1px solid #343b44;border-radius:8px;box-sizing:border-box;text-align:left">'
        +   '<div data-ce-err role="alert" style="color:#ff8a8f;font-size:12px;min-height:18px;margin-top:6px"></div>'
        +   '<div style="display:flex;gap:8px;margin-top:6px">'
        +     '<button type="button" class="btn btn-primary" data-ce-save style="min-height:40px;flex:1">حفظ</button>' // Save
        +     '<button type="button" class="btn btn-secondary" data-ce-cancel style="min-height:40px">إلغاء</button>' // Cancel
        +   '</div>'
        + '</div>';
      var nm = wrap.querySelector('#novaCeName'), ph = wrap.querySelector('#novaCePhone'), err = wrap.querySelector('[data-ce-err]');
      var digits = function (v) { return normalizeDigits(v).replace(/[^0-9]/g, ''); };
      nm.focus();
      wrap.querySelector('[data-ce-cancel]').addEventListener('click', function () { wrap.innerHTML = ''; btn.focus(); });
      wrap.querySelector('[data-ce-save]').addEventListener('click', function () {
        var name = nm.value.trim(), phone = digits(ph.value);
        if (!name) { err.textContent = 'اكتب اسم العميل'; nm.focus(); return; } // Enter customer name
        if (phone.length < 9 || phone.length > 15) { err.textContent = 'رقم الهاتف من 9 إلى 15 رقمًا'; ph.focus(); return; } // Phone number must be 9 to 15 digits
        var dup = custs.find(function (c) { return String(c.id) !== String(cust.id) && digits(c.phone) === phone; });
        if (dup) { err.textContent = 'هذا الرقم مسجّل بالفعل للعميل: ' + dup.name; ph.focus(); return; } // This number is already registered to customer
        cust.name = name; cust.phone = phone;
        try { window.localStorage.setItem('nova-rx-demo-customers-v1', JSON.stringify(custs.filter(function (x) { return String(x.id).indexOf('DEMO-') === 0; }))); } catch (e) {}
        var title = card.querySelector('#novaCustDetailT'); if (title) title.textContent = name;
        var row = document.querySelector('tr[data-cust-row="' + String(cust.id).replace(/"/g, '') + '"]');
        if (row) {
          var ar = row.querySelector('.nova-cust-ar'); if (ar) ar.textContent = name;
          var en = row.querySelector('.nova-cust-en'); if (en) en.textContent = '';
          var pTd = row.querySelector('.nova-cust-phone'); if (pTd) pTd.textContent = phone;
        }
        wrap.innerHTML = '';
        notify('تم تحديث بيانات العميل'); // Customer details updated
      });
    });
  }

  // --- 2. Customers List Badges ---

  function enhanceCustomerRows() {
    var rows = document.querySelectorAll('tr[data-cust-row]');
    if (!rows.length) return;
    var l = getLedger();
    if (!l) return;

    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      var id = tr.getAttribute('data-cust-row');
      if (!id) continue;

      var bal = 0;
      var lim = null;
      try { bal = l.balance(id); } catch (e) { bal = 0; }
      try { lim = l.limitOf(id); } catch (e) { lim = null; }

      var sig = String(bal) + '|' + String(lim === null ? 'null' : lim);
      if (tr.getAttribute('data-cl-sig') === sig) continue;
      tr.setAttribute('data-cl-sig', sig);

      var nameCell = tr.querySelector('td.nova-cust-name') || tr.querySelector('td');
      if (!nameCell) continue;

      var existing = nameCell.querySelector('[data-cl-badge]');
      var st = badgeStatus(bal, lim);

      if (st === 'ok') {
        if (existing) existing.remove();
        continue;
      }

      if (!existing) {
        existing = document.createElement('span');
        existing.className = 'nova-chip';
        existing.setAttribute('data-cl-badge', st);
        nameCell.appendChild(document.createTextNode(' '));
        nameCell.appendChild(existing);
      } else {
        existing.setAttribute('data-cl-badge', st);
      }

      if (st === 'over') {
        existing.textContent = 'فوق الحد';
        existing.style.cssText = 'display:inline-block;margin-inline-start:6px;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:700;background:rgba(255,93,93,.18);color:#ff8a8f;border:1px solid rgba(255,93,93,.45)';
      } else {
        existing.textContent = 'قرب الحد';
        existing.style.cssText = 'display:inline-block;margin-inline-start:6px;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:700;background:rgba(255,207,107,.16);color:#ffcf6b;border:1px solid rgba(255,207,107,.45)';
      }
    }
  }

  // --- Single MutationObserver on document.body ---

  function runScan() {
    scheduled = false;
    enhanceCustomerDialog();
    enhanceCustomerRows();
  }

  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(runScan);
    } else {
      setTimeout(runScan, 0);
    }
  }

  function initObserver() {
    if (!document.body || typeof MutationObserver === 'undefined') return;
    var obs = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes || [];
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1 || (n.hasAttribute && n.hasAttribute('data-cl-badge')) || (n.closest && n.closest('#novaCustCreditLimit'))) continue;
          if (n.id === 'novaCustDetail' || (n.matches && n.matches('tr[data-cust-row]')) || (n.querySelector && n.querySelector('#novaCustDetail, tr[data-cust-row]'))) { scheduleScan(); return; }
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    scheduleScan();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initObserver);
  } else {
    initObserver();
  }
})(typeof window !== 'undefined' ? window : this);