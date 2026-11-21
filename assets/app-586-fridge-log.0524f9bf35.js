/* app/586-fridge-log.js — NOVA Rx Fridge Temperature Log (Task #139) */
(function () {
  'use strict';

  var STORAGE_KEY = 'nova-rx-fridge-log-v1';
  var CARD_ID = 'novaFridgeLog';
  var PAGE_NAME = 'reports';
  var MAX_RECORDS = 500;
  var MIN_TEMP = -10;
  var MAX_TEMP = 30;
  var SAFE_MIN = 2;
  var SAFE_MAX = 8;

  var observer = null;
  var styleInjected = false;

  function isEn() {
    try {
      return window.localStorage.getItem('nova-rx-language') === 'en';
    } catch (e) {
      return false;
    }
  }

  function t(ar, en) {
    return isEn() ? en : ar;
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') {
      try {
        window.showToast(msg, type || 'success');
      } catch (e) {}
    }
  }

  function requireSignedIn() {
    try {
      if (!window.novaAuth || typeof window.novaAuth.current !== 'function') {
        return null;
      }
      var u = window.novaAuth.current();
      if (!u || typeof u !== 'object') {
        return null;
      }
      var name = typeof u.name === 'string' ? u.name.trim() : '';
      var role = typeof u.role === 'string' ? u.role.trim() : '';
      if (!name && !role) {
        return null;
      }
      return { name: name, role: role };
    } catch (e) {
      return null;
    }
  }

  function normalizeDigits(val) {
    if (val === null || val === undefined) {
      return '';
    }
    var s = String(val).trim();
    var map = {
      '\u0660': '0', '\u0661': '1', '\u0662': '2', '\u0663': '3', '\u0664': '4',
      '\u0665': '5', '\u0666': '6', '\u0667': '7', '\u0668': '8', '\u0669': '9',
      '\u06F0': '0', '\u06F1': '1', '\u06F2': '2', '\u06F3': '3', '\u06F4': '4',
      '\u06F5': '5', '\u06F6': '6', '\u06F7': '7', '\u06F8': '8', '\u06F9': '9',
      '\u066B': '.', ',': '.', '\u2212': '-'
    };
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      out += map[ch] !== undefined ? map[ch] : ch;
    }
    return out;
  }

  function parseTemp(val) {
    if (typeof val === 'boolean') {
      return NaN;
    }
    var norm = normalizeDigits(val);
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(norm)) {
      return NaN;
    }
    var n = Number(norm);
    if (isNaN(n) || !isFinite(n)) {
      return NaN;
    }
    var rounded = Math.round(n * 10) / 10;
    return rounded === 0 ? 0 : rounded;
  }

  function isOutOfRange(temp) {
    return temp < SAFE_MIN || temp > SAFE_MAX;
  }

  function loadRecords() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      var valid = [];
      for (var i = 0; i < parsed.length; i++) {
        var r = parsed[i];
        if (!r || typeof r !== 'object') {
          continue;
        }
        if (typeof r.temp !== 'number' || !isFinite(r.temp)) {
          continue;
        }
        if (typeof r.time !== 'number' || !isFinite(r.time)) {
          continue;
        }
        valid.push({
          id: typeof r.id === 'string' ? r.id : '',
          temp: r.temp,
          time: r.time,
          by: typeof r.by === 'string' ? r.by : '',
          note: typeof r.note === 'string' ? r.note : '',
          flagged: isOutOfRange(r.temp)
        });
      }
      return valid;
    } catch (e) {
      return [];
    }
  }

  function saveRecords(list) {
    var trimmed = list.length > MAX_RECORDS ? list.slice(list.length - MAX_RECORDS) : list;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return true;
    } catch (e) {
      return false;
    }
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function dateKey(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function monthKey(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function formatTime(ms) {
    var d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function formatDateTime(ms) {
    return dateKey(ms) + ' ' + formatTime(ms);
  }

  function add(entry) {
    var user = requireSignedIn();
    if (!user) {
      return { ok: false, error: t('لازم تسجل دخول الأول', 'Sign in required') };
    }
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: t('بيانات غير صالحة', 'Invalid input') };
    }
    var temp = parseTemp(entry.temp);
    if (isNaN(temp) || temp < MIN_TEMP || temp > MAX_TEMP) {
      return {
        ok: false,
        error: t('الحرارة لازم تكون بين -10 و 30 درجة مئوية', 'Temperature must be between -10 and 30 C')
      };
    }
    var note = entry.note !== undefined && entry.note !== null ? String(entry.note).trim() : '';
    var flagged = isOutOfRange(temp);
    if (flagged && !note) {
      return {
        ok: false,
        error: t('الحرارة بره النطاق الآمن، لازم تكتب اتعمل إيه', 'Out of safe range (2-8 C): action note is required')
      };
    }
    var nowMs = typeof entry.time === 'number' && isFinite(entry.time) && entry.time > 0
      ? entry.time
      : Date.now();
    var rec = {
      id: 'fl_' + nowMs + '_' + Math.floor(Math.random() * 10000),
      temp: temp,
      time: nowMs,
      by: user.name,
      note: note,
      flagged: flagged
    };
    var records = loadRecords();
    records.push(rec);
    if (!saveRecords(records)) {
      return {
        ok: false,
        error: t('تعذر حفظ القراءة في التخزين المحلي', 'Failed to save reading to local storage')
      };
    }
    refreshCard();
    return { ok: true, record: rec };
  }

  function list(fromMs, toMs) {
    var records = loadRecords();
    var hasFrom = typeof fromMs === 'number' && isFinite(fromMs);
    var hasTo = typeof toMs === 'number' && isFinite(toMs);
    var out = [];
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (hasFrom && r.time < fromMs) {
        continue;
      }
      if (hasTo && r.time > toMs) {
        continue;
      }
      out.push(r);
    }
    return out;
  }

  function outOfRange() {
    var records = loadRecords();
    var out = [];
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (isOutOfRange(r.temp)) {
        out.push(r);
      }
    }
    return out;
  }

  function todayDone() {
    var today = dateKey(Date.now());
    var records = loadRecords();
    var morning = false;
    var evening = false;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (dateKey(r.time) !== today) {
        continue;
      }
      var hr = new Date(r.time).getHours();
      if (hr < 12) {
        morning = true;
      }
      if (hr >= 18) {
        evening = true;
      }
    }
    return { morning: morning, evening: evening };
  }

  function injectStyles() {
    if (styleInjected || document.getElementById('novaFridgeLogStyles')) {
      styleInjected = true;
      return;
    }
    var css = ''
      + '#novaFridgeLog{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;overflow-x:hidden;}'
      + '#novaFridgeLog *{box-sizing:border-box;}'
      + '#novaFridgeLog .nfl-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px;border-bottom:1px solid #343b44;padding-bottom:10px;}'
      + '#novaFridgeLog .nfl-title{margin:0;font-size:17px;color:#79c9eb;}'
      + '#novaFridgeLog .nfl-sub{font-size:12px;color:#9aa7b4;}'
      + '#novaFridgeLog .nfl-alert{background:#332614;border:1px solid #b5842e;color:#f4d58d;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:13px;}'
      + '#novaFridgeLog .nfl-form{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;align-items:stretch;}'
      + '#novaFridgeLog .nfl-input{background:#0d1117;border:1px solid #343b44;color:#e6edf3;border-radius:6px;padding:8px 10px;min-height:44px;font-size:14px;max-width:100%;}'
      + '#novaFridgeLog .nfl-temp{width:130px;max-width:100%;}'
      + '#novaFridgeLog .nfl-note{flex:1 1 180px;min-width:140px;}'
      + '#novaFridgeLog .btn{min-height:44px;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:14px;}'
      + '#novaFridgeLog .nfl-sec{margin-top:14px;}'
      + '#novaFridgeLog .nfl-sec-title{font-size:14px;color:#79c9eb;margin:0 0 8px 0;}'
      + '#novaFridgeLog .nfl-wrap{width:100%;max-width:100%;overflow-x:auto;}'
      + '#novaFridgeLog table{width:100%;border-collapse:collapse;font-size:13px;min-width:280px;}'
      + '#novaFridgeLog th,#novaFridgeLog td{border:1px solid #343b44;padding:6px 8px;text-align:start;overflow-wrap:anywhere;}'
      + '#novaFridgeLog th{background:#1b222c;color:#79c9eb;}'
      + '#novaFridgeLog tr.nfl-bad td{background:#3a191c;color:#ffb4b4;}'
      + '#novaFridgeLog .nfl-print-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:14px;padding-top:12px;border-top:1px solid #343b44;}'
      + '#novaFridgeLogPrint{display:none;}'
      + '@media print{body > *:not(#novaFridgeLogPrint){display:none !important;}#novaFridgeLogPrint{display:block !important;position:static;background:#fff;color:#000;padding:16px;}#novaFridgeLogPrint table{width:100%;border-collapse:collapse;font-size:12px;}#novaFridgeLogPrint th,#novaFridgeLogPrint td{border:1px solid #333;padding:5px;text-align:start;}}';
    var style = document.createElement('style');
    style.id = 'novaFridgeLogStyles';
    style.textContent = css;
    document.head.appendChild(style);
    styleInjected = true;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }
    return node;
  }

  function isReportsActive() {
    if (document.body && document.body.dataset && document.body.dataset.activePage === PAGE_NAME) {
      return true;
    }
    var activeTab = document.querySelector('.nova-tab.active[data-page="' + PAGE_NAME + '"]');
    return !!activeTab;
  }

  function buildPrintArea(monthStr) {
    var old = document.getElementById('novaFridgeLogPrint');
    if (old && old.parentNode) {
      old.parentNode.removeChild(old);
    }
    var box = el('div');
    box.id = 'novaFridgeLogPrint';
    box.dir = isEn() ? 'ltr' : 'rtl';
    box.appendChild(el('h2', '', t('سجل حرارة التلاجة - شهر ', 'Fridge Temperature Log - ') + monthStr));
    var tbl = el('table');
    var thead = el('thead');
    var hr = el('tr');
    hr.appendChild(el('th', '', t('التاريخ والوقت', 'Date & Time')));
    hr.appendChild(el('th', '', t('الحرارة', 'Temp')));
    hr.appendChild(el('th', '', t('الحالة', 'Status')));
    hr.appendChild(el('th', '', t('بواسطة', 'By')));
    hr.appendChild(el('th', '', t('اتعمل إيه', 'Action / Note')));
    thead.appendChild(hr);
    tbl.appendChild(thead);

    var tbody = el('tbody');
    var records = loadRecords();
    var count = 0;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (monthKey(r.time) !== monthStr) {
        continue;
      }
      count++;
      var tr = el('tr');
      tr.appendChild(el('td', '', formatDateTime(r.time)));
      tr.appendChild(el('td', '', r.temp.toFixed(1) + t(' °م', ' °C')));
      tr.appendChild(el('td', '', isOutOfRange(r.temp) ? t('بره النطاق', 'Out of range') : t('آمن', 'Safe')));
      tr.appendChild(el('td', '', r.by || '-'));
      tr.appendChild(el('td', '', r.note || '-'));
      tbody.appendChild(tr);
    }
    if (count === 0) {
      var er = el('tr');
      var ed = el('td', '', t('لا توجد قراءات في هذا الشهر', 'No readings for this month'));
      ed.colSpan = 5;
      er.appendChild(ed);
      tbody.appendChild(er);
    }
    tbl.appendChild(tbody);
    box.appendChild(tbl);
    document.body.appendChild(box);
  }

  function renderCardContent(card) {
    while (card.firstChild) {
      card.removeChild(card.firstChild);
    }
    card.dir = isEn() ? 'ltr' : 'rtl';

    var head = el('div', 'nfl-head');
    head.appendChild(el('h3', 'nfl-title', t('سجل حرارة التلاجة', 'Fridge Temperature Log')));
    head.appendChild(el('span', 'nfl-sub', t('النطاق الآمن: 2 إلى 8 درجة مئوية', 'Safe range: 2 - 8 C')));
    card.appendChild(head);

    var done = todayDone();
    var reminders = [];
    if (!done.morning) {
      reminders.push(t('ما اتسجلتش قراءة الصبح (قبل 12:00)', 'Morning reading not logged (before 12:00)'));
    }
    if (!done.evening) {
      reminders.push(t('ما اتسجلتش قراءة بالليل (بعد 18:00)', 'Evening reading not logged (after 18:00)'));
    }
    if (reminders.length > 0) {
      card.appendChild(el('div', 'nfl-alert', reminders.join(' • ')));
    }

    var form = el('form', 'nfl-form');
    var tempInput = el('input', 'nfl-input nfl-temp');
    tempInput.type = 'text';
    tempInput.setAttribute('inputmode', 'decimal');
    tempInput.placeholder = t('الحرارة (مثلاً ٥.٢)', 'Temp (e.g. 5.2)');
    tempInput.setAttribute('aria-label', t('درجة الحرارة', 'Temperature'));

    var noteInput = el('input', 'nfl-input nfl-note');
    noteInput.type = 'text';
    noteInput.placeholder = t('اتعمل إيه (مطلوب لو بره 2-8)', 'Action taken (required if outside 2-8)');
    noteInput.setAttribute('aria-label', t('ملاحظة', 'Note'));

    var submitBtn = el('button', 'btn btn-primary', t('تسجيل القراءة', 'Log Reading'));
    submitBtn.type = 'submit';

    form.appendChild(tempInput);
    form.appendChild(noteInput);
    form.appendChild(submitBtn);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var res = add({ temp: tempInput.value, note: noteInput.value });
      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }
      toast(
        res.record.flagged
          ? t('تم التسجيل (تنبيه: بره النطاق الآمن)', 'Logged (Alert: out of safe range)')
          : t('تم تسجيل قراءة الحرارة', 'Temperature logged'),
        res.record.flagged ? 'error' : 'success'
      );
    });
    card.appendChild(form);

    var todaySec = el('div', 'nfl-sec');
    todaySec.appendChild(el('h4', 'nfl-sec-title', t('قراءات النهاردة', 'Today Readings')));
    var todayWrap = el('div', 'nfl-wrap');
    var todayTbl = el('table');
    var tHead = el('thead');
    var tHr = el('tr');
    tHr.appendChild(el('th', '', t('الوقت', 'Time')));
    tHr.appendChild(el('th', '', t('الحرارة', 'Temp')));
    tHr.appendChild(el('th', '', t('بواسطة', 'By')));
    tHr.appendChild(el('th', '', t('اتعمل إيه', 'Note')));
    tHead.appendChild(tHr);
    todayTbl.appendChild(tHead);

    var tBody = el('tbody');
    var todayStr = dateKey(Date.now());
    var allRecords = loadRecords();
    var todayCount = 0;
    for (var i = allRecords.length - 1; i >= 0; i--) {
      var r = allRecords[i];
      if (dateKey(r.time) !== todayStr) {
        continue;
      }
      todayCount++;
      var tr = el('tr', isOutOfRange(r.temp) ? 'nfl-bad' : '');
      tr.appendChild(el('td', '', formatTime(r.time)));
      tr.appendChild(el('td', '', r.temp.toFixed(1) + t(' °م', ' °C')));
      tr.appendChild(el('td', '', r.by || '-'));
      tr.appendChild(el('td', '', r.note || '-'));
      tBody.appendChild(tr);
    }
    if (todayCount === 0) {
      var emptyRow = el('tr');
      var emptyTd = el('td', '', t('مفيش قراءات متسجلة النهاردة', 'No readings logged today'));
      emptyTd.colSpan = 4;
      emptyRow.appendChild(emptyTd);
      tBody.appendChild(emptyRow);
    }
    todayTbl.appendChild(tBody);
    todayWrap.appendChild(todayTbl);
    todaySec.appendChild(todayWrap);
    card.appendChild(todaySec);

    var monthSec = el('div', 'nfl-sec');
    monthSec.appendChild(el('h4', 'nfl-sec-title', t('ملخص آخر 30 يوم (أقل / أعلى)', 'Last 30 Days (Min / Max)')));
    var nowDate = new Date();
    var thirtyStartMs = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate() - 29,
      0, 0, 0, 0
    ).getTime();
    var byDay = {};
    var dayKeys = [];
    for (var j = 0; j < allRecords.length; j++) {
      var rec = allRecords[j];
      if (rec.time < thirtyStartMs) {
        continue;
      }
      var dk = dateKey(rec.time);
      if (!byDay[dk]) {
        byDay[dk] = { min: rec.temp, max: rec.temp, count: 1 };
        dayKeys.push(dk);
      } else {
        if (rec.temp < byDay[dk].min) {
          byDay[dk].min = rec.temp;
        }
        if (rec.temp > byDay[dk].max) {
          byDay[dk].max = rec.temp;
        }
        byDay[dk].count++;
      }
    }
    dayKeys.sort().reverse();

    var mWrap = el('div', 'nfl-wrap');
    var mTbl = el('table');
    var mHead = el('thead');
    var mHr = el('tr');
    mHr.appendChild(el('th', '', t('التاريخ', 'Date')));
    mHr.appendChild(el('th', '', t('أقل حرارة', 'Min')));
    mHr.appendChild(el('th', '', t('أعلى حرارة', 'Max')));
    mHr.appendChild(el('th', '', t('العدد', 'Count')));
    mHead.appendChild(mHr);
    mTbl.appendChild(mHead);

    var mBody = el('tbody');
    if (dayKeys.length === 0) {
      var mEmpty = el('tr');
      var mTd = el('td', '', t('لا توجد بيانات في آخر 30 يوم', 'No data in the last 30 days'));
      mTd.colSpan = 4;
      mEmpty.appendChild(mTd);
      mBody.appendChild(mEmpty);
    } else {
      for (var k = 0; k < dayKeys.length; k++) {
        var dKey = dayKeys[k];
        var stat = byDay[dKey];
        var badDay = isOutOfRange(stat.min) || isOutOfRange(stat.max);
        var mTr = el('tr', badDay ? 'nfl-bad' : '');
        mTr.appendChild(el('td', '', dKey));
        mTr.appendChild(el('td', '', stat.min.toFixed(1) + t(' °م', ' °C')));
        mTr.appendChild(el('td', '', stat.max.toFixed(1) + t(' °م', ' °C')));
        mTr.appendChild(el('td', '', String(stat.count)));
        mBody.appendChild(mTr);
      }
    }
    mTbl.appendChild(mBody);
    mWrap.appendChild(mTbl);
    monthSec.appendChild(mWrap);
    card.appendChild(monthSec);

    var printBar = el('div', 'nfl-print-bar');
    var monthInput = el('input', 'nfl-input');
    monthInput.type = 'month';
    monthInput.value = monthKey(Date.now());
    monthInput.setAttribute('aria-label', t('اختر الشهر', 'Select month'));

    var printBtn = el('button', 'btn btn-secondary', t('طباعة السجل', 'Print Log'));
    printBtn.type = 'button';
    printBtn.addEventListener('click', function () {
      var chosen = monthInput.value || monthKey(Date.now());
      buildPrintArea(chosen);
      window.print();
    });

    printBar.appendChild(monthInput);
    printBar.appendChild(printBtn);
    card.appendChild(printBar);
  }

  function refreshCard() {
    var existing = document.getElementById(CARD_ID);
    if (existing) {
      renderCardContent(existing);
    }
  }

  function mountIfNeeded() {
    var container = document.getElementById('novaPageView');
    if (!container || !isReportsActive()) {
      return;
    }
    if (document.getElementById(CARD_ID)) {
      return;
    }
    injectStyles();
    var card = el('section');
    card.id = CARD_ID;
    renderCardContent(card);
    container.appendChild(card);
  }

  function startObserver() {
    var container = document.getElementById('novaPageView');
    if (container && typeof MutationObserver === 'function' && !observer) {
      observer = new MutationObserver(function () {
        mountIfNeeded();
      });
      observer.observe(container, { childList: true });
    }
    mountIfNeeded();
  }

  window.novaFridgeLog = Object.freeze({
    add: add,
    list: list,
    outOfRange: outOfRange,
    todayDone: todayDone
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
})();