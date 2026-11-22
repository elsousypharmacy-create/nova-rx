// app/584-item-limits.js
(function () {
  'use strict';

  var STORAGE_KEY = 'nova-rx-item-limits-v1';
  var LANG_KEY = 'nova-rx-language';
  var CARD_ID = 'novaItemLimits';
  var STYLE_ID = 'novaItemLimitsStyle';
  var observer = null;
  var selectedKey = '';

  function isEn() {
    try {
      return localStorage.getItem(LANG_KEY) === 'en';
    } catch (e) {
      return false;
    }
  }

  function t(ar, en) {
    return isEn() ? en : ar;
  }

  function normalizeDigits(str) {
    var s = String(str == null ? '' : str);
    var ar = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669';
    var fa = '\u06f0\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7\u06f8\u06f9';
    var out = '';
    var i, ch, idx;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      idx = ar.indexOf(ch);
      if (idx !== -1) {
        out += String(idx);
      } else {
        idx = fa.indexOf(ch);
        out += idx !== -1 ? String(idx) : ch;
      }
    }
    return out;
  }

  function parseOptionalInt(val) {
    var s = normalizeDigits(val).replace(/^\s+|\s+$/g, '');
    if (!s) return null;
    if (!/^\d+$/.test(s)) return NaN;
    return parseInt(s, 10);
  }

  function canEdit() {
    if (window.novaPerms && typeof window.novaPerms.require === 'function') {
      try {
        return !!window.novaPerms.require('stock.adjust');
      } catch (e) {
        return false;
      }
    }
    return true;
  }

  function readStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeStore(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  }

  function getProducts() {
    if (window.NOVA_DEMO && Array.isArray(window.NOVA_DEMO.products)) {
      return window.NOVA_DEMO.products;
    }
    return [];
  }

  function keyOf(product) {
    if (!product) return '';
    if (window.novaStock && typeof window.novaStock.keyOf === 'function') {
      return String(window.novaStock.keyOf(product) || '');
    }
    return String(product.barcode || product.id || product.name || '');
  }

  function findProductByKey(key) {
    var list = getProducts();
    var i;
    for (i = 0; i < list.length; i++) {
      if (keyOf(list[i]) === key) return list[i];
    }
    return null;
  }

  function getOnHand(key) {
    if (!window.novaStock || typeof window.novaStock.hasLots !== 'function' || typeof window.novaStock.lots !== 'function') {
      return 0;
    }
    if (!window.novaStock.hasLots(key)) return 0;
    var lots = window.novaStock.lots(key) || [];
    var sum = 0;
    var i;
    for (i = 0; i < lots.length; i++) {
      sum += Number(lots[i] && lots[i].onHand) || 0;
    }
    return sum;
  }

  function getEntry(key) {
    var store = readStore();
    var item = store[key];
    if (!item || typeof item !== 'object') {
      return { min: null, max: null, shelf: '' };
    }
    return {
      min: typeof item.min === 'number' ? item.min : null,
      max: typeof item.max === 'number' ? item.max : null,
      shelf: typeof item.shelf === 'string' ? item.shelf : ''
    };
  }

  function setEntry(key, opts) {
    if (!canEdit()) return false;
    if (!key) return false;
    var o = opts || {};
    var min = o.min === null || o.min === undefined || o.min === '' ? null : parseOptionalInt(o.min);
    var max = o.max === null || o.max === undefined || o.max === '' ? null : parseOptionalInt(o.max);
    if (min !== null && (isNaN(min) || min < 0)) return false;
    if (max !== null && (isNaN(max) || max < 0)) return false;
    if (min !== null && max !== null && max < min) return false;
    var shelf = String(o.shelf == null ? '' : o.shelf).replace(/^\s+|\s+$/g, '').slice(0, 30);

    var store = readStore();
    store[key] = { min: min, max: max, shelf: shelf };
    writeStore(store);
    refreshTables();
    return { min: min, max: max, shelf: shelf };
  }

  function suggestLimits(key) {
    var sales = [];
    if (window.novaSales && typeof window.novaSales.list === 'function') {
      sales = window.novaSales.list() || [];
    }
    var prod = findProductByKey(key);
    var cutoff = Date.now() - 30 * 86400000;
    var totalBoxes = 0;
    var i, j, sale, ts, lines, line, lineKey, qty, factor;

    for (i = 0; i < sales.length; i++) {
      sale = sales[i];
      if (!sale || !sale.at) continue;
      ts = Date.parse(sale.at);
      if (isNaN(ts) || ts < cutoff) continue;
      lines = Array.isArray(sale.lines) ? sale.lines : [];
      for (j = 0; j < lines.length; j++) {
        line = lines[j];
        if (!line) continue;
        lineKey = keyOf(line);
        var matched = (lineKey === key) ||
          (prod && prod.barcode && line.barcode && String(line.barcode) === String(prod.barcode)) ||
          (prod && prod.name && line.name && String(line.name) === String(prod.name));
        if (!matched) continue;
        qty = Number(line.qty) || 0;
        if (line.unit === 'strip') {
          factor = Number(line.unitFactor) || 1;
          totalBoxes += qty / factor;
        } else {
          totalBoxes += qty;
        }
      }
    }

    if (totalBoxes <= 0) {
      return { min: 0, max: 0 };
    }
    var avgDaily = totalBoxes / 30;
    return {
      min: Math.max(1, Math.ceil(avgDaily * 7)),
      max: Math.max(1, Math.ceil(avgDaily * 21))
    };
  }

  function computeBelow() {
    var store = readStore();
    var keys = Object.keys(store);
    var out = [];
    var i, k, cfg, onHand, prod, need;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      cfg = getEntry(k);
      if (cfg.min === null) continue;
      onHand = getOnHand(k);
      if (onHand < cfg.min) {
        prod = findProductByKey(k);
        need = cfg.max !== null ? (cfg.max - onHand) : (cfg.min * 2 - onHand);
        if (need < 0) need = 0;
        out.push({
          key: k,
          name: prod ? prod.name : k,
          onHand: onHand,
          min: cfg.min,
          max: cfg.max,
          need: need,
          shelf: cfg.shelf
        });
      }
    }
    out.sort(function (a, b) {
      return a.onHand - b.onHand;
    });
    return out;
  }

  function computeAbove() {
    var store = readStore();
    var keys = Object.keys(store);
    var out = [];
    var i, k, cfg, onHand, prod;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      cfg = getEntry(k);
      if (cfg.max === null) continue;
      onHand = getOnHand(k);
      if (onHand > cfg.max) {
        prod = findProductByKey(k);
        out.push({
          key: k,
          name: prod ? prod.name : k,
          onHand: onHand,
          min: cfg.min,
          max: cfg.max,
          over: onHand - cfg.max,
          shelf: cfg.shelf
        });
      }
    }
    out.sort(function (a, b) {
      return b.over - a.over;
    });
    return out;
  }

  function shelfOf(key) {
    return getEntry(key).shelf;
  }

  window.novaItemLimits = {
    get: getEntry,
    set: setEntry,
    suggest: suggestLimits,
    below: computeBelow,
    above: computeAbove,
    shelfOf: shelfOf
  };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '#novaItemLimits{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;}',
      '#novaItemLimits *{box-sizing:border-box;}',
      '#novaItemLimits h3,#novaItemLimits h4{margin:0 0 12px 0;color:#e6edf3;}',
      '#novaItemLimits h3{font-size:1.1rem;border-bottom:1px solid #343b44;padding-bottom:8px;}',
      '#novaItemLimits h4{font-size:0.95rem;margin-top:16px;color:#79c9eb;}',
      '.nil-search-wrap{position:relative;margin-bottom:12px;}',
      '.nil-input{width:100%;min-height:44px;padding:8px 12px;background:#0d1117;border:1px solid #343b44;border-radius:8px;color:#e6edf3;font-size:0.95rem;}',
      '.nil-input:focus{outline:none;border-color:#79c9eb;}',
      '.nil-results{margin-top:6px;border:1px solid #343b44;border-radius:8px;background:#0d1117;max-height:220px;overflow-y:auto;}',
      '.nil-result-btn{display:block;width:100%;min-height:44px;text-align:inherit;padding:8px 12px;background:transparent;border:0;border-bottom:1px solid #343b44;color:#e6edf3;cursor:pointer;}',
      '.nil-result-btn:last-child{border-bottom:0;}',
      '.nil-result-btn:hover{background:#1c232b;}',
      '.nil-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:12px 0;}',
      '.nil-field label{display:block;font-size:0.85rem;margin-bottom:4px;color:#9fb0c2;}',
      '.nil-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center;}',
      '.nil-actions button,.nil-head-row button{min-height:44px;}',
      '.nil-status{font-size:0.85rem;color:#79c9eb;min-height:20px;margin-top:6px;}',
      '.nil-head-row{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-top:16px;margin-bottom:8px;}',
      '.nil-head-row h4{margin:0;}',
      '.nil-table-wrap{width:100%;overflow-x:auto;border:1px solid #343b44;border-radius:8px;}',
      '.nil-table{width:100%;border-collapse:collapse;font-size:0.9rem;min-width:320px;}',
      '.nil-table th,.nil-table td{padding:8px 10px;border-bottom:1px solid #343b44;text-align:inherit;white-space:nowrap;}',
      '.nil-table th{background:#1b2129;color:#79c9eb;font-weight:600;}',
      '.nil-table tr:last-child td{border-bottom:0;}',
      '.nil-empty{padding:12px;color:#9fb0c2;font-size:0.9rem;}'
    ].join('');
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function copyText(text, onDone) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(function () {
        if (onDone) onDone(true);
      }, function () {
        fallbackCopy(text, onDone);
      });
    } else {
      fallbackCopy(text, onDone);
    }
  }

  function fallbackCopy(text, onDone) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    if (onDone) onDone(ok);
  }

  function searchProducts(q) {
    if (window.novaSearch && typeof window.novaSearch.search === 'function') {
      return window.novaSearch.search(q, 10) || [];
    }
    var query = String(q || '').toLowerCase();
    var list = getProducts();
    var out = [];
    var i, p;
    for (i = 0; i < list.length && out.length < 10; i++) {
      p = list[i];
      if (!query || (p.name && p.name.toLowerCase().indexOf(query) !== -1) || (p.barcode && String(p.barcode).indexOf(query) !== -1)) {
        out.push(p);
      }
    }
    return out;
  }

  function buildTable(headers, rows, emptyMsg) {
    var wrap = el('div', 'nil-table-wrap');
    if (!rows.length) {
      wrap.appendChild(el('div', 'nil-empty', emptyMsg));
      return wrap;
    }
    var table = el('table', 'nil-table');
    var thead = document.createElement('thead');
    var trHead = document.createElement('tr');
    var i, j, tr;
    for (i = 0; i < headers.length; i++) {
      trHead.appendChild(el('th', '', headers[i]));
    }
    thead.appendChild(trHead);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (i = 0; i < rows.length; i++) {
      tr = document.createElement('tr');
      for (j = 0; j < rows[i].length; j++) {
        tr.appendChild(el('td', '', rows[i][j]));
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function refreshTables() {
    var belowBox = document.getElementById('nilBelowWrap');
    var aboveBox = document.getElementById('nilAboveWrap');
    if (!belowBox || !aboveBox) return;

    while (belowBox.firstChild) belowBox.removeChild(belowBox.firstChild);
    while (aboveBox.firstChild) aboveBox.removeChild(aboveBox.firstChild);

    var belowItems = computeBelow();
    var belowRows = [];
    var i, item;
    for (i = 0; i < belowItems.length; i++) {
      item = belowItems[i];
      belowRows.push([
        item.name,
        item.onHand,
        item.min,
        item.max === null ? '—' : item.max,
        item.need,
        item.shelf || '—'
      ]);
    }
    belowBox.appendChild(buildTable(
      [
        t('الصنف', 'Item'),
        t('الرصيد', 'On Hand'),
        t('الحد الأدنى', 'Min'),
        t('الحد الأقصى', 'Max'),
        t('المطلوب', 'Need'),
        t('مكان الرف', 'Shelf')
      ],
      belowRows,
      t('لا توجد أصناف تحت الحد الأدنى.', 'No items below minimum.')
    ));

    var aboveItems = computeAbove();
    var aboveRows = [];
    for (i = 0; i < aboveItems.length; i++) {
      item = aboveItems[i];
      aboveRows.push([
        item.name,
        item.onHand,
        item.max,
        item.over,
        item.shelf || '—'
      ]);
    }
    aboveBox.appendChild(buildTable(
      [
        t('الصنف', 'Item'),
        t('الرصيد', 'On Hand'),
        t('الحد الأقصى', 'Max'),
        t('الزيادة', 'Over'),
        t('مكان الرف', 'Shelf')
      ],
      aboveRows,
      t('لا توجد أصناف فوق الحد الأقصى.', 'No items above maximum.')
    ));
  }

  function buildCard() {
    injectStyles();
    selectedKey = ''; // a fresh card has an empty form: never save over a stale pick
    var editable = canEdit();
    var card = el('section', 'nova-card');
    card.id = CARD_ID;
    card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    card.appendChild(el('h3', '', t('الحدود ومكان الرف', 'Item Limits & Shelf Location')));

    var searchWrap = el('div', 'nil-search-wrap');
    var searchInput = el('input', 'nil-input');
    searchInput.type = 'search';
    searchInput.placeholder = t('ابحث عن صنف بالاسم أو الباركود...', 'Search item by name or barcode...');
    var resultsBox = el('div', 'nil-results');
    resultsBox.style.display = 'none';
    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(resultsBox);
    card.appendChild(searchWrap);

    var selectedTitle = el('div', 'nil-status', '');
    card.appendChild(selectedTitle);

    var form = el('div', 'nil-form');

    function makeField(labelText, inputId, placeholder, maxLen) {
      var wrap = el('div', 'nil-field');
      var lbl = el('label', '', labelText);
      lbl.setAttribute('for', inputId);
      var inp = el('input', 'nil-input');
      inp.id = inputId;
      inp.type = 'text';
      if (placeholder) inp.placeholder = placeholder;
      if (maxLen) inp.maxLength = maxLen;
      if (!editable) inp.disabled = true;
      wrap.appendChild(lbl);
      wrap.appendChild(inp);
      form.appendChild(wrap);
      return inp;
    }

    var minInput = makeField(t('الحد الأدنى', 'Min Limit'), 'nilMinInput', '0');
    minInput.setAttribute('inputmode', 'numeric');
    var maxInput = makeField(t('الحد الأقصى', 'Max Limit'), 'nilMaxInput', t('اختياري', 'Optional'));
    maxInput.setAttribute('inputmode', 'numeric');
    var shelfInput = makeField(t('مكان الرف', 'Shelf Location'), 'nilShelfInput', t('رف 3 – ب', 'Shelf 3 - B'), 30);

    card.appendChild(form);

    var actions = el('div', 'nil-actions');
    var saveBtn = el('button', 'btn btn-primary', t('حفظ', 'Save'));
    saveBtn.type = 'button';
    if (!editable) saveBtn.disabled = true;

    var suggestBtn = el('button', 'btn btn-secondary', t('اقترح من المبيعات', 'Suggest from Sales'));
    suggestBtn.type = 'button';
    if (!editable) suggestBtn.disabled = true;

    actions.appendChild(saveBtn);
    actions.appendChild(suggestBtn);
    card.appendChild(actions);

    var statusMsg = el('div', 'nil-status', editable ? '' : t('وضع العرض فقط.', 'Read-only mode.'));
    card.appendChild(statusMsg);

    function selectProduct(prod) {
      selectedKey = keyOf(prod);
      var cfg = getEntry(selectedKey);
      selectedTitle.textContent = prod.name + ' (' + t('الرصيد: ', 'Stock: ') + getOnHand(selectedKey) + ')';
      minInput.value = cfg.min === null ? '' : String(cfg.min);
      maxInput.value = cfg.max === null ? '' : String(cfg.max);
      shelfInput.value = cfg.shelf || '';
      resultsBox.style.display = 'none';
      statusMsg.textContent = '';
    }

    searchInput.addEventListener('input', function () {
      var q = searchInput.value.replace(/^\s+|\s+$/g, '');
      while (resultsBox.firstChild) resultsBox.removeChild(resultsBox.firstChild);
      if (!q) {
        resultsBox.style.display = 'none';
        return;
      }
      var hits = searchProducts(q);
      if (!hits.length) {
        resultsBox.style.display = 'none';
        return;
      }
      var i, btn;
      for (i = 0; i < hits.length; i++) {
        (function (p) {
          btn = el('button', 'nil-result-btn', p.name);
          btn.type = 'button';
          btn.addEventListener('click', function () {
            selectProduct(p);
          });
          resultsBox.appendChild(btn);
        })(hits[i]);
      }
      resultsBox.style.display = 'block';
    });

    suggestBtn.addEventListener('click', function () {
      if (!selectedKey) {
        statusMsg.textContent = t('اختر صنفًا أولًا.', 'Select an item first.');
        return;
      }
      var sug = suggestLimits(selectedKey);
      minInput.value = String(sug.min);
      maxInput.value = String(sug.max);
      statusMsg.textContent = t('تم اقتراح الحدود من مبيعات آخر ٣٠ يومًا.', 'Suggested from last 30 days sales.');
    });

    saveBtn.addEventListener('click', function () {
      if (!selectedKey) {
        statusMsg.textContent = t('اختر صنفًا أولًا.', 'Select an item first.');
        return;
      }
      var saved = setEntry(selectedKey, {
        min: minInput.value,
        max: maxInput.value,
        shelf: shelfInput.value
      });
      if (!saved) {
        statusMsg.textContent = t('تعذر الحفظ: تحقق من القيم أو الصلاحية.', 'Save failed: check values or permission.');
      } else {
        statusMsg.textContent = t('تم الحفظ بنجاح.', 'Saved successfully.');
      }
    });

    var belowHead = el('div', 'nil-head-row');
    belowHead.appendChild(el('h4', '', t('تحت الحد الأدنى', 'Below Minimum')));
    var exportBtn = el('button', 'btn btn-secondary', t('تصدير القايمة', 'Export List'));
    exportBtn.type = 'button';
    exportBtn.addEventListener('click', function () {
      var list = computeBelow();
      if (!list.length) {
        statusMsg.textContent = t('لا توجد أصناف للتصدير.', 'No items to export.');
        return;
      }
      var lines = [];
      var i;
      for (i = 0; i < list.length; i++) {
        lines.push(list[i].name + ' — ' + list[i].need);
      }
      copyText(lines.join('\n'), function (ok) {
        statusMsg.textContent = ok
          ? t('تم نسخ القائمة.', 'List copied.')
          : t('تعذر النسخ.', 'Copy failed.');
      });
    });
    belowHead.appendChild(exportBtn);
    card.appendChild(belowHead);

    var belowWrap = el('div', '');
    belowWrap.id = 'nilBelowWrap';
    card.appendChild(belowWrap);

    card.appendChild(el('h4', '', t('فوق الحد الأقصى', 'Above Maximum')));
    var aboveWrap = el('div', '');
    aboveWrap.id = 'nilAboveWrap';
    card.appendChild(aboveWrap);

    return card;
  }

  function isProductsPage() {
    if (document.body && document.body.dataset && document.body.dataset.activePage === 'products') {
      return true;
    }
    return !!document.querySelector('.nova-tab.active[data-page="products"],.nova-hostmark.active[data-page="products"]');
  }

  function ensureMounted() {
    var pageView = document.getElementById('novaPageView');
    if (!pageView || pageView.hidden || !isProductsPage()) return;
    if (document.getElementById(CARD_ID)) return;
    pageView.appendChild(buildCard());
    refreshTables();
  }

  function initObserver() {
    var pageView = document.getElementById('novaPageView');
    if (!pageView || observer) return;
    observer = new MutationObserver(function () {
      if (!document.getElementById(CARD_ID) && isProductsPage()) {
        ensureMounted();
      }
    });
    observer.observe(pageView, { childList: true });
    ensureMounted();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initObserver);
  } else {
    initObserver();
  }
})();
