// app/594-license-reminders.js
(function () {
  'use strict';

  var STORAGE_KEY = 'nova-rx-licenses-v1';
  var LANG_KEY = 'nova-rx-language';
  var CARD_ID = 'novaLicenseReminders';
  var STYLE_ID = 'novaLicenseRemindersStyle';
  var MAX_RECORDS = 500;
  var observer = null;
  var idSeq = 0;

  var KINDS = [
    { id: 'pharmacy', ar: 'رخصة الصيدلية', en: 'Pharmacy License' },
    { id: 'practice', ar: 'مزاولة المهنة', en: 'Practice License' },
    { id: 'syndicate', ar: 'كارنيه النقابة', en: 'Syndicate Card' },
    { id: 'tax', ar: 'البطاقة الضريبية', en: 'Tax Card' },
    { id: 'commercial', ar: 'السجل التجاري', en: 'Commercial Register' },
    { id: 'civil', ar: 'الدفاع المدني', en: 'Civil Defense' },
    { id: 'other', ar: 'أخرى', en: 'Other' }
  ];

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

  function toast(msg, type) {
    if (window.showToast && typeof window.showToast === 'function') {
      try {
        window.showToast(msg, type || 'success');
      } catch (e) {}
    }
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

  function trimStr(val) {
    return String(val == null ? '' : val).replace(/^\s+|\s+$/g, '');
  }

  function canEdit() {
    if (!window.novaPerms || typeof window.novaPerms.require !== 'function') {
      return false;
    }
    try {
      return !!window.novaPerms.require('settings.edit');
    } catch (e) {
      return false;
    }
  }

  function currentUser() {
    if (window.novaAuth && typeof window.novaAuth.current === 'function') {
      try {
        var u = window.novaAuth.current();
        return u && u.name ? String(u.name) : '';
      } catch (e) {
        return '';
      }
    }
    return '';
  }

  function isValidKind(k) {
    var i;
    for (i = 0; i < KINDS.length; i++) {
      if (KINDS[i].id === k) return true;
    }
    return false;
  }

  function kindLabel(k) {
    var i;
    for (i = 0; i < KINDS.length; i++) {
      if (KINDS[i].id === k) return isEn() ? KINDS[i].en : KINDS[i].ar;
    }
    return isEn() ? 'Other' : 'أخرى';
  }

  function parseDateEndOfDay(dateStr) {
    var s = normalizeDigits(trimStr(dateStr));
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return NaN;
    var y = parseInt(m[1], 10);
    var mo = parseInt(m[2], 10);
    var d = parseInt(m[3], 10);
    var dt = new Date(y, mo - 1, d, 23, 59, 59, 999);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
      return NaN;
    }
    return dt.getTime();
  }

  function parseRemindDays(val) {
    if (val === undefined || val === null || trimStr(val) === '') return 30;
    var s = normalizeDigits(trimStr(val));
    if (!/^\d+$/.test(s)) return NaN;
    var n = parseInt(s, 10);
    if (n < 1 || n > 180) return NaN;
    return n;
  }

  function readStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function writeStore(list) {
    var arr = Array.isArray(list) ? list : [];
    if (arr.length > MAX_RECORDS) {
      arr = arr.slice(arr.length - MAX_RECORDS);
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
      return true;
    } catch (e) {
      return false;
    }
  }

  function calcDaysLeft(expiresAt, nowMs) {
    var exp = parseDateEndOfDay(expiresAt);
    if (isNaN(exp)) return 0;
    var now = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
    return Math.floor((exp - now) / 86400000);
  }

  function compareExpires(a, b) {
    var ea = parseDateEndOfDay(a.expiresAt);
    var eb = parseDateEndOfDay(b.expiresAt);
    var va = isNaN(ea) ? Infinity : ea;
    var vb = isNaN(eb) ? Infinity : eb;
    return va - vb;
  }

  function cloneItem(item, nowMs) {
    var hist = Array.isArray(item.history) ? item.history.slice() : [];
    var rem = typeof item.remindDays === 'number' && isFinite(item.remindDays) ? item.remindDays : 30;
    return {
      id: item.id,
      title: item.title,
      kind: item.kind,
      number: item.number || '',
      holder: item.holder || '',
      expiresAt: item.expiresAt,
      remindDays: rem,
      note: item.note || '',
      createdAt: item.createdAt || '',
      createdBy: item.createdBy || '',
      history: hist,
      daysLeft: calcDaysLeft(item.expiresAt, nowMs)
    };
  }

  function makeId() {
    idSeq += 1;
    return 'lic_' + Date.now() + '_' + idSeq + '_' + Math.floor(Math.random() * 10000);
  }

  function addLicense(opts) {
    if (!canEdit()) return false;
    var o = opts || {};
    var title = trimStr(o.title);
    if (!title) return false;

    var kind = trimStr(o.kind) || 'other';
    if (!isValidKind(kind)) return false;

    var expiresAt = normalizeDigits(trimStr(o.expiresAt));
    if (isNaN(parseDateEndOfDay(expiresAt))) return false;

    var remindDays = parseRemindDays(o.remindDays);
    if (isNaN(remindDays)) return false;

    var item = {
      id: makeId(),
      title: title.slice(0, 120),
      kind: kind,
      number: normalizeDigits(trimStr(o.number)).slice(0, 60),
      holder: trimStr(o.holder).slice(0, 80),
      expiresAt: expiresAt,
      remindDays: remindDays,
      note: trimStr(o.note).slice(0, 240),
      createdAt: new Date().toISOString(),
      createdBy: currentUser(),
      history: []
    };

    var store = readStore();
    store.push(item);
    if (!writeStore(store)) return false;
    refreshView();
    return cloneItem(item);
  }

  function listLicenses(nowMs) {
    var store = readStore();
    var out = [];
    var i, item;
    for (i = 0; i < store.length; i++) {
      item = store[i];
      if (!item || item.removedAt || !item.expiresAt) continue;
      out.push(cloneItem(item, nowMs));
    }
    out.sort(compareExpires);
    return out;
  }

  function dueLicenses(nowMs) {
    var all = listLicenses(nowMs);
    var out = [];
    var i, item;
    for (i = 0; i < all.length; i++) {
      item = all[i];
      if (item.daysLeft <= item.remindDays) {
        out.push(item);
      }
    }
    out.sort(compareExpires);
    return out;
  }

  function renewLicense(id, newExpiresAt, note) {
    if (!canEdit()) return false;
    var targetId = trimStr(id);
    if (!targetId) return false;

    var nextDate = normalizeDigits(trimStr(newExpiresAt));
    var nextMs = parseDateEndOfDay(nextDate);
    if (isNaN(nextMs)) return false;

    var store = readStore();
    var i, item, oldMs;
    for (i = 0; i < store.length; i++) {
      item = store[i];
      if (!item || item.removedAt || item.id !== targetId) continue;
      oldMs = parseDateEndOfDay(item.expiresAt);
      if (isNaN(oldMs) || nextMs <= oldMs) return false;

      if (!Array.isArray(item.history)) item.history = [];
      item.history.push({
        oldExpiresAt: item.expiresAt,
        newExpiresAt: nextDate,
        at: new Date().toISOString(),
        by: currentUser(),
        note: trimStr(note).slice(0, 240)
      });
      item.expiresAt = nextDate;
      if (!writeStore(store)) return false;
      refreshView();
      return cloneItem(item);
    }
    return false;
  }

  function removeLicense(id, reason) {
    if (!canEdit()) return false;
    var targetId = trimStr(id);
    var why = trimStr(reason);
    if (!targetId || !why) return false;

    var store = readStore();
    var i, item;
    for (i = 0; i < store.length; i++) {
      item = store[i];
      if (!item || item.removedAt || item.id !== targetId) continue;
      item.removedAt = new Date().toISOString();
      item.removedBy = currentUser();
      item.reason = why.slice(0, 200);
      if (!writeStore(store)) return false;
      refreshView();
      return true;
    }
    return false;
  }

  window.novaLicenses = {
    add: addLicense,
    list: listLicenses,
    due: dueLicenses,
    renew: renewLicense,
    remove: removeLicense
  };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function closeExistingDialogs() {
    var existing = document.querySelectorAll('.nlr-dialog-backdrop');
    var i;
    for (i = 0; i < existing.length; i++) {
      if (existing[i].parentNode) {
        existing[i].parentNode.removeChild(existing[i]);
      }
    }
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '#novaLicenseReminders{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;overflow:hidden;}',
      '#novaLicenseReminders *{box-sizing:border-box;}',
      '#novaLicenseReminders h3{margin:0 0 12px 0;font-size:1.1rem;color:#e6edf3;border-bottom:1px solid #343b44;padding-bottom:8px;}',
      '#novaLicenseReminders h4{margin:16px 0 8px 0;font-size:0.95rem;color:#79c9eb;}',
      '.nlr-banner{background:#3b240c;border:1px solid #d29922;color:#ffd27d;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-weight:600;font-size:0.95rem;}',
      '.nlr-list{display:flex;flex-direction:column;gap:10px;margin-bottom:16px;}',
      '.nlr-row{background:#0d1117;border:1px solid #343b44;border-radius:8px;padding:12px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;}',
      '.nlr-row-info{flex:1 1 200px;min-width:0;}',
      '.nlr-row-title{font-weight:600;font-size:0.98rem;color:#e6edf3;word-break:break-word;}',
      '.nlr-row-meta{font-size:0.84rem;color:#9fb0c2;margin-top:4px;word-break:break-word;}',
      '.nlr-badge{display:inline-block;padding:4px 10px;border-radius:999px;font-size:0.82rem;font-weight:600;margin-top:6px;}',
      '.nlr-badge-expired{background:#3d1619;border:1px solid #f85149;color:#ff9492;}',
      '.nlr-badge-due{background:#3b240c;border:1px solid #d29922;color:#ffd27d;}',
      '.nlr-badge-ok{background:#122e1d;border:1px solid #3fb950;color:#7ee787;}',
      '.nlr-row-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}',
      '.nlr-row-actions button,.nlr-actions button,.nlr-dialog-actions button{min-height:44px;}',
      '.nlr-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:10px 0;}',
      '.nlr-field{min-width:0;}',
      '.nlr-field label{display:block;font-size:0.84rem;margin-bottom:4px;color:#9fb0c2;}',
      '.nlr-input{width:100%;max-width:100%;min-width:0;min-height:44px;padding:8px 10px;background:#0d1117;border:1px solid #343b44;border-radius:8px;color:#e6edf3;font-size:0.94rem;}',
      '.nlr-input:focus{outline:none;border-color:#79c9eb;}',
      '.nlr-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center;}',
      '.nlr-status{font-size:0.85rem;color:#79c9eb;min-height:20px;margin-top:8px;}',
      '.nlr-empty{padding:12px;color:#9fb0c2;font-size:0.9rem;border:1px solid #343b44;border-radius:8px;background:#0d1117;}',
      '.nlr-dialog-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.72);display:flex;align-items:center;justify-content:center;padding:16px;z-index:9999;}',
      '.nlr-dialog{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;width:100%;max-width:360px;color:#e6edf3;}',
      '.nlr-dialog h4{margin:0 0 12px 0;color:#79c9eb;font-size:1rem;}',
      '.nlr-dialog-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;justify-content:flex-end;}'
    ].join('');
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function openRenewDialog(item) {
    closeExistingDialogs();
    var backdrop = el('div', 'nlr-dialog-backdrop');
    backdrop.setAttribute('dir', isEn() ? 'ltr' : 'rtl');
    var box = el('div', 'nlr-dialog');
    box.appendChild(el('h4', '', t('تجديد: ', 'Renew: ') + item.title));

    var dateWrap = el('div', 'nlr-field');
    var dateLbl = el('label', '', t('تاريخ الانتهاء الجديد', 'New Expiry Date'));
    dateLbl.setAttribute('for', 'nlrRenewDate');
    var dateInp = el('input', 'nlr-input');
    dateInp.id = 'nlrRenewDate';
    dateInp.type = 'date';
    dateWrap.appendChild(dateLbl);
    dateWrap.appendChild(dateInp);
    box.appendChild(dateWrap);

    var noteWrap = el('div', 'nlr-field');
    noteWrap.style.marginTop = '10px';
    var noteLbl = el('label', '', t('ملاحظة (اختياري)', 'Note (Optional)'));
    noteLbl.setAttribute('for', 'nlrRenewNote');
    var noteInp = el('input', 'nlr-input');
    noteInp.id = 'nlrRenewNote';
    noteInp.type = 'text';
    noteWrap.appendChild(noteLbl);
    noteWrap.appendChild(noteInp);
    box.appendChild(noteWrap);

    var errMsg = el('div', 'nlr-status', '');
    box.appendChild(errMsg);

    var acts = el('div', 'nlr-dialog-actions');
    var cancelBtn = el('button', 'btn btn-secondary', t('إلغاء', 'Cancel'));
    cancelBtn.type = 'button';
    var okBtn = el('button', 'btn btn-primary', t('حفظ التجديد', 'Save Renewal'));
    okBtn.type = 'button';

    cancelBtn.addEventListener('click', function () {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    });
    okBtn.addEventListener('click', function () {
      if (!canEdit()) {
        errMsg.textContent = t('ليست لديك صلاحية التعديل.', 'You do not have edit permission.');
        toast(errMsg.textContent, 'error');
        return;
      }
      var res = renewLicense(item.id, dateInp.value, noteInp.value);
      if (!res) {
        errMsg.textContent = t('التاريخ الجديد لازم يكون بعد التاريخ القديم.', 'New date must be after the current expiry.');
        toast(errMsg.textContent, 'error');
        return;
      }
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      toast(t('تم تسجيل التجديد.', 'Renewal saved.'), 'success');
    });

    acts.appendChild(cancelBtn);
    acts.appendChild(okBtn);
    box.appendChild(acts);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
  }

  function openRemoveDialog(item) {
    closeExistingDialogs();
    var backdrop = el('div', 'nlr-dialog-backdrop');
    backdrop.setAttribute('dir', isEn() ? 'ltr' : 'rtl');
    var box = el('div', 'nlr-dialog');
    box.appendChild(el('h4', '', t('حذف: ', 'Remove: ') + item.title));

    var reasonWrap = el('div', 'nlr-field');
    var reasonLbl = el('label', '', t('سبب الحذف', 'Reason for Removal'));
    reasonLbl.setAttribute('for', 'nlrRemoveReason');
    var reasonInp = el('input', 'nlr-input');
    reasonInp.id = 'nlrRemoveReason';
    reasonInp.type = 'text';
    reasonWrap.appendChild(reasonLbl);
    reasonWrap.appendChild(reasonInp);
    box.appendChild(reasonWrap);

    var errMsg = el('div', 'nlr-status', '');
    box.appendChild(errMsg);

    var acts = el('div', 'nlr-dialog-actions');
    var cancelBtn = el('button', 'btn btn-secondary', t('إلغاء', 'Cancel'));
    cancelBtn.type = 'button';
    var okBtn = el('button', 'btn btn-primary', t('تأكيد الحذف', 'Confirm Remove'));
    okBtn.type = 'button';

    cancelBtn.addEventListener('click', function () {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    });
    okBtn.addEventListener('click', function () {
      if (!canEdit()) {
        errMsg.textContent = t('ليست لديك صلاحية التعديل.', 'You do not have edit permission.');
        toast(errMsg.textContent, 'error');
        return;
      }
      var ok = removeLicense(item.id, reasonInp.value);
      if (!ok) {
        errMsg.textContent = t('اكتب سبب الحذف أولًا.', 'Enter a removal reason first.');
        toast(errMsg.textContent, 'error');
        return;
      }
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      toast(t('تم حذف السجل.', 'Record removed.'), 'success');
    });

    acts.appendChild(cancelBtn);
    acts.appendChild(okBtn);
    box.appendChild(acts);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
  }

  function refreshView() {
    var banner = document.getElementById('nlrBanner');
    var listWrap = document.getElementById('nlrListWrap');
    if (!banner || !listWrap) return;

    var due = dueLicenses();
    if (due.length > 0) {
      banner.style.display = 'block';
      banner.textContent = isEn()
        ? 'Licenses needing renewal (' + due.length + ')'
        : 'في رخص محتاجة تجديد (' + due.length + ')';
    } else {
      banner.style.display = 'none';
      banner.textContent = '';
    }

    while (listWrap.firstChild) listWrap.removeChild(listWrap.firstChild);
    var items = listLicenses();
    if (!items.length) {
      listWrap.appendChild(el('div', 'nlr-empty', t('لا توجد رخص مسجلة بعد.', 'No licenses recorded yet.')));
      return;
    }

    var editable = canEdit();
    var i, item, row, info, metaParts, badgeCls, badgeText, acts, renewBtn, remBtn;
    for (i = 0; i < items.length; i++) {
      item = items[i];
      row = el('div', 'nlr-row');
      info = el('div', 'nlr-row-info');
      info.appendChild(el('div', 'nlr-row-title', item.title));

      metaParts = [kindLabel(item.kind), t('الانتهاء: ', 'Expires: ') + item.expiresAt];
      if (item.number) metaParts.push(t('رقم: ', 'No: ') + item.number);
      if (item.holder) metaParts.push(item.holder);
      info.appendChild(el('div', 'nlr-row-meta', metaParts.join(' • ')));

      if (item.daysLeft < 0) {
        badgeCls = 'nlr-badge nlr-badge-expired';
        badgeText = isEn()
          ? 'Expired ' + Math.abs(item.daysLeft) + ' days ago'
          : 'منتهية من ' + Math.abs(item.daysLeft) + ' يوم';
      } else if (item.daysLeft <= item.remindDays) {
        badgeCls = 'nlr-badge nlr-badge-due';
        badgeText = isEn()
          ? item.daysLeft + ' days left'
          : 'فاضل ' + item.daysLeft + ' يوم';
      } else {
        badgeCls = 'nlr-badge nlr-badge-ok';
        badgeText = isEn()
          ? 'Valid (' + item.daysLeft + ' days)'
          : 'سارية (' + item.daysLeft + ' يوم)';
      }
      info.appendChild(el('span', badgeCls, badgeText));
      row.appendChild(info);

      acts = el('div', 'nlr-row-actions');
      (function (rec) {
        renewBtn = el('button', 'btn btn-primary', t('جدّدت', 'Renewed'));
        renewBtn.type = 'button';
        if (!editable) renewBtn.disabled = true;
        renewBtn.addEventListener('click', function () {
          openRenewDialog(rec);
        });
        acts.appendChild(renewBtn);

        remBtn = el('button', 'btn btn-secondary', t('حذف', 'Remove'));
        remBtn.type = 'button';
        if (!editable) remBtn.disabled = true;
        remBtn.addEventListener('click', function () {
          openRemoveDialog(rec);
        });
        acts.appendChild(remBtn);
      })(item);

      row.appendChild(acts);
      listWrap.appendChild(row);
    }
  }

  function buildCard() {
    injectStyles();
    var editable = canEdit();
    var card = el('section', 'nova-card');
    card.id = CARD_ID;
    card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    card.appendChild(el('h3', '', t('تجديد الرخص والشهادات', 'Licenses & Certificates Renewal')));

    var banner = el('div', 'nlr-banner', '');
    banner.id = 'nlrBanner';
    banner.style.display = 'none';
    card.appendChild(banner);

    var listWrap = el('div', 'nlr-list');
    listWrap.id = 'nlrListWrap';
    card.appendChild(listWrap);

    card.appendChild(el('h4', '', t('إضافة رخصة أو شهادة', 'Add License or Certificate')));
    var form = el('div', 'nlr-form');

    function makeField(labelText, id, type, placeholder) {
      var wrap = el('div', 'nlr-field');
      var lbl = el('label', '', labelText);
      lbl.setAttribute('for', id);
      var inp = el('input', 'nlr-input');
      inp.id = id;
      inp.type = type || 'text';
      if (placeholder) inp.placeholder = placeholder;
      if (!editable) inp.disabled = true;
      wrap.appendChild(lbl);
      wrap.appendChild(inp);
      form.appendChild(wrap);
      return inp;
    }

    var titleInp = makeField(t('العنوان', 'Title'), 'nlrTitleInput', 'text', t('رخصة الصيدلية', 'Pharmacy License'));

    var kindWrap = el('div', 'nlr-field');
    var kindLbl = el('label', '', t('النوع', 'Kind'));
    kindLbl.setAttribute('for', 'nlrKindSelect');
    var kindSel = el('select', 'nlr-input');
    kindSel.id = 'nlrKindSelect';
    if (!editable) kindSel.disabled = true;
    var i, opt;
    for (i = 0; i < KINDS.length; i++) {
      opt = document.createElement('option');
      opt.value = KINDS[i].id;
      opt.textContent = isEn() ? KINDS[i].en : KINDS[i].ar;
      kindSel.appendChild(opt);
    }
    kindWrap.appendChild(kindLbl);
    kindWrap.appendChild(kindSel);
    form.appendChild(kindWrap);

    var numInp = makeField(t('الرقم', 'Number'), 'nlrNumberInput', 'text', '');
    numInp.setAttribute('inputmode', 'numeric');
    var holderInp = makeField(t('باسم', 'Holder'), 'nlrHolderInput', 'text', '');
    var expInp = makeField(t('تاريخ الانتهاء', 'Expiry Date'), 'nlrExpiresInput', 'date', '');
    var remInp = makeField(t('التذكير قبل (يوم)', 'Remind Days'), 'nlrRemindInput', 'text', '30');
    remInp.setAttribute('inputmode', 'numeric');
    remInp.value = '30';
    var noteInp = makeField(t('ملاحظة', 'Note'), 'nlrNoteInput', 'text', '');

    card.appendChild(form);

    var actions = el('div', 'nlr-actions');
    var addBtn = el('button', 'btn btn-primary', t('إضافة', 'Add'));
    addBtn.type = 'button';
    if (!editable) addBtn.disabled = true;
    actions.appendChild(addBtn);
    card.appendChild(actions);

    var statusMsg = el('div', 'nlr-status', editable ? '' : t('وضع العرض فقط.', 'Read-only mode.'));
    card.appendChild(statusMsg);

    addBtn.addEventListener('click', function () {
      var created = addLicense({
        title: titleInp.value,
        kind: kindSel.value,
        number: numInp.value,
        holder: holderInp.value,
        expiresAt: expInp.value,
        remindDays: remInp.value,
        note: noteInp.value
      });
      if (!created) {
        statusMsg.textContent = t('تعذرت الإضافة: تحقق من البيانات أو الصلاحية.', 'Add failed: check inputs or permission.');
        toast(statusMsg.textContent, 'error');
        return;
      }
      titleInp.value = '';
      numInp.value = '';
      holderInp.value = '';
      expInp.value = '';
      remInp.value = '30';
      noteInp.value = '';
      statusMsg.textContent = t('تمت الإضافة بنجاح.', 'Added successfully.');
      toast(statusMsg.textContent, 'success');
    });

    return card;
  }

  function isReportsPage() {
    if (document.body && document.body.dataset && document.body.dataset.activePage === 'reports') {
      return true;
    }
    return !!document.querySelector('.nova-tab.active[data-page="reports"]');
  }

  function ensureMounted() {
    var pageView = document.getElementById('novaPageView');
    if (!pageView || !isReportsPage()) return;
    if (document.getElementById(CARD_ID)) return;
    pageView.appendChild(buildCard());
    refreshView();
  }

  function initObserver() {
    var pageView = document.getElementById('novaPageView');
    if (!pageView || observer) return;
    observer = new MutationObserver(function () {
      if (!document.getElementById(CARD_ID) && isReportsPage()) {
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
;
// app/596-supplier-cheques.js
(function () {
  'use strict';

  var STORAGE_KEY = 'nova-rx-supplier-cheques-v1';
  var LANG_KEY = 'nova-rx-language';
  var CARD_ID = 'novaSupplierCheques';
  var STYLE_ID = 'novaSupplierChequesStyle';
  var DIALOG_ID = 'novaChequesDialog';
  var MAX_RECORDS = 1000;
  var DAY_MS = 86400000;
  var observer = null;
  var activeFilter = 'all';

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

  function notify(msg, type) {
    if (window.showToast && typeof window.showToast === 'function') {
      try {
        window.showToast(msg, type || 'success');
      } catch (e) {}
    }
  }

  function trimStr(val) {
    return String(val == null ? '' : val).replace(/^\s+|\s+$/g, '');
  }

  function normalizeDigits(str) {
    var s = String(str == null ? '' : str);
    var ar = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669';
    var fa = '\u06f0\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7\u06f8\u06f9';
    var out = '';
    var i, ch, idx;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      if (ch === '\u066b') {
        out += '.';
        continue;
      }
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

  function parsePiasters(val) {
    if (typeof val === 'number') {
      if (!isFinite(val) || val <= 0) return NaN;
      val = String(val);
    }
    var s = normalizeDigits(val).replace(/^\s+|\s+$/g, '');
    if (!s || !/^\d+(?:\.\d{1,2})?$/.test(s)) return NaN;
    var parts = s.split('.');
    var whole = parseInt(parts[0], 10);
    var fracStr = parts.length > 1 ? (parts[1] + '00').slice(0, 2) : '00';
    var frac = parseInt(fracStr, 10);
    var total = whole * 100 + frac;
    if (!isFinite(total) || total <= 0 || total > 9007199254740991) return NaN;
    return total;
  }

  function formatMoney(piasters) {
    var n = Number(piasters) || 0;
    var sign = n < 0 ? '-' : '';
    var abs = Math.round(Math.abs(n));
    var whole = Math.floor(abs / 100);
    var frac = abs % 100;
    var fracStr = frac < 10 ? '0' + String(frac) : String(frac);
    return sign + String(whole) + '.' + fracStr + ' ' + t('ج.م', 'EGP');
  }

  function startOfUtcDay(ms) {
    var d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  function parseDueDate(dueAt) {
    if (dueAt === null || dueAt === undefined || dueAt === '') return null;
    if (typeof dueAt === 'number') {
      if (!isFinite(dueAt)) return null;
      var dNum = new Date(dueAt);
      if (isNaN(dNum.getTime())) return null;
      return { ms: dNum.getTime(), str: dNum.toISOString().slice(0, 10) };
    }
    if (dueAt instanceof Date) {
      if (isNaN(dueAt.getTime())) return null;
      return { ms: dueAt.getTime(), str: dueAt.toISOString().slice(0, 10) };
    }
    var s = normalizeDigits(trimStr(dueAt));
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) {
      var y = parseInt(m[1], 10);
      var mo = parseInt(m[2], 10);
      var day = parseInt(m[3], 10);
      var dt = new Date(Date.UTC(y, mo - 1, day));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== day) {
        return null;
      }
      return { ms: dt.getTime(), str: s };
    }
    var parsed = Date.parse(s);
    if (isNaN(parsed)) return null;
    return { ms: parsed, str: new Date(parsed).toISOString().slice(0, 10) };
  }

  function dueMsOf(item) {
    if (!item) return NaN;
    if (typeof item.dueMs === 'number' && isFinite(item.dueMs)) return item.dueMs;
    var p = parseDueDate(item.dueAt);
    return p ? p.ms : NaN;
  }

  function canWrite() {
    if (!window.novaPerms || typeof window.novaPerms.require !== 'function') {
      return false;
    }
    try {
      return !!window.novaPerms.require('suppliers.pay');
    } catch (e) {
      return false;
    }
  }

  function currentUserName() {
    try {
      if (window.novaAuth && typeof window.novaAuth.current === 'function') {
        var u = window.novaAuth.current();
        if (u && u.name) return String(u.name);
      }
    } catch (e) {}
    return '';
  }

  function readStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function writeStore(list) {
    try {
      var trimmed = list.length > MAX_RECORDS ? list.slice(list.length - MAX_RECORDS) : list;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return true;
    } catch (e) {
      return false;
    }
  }

  function cloneCheque(c) {
    var hist = [];
    var i, h;
    if (Array.isArray(c.history)) {
      for (i = 0; i < c.history.length; i++) {
        h = c.history[i];
        hist.push({
          at: h.at,
          by: h.by,
          from: h.from,
          to: h.to,
          note: h.note
        });
      }
    }
    return {
      id: c.id,
      supplier: c.supplier,
      number: c.number,
      bank: c.bank,
      amount: c.amount,
      dueAt: c.dueAt,
      dueMs: dueMsOf(c),
      note: c.note,
      status: c.status,
      createdAt: c.createdAt,
      createdBy: c.createdBy,
      history: hist
    };
  }

  function makeId() {
    return 'chq-' + String(Date.now()) + '-' + String(Math.floor(Math.random() * 1000000));
  }

  function normKey(s) {
    return normalizeDigits(trimStr(s)).toLowerCase();
  }

  function addCheque(opts) {
    if (!canWrite()) return false;
    var o = opts || {};
    var supplier = trimStr(o.supplier);
    var number = normalizeDigits(trimStr(o.number));
    var bank = trimStr(o.bank);
    var note = trimStr(o.note);
    var amount = parsePiasters(o.amount);
    var due = parseDueDate(o.dueAt);

    if (!supplier || !number || isNaN(amount) || !due) return false;

    var list = readStore();
    var sKey = normKey(supplier);
    var nKey = normKey(number);
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && normKey(list[i].supplier) === sKey && normKey(list[i].number) === nKey) {
        return false;
      }
    }

    var record = {
      id: makeId(),
      supplier: supplier,
      number: number,
      bank: bank,
      amount: amount,
      dueAt: due.str,
      dueMs: due.ms,
      note: note,
      status: 'pending',
      createdAt: new Date().toISOString(),
      createdBy: currentUserName(),
      history: []
    };

    list.push(record);
    if (!writeStore(list)) return false;
    refreshUI();
    return cloneCheque(record);
  }

  function transitionStatus(id, targetStatus, noteOrReason, requireReason) {
    if (!canWrite()) return false;
    var cleanId = trimStr(id);
    if (!cleanId) return false;
    var reason = trimStr(noteOrReason);
    if (requireReason && !reason) return false;

    var list = readStore();
    var i, item;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === cleanId) {
        item = list[i];
        break;
      }
    }
    if (!item || item.status !== 'pending') return false;

    if (!Array.isArray(item.history)) item.history = [];
    item.history.push({
      at: new Date().toISOString(),
      by: currentUserName(),
      from: item.status,
      to: targetStatus,
      note: reason
    });
    item.status = targetStatus;

    if (!writeStore(list)) return false;
    refreshUI();
    return cloneCheque(item);
  }

  function markPaid(id, note) {
    return transitionStatus(id, 'paid', note, false);
  }

  function markBounced(id, reason) {
    return transitionStatus(id, 'bounced', reason, true);
  }

  function cancelCheque(id, reason) {
    return transitionStatus(id, 'cancelled', reason, true);
  }

  function dueWithin(days, nowMs) {
    var d = days === undefined || days === null ? 7 : Number(days);
    if (!isFinite(d)) d = 7;
    var now = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
    var limit = now + d * DAY_MS;
    var list = readStore();
    var out = [];
    var i, item, ms;
    for (i = 0; i < list.length; i++) {
      item = list[i];
      if (!item || item.status !== 'pending') continue;
      ms = dueMsOf(item);
      if (isFinite(ms) && ms <= limit) {
        out.push(cloneCheque(item));
      }
    }
    out.sort(function (a, b) {
      return a.dueMs - b.dueMs;
    });
    return out;
  }

  function computeTotals(nowMs) {
    var now = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
    var todayStart = startOfUtcDay(now);
    var next7Limit = now + 7 * DAY_MS;
    var list = readStore();
    var pendingCount = 0;
    var pendingAmount = 0;
    var overdueAmount = 0;
    var next7Amount = 0;
    var i, item, ms, amt;
    for (i = 0; i < list.length; i++) {
      item = list[i];
      if (!item || item.status !== 'pending') continue;
      amt = Number(item.amount) || 0;
      ms = dueMsOf(item);
      pendingCount += 1;
      pendingAmount += amt;
      if (isFinite(ms)) {
        if (ms < todayStart) {
          overdueAmount += amt;
        } else if (ms <= next7Limit) {
          next7Amount += amt;
        }
      }
    }
    return {
      pendingCount: pendingCount,
      pendingAmount: pendingAmount,
      overdueAmount: overdueAmount,
      next7Amount: next7Amount
    };
  }

  function listCheques(filter) {
    var list = readStore();
    var now = Date.now();
    var opts = filter && typeof filter === 'object' ? filter : null;
    if (opts && typeof opts.nowMs === 'number' && isFinite(opts.nowMs)) {
      now = opts.nowMs;
    }
    var todayStart = startOfUtcDay(now);
    var next7Limit = now + 7 * DAY_MS;
    var out = [];
    var i, item, ms, match;
    var mode = typeof filter === 'string' ? filter : 'all';

    for (i = 0; i < list.length; i++) {
      item = list[i];
      if (!item) continue;
      ms = dueMsOf(item);
      match = true;

      if (opts) {
        if (opts.status && opts.status !== 'all' && item.status !== opts.status) match = false;
        if (match && opts.supplier && normKey(item.supplier).indexOf(normKey(opts.supplier)) === -1) match = false;
        if (match && opts.overdue && !(item.status === 'pending' && isFinite(ms) && ms < todayStart)) match = false;
        if (match && typeof opts.dueWithinDays === 'number' && isFinite(opts.dueWithinDays)) {
          if (!(item.status === 'pending' && isFinite(ms) && ms <= now + opts.dueWithinDays * DAY_MS)) {
            match = false;
          }
        }
      } else if (mode && mode !== 'all') {
        if (mode === 'overdue') {
          match = item.status === 'pending' && isFinite(ms) && ms < todayStart;
        } else if (mode === 'soon' || mode === 'due7') {
          match = item.status === 'pending' && isFinite(ms) && ms >= todayStart && ms <= next7Limit;
        } else {
          match = item.status === mode;
        }
      }

      if (match) out.push(cloneCheque(item));
    }

    out.sort(function (a, b) {
      return a.dueMs - b.dueMs;
    });
    return out;
  }

  window.novaCheques = {
    add: addCheque,
    list: listCheques,
    dueWithin: dueWithin,
    markPaid: markPaid,
    markBounced: markBounced,
    cancel: cancelCheque,
    totals: computeTotals
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
      '#novaSupplierCheques{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;}',
      '#novaSupplierCheques *{box-sizing:border-box;}',
      '#novaSupplierCheques h3{margin:0 0 12px 0;font-size:1.1rem;color:#e6edf3;border-bottom:1px solid #343b44;padding-bottom:8px;}',
      '.nsc-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px;}',
      '.nsc-kpi{background:#0d1117;border:1px solid #343b44;border-radius:8px;padding:10px 12px;}',
      '.nsc-kpi-label{font-size:0.82rem;color:#9fb0c2;margin-bottom:4px;}',
      '.nsc-kpi-val{font-size:1.05rem;font-weight:700;color:#79c9eb;}',
      '.nsc-kpi-overdue .nsc-kpi-val{color:#f87171;}',
      '.nsc-kpi-soon .nsc-kpi-val{color:#fbbf24;}',
      '.nsc-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin-bottom:12px;padding:12px;background:#0d1117;border:1px solid #343b44;border-radius:8px;}',
      '.nsc-field label{display:block;font-size:0.82rem;color:#9fb0c2;margin-bottom:4px;}',
      '.nsc-input{width:100%;min-height:44px;padding:8px 10px;background:#14181d;border:1px solid #343b44;border-radius:8px;color:#e6edf3;font-size:0.92rem;}',
      '.nsc-input:focus{outline:none;border-color:#79c9eb;}',
      '.nsc-form-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;}',
      '.nsc-form-actions button{min-height:44px;}',
      '.nsc-status{font-size:0.85rem;color:#79c9eb;min-height:20px;}',
      '.nsc-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;}',
      '.nsc-chip{min-height:44px;padding:8px 14px;border-radius:999px;border:1px solid #343b44;background:#0d1117;color:#e6edf3;cursor:pointer;font-size:0.88rem;}',
      '.nsc-chip.active{border-color:#79c9eb;background:#1c2b36;color:#79c9eb;font-weight:600;}',
      '.nsc-table-wrap{width:100%;overflow-x:auto;border:1px solid #343b44;border-radius:8px;}',
      '.nsc-table{width:100%;border-collapse:collapse;font-size:0.88rem;min-width:560px;}',
      '.nsc-table th,.nsc-table td{padding:8px 10px;border-bottom:1px solid #343b44;text-align:inherit;white-space:nowrap;}',
      '.nsc-table th{background:#1b2129;color:#79c9eb;font-weight:600;}',
      '.nsc-table tr:last-child td{border-bottom:0;}',
      '.nsc-row-overdue{background:rgba(248,113,113,0.14);}',
      '.nsc-row-overdue td:first-child{border-inline-start:3px solid #f87171;}',
      '.nsc-row-soon{background:rgba(251,191,36,0.12);}',
      '.nsc-row-soon td:first-child{border-inline-start:3px solid #fbbf24;}',
      '.nsc-row-btns{display:flex;gap:6px;flex-wrap:nowrap;}',
      '.nsc-row-btns button{min-height:44px;padding:6px 10px;font-size:0.82rem;}',
      '.nsc-empty{padding:14px;color:#9fb0c2;font-size:0.9rem;}',
      '#novaChequesDialog{position:fixed;inset:0;background:rgba(0,0,0,0.68);display:flex;align-items:center;justify-content:center;padding:16px;z-index:9999;}',
      '.nsc-dialog-box{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;width:100%;max-width:360px;color:#e6edf3;box-sizing:border-box;}',
      '.nsc-dialog-box h4{margin:0 0 10px 0;font-size:1rem;color:#79c9eb;}',
      '.nsc-dialog-err{font-size:0.84rem;color:#f87171;min-height:18px;margin-top:6px;}',
      '.nsc-dialog-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;}',
      '.nsc-dialog-actions button{min-height:44px;}'
    ].join('');
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function statusLabel(status) {
    if (status === 'paid') return t('اتصرف', 'Paid');
    if (status === 'bounced') return t('مرتد', 'Bounced');
    if (status === 'cancelled') return t('ملغي', 'Cancelled');
    return t('معلق', 'Pending');
  }

  function closeDialog() {
    var existing = document.getElementById(DIALOG_ID);
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }

  function openActionDialog(action, cheque) {
    closeDialog();
    var overlay = el('div', '');
    overlay.id = DIALOG_ID;
    overlay.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    var box = el('div', 'nsc-dialog-box');
    var titleText = action === 'paid'
      ? t('تأكيد صرف الشيك', 'Confirm Cheque Paid')
      : (action === 'bounced'
        ? t('تسجيل ارتداد الشيك', 'Mark Cheque Bounced')
        : t('إلغاء الشيك', 'Cancel Cheque'));
    box.appendChild(el('h4', '', titleText));
    box.appendChild(el('div', 'nsc-kpi-label', cheque.supplier + ' — ' + cheque.number + ' (' + formatMoney(cheque.amount) + ')'));

    var isRequired = action !== 'paid';
    var lbl = el('label', '', isRequired ? t('السبب (مطلوب)', 'Reason (required)') : t('ملاحظة (اختياري)', 'Note (optional)'));
    lbl.style.display = 'block';
    lbl.style.marginTop = '10px';
    lbl.style.marginBottom = '4px';
    lbl.style.fontSize = '0.84rem';
    lbl.style.color = '#9fb0c2';
    box.appendChild(lbl);

    var input = el('input', 'nsc-input');
    input.type = 'text';
    input.id = 'nscDialogInput';
    input.placeholder = isRequired ? t('اكتب السبب...', 'Enter reason...') : t('ملاحظة اختيارية...', 'Optional note...');
    box.appendChild(input);

    var errMsg = el('div', 'nsc-dialog-err', '');
    box.appendChild(errMsg);

    var actions = el('div', 'nsc-dialog-actions');
    var cancelBtn = el('button', 'btn btn-secondary', t('رجوع', 'Back'));
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', closeDialog);

    var confirmBtn = el('button', 'btn btn-primary', t('تأكيد', 'Confirm'));
    confirmBtn.type = 'button';
    confirmBtn.addEventListener('click', function () {
      var val = trimStr(input.value);
      if (isRequired && !val) {
        errMsg.textContent = t('السبب مطلوب.', 'Reason is required.');
        return;
      }
      var res = false;
      if (action === 'paid') res = markPaid(cheque.id, val);
      else if (action === 'bounced') res = markBounced(cheque.id, val);
      else res = cancelCheque(cheque.id, val);

      if (!res) {
        errMsg.textContent = t('تعذر تنفيذ العملية: تحقق من الصلاحية أو الحالة.', 'Action failed: check permission or status.');
        notify(errMsg.textContent, 'error');
        return;
      }
      closeDialog();
      notify(t('تم تحديث حالة الشيك.', 'Cheque status updated.'), 'success');
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    input.focus();
  }

  function refreshUI() {
    var summaryBox = document.getElementById('nscSummary');
    var tableBox = document.getElementById('nscTableWrap');
    if (!summaryBox || !tableBox) return;

    var totals = computeTotals();
    while (summaryBox.firstChild) summaryBox.removeChild(summaryBox.firstChild);

    function makeKpi(cls, label, val) {
      var box = el('div', 'nsc-kpi ' + cls);
      box.appendChild(el('div', 'nsc-kpi-label', label));
      box.appendChild(el('div', 'nsc-kpi-val', val));
      return box;
    }

    summaryBox.appendChild(makeKpi('nsc-kpi-soon', t('المستحق خلال ٧ أيام', 'Due in 7 Days'), formatMoney(totals.next7Amount)));
    summaryBox.appendChild(makeKpi('nsc-kpi-overdue', t('المتأخر', 'Overdue'), formatMoney(totals.overdueAmount)));
    summaryBox.appendChild(makeKpi('', t('إجمالي المعلق', 'Total Pending'), formatMoney(totals.pendingAmount)));

    while (tableBox.firstChild) tableBox.removeChild(tableBox.firstChild);
    var rows = listCheques(activeFilter);
    if (!rows.length) {
      tableBox.appendChild(el('div', 'nsc-empty', t('لا توجد شيكات مطابقة.', 'No matching cheques.')));
      return;
    }

    var table = el('table', 'nsc-table');
    var thead = document.createElement('thead');
    var trHead = document.createElement('tr');
    var headers = [
      t('المورد', 'Supplier'),
      t('رقم الشيك', 'Cheque No.'),
      t('البنك', 'Bank'),
      t('المبلغ', 'Amount'),
      t('الاستحقاق', 'Due Date'),
      t('الحالة', 'Status'),
      t('إجراءات', 'Actions')
    ];
    var i;
    for (i = 0; i < headers.length; i++) {
      trHead.appendChild(el('th', '', headers[i]));
    }
    thead.appendChild(trHead);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    var now = Date.now();
    var todayStart = startOfUtcDay(now);
    var next7 = now + 7 * DAY_MS;
    var editable = canWrite();

    for (i = 0; i < rows.length; i++) {
      (function (item) {
        var tr = document.createElement('tr');
        if (item.status === 'pending') {
          if (item.dueMs < todayStart) tr.className = 'nsc-row-overdue';
          else if (item.dueMs <= next7) tr.className = 'nsc-row-soon';
        }
        tr.appendChild(el('td', '', item.supplier));
        tr.appendChild(el('td', '', item.number));
        tr.appendChild(el('td', '', item.bank || '—'));
        tr.appendChild(el('td', '', formatMoney(item.amount)));
        tr.appendChild(el('td', '', item.dueAt));
        tr.appendChild(el('td', '', statusLabel(item.status)));

        var actTd = document.createElement('td');
        if (item.status === 'pending') {
          var btnWrap = el('div', 'nsc-row-btns');
          var paidBtn = el('button', 'btn btn-primary', t('اتصرف', 'Paid'));
          paidBtn.type = 'button';
          if (!editable) paidBtn.disabled = true;
          paidBtn.addEventListener('click', function () {
            openActionDialog('paid', item);
          });

          var bounceBtn = el('button', 'btn btn-secondary', t('ارتد', 'Bounced'));
          bounceBtn.type = 'button';
          if (!editable) bounceBtn.disabled = true;
          bounceBtn.addEventListener('click', function () {
            openActionDialog('bounced', item);
          });

          var cancelBtn = el('button', 'btn btn-secondary', t('إلغاء', 'Cancel'));
          cancelBtn.type = 'button';
          if (!editable) cancelBtn.disabled = true;
          cancelBtn.addEventListener('click', function () {
            openActionDialog('cancelled', item);
          });

          btnWrap.appendChild(paidBtn);
          btnWrap.appendChild(bounceBtn);
          btnWrap.appendChild(cancelBtn);
          actTd.appendChild(btnWrap);
        } else {
          actTd.textContent = '—';
        }
        tr.appendChild(actTd);
        tbody.appendChild(tr);
      })(rows[i]);
    }

    table.appendChild(tbody);
    tableBox.appendChild(table);
  }

  function buildCard() {
    injectStyles();
    activeFilter = 'all';
    var editable = canWrite();
    var card = el('section', 'nova-card');
    card.id = CARD_ID;
    card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    card.appendChild(el('h3', '', t('الشيكات الآجلة للموردين', 'Supplier Post-Dated Cheques')));

    var summary = el('div', 'nsc-summary');
    summary.id = 'nscSummary';
    card.appendChild(summary);

    var form = el('div', 'nsc-form');
    function makeField(labelText, id, type, placeholder) {
      var wrap = el('div', 'nsc-field');
      var lbl = el('label', '', labelText);
      lbl.setAttribute('for', id);
      var inp = el('input', 'nsc-input');
      inp.id = id;
      inp.type = type || 'text';
      if (placeholder) inp.placeholder = placeholder;
      if (!editable) inp.disabled = true;
      wrap.appendChild(lbl);
      wrap.appendChild(inp);
      form.appendChild(wrap);
      return inp;
    }

    var supplierInp = makeField(t('المورد', 'Supplier'), 'nscSupplier', 'text', t('اسم المورد', 'Supplier name'));
    var numberInp = makeField(t('رقم الشيك', 'Cheque No.'), 'nscNumber', 'text', t('رقم الشيك', 'Cheque number'));
    var bankInp = makeField(t('البنك', 'Bank'), 'nscBank', 'text', t('اسم البنك', 'Bank name'));
    var amountInp = makeField(t('المبلغ', 'Amount'), 'nscAmount', 'text', '0.00');
    amountInp.setAttribute('inputmode', 'decimal');
    var dueInp = makeField(t('تاريخ الاستحقاق', 'Due Date'), 'nscDueAt', 'date', '');
    var noteInp = makeField(t('ملاحظة', 'Note'), 'nscNote', 'text', t('اختياري', 'Optional'));

    card.appendChild(form);

    var formActions = el('div', 'nsc-form-actions');
    var addBtn = el('button', 'btn btn-primary', t('إضافة شيك', 'Add Cheque'));
    addBtn.type = 'button';
    if (!editable) addBtn.disabled = true;
    var statusMsg = el('div', 'nsc-status', editable ? '' : t('وضع العرض فقط.', 'Read-only mode.'));

    addBtn.addEventListener('click', function () {
      var saved = addCheque({
        supplier: supplierInp.value,
        number: numberInp.value,
        bank: bankInp.value,
        amount: amountInp.value,
        dueAt: dueInp.value,
        note: noteInp.value
      });
      if (!saved) {
        statusMsg.textContent = t('تعذر الإضافة: تحقق من البيانات أو التكرار أو الصلاحية.', 'Add failed: check fields, duplicate, or permission.');
        notify(statusMsg.textContent, 'error');
        return;
      }
      supplierInp.value = '';
      numberInp.value = '';
      bankInp.value = '';
      amountInp.value = '';
      dueInp.value = '';
      noteInp.value = '';
      statusMsg.textContent = t('تم تسجيل الشيك بنجاح.', 'Cheque added successfully.');
      notify(statusMsg.textContent, 'success');
    });

    formActions.appendChild(addBtn);
    formActions.appendChild(statusMsg);
    card.appendChild(formActions);

    var chipsWrap = el('div', 'nsc-chips');
    var chipDefs = [
      { key: 'all', label: t('الكل', 'All') },
      { key: 'soon', label: t('مستحق قريب', 'Due Soon') },
      { key: 'overdue', label: t('متأخر', 'Overdue') },
      { key: 'paid', label: t('اتصرف', 'Paid') },
      { key: 'bounced', label: t('مرتد', 'Bounced') }
    ];
    var chipButtons = [];
    var i;
    for (i = 0; i < chipDefs.length; i++) {
      (function (def) {
        var btn = el('button', 'nsc-chip' + (def.key === activeFilter ? ' active' : ''), def.label);
        btn.type = 'button';
        btn.setAttribute('data-filter', def.key);
        btn.addEventListener('click', function () {
          activeFilter = def.key;
          var j;
          for (j = 0; j < chipButtons.length; j++) {
            chipButtons[j].className = 'nsc-chip' + (chipButtons[j].getAttribute('data-filter') === activeFilter ? ' active' : '');
          }
          refreshUI();
        });
        chipButtons.push(btn);
        chipsWrap.appendChild(btn);
      })(chipDefs[i]);
    }
    card.appendChild(chipsWrap);

    var tableWrap = el('div', 'nsc-table-wrap');
    tableWrap.id = 'nscTableWrap';
    card.appendChild(tableWrap);

    return card;
  }

  function isReportsPage() {
    if (document.body && document.body.dataset && document.body.dataset.activePage === 'reports') {
      return true;
    }
    return !!document.querySelector('.nova-tab.active[data-page="reports"]');
  }

  function ensureMounted() {
    var pageView = document.getElementById('novaPageView');
    if (!pageView || pageView.hidden || !isReportsPage()) return;
    if (document.getElementById(CARD_ID)) return;
    pageView.appendChild(buildCard());
    refreshUI();
  }

  function initObserver() {
    var pageView = document.getElementById('novaPageView');
    if (!pageView || observer) return;
    observer = new MutationObserver(function () {
      if (!document.getElementById(CARD_ID) && isReportsPage()) {
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
;
// app/598-shelf-labels.js
(function () {
  'use strict';

  var STORAGE_KEY = 'nova-rx-shelf-labels-v1';
  var LANG_KEY = 'nova-rx-language';
  var CARD_ID = 'novaShelfLabels';
  var STYLE_ID = 'novaShelfLabelsStyle';
  var MAX_ITEMS = 500;
  var VALID_SIZES = { small: true, medium: true, a4: true };
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

  function toast(msg, type) {
    if (typeof window.showToast === 'function') {
      try {
        window.showToast(msg, type || 'success');
      } catch (e) {
        // ignore toast errors
      }
    }
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

  function parseCopies(val) {
    var s = normalizeDigits(val).replace(/^\s+|\s+$/g, '');
    if (!s || !/^\d+$/.test(s)) return NaN;
    var n = parseInt(s, 10);
    if (n < 1 || n > 50) return NaN;
    return n;
  }

  function readStore() {
    var fallback = { size: 'medium', items: [] };
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return fallback;
      var size = VALID_SIZES[parsed.size] ? parsed.size : 'medium';
      var rawItems = Array.isArray(parsed.items) ? parsed.items : [];
      var items = [];
      var i, it, c;
      for (i = 0; i < rawItems.length; i++) {
        it = rawItems[i];
        if (!it || typeof it !== 'object' || !it.key) continue;
        c = parseCopies(it.copies);
        if (isNaN(c)) continue;
        items.push({ key: String(it.key), copies: c });
      }
      if (items.length > MAX_ITEMS) {
        items = items.slice(items.length - MAX_ITEMS);
      }
      return { size: size, items: items };
    } catch (e) {
      return fallback;
    }
  }

  function writeStore(data) {
    var safe = {
      size: VALID_SIZES[data && data.size] ? data.size : 'medium',
      items: Array.isArray(data && data.items) ? data.items.slice(-MAX_ITEMS) : []
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
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

  function searchProducts(q) {
    if (window.novaSearch && typeof window.novaSearch.search === 'function') {
      return window.novaSearch.search(q, 10) || [];
    }
    var query = normalizeDigits(q).toLowerCase();
    var list = getProducts();
    var out = [];
    var i, p;
    for (i = 0; i < list.length && out.length < 10; i++) {
      p = list[i];
      if (
        !query ||
        (p.name && p.name.toLowerCase().indexOf(query) !== -1) ||
        (p.nameEn && p.nameEn.toLowerCase().indexOf(query) !== -1) ||
        (p.barcode && String(p.barcode).indexOf(query) !== -1)
      ) {
        out.push(p);
      }
    }
    return out;
  }

  function getShelf(key) {
    if (window.novaItemLimits && typeof window.novaItemLimits.shelfOf === 'function') {
      try {
        return String(window.novaItemLimits.shelfOf(key) || '');
      } catch (e) {
        return '';
      }
    }
    return '';
  }

  function readPrice(product) {
    if (!product) return 0;
    var raw = product.price != null ? product.price : (product.salePrice != null ? product.salePrice : 0);
    var num = Number(raw);
    return isNaN(num) || num < 0 ? 0 : num;
  }

  function formatPrice(num) {
    var n = Number(num);
    if (isNaN(n)) n = 0;
    return n.toFixed(2) + ' \u062c.\u0645';
  }

  function readEnglishName(product) {
    if (!product) return '';
    var en = product.nameEn || product.enName || product.name_en || product.englishName || '';
    en = String(en).replace(/^\s+|\s+$/g, '');
    if (!en || (product.name && en === String(product.name).replace(/^\s+|\s+$/g, ''))) {
      return '';
    }
    return en;
  }

  function enrichItem(entry) {
    var prod = findProductByKey(entry.key);
    return {
      key: entry.key,
      copies: entry.copies,
      name: prod && prod.name ? String(prod.name) : entry.key,
      nameEn: readEnglishName(prod),
      price: readPrice(prod),
      barcode: prod && prod.barcode ? String(prod.barcode) : '',
      shelf: getShelf(entry.key)
    };
  }

  function getQueue() {
    var store = readStore();
    var out = [];
    var i;
    for (i = 0; i < store.items.length; i++) {
      out.push(enrichItem(store.items[i]));
    }
    return out;
  }

  function addItem(itemKey, copies) {
    var key = String(itemKey == null ? '' : itemKey).replace(/^\s+|\s+$/g, '');
    if (!key) return false;
    var count = parseCopies(copies);
    if (isNaN(count)) return false;

    var store = readStore();
    var found = false;
    var i;
    for (i = 0; i < store.items.length; i++) {
      if (store.items[i].key === key) {
        store.items[i].copies = count;
        found = true;
        break;
      }
    }
    if (!found) {
      store.items.push({ key: key, copies: count });
    }
    if (store.items.length > MAX_ITEMS) {
      store.items = store.items.slice(store.items.length - MAX_ITEMS);
    }
    writeStore(store);
    refreshUI();
    return enrichItem({ key: key, copies: count });
  }

  function removeItem(itemKey) {
    var key = String(itemKey == null ? '' : itemKey).replace(/^\s+|\s+$/g, '');
    var store = readStore();
    var next = [];
    var removed = false;
    var i;
    for (i = 0; i < store.items.length; i++) {
      if (store.items[i].key === key) {
        removed = true;
      } else {
        next.push(store.items[i]);
      }
    }
    if (!removed) return false;
    store.items = next;
    writeStore(store);
    refreshUI();
    return true;
  }

  function clearQueue() {
    var store = readStore();
    store.items = [];
    writeStore(store);
    refreshUI();
    return true;
  }

  function setSize(size) {
    var s = String(size == null ? '' : size).replace(/^\s+|\s+$/g, '').toLowerCase();
    if (!VALID_SIZES[s]) return false;
    var store = readStore();
    store.size = s;
    writeStore(store);
    refreshUI();
    return s;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function buildPrintCss(size) {
    var pageRule = '@page{size:50mm 30mm;margin:0;}';
    if (size === 'small') {
      pageRule = '@page{size:38mm 25mm;margin:0;}';
    } else if (size === 'a4') {
      pageRule = '@page{size:A4;margin:8mm;}';
    }
    return [
      pageRule,
      '*{box-sizing:border-box;}',
      'body{margin:0;padding:0;font-family:sans-serif;color:#000;background:#fff;direction:rtl;}',
      '.nsl-sheet{width:100%;}',
      '.nsl-label{border:1px solid #ccc;padding:2mm;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;background:#fff;}',
      '.nsl-size-small .nsl-label{width:38mm;height:25mm;page-break-after:always;break-after:page;}',
      '.nsl-size-medium .nsl-label{width:50mm;height:30mm;page-break-after:always;break-after:page;}',
      '.nsl-size-small .nsl-label:last-child,.nsl-size-medium .nsl-label:last-child{page-break-after:auto;break-after:auto;}',
      '.nsl-grid{display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:32.5mm;gap:2mm;}',
      '.nsl-grid .nsl-label{width:100%;height:32.5mm;break-inside:avoid;page-break-inside:avoid;}',
      '.nsl-name{font-size:10pt;font-weight:700;line-height:1.2;word-break:break-word;}',
      '.nsl-name-en{font-size:7.5pt;color:#333;direction:ltr;text-align:left;line-height:1.1;word-break:break-word;}',
      '.nsl-price{font-size:12pt;font-weight:800;margin-top:1mm;}',
      '.nsl-meta{display:flex;justify-content:space-between;align-items:center;gap:2mm;font-size:7pt;color:#222;}',
      '.nsl-barcode{font-family:monospace;direction:ltr;letter-spacing:0.5px;}',
      '.nsl-shelf{font-weight:600;}',
      '@media print{body{margin:0;}.nsl-label{border:0.5pt solid #bbb;}}'
    ].join('');
  }

  function buildPrintHtml() {
    var store = readStore();
    var size = store.size;
    var items = getQueue();

    var htmlEl = document.createElement('html');
    htmlEl.setAttribute('dir', 'rtl');
    htmlEl.setAttribute('lang', 'ar');

    var head = document.createElement('head');
    var meta = document.createElement('meta');
    meta.setAttribute('charset', 'utf-8');
    head.appendChild(meta);
    head.appendChild(el('title', '', t('ملصقات أسعار الرف', 'Shelf Price Labels')));
    var style = document.createElement('style');
    style.textContent = buildPrintCss(size);
    head.appendChild(style);
    htmlEl.appendChild(head);

    var body = document.createElement('body');
    var sheetCls = 'nsl-sheet nsl-size-' + size + (size === 'a4' ? ' nsl-grid' : '');
    var sheet = el('div', sheetCls);

    var i, c, item, label, topBox, metaRow;
    for (i = 0; i < items.length; i++) {
      item = items[i];
      for (c = 0; c < item.copies; c++) {
        label = el('div', 'nsl-label');
        topBox = el('div', 'nsl-top');
        topBox.appendChild(el('div', 'nsl-name', item.name));
        if (item.nameEn) {
          topBox.appendChild(el('div', 'nsl-name-en', item.nameEn));
        }
        label.appendChild(topBox);

        label.appendChild(el('div', 'nsl-price', formatPrice(item.price)));

        if (item.barcode || item.shelf) {
          metaRow = el('div', 'nsl-meta');
          if (item.shelf) {
            metaRow.appendChild(el('span', 'nsl-shelf', item.shelf));
          }
          if (item.barcode) {
            metaRow.appendChild(el('span', 'nsl-barcode', item.barcode));
          }
          label.appendChild(metaRow);
        }

        sheet.appendChild(label);
      }
    }

    body.appendChild(sheet);
    htmlEl.appendChild(body);
    return '<!DOCTYPE html>' + htmlEl.outerHTML;
  }

  function printLabels() {
    var items = getQueue();
    if (!items.length) {
      toast(t('قائمة الطباعة فارغة.', 'Print queue is empty.'), 'error');
      return false;
    }
    var markup = buildPrintHtml();
    var frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.style.visibility = 'hidden';
    frame.onload = function () {
      try {
        if (frame.contentWindow && typeof frame.contentWindow.focus === 'function') {
          frame.contentWindow.focus();
        }
        if (frame.contentWindow && typeof frame.contentWindow.print === 'function') {
          frame.contentWindow.print();
        }
      } catch (e) {
        // ignore print errors in headless environments
      }
      setTimeout(function () {
        if (frame.parentNode) frame.parentNode.removeChild(frame);
      }, 1000);
    };
    frame.srcdoc = markup;
    document.body.appendChild(frame);
    toast(t('جاري تجهيز الملصقات للطباعة.', 'Preparing labels for print.'), 'success');
    return true;
  }

  window.novaShelfLabels = {
    queue: getQueue,
    addItem: addItem,
    remove: removeItem,
    clear: clearQueue,
    setSize: setSize,
    html: buildPrintHtml
  };

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '#novaShelfLabels{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;overflow:hidden;}',
      '#novaShelfLabels *{box-sizing:border-box;}',
      '#novaShelfLabels h3,#novaShelfLabels h4{margin:0 0 12px 0;color:#e6edf3;}',
      '#novaShelfLabels h3{font-size:1.1rem;border-bottom:1px solid #343b44;padding-bottom:8px;}',
      '#novaShelfLabels h4{font-size:0.95rem;margin-top:14px;color:#79c9eb;}',
      '.nsl-search-wrap{position:relative;margin-bottom:12px;}',
      '.nsl-input{width:100%;min-height:44px;padding:8px 12px;background:#0d1117;border:1px solid #343b44;border-radius:8px;color:#e6edf3;font-size:0.95rem;}',
      '.nsl-input:focus{outline:none;border-color:#79c9eb;}',
      '.nsl-results{margin-top:6px;border:1px solid #343b44;border-radius:8px;background:#0d1117;max-height:220px;overflow-y:auto;}',
      '.nsl-result-btn{display:block;width:100%;min-height:44px;text-align:inherit;padding:8px 12px;background:transparent;border:0;border-bottom:1px solid #343b44;color:#e6edf3;cursor:pointer;}',
      '.nsl-result-btn:last-child{border-bottom:0;}',
      '.nsl-result-btn:hover{background:#1c232b;}',
      '.nsl-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:10px 0;align-items:end;}',
      '.nsl-field label{display:block;font-size:0.85rem;margin-bottom:4px;color:#9fb0c2;}',
      '.nsl-sizes{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0;}',
      '.nsl-size-btn{min-height:44px;flex:1 1 110px;}',
      '.nsl-size-btn.is-active{border-color:#79c9eb;box-shadow:inset 0 0 0 1px #79c9eb;}',
      '.nsl-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;align-items:center;}',
      '.nsl-actions button,.nsl-form button,.nsl-del-btn{min-height:44px;}',
      '.nsl-status{font-size:0.85rem;color:#79c9eb;min-height:20px;margin-top:6px;}',
      '.nsl-table-wrap{width:100%;overflow-x:auto;border:1px solid #343b44;border-radius:8px;margin-top:8px;}',
      '.nsl-table{width:100%;border-collapse:collapse;font-size:0.9rem;min-width:300px;}',
      '.nsl-table th,.nsl-table td{padding:8px 10px;border-bottom:1px solid #343b44;text-align:inherit;white-space:nowrap;}',
      '.nsl-table th{background:#1b2129;color:#79c9eb;font-weight:600;}',
      '.nsl-table tr:last-child td{border-bottom:0;}',
      '.nsl-empty{padding:12px;color:#9fb0c2;font-size:0.9rem;}'
    ].join('');
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function refreshUI() {
    var card = document.getElementById(CARD_ID);
    if (!card) return;
    var store = readStore();
    var sizeBtns = card.querySelectorAll('.nsl-size-btn');
    var i, btn;
    for (i = 0; i < sizeBtns.length; i++) {
      btn = sizeBtns[i];
      if (btn.getAttribute('data-size') === store.size) {
        btn.className = 'btn btn-primary nsl-size-btn is-active';
      } else {
        btn.className = 'btn btn-secondary nsl-size-btn';
      }
    }

    var queueWrap = document.getElementById('nslQueueWrap');
    if (!queueWrap) return;
    while (queueWrap.firstChild) queueWrap.removeChild(queueWrap.firstChild);

    var items = getQueue();
    if (!items.length) {
      var emptyWrap = el('div', 'nsl-table-wrap');
      emptyWrap.appendChild(el('div', 'nsl-empty', t('لا توجد أصناف في قائمة الطباعة.', 'No items in the print queue.')));
      queueWrap.appendChild(emptyWrap);
      return;
    }

    var wrap = el('div', 'nsl-table-wrap');
    var table = el('table', 'nsl-table');
    var thead = document.createElement('thead');
    var trHead = document.createElement('tr');
    var headers = [
      t('الصنف', 'Item'),
      t('السعر', 'Price'),
      t('الرف', 'Shelf'),
      t('النسخ', 'Copies'),
      t('إجراء', 'Action')
    ];
    for (i = 0; i < headers.length; i++) {
      trHead.appendChild(el('th', '', headers[i]));
    }
    thead.appendChild(trHead);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (i = 0; i < items.length; i++) {
      (function (item) {
        var tr = document.createElement('tr');
        tr.appendChild(el('td', '', item.name));
        tr.appendChild(el('td', '', formatPrice(item.price)));
        tr.appendChild(el('td', '', item.shelf || '—'));
        tr.appendChild(el('td', '', String(item.copies)));
        var tdAct = document.createElement('td');
        var rmBtn = el('button', 'btn btn-secondary nsl-del-btn', t('حذف', 'Remove'));
        rmBtn.type = 'button';
        rmBtn.addEventListener('click', function () {
          removeItem(item.key);
        });
        tdAct.appendChild(rmBtn);
        tr.appendChild(tdAct);
        tbody.appendChild(tr);
      })(items[i]);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    queueWrap.appendChild(wrap);
  }

  function buildCard() {
    injectStyles();
    selectedKey = '';
    var card = el('section', 'nova-card');
    card.id = CARD_ID;
    card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    card.appendChild(el('h3', '', t('ملصقات أسعار الرف', 'Shelf Price Labels')));

    var searchWrap = el('div', 'nsl-search-wrap');
    var searchInput = el('input', 'nsl-input');
    searchInput.type = 'search';
    searchInput.placeholder = t('ابحث عن صنف بالاسم أو الباركود...', 'Search item by name or barcode...');
    var resultsBox = el('div', 'nsl-results');
    resultsBox.style.display = 'none';
    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(resultsBox);
    card.appendChild(searchWrap);

    var selectedTitle = el('div', 'nsl-status', '');
    card.appendChild(selectedTitle);

    var form = el('div', 'nsl-form');
    var copiesField = el('div', 'nsl-field');
    var copiesLbl = el('label', '', t('عدد النسخ (١ إلى ٥٠)', 'Copies (1 to 50)'));
    copiesLbl.setAttribute('for', 'nslCopiesInput');
    var copiesInput = el('input', 'nsl-input');
    copiesInput.id = 'nslCopiesInput';
    copiesInput.type = 'text';
    copiesInput.value = '1';
    copiesInput.setAttribute('inputmode', 'numeric');
    copiesField.appendChild(copiesLbl);
    copiesField.appendChild(copiesInput);
    form.appendChild(copiesField);

    var addBtn = el('button', 'btn btn-primary', t('إضافة للقائمة', 'Add to Queue'));
    addBtn.type = 'button';
    form.appendChild(addBtn);
    card.appendChild(form);

    card.appendChild(el('h4', '', t('مقاس الملصق', 'Label Size')));
    var sizesRow = el('div', 'nsl-sizes');
    var sizeDefs = [
      { id: 'small', ar: 'صغير (٣٨×٢٥ مم)', en: 'Small (38x25mm)' },
      { id: 'medium', ar: 'متوسط (٥٠×٣٠ مم)', en: 'Medium (50x30mm)' },
      { id: 'a4', ar: 'ورقة كاملة (٣×٨)', en: 'A4 Grid (3x8)' }
    ];
    var i;
    for (i = 0; i < sizeDefs.length; i++) {
      (function (def) {
        var b = el('button', 'btn btn-secondary nsl-size-btn', t(def.ar, def.en));
        b.type = 'button';
        b.setAttribute('data-size', def.id);
        b.addEventListener('click', function () {
          setSize(def.id);
        });
        sizesRow.appendChild(b);
      })(sizeDefs[i]);
    }
    card.appendChild(sizesRow);

    var statusMsg = el('div', 'nsl-status', '');
    card.appendChild(statusMsg);

    var actions = el('div', 'nsl-actions');
    var printBtn = el('button', 'btn btn-primary', t('اطبع', 'Print'));
    printBtn.type = 'button';
    printBtn.addEventListener('click', function () {
      if (!printLabels()) {
        statusMsg.textContent = t('قائمة الطباعة فارغة.', 'Print queue is empty.');
      } else {
        statusMsg.textContent = t('تم إرسال الملصقات للطباعة.', 'Sent labels to print.');
      }
    });

    var clearBtn = el('button', 'btn btn-secondary', t('مسح القائمة', 'Clear Queue'));
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', function () {
      clearQueue();
      statusMsg.textContent = t('تم مسح القائمة.', 'Queue cleared.');
    });

    actions.appendChild(printBtn);
    actions.appendChild(clearBtn);
    card.appendChild(actions);

    card.appendChild(el('h4', '', t('قائمة الطباعة', 'Print Queue')));
    var queueWrap = el('div', '');
    queueWrap.id = 'nslQueueWrap';
    card.appendChild(queueWrap);

    function selectProduct(prod) {
      selectedKey = keyOf(prod);
      selectedTitle.textContent = prod.name + ' — ' + formatPrice(readPrice(prod));
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
      var j;
      for (j = 0; j < hits.length; j++) {
        (function (p) {
          var rBtn = el('button', 'nsl-result-btn', p.name);
          rBtn.type = 'button';
          rBtn.addEventListener('click', function () {
            selectProduct(p);
          });
          resultsBox.appendChild(rBtn);
        })(hits[j]);
      }
      resultsBox.style.display = 'block';
    });

    addBtn.addEventListener('click', function () {
      if (!selectedKey) {
        statusMsg.textContent = t('اختر صنفًا أولًا.', 'Select an item first.');
        return;
      }
      var added = addItem(selectedKey, copiesInput.value);
      if (!added) {
        statusMsg.textContent = t('عدد النسخ يجب أن يكون بين ١ و ٥٠.', 'Copies must be between 1 and 50.');
        toast(statusMsg.textContent, 'error');
        return;
      }
      statusMsg.textContent = t('تمت الإضافة لقائمة الطباعة.', 'Added to print queue.');
      toast(statusMsg.textContent, 'success');
    });

    return card;
  }

  function isProductsPage() {
    if (document.body && document.body.dataset && document.body.dataset.activePage === 'products') {
      return true;
    }
    return !!document.querySelector('.nova-tab.active[data-page="products"]');
  }

  function ensureMounted() {
    var pageView = document.getElementById('novaPageView');
    if (!pageView || pageView.hidden || !isProductsPage()) return;
    if (document.getElementById(CARD_ID)) return;
    pageView.appendChild(buildCard());
    refreshUI();
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