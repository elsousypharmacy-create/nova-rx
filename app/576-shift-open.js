// app/576-shift-open.js — #75 Shift open with opening float & cash denomination counter
(function () {
  'use strict';

  var SHIFT_KEY = 'nova-rx-shift-v1';
  var CLOSINGS_KEY = 'nova-rx-shift-closings-v1';
  var OPENS_KEY = 'nova-rx-shift-opens-v1';
  var LANG_KEY = 'nova-rx-language';
  var DENOMS = [
    { v: 200, p: 20000, ar: '200 ج.م', en: '200 EGP' },
    { v: 100, p: 10000, ar: '100 ج.م', en: '100 EGP' },
    { v: 50, p: 5000, ar: '50 ج.م', en: '50 EGP' },
    { v: 20, p: 2000, ar: '20 ج.م', en: '20 EGP' },
    { v: 10, p: 1000, ar: '10 ج.م', en: '10 EGP' },
    { v: 5, p: 500, ar: '5 ج.م', en: '5 EGP' },
    { v: 1, p: 100, ar: '1 ج.م', en: '1 EGP' },
    { v: 0.5, p: 50, ar: '50 قرش', en: '50 PT' },
    { v: 0.25, p: 25, ar: '25 قرش', en: '25 PT' }
  ];
  var handledClosings = {};

  function isEn() {
    try { return localStorage.getItem(LANG_KEY) === 'en'; } catch (e) { return false; }
  }

  function t(k) {
    var en = isEn();
    var map = {
      notOpen: en ? 'Shift is not open' : 'الوردية مش مفتوحة',
      openBtn: en ? 'Open shift' : 'افتح الوردية',
      openTitle: en ? 'Opening cash in the drawer' : 'رصيد الدرج في أول الوردية',
      openAction: en ? 'Open' : 'افتح',
      cancel: en ? 'Cancel' : 'إلغاء',
      openedToast: en ? 'Shift opened' : 'اتفتحت الوردية',
      countBtn: en ? 'Count by notes' : 'عدّ بالفئات',
      useTotal: en ? 'Use total' : 'استخدم المجموع',
      total: en ? 'Total' : 'المجموع',
      cur: en ? 'EGP' : 'ج.م',
      since: en ? 'Shift open since' : 'الوردية مفتوحة من',
      by: en ? 'opened by' : 'فتحها',
      flt: en ? 'opening float' : 'رصيد الافتتاح'
    };
    return map[k] || '';
  }

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (e) { return fallback; }
  }

  function writeJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function getState() {
    var st = readJson(SHIFT_KEY, {});
    return Array.isArray(st) ? {} : st;
  }

  function currentUserName() {
    try {
      var u = window.novaAuth && window.novaAuth.current && window.novaAuth.current();
      return (u && u.name) ? String(u.name) : '';
    } catch (e) { return ''; }
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function fmtTime(ms) {
    var d = new Date(ms);
    var hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    var dm = pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1);
    return isEn() ? (hm + ' ' + dm) : (hm + ' يوم ' + dm);
  }

  function denomTotal(counts) {
    var piasters = 0;
    if (counts && typeof counts === 'object') {
      for (var i = 0; i < DENOMS.length; i++) {
        var key = String(DENOMS[i].v);
        var c = parseInt(counts[key], 10);
        if (c > 0) piasters += c * DENOMS[i].p;
      }
    }
    return Math.round(piasters) / 100;
  }

  function fireEvent(el, type) {
    if (!el) return;
    var ev;
    try { ev = new Event(type, { bubbles: true }); }
    catch (e) { ev = document.createEvent('Event'); ev.initEvent(type, true, false); }
    el.dispatchEvent(ev);
  }

  function openShift(amount) {
    var num = Number(amount);
    if (!isFinite(num) || num < 0) return false;
    num = Math.round((num + Number.EPSILON) * 100) / 100;
    var st = getState();
    st.float = num;
    st.openedAt = Date.now();
    st.openedBy = currentUserName();
    delete st.counted;
    delete st.denoms;
    delete st.closedId;
    delete st.closedAt;
    writeJson(SHIFT_KEY, st);
    var sumBox = document.getElementById('novaShiftSummary');
    if (sumBox && sumBox.parentNode) sumBox.parentNode.removeChild(sumBox);
    var msgEl = document.getElementById('novaShiftMsg');
    if (msgEl) msgEl.textContent = '';
    var closeBtn = document.getElementById('novaShiftDo');
    if (closeBtn) closeBtn.disabled = false;
    var fltInput = document.getElementById('novaShiftFloat');
    if (fltInput) {
      fltInput.value = String(num);
      fireEvent(fltInput, 'change');
    }
    renderStatusBox();
    if (typeof window.showToast === 'function') {
      window.showToast(t('openedToast'), 'success');
    }
    return true;
  }

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!attrs.hasOwnProperty(k)) continue;
        if (k === 'className') node.className = attrs[k];
        else if (k === 'style') node.style.cssText = attrs[k];
        else node.setAttribute(k, attrs[k]);
      }
    }
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function createModal(titleText) {
    var prevFocus = document.activeElement;
    var overlay = el('div', {
      style: 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.68);display:flex;align-items:center;justify-content:center;padding:16px;'
    });
    var dialog = el('div', {
      role: 'dialog',
      'aria-modal': 'true',
      style: 'background:#14181d;color:#e6edf3;border:1px solid #343b44;border-radius:10px;padding:18px;width:100%;max-width:420px;max-height:90vh;overflow:auto;box-shadow:0 12px 32px rgba(0,0,0,0.5);'
    });
    var heading = el('h3', { style: 'margin:0 0 14px;font-size:16px;color:#79c9eb;' }, titleText);
    dialog.appendChild(heading);
    overlay.appendChild(dialog);

    function close() {
      document.removeEventListener('keydown', onKey, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (prevFocus && typeof prevFocus.focus === 'function') {
        try { prevFocus.focus(); } catch (e) {}
      }
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Tab') {
        var nodes = dialog.querySelectorAll('button,input,[tabindex]:not([tabindex="-1"])');
        if (!nodes.length) return;
        var first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    return { dialog: dialog, close: close };
  }

  function showOpenDialog() {
    var m = createModal(t('openTitle'));
    var form = el('form');
    var input = el('input', {
      type: 'number', min: '0', step: '0.01', required: 'required',
      style: 'width:100%;min-height:44px;padding:8px 12px;background:#0d1117;color:#e6edf3;border:1px solid #343b44;border-radius:6px;box-sizing:border-box;margin-bottom:14px;font-size:15px;'
    });
    var actions = el('div', { style: 'display:flex;gap:8px;justify-content:flex-end;' });
    var btnCancel = el('button', { type: 'button', className: 'btn btn-secondary', style: 'min-height:44px;' }, t('cancel'));
    var btnOk = el('button', { type: 'submit', className: 'btn btn-primary', style: 'min-height:44px;' }, t('openAction'));
    btnCancel.addEventListener('click', m.close);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (input.value === '') return;
      if (openShift(input.value)) m.close();
    });
    actions.appendChild(btnCancel);
    actions.appendChild(btnOk);
    form.appendChild(input);
    form.appendChild(actions);
    m.dialog.appendChild(form);
    input.focus();
  }

  function showDenomDialog() {
    var m = createModal(t('countBtn'));
    var saved = (getState().denoms && typeof getState().denoms === 'object') ? getState().denoms : {};
    var inputs = {};
    var subs = {};
    var list = el('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-bottom:14px;' });
    var totalEl = el('div', {
      style: 'display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#0d1117;border:1px solid #343b44;border-radius:6px;margin-bottom:14px;font-weight:700;color:#79c9eb;'
    });
    var totalLabel = el('span', null, t('total'));
    var totalVal = el('span', { id: 'novaShiftDenomTotal' }, '0.00 ' + t('cur'));
    totalEl.appendChild(totalLabel);
    totalEl.appendChild(totalVal);

    function collectCounts() {
      var out = {};
      for (var i = 0; i < DENOMS.length; i++) {
        var k = String(DENOMS[i].v);
        var n = parseInt(inputs[k].value, 10);
        if (n > 0) out[k] = n;
      }
      return out;
    }

    function recalc() {
      var counts = collectCounts();
      for (var i = 0; i < DENOMS.length; i++) {
        var k = String(DENOMS[i].v);
        var c = counts[k] || 0;
        subs[k].textContent = ((c * DENOMS[i].p) / 100).toFixed(2);
      }
      totalVal.textContent = denomTotal(counts).toFixed(2) + ' ' + t('cur');
    }

    for (var i = 0; i < DENOMS.length; i++) {
      (function (d) {
        var k = String(d.v);
        var row = el('div', { style: 'display:grid;grid-template-columns:1fr 90px 80px;gap:8px;align-items:center;' });
        var lbl = el('span', null, isEn() ? d.en : d.ar);
        var inp = el('input', {
          type: 'number', min: '0', step: '1', 'data-denom': k,
          value: saved[k] ? String(saved[k]) : '',
          style: 'min-height:44px;padding:6px 8px;background:#0d1117;color:#e6edf3;border:1px solid #343b44;border-radius:6px;width:100%;box-sizing:border-box;'
        });
        var sub = el('span', { style: 'text-align:end;color:#9fb0c0;font-variant-numeric:tabular-nums;' }, '0.00');
        inp.addEventListener('input', recalc);
        inputs[k] = inp;
        subs[k] = sub;
        row.appendChild(lbl);
        row.appendChild(inp);
        row.appendChild(sub);
        list.appendChild(row);
      })(DENOMS[i]);
    }

    var actions = el('div', { style: 'display:flex;gap:8px;justify-content:flex-end;' });
    var btnCancel = el('button', { type: 'button', className: 'btn btn-secondary', style: 'min-height:44px;' }, t('cancel'));
    var btnUse = el('button', { type: 'button', className: 'btn btn-primary', style: 'min-height:44px;' }, t('useTotal'));
    btnCancel.addEventListener('click', m.close);
    btnUse.addEventListener('click', function () {
      var counts = collectCounts();
      var tot = denomTotal(counts);
      var st = getState();
      st.denoms = counts;
      writeJson(SHIFT_KEY, st);
      var cntInput = document.getElementById('novaShiftCount');
      if (cntInput) {
        cntInput.value = tot.toFixed(2);
        fireEvent(cntInput, 'input');
      }
      m.close();
    });
    actions.appendChild(btnCancel);
    actions.appendChild(btnUse);
    m.dialog.appendChild(list);
    m.dialog.appendChild(totalEl);
    m.dialog.appendChild(actions);
    recalc();
    inputs['200'].focus();
  }

  function renderStatusBox() {
    var box = document.getElementById('novaShiftOpenBox');
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    var st = getState();
    if (!st.openedAt) {
      box.appendChild(el('span', { style: 'font-weight:600;' }, t('notOpen')));
      var btn = el('button', {
        id: 'novaShiftOpenBtn', type: 'button', className: 'btn btn-primary', style: 'min-height:44px;'
      }, t('openBtn'));
      btn.addEventListener('click', showOpenDialog);
      box.appendChild(btn);
    } else {
      var flt = (typeof st.float === 'number' && isFinite(st.float)) ? st.float.toFixed(2) : '0.00';
      var who = st.openedBy ? st.openedBy : '—';
      var msg = t('since') + ' ' + fmtTime(st.openedAt) + ' — ' + t('by') + ' ' + who + ' — ' + t('flt') + ' ' + flt + ' ' + t('cur');
      box.appendChild(el('span', { style: 'color:#79c9eb;font-weight:600;' }, msg));
    }
  }

  function handleClosingIfNeeded() {
    if (!document.getElementById('novaShiftSummary')) return;
    var closings = readJson(CLOSINGS_KEY, []);
    if (!Array.isArray(closings) || !closings.length) return;
    var last = closings[closings.length - 1];
    if (!last || !last.id) return;
    var cid = String(last.id);
    if (handledClosings[cid]) return;
    var opens = readJson(OPENS_KEY, []);
    if (!Array.isArray(opens)) opens = [];
    for (var i = 0; i < opens.length; i++) {
      if (opens[i] && String(opens[i].closingId) === cid) {
        handledClosings[cid] = true;
        return;
      }
    }
    var st = getState();
    // only a closing made after this shift was opened ends it (older closings are ignored)
    if (!st.openedAt || !(Number(last.at) >= Number(st.openedAt))) { handledClosings[cid] = true; return; }
    opens.push({
      closingId: last.id,
      openedAt: st.openedAt || null,
      openedBy: st.openedBy || '',
      denoms: st.denoms || {}
    });
    if (opens.length > 200) opens = opens.slice(opens.length - 200);
    writeJson(OPENS_KEY, opens);
    handledClosings[cid] = true;
    // keep float/counted (the closing screen shows them after reload); only the opening info resets so the next shift must be opened
    delete st.openedAt; delete st.openedBy; delete st.denoms;
    writeJson(SHIFT_KEY, st);
    renderStatusBox();
  }

  function mount() {
    var panel = document.getElementById('novaShiftClose');
    if (!panel) return;
    if (!document.getElementById('novaShiftOpenBox')) {
      var box = el('div', {
        id: 'novaShiftOpenBox',
        style: 'display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;margin-bottom:12px;background:#14181d;color:#e6edf3;border:1px solid #343b44;border-radius:8px;'
      });
      panel.insertBefore(box, panel.firstChild);
      renderStatusBox();
    }
    var cnt = document.getElementById('novaShiftCount');
    if (cnt && !document.getElementById('novaShiftDenomBtn')) {
      var dBtn = el('button', {
        id: 'novaShiftDenomBtn', type: 'button', className: 'btn btn-secondary',
        style: 'min-height:44px;margin-inline-start:8px;'
      }, t('countBtn'));
      dBtn.addEventListener('click', showDenomDialog);
      cnt.parentNode.insertBefore(dBtn, cnt.nextSibling);
    }
    if (!panel._novaShiftSummaryObs && typeof MutationObserver === 'function') {
      panel._novaShiftSummaryObs = true;
      var sObs = new MutationObserver(handleClosingIfNeeded);
      sObs.observe(panel, { childList: true, subtree: true });
    }
    handleClosingIfNeeded();
  }

  function init() {
    mount();
    var view = document.getElementById('novaPageView');
    if (view && typeof MutationObserver === 'function') {
      var obs = new MutationObserver(mount);
      obs.observe(view, { childList: true, subtree: false });
    }
  }

  window.novaShiftOpen = {
    state: getState,
    open: openShift,
    openDialog: showOpenDialog,
    denomTotal: denomTotal
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
