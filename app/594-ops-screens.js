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
      return !!window.novaPerms.require('accounts.manage');
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
    return !!document.querySelector('.nova-tab.active[data-page="reports"],.nova-hostmark.active[data-page="reports"]');
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
      return !!window.novaPerms.require('purchases.manage');
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
    return !!document.querySelector('.nova-tab.active[data-page="reports"],.nova-hostmark.active[data-page="reports"]');
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
    return !!document.querySelector('.nova-tab.active[data-page="products"],.nova-hostmark.active[data-page="products"]');
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
;
// app/600-expiry-clearance.js
(function () {
  'use strict';

  var STORAGE_KEY = 'nova-rx-expiry-plans-v1';
  var LANG_KEY = 'nova-rx-language';
  var CARD_ID = 'novaExpiryClearance';
  var STYLE_ID = 'novaExpiryClearanceStyle';
  var DIALOG_ID = 'necConfirmDialog';
  var MAX_RECORDS = 500;
  var DAY_MS = 86400000;
  var observer = null;
  var currentDays = 90;

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

  function parsePercent(val) {
    var s = normalizeDigits(val).replace(/^\s+|\s+$/g, '');
    if (!s || !/^\d+$/.test(s)) return NaN;
    return parseInt(s, 10);
  }

  function canDiscount() {
    if (!window.novaPerms || typeof window.novaPerms.require !== 'function') {
      return false;
    }
    try {
      return !!window.novaPerms.require('prices.edit');
    } catch (e) {
      return false;
    }
  }

  function canDiscountHint() {
    if (!window.novaPerms) return false;
    if (typeof window.novaPerms.can === 'function') {
      try {
        return !!window.novaPerms.can('prices.edit');
      } catch (e) {
        return false;
      }
    }
    return typeof window.novaPerms.require === 'function';
  }

  function currentUserName() {
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

  function readPlans() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function writePlans(list) {
    try {
      var arr = Array.isArray(list) ? list : [];
      if (arr.length > MAX_RECORDS) {
        arr = arr.slice(arr.length - MAX_RECORDS);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
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

  function parseExpiryDayMs(expiryStr) {
    if (!expiryStr) return NaN;
    var s = normalizeDigits(expiryStr).replace(/^\s+|\s+$/g, '');
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m) {
      var y = parseInt(m[1], 10);
      var mo = parseInt(m[2], 10);
      var day = parseInt(m[3], 10);
      var dt = new Date(Date.UTC(y, mo - 1, day));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== day) {
        return NaN;
      }
      return dt.getTime();
    }
    var mYm = /^(\d{4})-(\d{1,2})$/.exec(s);
    if (mYm) {
      var yy = parseInt(mYm[1], 10);
      var mm = parseInt(mYm[2], 10);
      if (mm < 1 || mm > 12) return NaN;
      return Date.UTC(yy, mm - 1, 1);
    }
    var ts = Date.parse(s);
    if (isNaN(ts)) return NaN;
    var d = new Date(ts);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  function computeDaysLeft(expiryStr, nowMs) {
    var expMs = parseExpiryDayMs(expiryStr);
    if (isNaN(expMs)) return null;
    var ref = typeof nowMs === 'number' && !isNaN(nowMs) ? nowMs : Date.now();
    var d = new Date(ref);
    var todayMs = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((expMs - todayMs) / DAY_MS);
  }

  function planFor(itemKey, lotKey) {
    var ik = String(itemKey || '');
    var lk = String(lotKey || '');
    if (!ik || !lk) return null;
    var list = readPlans();
    var i;
    for (i = list.length - 1; i >= 0; i--) {
      if (list[i] && list[i].itemKey === ik && list[i].lotKey === lk) {
        return list[i];
      }
    }
    return null;
  }

  function plans() {
    return readPlans();
  }

  function findLotExpiry(itemKey, lotKey) {
    if (!window.novaStock || typeof window.novaStock.lots !== 'function') return '';
    var lots = window.novaStock.lots(itemKey) || [];
    var i, l, lk;
    for (i = 0; i < lots.length; i++) {
      l = lots[i];
      if (!l) continue;
      lk = String(l.lot || l.id || '');
      if (lk === lotKey) return String(l.expiry || '');
    }
    return '';
  }

  function nearExpiry(days, nowMs) {
    var win = (days === undefined || days === null || days === '') ? 90 : Number(days);
    if (isNaN(win) || win < 0) win = 90;
    if (!window.novaStock || typeof window.novaStock.lots !== 'function') return [];

    var prods = getProducts();
    var seen = {};
    var out = [];
    var i, j, p, ik, lots, l, onHand, dl, lk, cost, price, costVal, pl;

    for (i = 0; i < prods.length; i++) {
      p = prods[i];
      ik = keyOf(p);
      if (!ik || seen[ik]) continue;
      seen[ik] = true;
      if (typeof window.novaStock.hasLots === 'function' && !window.novaStock.hasLots(ik)) {
        continue;
      }
      lots = window.novaStock.lots(ik) || [];
      for (j = 0; j < lots.length; j++) {
        l = lots[j];
        if (!l) continue;
        onHand = Number(l.onHand !== undefined ? l.onHand : l.qty) || 0;
        if (onHand <= 0) continue;
        dl = computeDaysLeft(l.expiry, nowMs);
        if (dl === null || dl > win) continue;
        lk = String(l.lot || l.id || '');
        cost = Number(l.cost !== undefined && l.cost !== null && l.cost !== '' ? l.cost : p.cost);
        if (isNaN(cost) || cost < 0) cost = 0;
        price = Number(p.price);
        if (isNaN(price) || price < 0) price = 0;
        costVal = Math.round(onHand * cost * 100) / 100;
        pl = planFor(ik, lk);
        out.push({
          itemKey: ik,
          lotKey: lk,
          name: p.name || ik,
          lot: lk,
          expiry: String(l.expiry || ''),
          onHand: onHand,
          cost: cost,
          price: price,
          costValue: costVal,
          daysLeft: dl,
          planPercent: pl ? pl.percent : 0,
          plan: pl
        });
      }
    }

    out.sort(function (a, b) {
      return a.daysLeft - b.daysLeft;
    });
    return out;
  }

  function suggest(lot) {
    var l = lot || {};
    var dl = typeof l.daysLeft === 'number' ? l.daysLeft : computeDaysLeft(l.expiry);
    if (dl === null || isNaN(dl)) {
      return { percent: 0, capped: false, expired: false, hint: '' };
    }
    if (dl <= 0) {
      return {
        percent: 0,
        capped: false,
        expired: true,
        hint: t('محضر إعدام', 'Destruction record')
      };
    }
    var pct = 0;
    if (dl <= 30) {
      pct = 30;
    } else if (dl <= 60) {
      pct = 20;
    } else if (dl <= 90) {
      pct = 10;
    }

    var capped = false;
    var cost = Number(l.cost);
    var price = Number(l.price);
    if (!isNaN(cost) && cost > 0 && !isNaN(price) && price > 0 && pct > 0) {
      if (price * (100 - pct) + 1e-9 < cost * 100) {
        var maxPct = Math.floor(((price - cost) * 100) / price + 1e-9);
        if (maxPct < 0) maxPct = 0;
        while (maxPct > 0 && price * (100 - maxPct) + 1e-9 < cost * 100) {
          maxPct--;
        }
        pct = maxPct;
        capped = true;
      }
    }

    return {
      percent: pct,
      capped: capped,
      expired: false,
      hint: ''
    };
  }

  function setPlan(opts) {
    if (!canDiscount()) return false;
    var o = opts || {};
    var ik = String(o.itemKey || '').replace(/^\s+|\s+$/g, '');
    var lk = String(o.lotKey || '').replace(/^\s+|\s+$/g, '');
    if (!ik || !lk) return false;

    var pct = parsePercent(o.percent);
    if (isNaN(pct) || pct < 1 || pct > 90) return false;

    var rawUntil = o.until !== undefined && o.until !== null ? normalizeDigits(o.until).replace(/^\s+|\s+$/g, '') : '';
    var until = rawUntil || findLotExpiry(ik, lk);
    if (rawUntil && isNaN(parseExpiryDayMs(rawUntil))) return false;

    var by = o.by !== undefined && o.by !== null ? String(o.by) : currentUserName();

    var list = readPlans();
    var next = [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && !(list[i].itemKey === ik && list[i].lotKey === lk)) {
        next.push(list[i]);
      }
    }
    var rec = {
      itemKey: ik,
      lotKey: lk,
      percent: pct,
      until: until,
      by: by,
      at: new Date().toISOString()
    };
    next.push(rec);
    writePlans(next);
    refreshView();
    return rec;
  }

  function clear(itemKey, lotKey) {
    if (!canDiscount()) return false;
    var ik = String(itemKey || '');
    var lk = String(lotKey || '');
    if (!ik || !lk) return false;
    var list = readPlans();
    var next = [];
    var removed = false;
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].itemKey === ik && list[i].lotKey === lk) {
        removed = true;
      } else if (list[i]) {
        next.push(list[i]);
      }
    }
    if (removed) {
      writePlans(next);
      refreshView();
    }
    return removed;
  }

  window.novaExpiryClearance = {
    nearExpiry: nearExpiry,
    suggest: suggest,
    setPlan: setPlan,
    plans: plans,
    planFor: planFor,
    clear: clear
  };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function formatMoney(n) {
    var v = Number(n) || 0;
    return v.toFixed(2);
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '#novaExpiryClearance{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;margin-top:16px;color:#e6edf3;box-sizing:border-box;width:100%;max-width:100%;min-width:0;overflow:hidden;}',
      '#novaExpiryClearance *{box-sizing:border-box;}',
      '#novaExpiryClearance h3{margin:0 0 12px 0;font-size:1.1rem;color:#e6edf3;border-bottom:1px solid #343b44;padding-bottom:8px;}',
      '.nec-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;}',
      '.nec-days{display:flex;flex-wrap:wrap;gap:6px;}',
      '.nec-days button,.nec-toolbar button,.nec-save-btn,.nec-dialog-actions button{min-height:44px;}',
      '.nec-days button.nec-active{border-color:#79c9eb;color:#79c9eb;}',
      '.nec-summary{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;padding:10px 12px;background:#0d1117;border:1px solid #343b44;border-radius:8px;margin-bottom:12px;}',
      '.nec-summary-val{font-size:1.05rem;font-weight:700;color:#79c9eb;}',
      '.nec-advisory{font-size:0.85rem;color:#9fb0c2;margin-bottom:10px;}',
      '.nec-table-wrap{width:100%;max-width:100%;overflow-x:auto;border:1px solid #343b44;border-radius:8px;}',
      '.nec-table{width:100%;border-collapse:collapse;font-size:0.9rem;min-width:320px;}',
      '.nec-table th,.nec-table td{padding:8px 10px;border-bottom:1px solid #343b44;text-align:inherit;white-space:nowrap;}',
      '.nec-table th{background:#1b2129;color:#79c9eb;font-weight:600;}',
      '.nec-table tr:last-child td{border-bottom:0;}',
      '.nec-row-expired{background:rgba(220,53,69,0.18);}',
      '.nec-row-soon{background:rgba(245,158,11,0.18);}',
      '.nec-hint-expired{color:#ff7b89;font-weight:600;}',
      '.nec-pct-wrap{display:flex;gap:6px;align-items:center;}',
      '.nec-pct-input{width:76px;min-height:44px;padding:6px 8px;background:#0d1117;border:1px solid #343b44;border-radius:8px;color:#e6edf3;font-size:0.95rem;}',
      '.nec-pct-input:focus{outline:none;border-color:#79c9eb;}',
      '.nec-print-only{display:none;}',
      '.nec-empty{padding:12px;color:#9fb0c2;font-size:0.9rem;}',
      '.nec-status{font-size:0.85rem;color:#79c9eb;min-height:20px;margin-top:8px;}',
      '.nec-dialog-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;padding:16px;z-index:9999;}',
      '.nec-dialog{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;max-width:360px;width:100%;color:#e6edf3;}',
      '.nec-dialog p{margin:0 0 14px 0;line-height:1.5;}',
      '.nec-dialog-actions{display:flex;gap:8px;justify-content:flex-end;}',
      '@media print{body *{visibility:hidden !important;}#novaExpiryClearance,#novaExpiryClearance *{visibility:visible !important;}#novaExpiryClearance{position:absolute;left:0;top:0;width:100%;border:0;background:#fff;color:#000;overflow:visible;}#novaExpiryClearance h3{color:#000;border-bottom:1px solid #999;}#novaExpiryClearance .nec-summary{background:#fff;color:#000;border:1px solid #999;}#novaExpiryClearance .nec-summary-val{color:#000;}#novaExpiryClearance .nec-table-wrap{overflow:visible;border:1px solid #999;}#novaExpiryClearance .nec-table th{background:#eee;color:#000;border-bottom:1px solid #999;}#novaExpiryClearance .nec-table td{color:#000;border-bottom:1px solid #ccc;}#novaExpiryClearance .nec-hint-expired{color:#b00020;}#novaExpiryClearance .nec-no-print{display:none !important;}#novaExpiryClearance .nec-print-only{display:inline !important;}}'
    ].join('');
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function showConfirmDialog(message, onConfirm) {
    var existing = document.getElementById(DIALOG_ID);
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }

    var backdrop = el('div', 'nec-dialog-backdrop');
    backdrop.id = DIALOG_ID;
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    var box = el('div', 'nec-dialog');
    box.appendChild(el('p', '', message));

    var actions = el('div', 'nec-dialog-actions');
    var cancelBtn = el('button', 'btn btn-secondary', t('إلغاء', 'Cancel'));
    cancelBtn.type = 'button';
    var okBtn = el('button', 'btn btn-primary', t('تأكيد', 'Confirm'));
    okBtn.type = 'button';

    function close() {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    cancelBtn.addEventListener('click', close);
    okBtn.addEventListener('click', function () {
      close();
      if (onConfirm) onConfirm();
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    box.appendChild(actions);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
  }

  function refreshView() {
    var tableHost = document.getElementById('necTableHost');
    var lossVal = document.getElementById('necLossValue');
    var statusEl = document.getElementById('necStatusMsg');
    if (!tableHost || !lossVal) return;

    while (tableHost.firstChild) tableHost.removeChild(tableHost.firstChild);

    var rows = nearExpiry(currentDays);
    var totalLoss = 0;
    var i;
    for (i = 0; i < rows.length; i++) {
      totalLoss += rows[i].costValue;
    }
    lossVal.textContent = formatMoney(totalLoss) + ' ' + t('ج.م', 'EGP');

    if (!rows.length) {
      tableHost.appendChild(el('div', 'nec-empty', t('لا توجد تشغيلات قريبة الانتهاء في هذه الفترة.', 'No near-expiry lots in this window.')));
      return;
    }

    var editable = canDiscountHint();
    var wrap = el('div', 'nec-table-wrap');
    var table = el('table', 'nec-table');
    var thead = document.createElement('thead');
    var trHead = document.createElement('tr');
    var headers = [
      t('الصنف', 'Item'),
      t('التشغيلة', 'Lot'),
      t('الصلاحية', 'Expiry'),
      t('الرصيد', 'On Hand'),
      t('قيمة التكلفة', 'Cost Value'),
      t('الأيام المتبقية', 'Days Left'),
      t('خطة الخصم', 'Discount Plan')
    ];
    for (i = 0; i < headers.length; i++) {
      trHead.appendChild(el('th', '', headers[i]));
    }
    thead.appendChild(trHead);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (i = 0; i < rows.length; i++) {
      (function (row) {
        var tr = document.createElement('tr');
        if (row.daysLeft <= 0) {
          tr.className = 'nec-row-expired';
        } else if (row.daysLeft <= 30) {
          tr.className = 'nec-row-soon';
        }

        tr.appendChild(el('td', '', row.name));
        tr.appendChild(el('td', '', row.lot));
        tr.appendChild(el('td', '', row.expiry));
        tr.appendChild(el('td', '', String(row.onHand)));
        tr.appendChild(el('td', '', formatMoney(row.costValue)));
        tr.appendChild(el('td', '', String(row.daysLeft)));

        var planTd = document.createElement('td');
        if (row.daysLeft <= 0) {
          planTd.appendChild(el('span', 'nec-hint-expired', t('محضر إعدام', 'Destruction record')));
        } else {
          var box = el('div', 'nec-pct-wrap nec-no-print');
          var inp = el('input', 'nec-pct-input');
          inp.type = 'text';
          inp.setAttribute('inputmode', 'numeric');
          inp.setAttribute('aria-label', t('نسبة الخصم', 'Discount percent'));
          inp.placeholder = '%';
          inp.value = row.planPercent ? String(row.planPercent) : '';
          if (!editable) inp.disabled = true;

          var saveBtn = el('button', 'btn btn-primary nec-save-btn', t('احفظ الخطة', 'Save Plan'));
          saveBtn.type = 'button';
          if (!editable) saveBtn.disabled = true;

          saveBtn.addEventListener('click', function () {
            var res = setPlan({
              itemKey: row.itemKey,
              lotKey: row.lotKey,
              percent: inp.value,
              until: row.expiry
            });
            if (!res) {
              var errMsg = t('تعذر الحفظ: النسبة من ١ إلى ٩٠ أو لا توجد صلاحية.', 'Save failed: percent must be 1-90 or permission denied.');
              if (statusEl) statusEl.textContent = errMsg;
              toast(errMsg, 'error');
            } else {
              var okMsg = t('تم حفظ خطة الخصم.', 'Discount plan saved.');
              if (statusEl) statusEl.textContent = okMsg;
              toast(okMsg, 'success');
            }
          });

          box.appendChild(inp);
          box.appendChild(saveBtn);
          planTd.appendChild(box);
          planTd.appendChild(el('span', 'nec-print-only', row.planPercent ? (String(row.planPercent) + '%') : '-'));
        }
        tr.appendChild(planTd);
        tbody.appendChild(tr);
      })(rows[i]);
    }

    table.appendChild(tbody);
    wrap.appendChild(table);
    tableHost.appendChild(wrap);
  }

  function buildCard() {
    injectStyles();
    var editable = canDiscountHint();
    var card = el('section', 'nova-card');
    card.id = CARD_ID;
    card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    card.appendChild(el('h3', '', t('بيع الأصناف قريبة الانتهاء بخصم مخطط', 'Near-Expiry Clearance Plans')));
    card.appendChild(el('div', 'nec-advisory', t('خطة استرشادية فقط ولا تغيّر سعر البيع تلقائيًا.', 'Advisory plan only; does not change sale prices automatically.')));

    var toolbar = el('div', 'nec-toolbar nec-no-print');
    var daysWrap = el('div', 'nec-days');
    var options = [30, 60, 90, 180];
    var dayBtns = [];
    var i;

    function updateDayButtons() {
      var k;
      for (k = 0; k < dayBtns.length; k++) {
        if (dayBtns[k].val === currentDays) {
          dayBtns[k].btn.className = 'btn btn-secondary nec-active';
        } else {
          dayBtns[k].btn.className = 'btn btn-secondary';
        }
      }
    }

    for (i = 0; i < options.length; i++) {
      (function (dVal) {
        var b = el('button', 'btn btn-secondary', String(dVal) + ' ' + t('يوم', 'd'));
        b.type = 'button';
        b.addEventListener('click', function () {
          currentDays = dVal;
          updateDayButtons();
          refreshView();
        });
        daysWrap.appendChild(b);
        dayBtns.push({ val: dVal, btn: b });
      })(options[i]);
    }
    updateDayButtons();
    toolbar.appendChild(daysWrap);

    var suggestAllBtn = el('button', 'btn btn-primary', t('اقترح كل الخصومات', 'Suggest All Discounts'));
    suggestAllBtn.type = 'button';
    if (!editable) suggestAllBtn.disabled = true;
    suggestAllBtn.addEventListener('click', function () {
      var statusEl = document.getElementById('necStatusMsg');
      if (!canDiscount()) {
        var denyMsg = t('تعذر التطبيق: تحقق من الصلاحية.', 'Failed to apply: check permission.');
        if (statusEl) statusEl.textContent = denyMsg;
        toast(denyMsg, 'error');
        return;
      }
      var rows = nearExpiry(currentDays);
      var targets = [];
      var idx, r, s;
      for (idx = 0; idx < rows.length; idx++) {
        r = rows[idx];
        if (r.daysLeft <= 0 || r.plan) continue;
        s = suggest(r);
        if (s.percent >= 1) {
          targets.push({ row: r, sug: s });
        }
      }
      if (!targets.length) {
        var noMsg = t('لا توجد تشغيلات جديدة لاقتراح خصم لها.', 'No unplanned eligible lots to suggest.');
        if (statusEl) statusEl.textContent = noMsg;
        return;
      }
      showConfirmDialog(
        t('هل تريد تطبيق الخصم المقترح على التشغيلات التي ليس لها خطة؟', 'Apply suggested discounts to all unplanned eligible lots?'),
        function () {
          var k, applied = 0;
          for (k = 0; k < targets.length; k++) {
            if (setPlan({
              itemKey: targets[k].row.itemKey,
              lotKey: targets[k].row.lotKey,
              percent: targets[k].sug.percent,
              until: targets[k].row.expiry
            })) {
              applied++;
            }
          }
          var msg = applied > 0
            ? t('تم تطبيق الخصومات المقترحة.', 'Suggested discounts applied.')
            : t('تعذر التطبيق: تحقق من الصلاحية.', 'Failed to apply: check permission.');
          if (statusEl) statusEl.textContent = msg;
          toast(msg, applied > 0 ? 'success' : 'error');
        }
      );
    });
    toolbar.appendChild(suggestAllBtn);

    var printBtn = el('button', 'btn btn-secondary', t('طباعة قايمة التصفية', 'Print Clearance List'));
    printBtn.type = 'button';
    printBtn.addEventListener('click', function () {
      if (typeof window.print === 'function') {
        window.print();
      }
    });
    toolbar.appendChild(printBtn);
    card.appendChild(toolbar);

    var summary = el('div', 'nec-summary');
    summary.appendChild(el('span', '', t('قيمة المعرّض للخسارة', 'At-Risk Cost Value')));
    var lossVal = el('span', 'nec-summary-val', '0.00');
    lossVal.id = 'necLossValue';
    summary.appendChild(lossVal);
    card.appendChild(summary);

    var tableHost = el('div', '');
    tableHost.id = 'necTableHost';
    card.appendChild(tableHost);

    var statusMsg = el('div', 'nec-status', editable ? '' : t('وضع العرض فقط.', 'Read-only mode.'));
    statusMsg.id = 'necStatusMsg';
    card.appendChild(statusMsg);

    return card;
  }

  function isReportsPage() {
    if (document.body && document.body.dataset && document.body.dataset.activePage === 'reports') {
      return true;
    }
    return !!document.querySelector('.nova-tab.active[data-page="reports"],.nova-hostmark.active[data-page="reports"]');
  }

  function ensureMounted() {
    var pageView = document.getElementById('novaPageView');
    if (!pageView || pageView.hidden || !isReportsPage()) return;
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
// app/602-doctor-rx.js
(function () {
  'use strict';

  var STORAGE_KEY = 'nova-rx-doctor-rx-v1';
  var LANG_KEY = 'nova-rx-language';
  var CARD_ID = 'novaDoctorRx';
  var STYLE_ID = 'novaDoctorRxStyle';
  var MAX_RECORDS = 2000;
  var observer = null;
  var selectedDays = 30;

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

  function parsePositiveInt(val) {
    var s = trimStr(normalizeDigits(val));
    if (!s || !/^\d+$/.test(s)) return NaN;
    var n = parseInt(s, 10);
    return n >= 1 ? n : NaN;
  }

  function normalizePhone(val) {
    var raw = trimStr(normalizeDigits(val));
    if (!raw) return '';
    var digits = raw.replace(/[\s\-()]+/g, '');
    if (digits.indexOf('+20') === 0) {
      digits = '0' + digits.slice(3);
    } else if (digits.indexOf('0020') === 0) {
      digits = '0' + digits.slice(4);
    } else if (digits.indexOf('20') === 0 && digits.length === 12) {
      digits = '0' + digits.slice(2);
    }
    if (!/^01[0125]\d{8}$/.test(digits)) return null;
    return digits;
  }

  function toMs(val) {
    if (val === null || val === undefined || val === '') return NaN;
    if (typeof val === 'number') return isFinite(val) ? val : NaN;
    if (val instanceof Date) return val.getTime();
    var parsed = Date.parse(String(val));
    return isNaN(parsed) ? NaN : parsed;
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

  function makeId() {
    return 'drx-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
  }

  function normKey(str) {
    return trimStr(str).toLowerCase().replace(/\s+/g, ' ');
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

  function searchProducts(q) {
    if (window.novaSearch && typeof window.novaSearch.search === 'function') {
      try {
        return window.novaSearch.search(q, 10) || [];
      } catch (e) {}
    } else if (typeof window.novaSearch === 'function') {
      try {
        return window.novaSearch(q, 10) || [];
      } catch (e) {}
    }
    var query = normKey(q);
    var list = getProducts();
    var out = [];
    var i, p;
    for (i = 0; i < list.length && out.length < 10; i++) {
      p = list[i];
      if (!query || (p.name && normKey(p.name).indexOf(query) !== -1) || (p.barcode && String(p.barcode).indexOf(query) !== -1)) {
        out.push(p);
      }
    }
    return out;
  }

  function activeRecords(fromMs, untilMs) {
    var all = readStore();
    var out = [];
    var f = toMs(fromMs);
    var to = toMs(untilMs);
    var i, rec, ms;
    for (i = 0; i < all.length; i++) {
      rec = all[i];
      if (!rec || rec.removedAt) continue;
      ms = toMs(rec.at);
      if (!isNaN(f) && (isNaN(ms) || ms < f)) continue;
      if (!isNaN(to) && (isNaN(ms) || ms > to)) continue;
      out.push(rec);
    }
    return out;
  }

  function addRx(opts) {
    var o = opts || {};
    var doctor = trimStr(o.doctor);
    if (!doctor) return false;

    var rawItems = Array.isArray(o.items) ? o.items : [];
    if (rawItems.length < 1 || rawItems.length > 20) return false;

    var items = [];
    var i, row, name, qty;
    for (i = 0; i < rawItems.length; i++) {
      row = rawItems[i];
      if (!row || typeof row !== 'object') return false;
      name = trimStr(row.name);
      qty = parsePositiveInt(row.qty);
      if (!name || isNaN(qty)) return false;
      items.push({ name: name, qty: qty });
    }

    var phone = normalizePhone(o.customerPhone);
    if (phone === null) return false;

    var atMs = o.at !== undefined && o.at !== null && o.at !== '' ? toMs(o.at) : Date.now();
    if (isNaN(atMs)) return false;

    var rec = {
      id: makeId(),
      doctor: doctor,
      clinic: trimStr(o.clinic),
      items: items,
      customerPhone: phone,
      note: trimStr(o.note),
      at: new Date(atMs).toISOString(),
      createdBy: currentUser()
    };

    var store = readStore();
    store.push(rec);
    if (!writeStore(store)) return false;
    refreshCard();
    return rec;
  }

  function removeRx(id, reason) {
    var rid = trimStr(id);
    var why = trimStr(reason);
    if (!rid || !why) return false;

    var store = readStore();
    var i, found = false;
    for (i = 0; i < store.length; i++) {
      if (store[i] && store[i].id === rid && !store[i].removedAt) {
        store[i].removedAt = new Date().toISOString();
        store[i].removedBy = currentUser();
        store[i].reason = why;
        found = true;
        break;
      }
    }
    if (!found) return false;
    if (!writeStore(store)) return false;
    refreshCard();
    return true;
  }

  function listRx(filter) {
    var f = filter && typeof filter === 'object' ? filter : {};
    var all = readStore();
    var out = [];
    var from = toMs(f.fromMs);
    var to = toMs(f.toMs);
    var docFilter = f.doctor ? normKey(f.doctor) : '';
    var i, rec, ms;
    for (i = 0; i < all.length; i++) {
      rec = all[i];
      if (!rec) continue;
      if (!f.includeRemoved && rec.removedAt) continue;
      ms = toMs(rec.at);
      if (!isNaN(from) && (isNaN(ms) || ms < from)) continue;
      if (!isNaN(to) && (isNaN(ms) || ms > to)) continue;
      if (docFilter && normKey(rec.doctor).indexOf(docFilter) === -1) continue;
      out.push(rec);
    }
    out.sort(function (a, b) {
      return (toMs(b.at) || 0) - (toMs(a.at) || 0);
    });
    return out;
  }

  function doctorsSummary() {
    var recs = activeRecords();
    var map = {};
    var i, rec, k, ms;
    for (i = 0; i < recs.length; i++) {
      rec = recs[i];
      k = normKey(rec.doctor);
      ms = toMs(rec.at) || 0;
      if (!map[k]) {
        map[k] = { doctor: rec.doctor, count: 0, lastAt: rec.at, lastMs: ms };
      }
      map[k].count += 1;
      if (ms >= map[k].lastMs) {
        map[k].lastMs = ms;
        map[k].lastAt = rec.at;
        map[k].doctor = rec.doctor;
      }
    }
    var keys = Object.keys(map);
    var out = [];
    for (i = 0; i < keys.length; i++) {
      out.push({
        doctor: map[keys[i]].doctor,
        count: map[keys[i]].count,
        lastAt: map[keys[i]].lastAt
      });
    }
    out.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return (toMs(b.lastAt) || 0) - (toMs(a.lastAt) || 0);
    });
    return out;
  }

  function topItemsSummary(fromMs, untilMs, limit) {
    var recs = activeRecords(fromMs, untilMs);
    var map = {};
    var i, j, items, it, k;
    for (i = 0; i < recs.length; i++) {
      items = Array.isArray(recs[i].items) ? recs[i].items : [];
      for (j = 0; j < items.length; j++) {
        it = items[j];
        if (!it || !it.name) continue;
        k = normKey(it.name);
        if (!map[k]) {
          map[k] = { name: it.name, qty: 0, count: 0 };
        }
        map[k].qty += Number(it.qty) || 0;
        map[k].count += 1;
      }
    }
    var keys = Object.keys(map);
    var out = [];
    for (i = 0; i < keys.length; i++) {
      out.push(map[keys[i]]);
    }
    out.sort(function (a, b) {
      if (b.qty !== a.qty) return b.qty - a.qty;
      return b.count - a.count;
    });
    if (typeof limit === 'number' && limit > 0) {
      return out.slice(0, limit);
    }
    return out;
  }

  function byDoctorSummary(doctor, fromMs, untilMs) {
    var target = normKey(doctor);
    if (!target) return [];
    var recs = activeRecords(fromMs, untilMs);
    var out = [];
    var i;
    for (i = 0; i < recs.length; i++) {
      if (normKey(recs[i].doctor) === target) {
        out.push(recs[i]);
      }
    }
    out.sort(function (a, b) {
      return (toMs(b.at) || 0) - (toMs(a.at) || 0);
    });
    return out;
  }

  function missingItemsSummary(fromMs, untilMs) {
    var top = topItemsSummary(fromMs, untilMs);
    var out = [];
    var i, j, item, hits, hasInStock;
    for (i = 0; i < top.length; i++) {
      item = top[i];
      hits = searchProducts(item.name);
      if (!hits || !hits.length) {
        out.push({
          name: item.name,
          qty: item.qty,
          count: item.count,
          reason: 'not_found'
        });
      } else {
        hasInStock = false;
        for (j = 0; j < hits.length; j++) {
          if (getOnHand(keyOf(hits[j])) > 0) {
            hasInStock = true;
            break;
          }
        }
        if (!hasInStock) {
          out.push({
            name: item.name,
            qty: item.qty,
            count: item.count,
            reason: 'out_of_stock'
          });
        }
      }
    }
    return out;
  }

  window.novaDoctorRx = {
    add: addRx,
    remove: removeRx,
    list: listRx,
    doctors: doctorsSummary,
    topItems: topItemsSummary,
    byDoctor: byDoctorSummary,
    missingItems: missingItemsSummary
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
      '#novaDoctorRx{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;}',
      '#novaDoctorRx *{box-sizing:border-box;}',
      '#novaDoctorRx h3,#novaDoctorRx h4{margin:0 0 12px 0;color:#e6edf3;}',
      '#novaDoctorRx h3{font-size:1.1rem;border-bottom:1px solid #343b44;padding-bottom:8px;}',
      '#novaDoctorRx h4{font-size:0.95rem;margin-top:16px;color:#79c9eb;}',
      '.ndr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px;}',
      '.ndr-field label{display:block;font-size:0.85rem;margin-bottom:4px;color:#9fb0c2;}',
      '.ndr-input{width:100%;min-height:44px;padding:8px 12px;background:#0d1117;border:1px solid #343b44;border-radius:8px;color:#e6edf3;font-size:0.95rem;}',
      '.ndr-input:focus{outline:none;border-color:#79c9eb;}',
      '.ndr-items-box{display:flex;flex-direction:column;gap:8px;margin-bottom:10px;}',
      '.ndr-item-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}',
      '.ndr-item-name{flex:1 1 160px;min-width:0;}',
      '.ndr-item-qty{flex:0 0 84px;}',
      '.ndr-item-del{flex:0 0 44px;min-height:44px;padding:0;}',
      '.ndr-actions{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0;align-items:center;}',
      '.ndr-actions button,.ndr-head-row button,.ndr-period button{min-height:44px;}',
      '.ndr-status{font-size:0.85rem;color:#79c9eb;min-height:20px;margin-top:6px;}',
      '.ndr-period{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 8px 0;align-items:center;}',
      '.ndr-head-row{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-top:16px;margin-bottom:8px;}',
      '.ndr-head-row h4{margin:0;}',
      '.ndr-table-wrap{width:100%;overflow-x:auto;border:1px solid #343b44;border-radius:8px;}',
      '.ndr-table{width:100%;border-collapse:collapse;font-size:0.9rem;min-width:280px;}',
      '.ndr-table th,.ndr-table td{padding:8px 10px;border-bottom:1px solid #343b44;text-align:inherit;white-space:nowrap;}',
      '.ndr-table th{background:#1b2129;color:#79c9eb;font-weight:600;}',
      '.ndr-table tr:last-child td{border-bottom:0;}',
      '.ndr-empty{padding:12px;color:#9fb0c2;font-size:0.9rem;}'
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

  function formatDateShort(iso) {
    var ms = toMs(iso);
    if (isNaN(ms)) return '—';
    var d = new Date(ms);
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
  }

  function buildTable(headers, rows, emptyMsg) {
    var wrap = el('div', 'ndr-table-wrap');
    if (!rows.length) {
      wrap.appendChild(el('div', 'ndr-empty', emptyMsg));
      return wrap;
    }
    var table = el('table', 'ndr-table');
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

  function refreshDatalist() {
    var dl = document.getElementById('ndrDoctorsList');
    if (!dl) return;
    while (dl.firstChild) dl.removeChild(dl.firstChild);
    var docs = doctorsSummary();
    var i, opt;
    for (i = 0; i < docs.length; i++) {
      opt = document.createElement('option');
      opt.value = docs[i].doctor;
      dl.appendChild(opt);
    }
  }

  function refreshCard() {
    var docsBox = document.getElementById('ndrDoctorsWrap');
    var topBox = document.getElementById('ndrTopItemsWrap');
    var missBox = document.getElementById('ndrMissingWrap');
    if (!docsBox || !topBox || !missBox) return;

    refreshDatalist();

    while (docsBox.firstChild) docsBox.removeChild(docsBox.firstChild);
    while (topBox.firstChild) topBox.removeChild(topBox.firstChild);
    while (missBox.firstChild) missBox.removeChild(missBox.firstChild);

    var to = Date.now();
    var from = to - selectedDays * 86400000;

    var docs = doctorsSummary();
    var docRows = [];
    var i, d, it;
    for (i = 0; i < docs.length; i++) {
      d = docs[i];
      docRows.push([d.doctor, d.count, formatDateShort(d.lastAt)]);
    }
    docsBox.appendChild(buildTable(
      [t('الطبيب', 'Doctor'), t('عدد الروشتات', 'Prescriptions'), t('آخر تاريخ', 'Last Date')],
      docRows,
      t('لا توجد روشتات مسجلة.', 'No prescriptions recorded.')
    ));

    var top = topItemsSummary(from, to, 20);
    var topRows = [];
    for (i = 0; i < top.length; i++) {
      it = top[i];
      topRows.push([it.name, it.qty, it.count]);
    }
    topBox.appendChild(buildTable(
      [t('الصنف', 'Item'), t('الكمية', 'Qty'), t('التكرار', 'Count')],
      topRows,
      t('لا توجد أصناف في هذه الفترة.', 'No items in this period.')
    ));

    var missing = missingItemsSummary(from, to);
    var missRows = [];
    for (i = 0; i < missing.length; i++) {
      it = missing[i];
      missRows.push([
        it.name,
        it.qty,
        it.reason === 'out_of_stock' ? t('رصيده صفر', 'Out of stock') : t('غير مسجل', 'Not in catalog')
      ]);
    }
    missBox.appendChild(buildTable(
      [t('الصنف', 'Item'), t('الكمية المطلوبة', 'Requested Qty'), t('الحالة', 'Status')],
      missRows,
      t('كل الأصناف المكتوبة متوفرة حاليًا.', 'All prescribed items are in stock.')
    ));
  }

  function buildCard() {
    injectStyles();
    var card = el('section', 'nova-card');
    card.id = CARD_ID;
    card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    card.appendChild(el('h3', '', t('روشتات الأطباء', 'Doctor Prescriptions')));

    var dl = document.createElement('datalist');
    dl.id = 'ndrDoctorsList';
    card.appendChild(dl);

    var formGrid = el('div', 'ndr-grid');
    function makeField(labelText, id, placeholder, listId) {
      var wrap = el('div', 'ndr-field');
      var lbl = el('label', '', labelText);
      lbl.setAttribute('for', id);
      var inp = el('input', 'ndr-input');
      inp.id = id;
      inp.type = 'text';
      if (placeholder) inp.placeholder = placeholder;
      if (listId) inp.setAttribute('list', listId);
      wrap.appendChild(lbl);
      wrap.appendChild(inp);
      formGrid.appendChild(wrap);
      return inp;
    }

    var doctorInput = makeField(t('اسم الطبيب', 'Doctor Name'), 'ndrDoctorInput', t('د. أحمد...', 'Dr. Ahmed...'), 'ndrDoctorsList');
    var clinicInput = makeField(t('العيادة (اختياري)', 'Clinic (optional)'), 'ndrClinicInput', t('اسم العيادة', 'Clinic name'));
    var phoneInput = makeField(t('هاتف العميل (اختياري)', 'Customer Phone (optional)'), 'ndrPhoneInput', t('٠١٠١٢٣٤٥٦٧٨', '01xxxxxxxxx'));
    phoneInput.setAttribute('inputmode', 'tel');
    var noteInput = makeField(t('ملاحظة (اختياري)', 'Note (optional)'), 'ndrNoteInput', t('ملاحظات', 'Notes'));
    card.appendChild(formGrid);

    var itemsBox = el('div', 'ndr-items-box');
    itemsBox.id = 'ndrItemsBox';
    card.appendChild(itemsBox);

    function addItemRow() {
      if (itemsBox.children.length >= 20) return;
      var row = el('div', 'ndr-item-row');
      var nameInp = el('input', 'ndr-input ndr-item-name');
      nameInp.type = 'text';
      nameInp.placeholder = t('اسم الصنف', 'Item name');

      var qtyInp = el('input', 'ndr-input ndr-item-qty');
      qtyInp.type = 'text';
      qtyInp.setAttribute('inputmode', 'numeric');
      qtyInp.value = '1';
      qtyInp.placeholder = t('الكمية', 'Qty');

      var delBtn = el('button', 'btn btn-secondary ndr-item-del', '−');
      delBtn.type = 'button';
      delBtn.setAttribute('aria-label', t('حذف الصنف', 'Remove item'));
      delBtn.addEventListener('click', function () {
        if (itemsBox.children.length > 1) {
          itemsBox.removeChild(row);
        }
      });

      row.appendChild(nameInp);
      row.appendChild(qtyInp);
      row.appendChild(delBtn);
      itemsBox.appendChild(row);
    }

    addItemRow();

    var actions = el('div', 'ndr-actions');
    var addRowBtn = el('button', 'btn btn-secondary', t('+ إضافة صنف', '+ Add Item'));
    addRowBtn.type = 'button';
    addRowBtn.addEventListener('click', addItemRow);

    var saveBtn = el('button', 'btn btn-primary', t('حفظ الروشتة', 'Save Prescription'));
    saveBtn.type = 'button';

    actions.appendChild(addRowBtn);
    actions.appendChild(saveBtn);
    card.appendChild(actions);

    var statusMsg = el('div', 'ndr-status', '');
    card.appendChild(statusMsg);

    saveBtn.addEventListener('click', function () {
      var rows = itemsBox.querySelectorAll('.ndr-item-row');
      var items = [];
      var i, nInp, qInp;
      for (i = 0; i < rows.length; i++) {
        nInp = rows[i].querySelector('.ndr-item-name');
        qInp = rows[i].querySelector('.ndr-item-qty');
        items.push({ name: nInp ? nInp.value : '', qty: qInp ? qInp.value : '' });
      }
      var res = addRx({
        doctor: doctorInput.value,
        clinic: clinicInput.value,
        customerPhone: phoneInput.value,
        note: noteInput.value,
        items: items
      });
      if (!res) {
        var err = t('تعذر الحفظ: تأكد من اسم الطبيب والأصناف والهاتف.', 'Save failed: check doctor, items, and phone.');
        statusMsg.textContent = err;
        toast(err, 'error');
        return;
      }
      doctorInput.value = '';
      clinicInput.value = '';
      phoneInput.value = '';
      noteInput.value = '';
      while (itemsBox.firstChild) itemsBox.removeChild(itemsBox.firstChild);
      addItemRow();
      var ok = t('تم تسجيل الروشتة بنجاح.', 'Prescription saved.');
      statusMsg.textContent = ok;
      toast(ok, 'success');
    });

    var periodWrap = el('div', 'ndr-period');
    var periods = [7, 30, 90];
    var periodBtns = [];
    function updatePeriodBtns() {
      var j;
      for (j = 0; j < periodBtns.length; j++) {
        periodBtns[j].btn.className = periodBtns[j].days === selectedDays ? 'btn btn-primary' : 'btn btn-secondary';
      }
    }
    for (var pIdx = 0; pIdx < periods.length; pIdx++) {
      (function (days) {
        var b = el('button', days === selectedDays ? 'btn btn-primary' : 'btn btn-secondary', t('آخر ' + days + ' يوم', 'Last ' + days + ' days'));
        b.type = 'button';
        b.addEventListener('click', function () {
          selectedDays = days;
          updatePeriodBtns();
          refreshCard();
        });
        periodBtns.push({ days: days, btn: b });
        periodWrap.appendChild(b);
      })(periods[pIdx]);
    }
    card.appendChild(periodWrap);

    card.appendChild(el('h4', '', t('أكتر الدكاترة', 'Top Doctors')));
    var docsWrap = el('div', '');
    docsWrap.id = 'ndrDoctorsWrap';
    card.appendChild(docsWrap);

    card.appendChild(el('h4', '', t('أكتر الأصناف المكتوبة', 'Most Prescribed Items')));
    var topWrap = el('div', '');
    topWrap.id = 'ndrTopItemsWrap';
    card.appendChild(topWrap);

    var missHead = el('div', 'ndr-head-row');
    missHead.appendChild(el('h4', '', t('ناقص عندنا — اللي بيكتبه الدكاترة وإحنا ما عندناش', 'Missing Stock — Prescribed by Doctors')));
    var copyBtn = el('button', 'btn btn-secondary', t('انسخ القايمة', 'Copy List'));
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', function () {
      var to = Date.now();
      var from = to - selectedDays * 86400000;
      var list = missingItemsSummary(from, to);
      if (!list.length) {
        statusMsg.textContent = t('لا توجد نواقص للنسخ.', 'No missing items to copy.');
        return;
      }
      var lines = [];
      var i;
      for (i = 0; i < list.length; i++) {
        lines.push(list[i].name + ' — ' + list[i].qty);
      }
      copyText(lines.join('\n'), function (ok) {
        var msg = ok ? t('تم نسخ القائمة.', 'List copied.') : t('تعذر النسخ.', 'Copy failed.');
        statusMsg.textContent = msg;
        toast(msg, ok ? 'success' : 'error');
      });
    });
    missHead.appendChild(copyBtn);
    card.appendChild(missHead);

    var missWrap = el('div', '');
    missWrap.id = 'ndrMissingWrap';
    card.appendChild(missWrap);

    return card;
  }

  function isReportsPage() {
    if (document.body && document.body.dataset && document.body.dataset.activePage === 'reports') {
      return true;
    }
    return !!document.querySelector('.nova-tab.active[data-page="reports"],.nova-hostmark.active[data-page="reports"]');
  }

  function ensureMounted() {
    var pageView = document.getElementById('novaPageView');
    if (!pageView || pageView.hidden || !isReportsPage()) return;
    if (document.getElementById(CARD_ID)) return;
    pageView.appendChild(buildCard());
    refreshCard();
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
// app/604-pharmacy-swaps.js
// TASK #114: Borrowing and swapping items with neighbouring pharmacies.
//
// Balance formula (in integer piasters, per pharmacy):
//   positive (+) = they owe us
//   negative (-) = we owe them
//   balance = sum(record 'out' valuePiasters)
//           - sum(record 'in'  valuePiasters)
//           - sum(settle 'received' amountPiasters)
//           + sum(settle 'paid'     amountPiasters)
//           + sum(reverse deltaPiasters)
// where each 'reverse' entry has deltaPiasters = -deltaOf(targetEntry).
//
// Append-only ledger stored at localStorage['nova-rx-pharmacy-swaps-v1']:
// entries are never edited, deleted, or trimmed. Mistakes are corrected by
// appending a 'reverse' entry with a required non-empty reason.
(function () {
  'use strict';

  var STORAGE_KEY = 'nova-rx-pharmacy-swaps-v1';
  var LANG_KEY = 'nova-rx-language';
  var CARD_ID = 'novaPharmacySwaps';
  var STYLE_ID = 'novaPharmacySwapsStyle';
  var observer = null;
  var selectedDirection = 'in';
  var activeStatementPharmacy = '';
  var idCounter = 0;

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
      } catch (e) {}
    }
  }

  function currentUser() {
    try {
      if (window.novaAuth && typeof window.novaAuth.current === 'function') {
        var u = window.novaAuth.current();
        return u && u.name ? String(u.name) : '';
      }
    } catch (e) {}
    return '';
  }

  function canWrite() {
    if (!window.novaPerms || typeof window.novaPerms.require !== 'function') {
      return false;
    }
    try {
      return !!window.novaPerms.require('purchases.manage');
    } catch (e) {
      return false;
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

  function parsePositiveInt(val) {
    if (typeof val === 'number') {
      if (!isFinite(val) || Math.floor(val) !== val || val < 1) return NaN;
      return val;
    }
    var s = normalizeDigits(trimStr(val));
    if (!/^\d+$/.test(s)) return NaN;
    var n = parseInt(s, 10);
    return n >= 1 ? n : NaN;
  }

  function parseNonNegInt(val) {
    if (typeof val === 'number') {
      if (!isFinite(val) || Math.floor(val) !== val || val < 0) return NaN;
      return val;
    }
    var s = normalizeDigits(trimStr(val));
    if (!/^\d+$/.test(s)) return NaN;
    var n = parseInt(s, 10);
    return n >= 0 ? n : NaN;
  }

  function parseEgpToPiasters(val) {
    var s = normalizeDigits(trimStr(val)).replace(/\u066b|,/g, '.');
    if (!s) return NaN;
    var m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
    if (!m) return NaN;
    var whole = parseInt(m[1], 10);
    var frac = 0;
    if (m[2]) {
      frac = m[2].length === 1 ? parseInt(m[2], 10) * 10 : parseInt(m[2], 10);
    }
    return whole * 100 + frac;
  }

  function formatPiasters(p) {
    var n = Number(p) || 0;
    var sign = n < 0 ? '-' : '';
    var abs = Math.abs(Math.round(n));
    var whole = Math.floor(abs / 100);
    var frac = abs % 100;
    var fracStr = frac < 10 ? '0' + String(frac) : String(frac);
    return sign + String(whole) + '.' + fracStr + ' ' + t('ج.م', 'EGP');
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var y = d.getFullYear();
    var mo = d.getMonth() + 1;
    var da = d.getDate();
    var h = d.getHours();
    var mi = d.getMinutes();
    function pad(x) { return x < 10 ? '0' + String(x) : String(x); }
    return String(y) + '-' + pad(mo) + '-' + pad(da) + ' ' + pad(h) + ':' + pad(mi);
  }

  function nextId(prefix) {
    idCounter += 1;
    return (prefix || 'sw') + '-' + String(Date.now()) + '-' + String(idCounter);
  }

  function readLedger() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function appendEntry(entry) {
    var list = readLedger();
    list.push(entry);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  function entryDelta(e) {
    if (!e || typeof e !== 'object') return 0;
    if (e.type === 'record') {
      var v = Number(e.valuePiasters) || 0;
      if (e.direction === 'out') return v;
      if (e.direction === 'in') return -v;
      return 0;
    }
    if (e.type === 'settle') {
      var a = Number(e.amountPiasters) || 0;
      if (e.direction === 'received') return -a;
      if (e.direction === 'paid') return a;
      return 0;
    }
    if (e.type === 'reverse') {
      return Number(e.deltaPiasters) || 0;
    }
    return 0;
  }

  function resolvePharmacyKey(ledger, ref) {
    var key = trimStr(ref);
    if (!key) return '';
    var i, e;
    for (i = 0; i < ledger.length; i++) {
      e = ledger[i];
      if (e && e.type === 'pharmacy') {
        if (e.pharmacyId === key || e.id === key || e.name === key) {
          return e.name;
        }
      }
    }
    return key;
  }

  function getPharmacyMap(ledger) {
    var map = {};
    var order = [];
    var i, e, name;

    function ensure(n, info) {
      if (!n) return;
      if (!map[n]) {
        map[n] = {
          id: info && info.pharmacyId ? info.pharmacyId : n,
          name: n,
          phone: info && info.phone ? info.phone : '',
          note: info && info.note ? info.note : '',
          balance: 0
        };
        order.push(n);
      } else if (info) {
        if (!map[n].phone && info.phone) map[n].phone = info.phone;
        if (!map[n].note && info.note) map[n].note = info.note;
      }
    }

    for (i = 0; i < ledger.length; i++) {
      e = ledger[i];
      if (!e || typeof e !== 'object') continue;
      if (e.type === 'pharmacy') {
        name = trimStr(e.name);
        if (name) ensure(name, e);
      } else if (e.type === 'record' || e.type === 'settle' || e.type === 'reverse') {
        name = resolvePharmacyKey(ledger, e.pharmacy);
        if (name) {
          ensure(name, null);
          map[name].balance += entryDelta(e);
        }
      }
    }

    return { map: map, order: order };
  }

  function addPharmacy(opts) {
    if (!canWrite()) return false;
    var o = opts || {};
    var name = trimStr(o.name).slice(0, 80);
    if (!name) return false;
    var phone = trimStr(o.phone).slice(0, 30);
    var note = trimStr(o.note).slice(0, 160);

    var ledger = readLedger();
    var i, e;
    for (i = 0; i < ledger.length; i++) {
      e = ledger[i];
      if (e && e.type === 'pharmacy' && trimStr(e.name) === name) {
        return false;
      }
    }

    var entry = {
      id: nextId('ph'),
      at: new Date().toISOString(),
      by: currentUser(),
      type: 'pharmacy',
      pharmacyId: nextId('phid'),
      name: name,
      phone: phone,
      note: note
    };
    if (!appendEntry(entry)) return false;
    refreshUI();
    return {
      id: entry.pharmacyId,
      name: entry.name,
      phone: entry.phone,
      note: entry.note,
      balance: 0
    };
  }

  function pharmacies() {
    var ledger = readLedger();
    var info = getPharmacyMap(ledger);
    var out = [];
    var i, p;
    for (i = 0; i < info.order.length; i++) {
      p = info.map[info.order[i]];
      out.push({
        id: p.id,
        name: p.name,
        phone: p.phone,
        note: p.note,
        balance: p.balance
      });
    }
    return out;
  }

  function record(opts) {
    if (!canWrite()) return false;
    var o = opts || {};
    var ledger = readLedger();
    var pharm = resolvePharmacyKey(ledger, o.pharmacy);
    if (!pharm) return false;
    if (o.direction !== 'in' && o.direction !== 'out') return false;
    var item = trimStr(o.item).slice(0, 120);
    if (!item) return false;
    var qty = parsePositiveInt(o.qty);
    if (isNaN(qty)) return false;
    var valuePiasters = parseNonNegInt(o.valuePiasters);
    if (isNaN(valuePiasters)) return false;
    var note = trimStr(o.note).slice(0, 200);

    var entry = {
      id: nextId('rec'),
      at: new Date().toISOString(),
      by: currentUser(),
      type: 'record',
      pharmacy: pharm,
      direction: o.direction,
      item: item,
      qty: qty,
      valuePiasters: valuePiasters,
      note: note
    };
    if (!appendEntry(entry)) return false;
    refreshUI();
    return entry;
  }

  function settle(opts) {
    if (!canWrite()) return false;
    var o = opts || {};
    var ledger = readLedger();
    var pharm = resolvePharmacyKey(ledger, o.pharmacy);
    if (!pharm) return false;
    if (o.direction !== 'paid' && o.direction !== 'received') return false;
    var amountPiasters = parsePositiveInt(o.amountPiasters);
    if (isNaN(amountPiasters)) return false;
    var note = trimStr(o.note).slice(0, 200);

    var entry = {
      id: nextId('set'),
      at: new Date().toISOString(),
      by: currentUser(),
      type: 'settle',
      pharmacy: pharm,
      direction: o.direction,
      amountPiasters: amountPiasters,
      note: note
    };
    if (!appendEntry(entry)) return false;
    refreshUI();
    return entry;
  }

  function reverse(idOrOpts, maybeReason) {
    if (!canWrite()) return false;
    var targetId = '';
    var reason = '';
    if (idOrOpts && typeof idOrOpts === 'object') {
      targetId = trimStr(idOrOpts.id || idOrOpts.targetId);
      reason = trimStr(idOrOpts.reason).slice(0, 200);
    } else {
      targetId = trimStr(idOrOpts);
      reason = trimStr(maybeReason).slice(0, 200);
    }
    if (!targetId || !reason) return false;

    var ledger = readLedger();
    var target = null;
    var i, e;
    for (i = 0; i < ledger.length; i++) {
      e = ledger[i];
      if (!e) continue;
      if (e.id === targetId && (e.type === 'record' || e.type === 'settle')) {
        target = e;
      }
      if (e.type === 'reverse' && e.targetId === targetId) {
        return false;
      }
    }
    if (!target) return false;

    var delta = -entryDelta(target);
    var entry = {
      id: nextId('rev'),
      at: new Date().toISOString(),
      by: currentUser(),
      type: 'reverse',
      targetId: target.id,
      originalType: target.type,
      pharmacy: resolvePharmacyKey(ledger, target.pharmacy),
      deltaPiasters: delta,
      reason: reason
    };
    if (!appendEntry(entry)) return false;
    refreshUI();
    return entry;
  }

  function balance(pharmacyRef) {
    var ledger = readLedger();
    var pharm = resolvePharmacyKey(ledger, pharmacyRef);
    if (!pharm) return 0;
    var sum = 0;
    var i, e;
    for (i = 0; i < ledger.length; i++) {
      e = ledger[i];
      if (!e || e.type === 'pharmacy') continue;
      if (resolvePharmacyKey(ledger, e.pharmacy) === pharm) {
        sum += entryDelta(e);
      }
    }
    return sum;
  }

  function statement(pharmacyRef) {
    var ledger = readLedger();
    var pharm = resolvePharmacyKey(ledger, pharmacyRef);
    if (!pharm) return [];

    var reversedMap = {};
    var i, e;
    for (i = 0; i < ledger.length; i++) {
      e = ledger[i];
      if (e && e.type === 'reverse' && e.targetId) {
        reversedMap[e.targetId] = true;
      }
    }

    var out = [];
    var running = 0;
    var d, copy, k;
    for (i = 0; i < ledger.length; i++) {
      e = ledger[i];
      if (!e || e.type === 'pharmacy') continue;
      if (resolvePharmacyKey(ledger, e.pharmacy) !== pharm) continue;
      d = entryDelta(e);
      running += d;
      copy = {};
      for (k in e) {
        if (Object.prototype.hasOwnProperty.call(e, k)) {
          copy[k] = e[k];
        }
      }
      copy.deltaPiasters = d;
      copy.runningBalance = running;
      copy.reversed = !!reversedMap[e.id];
      out.push(copy);
    }
    return out;
  }

  function totals() {
    var list = pharmacies();
    var theyOweUs = 0;
    var weOweThem = 0;
    var i, b;
    for (i = 0; i < list.length; i++) {
      b = list[i].balance;
      if (b > 0) {
        theyOweUs += b;
      } else if (b < 0) {
        weOweThem += Math.abs(b);
      }
    }
    return {
      theyOweUs: theyOweUs,
      weOweThem: weOweThem,
      net: theyOweUs - weOweThem
    };
  }

  window.novaPharmacySwaps = {
    addPharmacy: addPharmacy,
    pharmacies: pharmacies,
    record: record,
    settle: settle,
    reverse: reverse,
    balance: balance,
    statement: statement,
    totals: totals
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
      '#novaPharmacySwaps{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;}',
      '#novaPharmacySwaps *{box-sizing:border-box;}',
      '#novaPharmacySwaps h3,#novaPharmacySwaps h4{margin:0 0 12px 0;color:#e6edf3;}',
      '#novaPharmacySwaps h3{font-size:1.1rem;border-bottom:1px solid #343b44;padding-bottom:8px;}',
      '#novaPharmacySwaps h4{font-size:0.95rem;margin-top:16px;color:#79c9eb;}',
      '.nps-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px;margin-bottom:14px;}',
      '.nps-kpi{background:#0d1117;border:1px solid #343b44;border-radius:8px;padding:10px;}',
      '.nps-kpi-lbl{font-size:0.8rem;color:#9fb0c2;margin-bottom:4px;}',
      '.nps-kpi-val{font-size:1rem;font-weight:700;}',
      '.nps-pos{color:#4ade80;}',
      '.nps-neg{color:#f87171;}',
      '.nps-zero{color:#e6edf3;}',
      '.nps-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:10px 0;}',
      '.nps-field label{display:block;font-size:0.85rem;margin-bottom:4px;color:#9fb0c2;}',
      '.nps-input,.nps-select{width:100%;min-height:44px;padding:8px 12px;background:#0d1117;border:1px solid #343b44;border-radius:8px;color:#e6edf3;font-size:0.95rem;}',
      '.nps-input:focus,.nps-select:focus{outline:none;border-color:#79c9eb;}',
      '.nps-toggle-row{display:flex;gap:8px;flex-wrap:wrap;}',
      '.nps-toggle-btn{flex:1 1 110px;min-height:44px;padding:8px 12px;border-radius:8px;border:1px solid #343b44;background:#0d1117;color:#e6edf3;cursor:pointer;font-size:0.95rem;}',
      '.nps-toggle-btn.active{border-color:#79c9eb;background:#1c2b36;color:#79c9eb;font-weight:600;}',
      '.nps-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center;}',
      '#novaPharmacySwaps button{min-height:44px;}',
      '.nps-status{font-size:0.85rem;color:#79c9eb;min-height:20px;margin-top:6px;}',
      '.nps-list{display:flex;flex-direction:column;gap:8px;margin:10px 0;}',
      '.nps-row{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;padding:10px 12px;background:#0d1117;border:1px solid #343b44;border-radius:8px;}',
      '.nps-row-info{min-width:140px;flex:1 1 auto;}',
      '.nps-row-name{font-weight:600;font-size:0.95rem;}',
      '.nps-row-meta{font-size:0.8rem;color:#9fb0c2;margin-top:2px;}',
      '.nps-row-bal{font-weight:700;font-size:0.95rem;}',
      '.nps-row-btns{display:flex;flex-wrap:wrap;gap:6px;}',
      '.nps-table-wrap{width:100%;overflow-x:auto;border:1px solid #343b44;border-radius:8px;margin-top:8px;}',
      '.nps-table{width:100%;border-collapse:collapse;font-size:0.85rem;min-width:340px;}',
      '.nps-table th,.nps-table td{padding:8px 10px;border-bottom:1px solid #343b44;text-align:inherit;white-space:nowrap;}',
      '.nps-table th{background:#1b2129;color:#79c9eb;font-weight:600;}',
      '.nps-table tr:last-child td{border-bottom:0;}',
      '.nps-empty{padding:12px;color:#9fb0c2;font-size:0.9rem;}',
      '.nps-stmt-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-top:14px;}',
      '.nps-stmt-head h4{margin:0;}',
      '.nps-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:16px;z-index:9999;}',
      '.nps-modal{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;width:100%;max-width:420px;color:#e6edf3;max-height:90vh;overflow-y:auto;}',
      '.nps-modal h4{margin:0 0 10px 0;color:#79c9eb;}',
      '@media print{body *{visibility:hidden;}#npsStatementArea,#npsStatementArea *{visibility:visible;}#npsStatementArea{position:absolute;left:0;top:0;width:100%;background:#ffffff;color:#000000;}}'
    ].join('');
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function balClass(p) {
    if (p > 0) return 'nps-pos';
    if (p < 0) return 'nps-neg';
    return 'nps-zero';
  }

  function openSettleDialog(pharmacyName) {
    var card = document.getElementById(CARD_ID);
    if (!card) return;
    var existing = document.getElementById('npsModalBackdrop');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var curBal = balance(pharmacyName);
    var settleDir = curBal >= 0 ? 'received' : 'paid';

    var backdrop = el('div', 'nps-modal-backdrop');
    backdrop.id = 'npsModalBackdrop';
    var modal = el('div', 'nps-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    modal.appendChild(el('h4', '', t('تسوية حساب: ', 'Settle Account: ') + pharmacyName));
    var balLine = el('div', 'nps-row-meta', t('الرصيد الحالي: ', 'Current Balance: ') + formatPiasters(curBal));
    modal.appendChild(balLine);

    var dirWrap = el('div', 'nps-field');
    dirWrap.style.marginTop = '10px';
    dirWrap.appendChild(el('label', '', t('نوع التسوية', 'Settlement Type')));
    var toggleRow = el('div', 'nps-toggle-row');
    var btnRecv = el('button', 'nps-toggle-btn' + (settleDir === 'received' ? ' active' : ''), t('قبضنا منهم', 'Received'));
    btnRecv.type = 'button';
    var btnPaid = el('button', 'nps-toggle-btn' + (settleDir === 'paid' ? ' active' : ''), t('دفعنا لهم', 'Paid'));
    btnPaid.type = 'button';

    function syncDir() {
      btnRecv.className = 'nps-toggle-btn' + (settleDir === 'received' ? ' active' : '');
      btnPaid.className = 'nps-toggle-btn' + (settleDir === 'paid' ? ' active' : '');
    }
    btnRecv.addEventListener('click', function () { settleDir = 'received'; syncDir(); });
    btnPaid.addEventListener('click', function () { settleDir = 'paid'; syncDir(); });
    toggleRow.appendChild(btnRecv);
    toggleRow.appendChild(btnPaid);
    dirWrap.appendChild(toggleRow);
    modal.appendChild(dirWrap);

    var amtWrap = el('div', 'nps-field');
    amtWrap.style.marginTop = '10px';
    var amtLbl = el('label', '', t('المبلغ (ج.م)', 'Amount (EGP)'));
    amtLbl.setAttribute('for', 'npsSettleAmt');
    var amtInp = el('input', 'nps-input');
    amtInp.id = 'npsSettleAmt';
    amtInp.type = 'text';
    amtInp.setAttribute('inputmode', 'decimal');
    amtInp.placeholder = t('مثال: ٥٠٫٠٠', 'e.g. 50.00');
    amtWrap.appendChild(amtLbl);
    amtWrap.appendChild(amtInp);
    modal.appendChild(amtWrap);

    var noteWrap = el('div', 'nps-field');
    noteWrap.style.marginTop = '10px';
    var noteLbl = el('label', '', t('ملاحظة', 'Note'));
    noteLbl.setAttribute('for', 'npsSettleNote');
    var noteInp = el('input', 'nps-input');
    noteInp.id = 'npsSettleNote';
    noteInp.type = 'text';
    noteInp.maxLength = 200;
    noteWrap.appendChild(noteLbl);
    noteWrap.appendChild(noteInp);
    modal.appendChild(noteWrap);

    var errLine = el('div', 'nps-status', '');
    modal.appendChild(errLine);

    var actions = el('div', 'nps-actions');
    var saveBtn = el('button', 'btn btn-primary', t('تأكيد التسوية', 'Confirm Settlement'));
    saveBtn.type = 'button';
    var cancelBtn = el('button', 'btn btn-secondary', t('إلغاء', 'Cancel'));
    cancelBtn.type = 'button';

    function close() {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    cancelBtn.addEventListener('click', close);
    saveBtn.addEventListener('click', function () {
      var piasters = parseEgpToPiasters(amtInp.value);
      if (isNaN(piasters) || piasters <= 0) {
        errLine.textContent = t('أدخل مبلغًا صحيحًا أكبر من صفر.', 'Enter a valid amount greater than zero.');
        toast(errLine.textContent, 'error');
        return;
      }
      var res = settle({
        pharmacy: pharmacyName,
        amountPiasters: piasters,
        direction: settleDir,
        note: noteInp.value
      });
      if (!res) {
        errLine.textContent = t('تعذرت التسوية: تحقق من الصلاحية أو البيانات.', 'Settlement failed: check permission or values.');
        toast(errLine.textContent, 'error');
        return;
      }
      toast(t('تم تسجيل التسوية بنجاح.', 'Settlement recorded.'), 'success');
      close();
    });

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    card.appendChild(backdrop);
  }

  function openReverseDialog(entryId) {
    var card = document.getElementById(CARD_ID);
    if (!card) return;
    var existing = document.getElementById('npsModalBackdrop');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var backdrop = el('div', 'nps-modal-backdrop');
    backdrop.id = 'npsModalBackdrop';
    var modal = el('div', 'nps-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    modal.appendChild(el('h4', '', t('عكس القيد', 'Reverse Entry')));

    var reasonWrap = el('div', 'nps-field');
    var reasonLbl = el('label', '', t('سبب العكس (إلزامي)', 'Reversal Reason (required)'));
    reasonLbl.setAttribute('for', 'npsReverseReason');
    var reasonInp = el('input', 'nps-input');
    reasonInp.id = 'npsReverseReason';
    reasonInp.type = 'text';
    reasonInp.maxLength = 200;
    reasonInp.placeholder = t('مثال: خطأ في الكمية أو القيمة', 'e.g. Wrong quantity or value');
    reasonWrap.appendChild(reasonLbl);
    reasonWrap.appendChild(reasonInp);
    modal.appendChild(reasonWrap);

    var errLine = el('div', 'nps-status', '');
    modal.appendChild(errLine);

    var actions = el('div', 'nps-actions');
    var confirmBtn = el('button', 'btn btn-primary', t('تأكيد العكس', 'Confirm Reversal'));
    confirmBtn.type = 'button';
    var cancelBtn = el('button', 'btn btn-secondary', t('إلغاء', 'Cancel'));
    cancelBtn.type = 'button';

    function close() {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    cancelBtn.addEventListener('click', close);
    confirmBtn.addEventListener('click', function () {
      var res = reverse({ id: entryId, reason: reasonInp.value });
      if (!res) {
        errLine.textContent = t('أدخل سببًا واضحًا وتأكد من الصلاحية.', 'Enter a valid reason and check permission.');
        toast(errLine.textContent, 'error');
        return;
      }
      toast(t('تم تسجيل قيد عكسي.', 'Reversing entry recorded.'), 'success');
      close();
    });

    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    card.appendChild(backdrop);
  }

  function renderStatement(pharmacyName) {
    var box = document.getElementById('npsStatementArea');
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    if (!pharmacyName) return;

    var editable = canWrite();
    var head = el('div', 'nps-stmt-head');
    head.appendChild(el('h4', '', t('كشف الحساب: ', 'Statement: ') + pharmacyName));

    var headBtns = el('div', 'nps-row-btns');
    var printBtn = el('button', 'btn btn-secondary', t('طباعة', 'Print'));
    printBtn.type = 'button';
    printBtn.addEventListener('click', function () {
      if (typeof window.print === 'function') window.print();
    });
    var closeBtn = el('button', 'btn btn-secondary', t('إغلاق', 'Close'));
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', function () {
      activeStatementPharmacy = '';
      renderStatement('');
    });
    headBtns.appendChild(printBtn);
    headBtns.appendChild(closeBtn);
    head.appendChild(headBtns);
    box.appendChild(head);

    var rows = statement(pharmacyName);
    var wrap = el('div', 'nps-table-wrap');
    if (!rows.length) {
      wrap.appendChild(el('div', 'nps-empty', t('لا توجد حركات مسجلة لهذه الصيدلية.', 'No entries recorded for this pharmacy.')));
      box.appendChild(wrap);
      return;
    }

    var table = el('table', 'nps-table');
    var thead = document.createElement('thead');
    var trH = document.createElement('tr');
    var headers = [
      t('التاريخ', 'Date'),
      t('النوع', 'Type'),
      t('التفاصيل', 'Details'),
      t('القيمة', 'Amount'),
      t('الرصيد', 'Balance'),
      t('إجراء', 'Action')
    ];
    var i, r, tr, typeLabel, details, tdAmt, tdBal, tdAct, revBtn;
    for (i = 0; i < headers.length; i++) {
      trH.appendChild(el('th', '', headers[i]));
    }
    thead.appendChild(trH);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      tr = document.createElement('tr');
      tr.appendChild(el('td', '', formatDateTime(r.at)));

      if (r.type === 'record') {
        typeLabel = r.direction === 'out' ? t('سلّفنا', 'Lent Out') : t('استلفنا', 'Borrowed In');
        details = r.item + ' × ' + String(r.qty) + (r.note ? ' — ' + r.note : '');
      } else if (r.type === 'settle') {
        typeLabel = r.direction === 'received' ? t('تسوية (قبضنا)', 'Settle (Received)') : t('تسوية (دفعنا)', 'Settle (Paid)');
        details = r.note || '—';
      } else {
        typeLabel = t('قيد عكسي', 'Reversal');
        details = r.reason || '—';
      }

      tr.appendChild(el('td', '', typeLabel));
      tr.appendChild(el('td', '', details));

      tdAmt = el('td', balClass(r.deltaPiasters), formatPiasters(r.deltaPiasters));
      tr.appendChild(tdAmt);

      tdBal = el('td', balClass(r.runningBalance), formatPiasters(r.runningBalance));
      tr.appendChild(tdBal);

      tdAct = document.createElement('td');
      if ((r.type === 'record' || r.type === 'settle') && !r.reversed && editable) {
        (function (entryId) {
          revBtn = el('button', 'btn btn-secondary', t('عكس قيد', 'Reverse'));
          revBtn.type = 'button';
          revBtn.addEventListener('click', function () {
            openReverseDialog(entryId);
          });
          tdAct.appendChild(revBtn);
        })(r.id);
      } else if (r.reversed) {
        tdAct.textContent = t('تم عكسه', 'Reversed');
      } else {
        tdAct.textContent = '—';
      }
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    wrap.appendChild(table);
    box.appendChild(wrap);
  }

  function refreshUI() {
    var summaryBox = document.getElementById('npsSummary');
    var listBox = document.getElementById('npsPharmList');
    var selectEl = document.getElementById('npsRecordPharm');
    if (!summaryBox || !listBox || !selectEl) return;

    var tot = totals();
    while (summaryBox.firstChild) summaryBox.removeChild(summaryBox.firstChild);

    function addKpi(label, val, cls) {
      var k = el('div', 'nps-kpi');
      k.appendChild(el('div', 'nps-kpi-lbl', label));
      k.appendChild(el('div', 'nps-kpi-val ' + cls, formatPiasters(val)));
      summaryBox.appendChild(k);
    }

    addKpi(t('لنا عندهم', 'They Owe Us'), tot.theyOweUs, tot.theyOweUs > 0 ? 'nps-pos' : 'nps-zero');
    addKpi(t('علينا لهم', 'We Owe Them'), tot.weOweThem, tot.weOweThem > 0 ? 'nps-neg' : 'nps-zero');
    addKpi(t('الصافي', 'Net'), tot.net, balClass(tot.net));

    var list = pharmacies();
    var prevVal = selectEl.value;
    while (selectEl.firstChild) selectEl.removeChild(selectEl.firstChild);
    var defOpt = el('option', '', t('اختر صيدلية...', 'Select pharmacy...'));
    defOpt.value = '';
    selectEl.appendChild(defOpt);

    while (listBox.firstChild) listBox.removeChild(listBox.firstChild);
    var editable = canWrite();
    var i, p, opt, row, info, balEl, btns, settleBtn, stmtBtn;

    if (!list.length) {
      listBox.appendChild(el('div', 'nps-empty', t('لا توجد صيدليات مضافة بعد.', 'No pharmacies added yet.')));
    } else {
      for (i = 0; i < list.length; i++) {
        p = list[i];
        opt = el('option', '', p.name);
        opt.value = p.name;
        selectEl.appendChild(opt);

        row = el('div', 'nps-row');
        info = el('div', 'nps-row-info');
        info.appendChild(el('div', 'nps-row-name', p.name));
        if (p.phone || p.note) {
          info.appendChild(el('div', 'nps-row-meta', (p.phone || '') + (p.phone && p.note ? ' — ' : '') + (p.note || '')));
        }
        balEl = el('div', 'nps-row-bal ' + balClass(p.balance), formatPiasters(p.balance));
        info.appendChild(balEl);
        row.appendChild(info);

        btns = el('div', 'nps-row-btns');
        (function (pharmName) {
          settleBtn = el('button', 'btn btn-secondary', t('تسوية', 'Settle'));
          settleBtn.type = 'button';
          if (!editable) settleBtn.disabled = true;
          settleBtn.addEventListener('click', function () {
            openSettleDialog(pharmName);
          });

          stmtBtn = el('button', 'btn btn-secondary', t('كشف الحساب', 'Statement'));
          stmtBtn.type = 'button';
          stmtBtn.addEventListener('click', function () {
            activeStatementPharmacy = pharmName;
            renderStatement(pharmName);
          });
          btns.appendChild(settleBtn);
          btns.appendChild(stmtBtn);
        })(p.name);

        row.appendChild(btns);
        listBox.appendChild(row);
      }
    }

    if (prevVal) selectEl.value = prevVal;
    if (activeStatementPharmacy) {
      renderStatement(activeStatementPharmacy);
    }
  }

  function buildCard() {
    injectStyles();
    selectedDirection = 'in';
    activeStatementPharmacy = '';

    var editable = canWrite();
    var card = el('section', 'nova-card');
    card.id = CARD_ID;
    card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    card.appendChild(el('h3', '', t('الاستلاف والتبديل مع الصيدليات المجاورة', 'Neighbouring Pharmacy Swaps')));

    var summaryBox = el('div', 'nps-summary');
    summaryBox.id = 'npsSummary';
    card.appendChild(summaryBox);

    card.appendChild(el('h4', '', t('الصيدليات والأرصدة', 'Pharmacies & Balances')));
    var listBox = el('div', 'nps-list');
    listBox.id = 'npsPharmList';
    card.appendChild(listBox);

    var stmtArea = el('div', '');
    stmtArea.id = 'npsStatementArea';
    card.appendChild(stmtArea);

    card.appendChild(el('h4', '', t('إضافة صيدلية مجاورة', 'Add Neighbouring Pharmacy')));
    var addGrid = el('div', 'nps-grid');

    function makeField(parent, labelText, id, placeholder, maxLen) {
      var w = el('div', 'nps-field');
      var l = el('label', '', labelText);
      l.setAttribute('for', id);
      var inp = el('input', 'nps-input');
      inp.id = id;
      inp.type = 'text';
      if (placeholder) inp.placeholder = placeholder;
      if (maxLen) inp.maxLength = maxLen;
      if (!editable) inp.disabled = true;
      w.appendChild(l);
      w.appendChild(inp);
      parent.appendChild(w);
      return inp;
    }

    var phNameInp = makeField(addGrid, t('اسم الصيدلية', 'Pharmacy Name'), 'npsPharmName', t('صيدلية النور', 'Al-Nour Pharmacy'), 80);
    var phPhoneInp = makeField(addGrid, t('الهاتف', 'Phone'), 'npsPharmPhone', t('اختياري', 'Optional'), 30);
    var phNoteInp = makeField(addGrid, t('ملاحظة', 'Note'), 'npsPharmNote', t('اختياري', 'Optional'), 160);
    card.appendChild(addGrid);

    var addActions = el('div', 'nps-actions');
    var addPharmBtn = el('button', 'btn btn-secondary', t('إضافة صيدلية', 'Add Pharmacy'));
    addPharmBtn.type = 'button';
    if (!editable) addPharmBtn.disabled = true;
    addActions.appendChild(addPharmBtn);
    card.appendChild(addActions);

    card.appendChild(el('h4', '', t('تسجيل استلاف أو تسليف', 'Record Swap / Loan')));

    var recGrid = el('div', 'nps-grid');
    var selWrap = el('div', 'nps-field');
    var selLbl = el('label', '', t('الصيدلية', 'Pharmacy'));
    selLbl.setAttribute('for', 'npsRecordPharm');
    var selEl = el('select', 'nps-select');
    selEl.id = 'npsRecordPharm';
    if (!editable) selEl.disabled = true;
    selWrap.appendChild(selLbl);
    selWrap.appendChild(selEl);
    recGrid.appendChild(selWrap);

    var dirWrap = el('div', 'nps-field');
    dirWrap.appendChild(el('label', '', t('الاتجاه', 'Direction')));
    var dirRow = el('div', 'nps-toggle-row');
    var btnIn = el('button', 'nps-toggle-btn active', t('استلفنا', 'Borrowed In'));
    btnIn.type = 'button';
    btnIn.id = 'npsDirIn';
    var btnOut = el('button', 'nps-toggle-btn', t('سلّفنا', 'Lent Out'));
    btnOut.type = 'button';
    btnOut.id = 'npsDirOut';
    if (!editable) {
      btnIn.disabled = true;
      btnOut.disabled = true;
    }
    function syncRecDir() {
      btnIn.className = 'nps-toggle-btn' + (selectedDirection === 'in' ? ' active' : '');
      btnOut.className = 'nps-toggle-btn' + (selectedDirection === 'out' ? ' active' : '');
    }
    btnIn.addEventListener('click', function () { selectedDirection = 'in'; syncRecDir(); });
    btnOut.addEventListener('click', function () { selectedDirection = 'out'; syncRecDir(); });
    dirRow.appendChild(btnIn);
    dirRow.appendChild(btnOut);
    dirWrap.appendChild(dirRow);
    recGrid.appendChild(dirWrap);

    var itemInp = makeField(recGrid, t('الصنف', 'Item'), 'npsRecordItem', t('اسم الصنف', 'Item name'), 120);
    var qtyInp = makeField(recGrid, t('الكمية', 'Quantity'), 'npsRecordQty', '1', 10);
    qtyInp.setAttribute('inputmode', 'numeric');
    var valInp = makeField(recGrid, t('القيمة (ج.م)', 'Value (EGP)'), 'npsRecordVal', t('مثال: ١٢٫٥٠', 'e.g. 12.50'), 16);
    valInp.setAttribute('inputmode', 'decimal');
    var recNoteInp = makeField(recGrid, t('ملاحظة', 'Note'), 'npsRecordNote', t('اختياري', 'Optional'), 200);
    card.appendChild(recGrid);

    var recActions = el('div', 'nps-actions');
    var saveRecBtn = el('button', 'btn btn-primary', t('تسجيل الحركة', 'Record Entry'));
    saveRecBtn.type = 'button';
    saveRecBtn.id = 'npsSaveRecordBtn';
    if (!editable) saveRecBtn.disabled = true;
    recActions.appendChild(saveRecBtn);
    card.appendChild(recActions);

    var statusMsg = el('div', 'nps-status', editable ? '' : t('وضع العرض فقط.', 'Read-only mode.'));
    statusMsg.id = 'npsStatusMsg';
    card.appendChild(statusMsg);

    addPharmBtn.addEventListener('click', function () {
      var res = addPharmacy({
        name: phNameInp.value,
        phone: phPhoneInp.value,
        note: phNoteInp.value
      });
      if (!res) {
        statusMsg.textContent = t('تعذرت الإضافة: أدخل اسمًا جديدًا وتأكد من الصلاحية.', 'Add failed: enter a unique name and check permission.');
        toast(statusMsg.textContent, 'error');
        return;
      }
      phNameInp.value = '';
      phPhoneInp.value = '';
      phNoteInp.value = '';
      selEl.value = res.name;
      statusMsg.textContent = t('تمت إضافة الصيدلية بنجاح.', 'Pharmacy added.');
      toast(statusMsg.textContent, 'success');
    });

    saveRecBtn.addEventListener('click', function () {
      var piasters = parseEgpToPiasters(valInp.value);
      if (isNaN(piasters) || piasters < 0) {
        statusMsg.textContent = t('أدخل قيمة صحيحة بحد أقصى رقمين عشريين.', 'Enter a valid value with up to 2 decimals.');
        toast(statusMsg.textContent, 'error');
        return;
      }
      var res = record({
        pharmacy: selEl.value,
        direction: selectedDirection,
        item: itemInp.value,
        qty: qtyInp.value,
        valuePiasters: piasters,
        note: recNoteInp.value
      });
      if (!res) {
        statusMsg.textContent = t('تعذر التسجيل: تحقق من البيانات أو الصلاحية.', 'Record failed: check inputs or permission.');
        toast(statusMsg.textContent, 'error');
        return;
      }
      itemInp.value = '';
      qtyInp.value = '';
      valInp.value = '';
      recNoteInp.value = '';
      statusMsg.textContent = t('تم تسجيل الحركة بنجاح.', 'Entry recorded.');
      toast(statusMsg.textContent, 'success');
    });

    return card;
  }

  function isReportsPage() {
    if (document.body && document.body.dataset && document.body.dataset.activePage === 'reports') {
      return true;
    }
    return !!document.querySelector('.nova-tab.active[data-page="reports"],.nova-hostmark.active[data-page="reports"]');
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
// app/606-family-accounts.js
(function () {
  'use strict';

  var STORAGE_KEY = 'nova-rx-family-accounts-v1';
  var LANG_KEY = 'nova-rx-language';
  var CARD_ID = 'novaFamilyAccounts';
  var STYLE_ID = 'novaFamilyAccountsStyle';
  var MAX_RECORDS = 500;
  var MAX_MEMBERS = 12;
  var RELATIONS = ['head', 'spouse', 'child', 'parent', 'sibling', 'other'];

  var observer = null;
  var selectedFamilyId = '';
  var selectedMemberId = '';
  var pendingRemove = null;
  var searchQuery = '';

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

  function currentUser() {
    try {
      if (window.novaAuth && typeof window.novaAuth.current === 'function') {
        var u = window.novaAuth.current();
        if (u && u.name) return String(u.name);
      }
    } catch (e) {}
    return '';
  }

  function canRemoveMember() {
    if (!window.novaPerms || typeof window.novaPerms.require !== 'function') {
      return false;
    }
    try {
      return !!window.novaPerms.require('accounts.manage');
    } catch (e) {
      return false;
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

  function normalizePhone(val) {
    var digits = normalizeDigits(val).replace(/[\s\-()]/g, '');
    if (!/^01[0125]\d{8}$/.test(digits)) return '';
    return digits;
  }

  function parseBirthYear(val) {
    var s = trimStr(normalizeDigits(val));
    if (!s) return null;
    if (!/^\d{4}$/.test(s)) return NaN;
    var y = parseInt(s, 10);
    var cur = new Date().getFullYear();
    if (y < 1900 || y > cur) return NaN;
    return y;
  }

  function makeId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1000000).toString(36);
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
      var arr = Array.isArray(list) ? list : [];
      if (arr.length > MAX_RECORDS) {
        arr = arr.slice(arr.length - MAX_RECORDS);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
      return true;
    } catch (e) {
      return false;
    }
  }

  function isValidRelation(rel) {
    var i;
    for (i = 0; i < RELATIONS.length; i++) {
      if (RELATIONS[i] === rel) return true;
    }
    return false;
  }

  function relationLabel(rel) {
    var mapAr = {
      head: 'رب الأسرة',
      spouse: 'الزوج/الزوجة',
      child: 'ابن/ابنة',
      parent: 'أب/أم',
      sibling: 'أخ/أخت',
      other: 'آخر'
    };
    var mapEn = {
      head: 'Head',
      spouse: 'Spouse',
      child: 'Child',
      parent: 'Parent',
      sibling: 'Sibling',
      other: 'Other'
    };
    return isEn() ? (mapEn[rel] || rel) : (mapAr[rel] || rel);
  }

  function activeMembers(family) {
    var list = (family && Array.isArray(family.members)) ? family.members : [];
    var out = [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && !list[i].removedAt) out.push(list[i]);
    }
    return out;
  }

  function createFamily(opts) {
    var o = opts || {};
    var name = trimStr(o.name);
    var phone = normalizePhone(o.phone);
    var headName = trimStr(o.headName) || name;
    if (!name || !phone) return false;

    var list = readStore();
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].phone === phone) return false;
    }

    var now = new Date().toISOString();
    var user = currentUser();
    var fam = {
      id: makeId('fam'),
      name: name,
      phone: phone,
      createdAt: now,
      createdBy: user,
      members: [
        {
          id: makeId('mem'),
          name: headName,
          relation: 'head',
          birthYear: null,
          allergies: '',
          notes: [],
          addedAt: now,
          addedBy: user
        }
      ]
    };

    list.push(fam);
    writeStore(list);
    refreshUI();
    return fam;
  }

  function addMember(familyId, opts) {
    var o = opts || {};
    var name = trimStr(o.name);
    var relation = trimStr(o.relation || 'other');
    if (!familyId || !name || !isValidRelation(relation)) return false;

    var birthYear = parseBirthYear(o.birthYear);
    if (birthYear !== null && isNaN(birthYear)) return false;

    var allergies = trimStr(o.allergies);
    if (allergies.length > 200) allergies = allergies.slice(0, 200);

    var initNote = trimStr(o.note);
    if (initNote.length > 300) initNote = initNote.slice(0, 300);

    var list = readStore();
    var i, fam = null;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === familyId) {
        fam = list[i];
        break;
      }
    }
    if (!fam) return false;
    if (activeMembers(fam).length >= MAX_MEMBERS) return false;

    var now = new Date().toISOString();
    var user = currentUser();
    var notesArr = [];
    if (initNote) {
      notesArr.push({ at: now, by: user, text: initNote });
    }

    var member = {
      id: makeId('mem'),
      name: name,
      relation: relation,
      birthYear: birthYear,
      allergies: allergies,
      notes: notesArr,
      addedAt: now,
      addedBy: user
    };

    if (!Array.isArray(fam.members)) fam.members = [];
    fam.members.push(member);
    writeStore(list);
    refreshUI();
    return member;
  }

  function removeMember(familyId, memberId, reason) {
    if (!canRemoveMember()) return false;
    var cleanReason = trimStr(reason);
    if (!familyId || !memberId || !cleanReason) return false;

    var list = readStore();
    var i, j, fam = null, mem = null;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === familyId) {
        fam = list[i];
        break;
      }
    }
    if (!fam || !Array.isArray(fam.members)) return false;

    for (j = 0; j < fam.members.length; j++) {
      if (fam.members[j] && fam.members[j].id === memberId) {
        mem = fam.members[j];
        break;
      }
    }
    if (!mem || mem.removedAt) return false;
    if (mem.relation === 'head') return false;

    mem.removedAt = new Date().toISOString();
    mem.removedBy = currentUser();
    mem.removeReason = cleanReason;
    writeStore(list);
    refreshUI();
    return true;
  }

  function listFamilies(query) {
    var list = readStore();
    var q = trimStr(query);
    if (!q) return list;
    var qLower = q.toLowerCase();
    var qNorm = normalizeDigits(q).replace(/[\s\-()]/g, '');
    var out = [];
    var i, j, fam, matched;
    for (i = 0; i < list.length; i++) {
      fam = list[i];
      if (!fam) continue;
      matched = false;
      if (fam.name && fam.name.toLowerCase().indexOf(qLower) !== -1) matched = true;
      if (!matched && fam.phone && qNorm && fam.phone.indexOf(qNorm) !== -1) matched = true;
      if (!matched && Array.isArray(fam.members)) {
        for (j = 0; j < fam.members.length; j++) {
          if (fam.members[j] && !fam.members[j].removedAt && fam.members[j].name &&
              fam.members[j].name.toLowerCase().indexOf(qLower) !== -1) {
            matched = true;
            break;
          }
        }
      }
      if (matched) out.push(fam);
    }
    return out;
  }

  function getFamily(familyId) {
    if (!familyId) return null;
    var list = readStore();
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === familyId) return list[i];
    }
    return null;
  }

  function getNotes(familyId, memberId) {
    var fam = getFamily(familyId);
    if (!fam || !Array.isArray(fam.members)) return [];
    var i;
    for (i = 0; i < fam.members.length; i++) {
      if (fam.members[i] && fam.members[i].id === memberId) {
        return Array.isArray(fam.members[i].notes) ? fam.members[i].notes.slice() : [];
      }
    }
    return [];
  }

  function addNote(familyId, memberId, text) {
    var clean = trimStr(text);
    if (!familyId || !memberId || !clean) return false;
    if (clean.length > 300) clean = clean.slice(0, 300);

    var list = readStore();
    var i, j, fam = null, mem = null;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === familyId) {
        fam = list[i];
        break;
      }
    }
    if (!fam || !Array.isArray(fam.members)) return false;
    for (j = 0; j < fam.members.length; j++) {
      if (fam.members[j] && fam.members[j].id === memberId) {
        mem = fam.members[j];
        break;
      }
    }
    if (!mem || mem.removedAt) return false;

    if (!Array.isArray(mem.notes)) mem.notes = [];
    var entry = {
      at: new Date().toISOString(),
      by: currentUser(),
      text: clean
    };
    mem.notes.push(entry);
    writeStore(list);
    refreshUI();
    return entry;
  }

  function findByPhone(phone) {
    var norm = normalizePhone(phone);
    if (!norm) return null;
    var list = readStore();
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].phone === norm) return list[i];
    }
    return null;
  }

  window.novaFamilyAccounts = {
    createFamily: createFamily,
    addMember: addMember,
    removeMember: removeMember,
    list: listFamilies,
    get: getFamily,
    notes: getNotes,
    addNote: addNote,
    findByPhone: findByPhone
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
      '#novaFamilyAccounts{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;}',
      '#novaFamilyAccounts *{box-sizing:border-box;}',
      '#novaFamilyAccounts h3,#novaFamilyAccounts h4{margin:0 0 12px 0;color:#e6edf3;}',
      '#novaFamilyAccounts h3{font-size:1.1rem;border-bottom:1px solid #343b44;padding-bottom:8px;}',
      '#novaFamilyAccounts h4{font-size:0.95rem;margin-top:14px;color:#79c9eb;}',
      '.nfa-input,.nfa-select{width:100%;min-height:44px;padding:8px 12px;background:#0d1117;border:1px solid #343b44;border-radius:8px;color:#e6edf3;font-size:0.95rem;}',
      '.nfa-input:focus,.nfa-select:focus{outline:none;border-color:#79c9eb;}',
      '.nfa-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:10px 0;}',
      '.nfa-field label{display:block;font-size:0.85rem;margin-bottom:4px;color:#9fb0c2;}',
      '.nfa-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center;}',
      '.nfa-actions button,.nfa-row-btn{min-height:44px;}',
      '.nfa-list{display:flex;flex-direction:column;gap:6px;margin:10px 0;max-height:220px;overflow-y:auto;}',
      '.nfa-fam-btn{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;min-height:44px;padding:8px 12px;background:#0d1117;border:1px solid #343b44;border-radius:8px;color:#e6edf3;cursor:pointer;text-align:inherit;}',
      '.nfa-fam-btn.active{border-color:#79c9eb;background:#1b2430;}',
      '.nfa-fam-sub{font-size:0.82rem;color:#9fb0c2;}',
      '.nfa-panel{border-top:1px solid #343b44;margin-top:14px;padding-top:12px;}',
      '.nfa-table-wrap{width:100%;overflow-x:auto;border:1px solid #343b44;border-radius:8px;margin:10px 0;}',
      '.nfa-table{width:100%;border-collapse:collapse;font-size:0.9rem;min-width:300px;}',
      '.nfa-table th,.nfa-table td{padding:8px 10px;border-bottom:1px solid #343b44;text-align:inherit;vertical-align:middle;}',
      '.nfa-table th{background:#1b2129;color:#79c9eb;font-weight:600;white-space:nowrap;}',
      '.nfa-table tr:last-child td{border-bottom:0;}',
      '.nfa-allergy{display:inline-block;padding:2px 8px;border-radius:6px;background:rgba(245,158,11,0.18);border:1px solid #f59e0b;color:#fbbf24;font-size:0.82rem;}',
      '.nfa-cell-actions{display:flex;flex-wrap:wrap;gap:6px;}',
      '.nfa-notes-box{border:1px solid #343b44;border-radius:8px;padding:12px;background:#0d1117;margin-top:12px;}',
      '.nfa-note-item{padding:8px 0;border-bottom:1px solid #343b44;font-size:0.88rem;}',
      '.nfa-note-item:last-child{border-bottom:0;}',
      '.nfa-note-meta{font-size:0.78rem;color:#9fb0c2;margin-bottom:2px;}',
      '.nfa-dialog{border:1px solid #f59e0b;border-radius:8px;padding:12px;background:#1b2129;margin-top:12px;}',
      '.nfa-empty{padding:10px;color:#9fb0c2;font-size:0.9rem;}',
      '.nfa-status{font-size:0.85rem;color:#79c9eb;min-height:20px;margin-top:6px;}'
    ].join('');
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function makeField(parent, labelText, id, placeholder, maxLen) {
    var wrap = el('div', 'nfa-field');
    var lbl = el('label', '', labelText);
    lbl.setAttribute('for', id);
    var inp = el('input', 'nfa-input');
    inp.id = id;
    inp.type = 'text';
    if (placeholder) inp.placeholder = placeholder;
    if (maxLen) inp.maxLength = maxLen;
    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    parent.appendChild(wrap);
    return inp;
  }

  function refreshUI() {
    var listBox = document.getElementById('nfaFamilyList');
    var panelBox = document.getElementById('nfaSelectedPanel');
    if (!listBox || !panelBox) return;

    while (listBox.firstChild) listBox.removeChild(listBox.firstChild);
    var fams = listFamilies(searchQuery);
    if (!fams.length) {
      listBox.appendChild(el('div', 'nfa-empty', t('لا توجد حسابات عائلية مطابقة.', 'No matching family accounts.')));
    } else {
      var i;
      for (i = 0; i < fams.length; i++) {
        (function (fam) {
          var btn = el('button', 'nfa-fam-btn' + (fam.id === selectedFamilyId ? ' active' : ''));
          btn.type = 'button';
          var left = el('span', '', fam.name);
          var right = el('span', 'nfa-fam-sub', fam.phone + ' (' + activeMembers(fam).length + ')');
          btn.appendChild(left);
          btn.appendChild(right);
          btn.addEventListener('click', function () {
            selectedFamilyId = fam.id;
            selectedMemberId = '';
            pendingRemove = null;
            refreshUI();
          });
          listBox.appendChild(btn);
        })(fams[i]);
      }
    }

    renderSelectedPanel(panelBox);
  }

  function renderSelectedPanel(panelBox) {
    while (panelBox.firstChild) panelBox.removeChild(panelBox.firstChild);
    if (!selectedFamilyId) return;
    var fam = getFamily(selectedFamilyId);
    if (!fam) {
      selectedFamilyId = '';
      return;
    }

    panelBox.appendChild(el('h4', '', fam.name + ' — ' + fam.phone));

    var members = activeMembers(fam);
    var curYear = new Date().getFullYear();

    var wrap = el('div', 'nfa-table-wrap');
    var table = el('table', 'nfa-table');
    var thead = document.createElement('thead');
    var trH = document.createElement('tr');
    var headers = [
      t('الاسم', 'Name'),
      t('الصفة', 'Relation'),
      t('العمر', 'Age'),
      t('الحساسية', 'Allergies'),
      t('إجراءات', 'Actions')
    ];
    var i;
    for (i = 0; i < headers.length; i++) {
      trH.appendChild(el('th', '', headers[i]));
    }
    thead.appendChild(trH);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (i = 0; i < members.length; i++) {
      (function (m) {
        var tr = document.createElement('tr');
        tr.appendChild(el('td', '', m.name));
        tr.appendChild(el('td', '', relationLabel(m.relation)));
        var ageText = m.birthYear ? String(curYear - m.birthYear) : '—';
        tr.appendChild(el('td', '', ageText));

        var tdAllergy = document.createElement('td');
        if (m.allergies) {
          tdAllergy.appendChild(el('span', 'nfa-allergy', m.allergies));
        } else {
          tdAllergy.textContent = '—';
        }
        tr.appendChild(tdAllergy);

        var tdAct = document.createElement('td');
        var actWrap = el('div', 'nfa-cell-actions');
        var notesBtn = el('button', 'btn btn-secondary nfa-row-btn', t('ملاحظات', 'Notes') + ' (' + (m.notes ? m.notes.length : 0) + ')');
        notesBtn.type = 'button';
        notesBtn.addEventListener('click', function () {
          selectedMemberId = m.id;
          pendingRemove = null;
          refreshUI();
        });
        actWrap.appendChild(notesBtn);

        if (m.relation !== 'head') {
          var remBtn = el('button', 'btn btn-secondary nfa-row-btn', t('إزالة', 'Remove'));
          remBtn.type = 'button';
          remBtn.addEventListener('click', function () {
            pendingRemove = { familyId: fam.id, memberId: m.id, memberName: m.name };
            refreshUI();
          });
          actWrap.appendChild(remBtn);
        }

        tdAct.appendChild(actWrap);
        tr.appendChild(tdAct);
        tbody.appendChild(tr);
      })(members[i]);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    panelBox.appendChild(wrap);

    if (pendingRemove && pendingRemove.familyId === fam.id) {
      var dlg = el('div', 'nfa-dialog');
      dlg.id = 'nfaRemoveDialog';
      dlg.appendChild(el('h4', '', t('إزالة الفرد: ', 'Remove member: ') + pendingRemove.memberName));
      var reasonInp = makeField(dlg, t('سبب الإزالة (مطلوب)', 'Removal reason (required)'), 'nfaRemoveReasonInput', t('اكتب السبب...', 'Enter reason...'), 200);
      var dlgStatus = el('div', 'nfa-status', '');
      var dlgAct = el('div', 'nfa-actions');
      var confirmBtn = el('button', 'btn btn-primary', t('تأكيد الإزالة', 'Confirm Remove'));
      confirmBtn.type = 'button';
      confirmBtn.addEventListener('click', function () {
        var ok = removeMember(pendingRemove.familyId, pendingRemove.memberId, reasonInp.value);
        if (!ok) {
          dlgStatus.textContent = t('تعذرت الإزالة: تحقق من السبب أو الصلاحية.', 'Removal failed: check reason or permission.');
          notify(dlgStatus.textContent, 'error');
        } else {
          pendingRemove = null;
          notify(t('تمت إزالة الفرد.', 'Member removed.'), 'success');
          refreshUI();
        }
      });
      var cancelBtn = el('button', 'btn btn-secondary', t('إلغاء', 'Cancel'));
      cancelBtn.type = 'button';
      cancelBtn.addEventListener('click', function () {
        pendingRemove = null;
        refreshUI();
      });
      dlgAct.appendChild(confirmBtn);
      dlgAct.appendChild(cancelBtn);
      dlg.appendChild(dlgAct);
      dlg.appendChild(dlgStatus);
      panelBox.appendChild(dlg);
    }

    if (selectedMemberId) {
      var targetMem = null;
      for (i = 0; i < members.length; i++) {
        if (members[i].id === selectedMemberId) {
          targetMem = members[i];
          break;
        }
      }
      if (targetMem) {
        var notesBox = el('div', 'nfa-notes-box');
        notesBox.id = 'nfaNotesBox';
        notesBox.appendChild(el('h4', '', t('ملاحظات: ', 'Notes: ') + targetMem.name));
        var mNotes = getNotes(fam.id, targetMem.id);
        if (!mNotes.length) {
          notesBox.appendChild(el('div', 'nfa-empty', t('لا توجد ملاحظات بعد.', 'No notes yet.')));
        } else {
          for (i = 0; i < mNotes.length; i++) {
            var item = el('div', 'nfa-note-item');
            var meta = (mNotes[i].by ? mNotes[i].by + ' — ' : '') + (mNotes[i].at ? mNotes[i].at.slice(0, 16).replace('T', ' ') : '');
            item.appendChild(el('div', 'nfa-note-meta', meta));
            item.appendChild(el('div', '', mNotes[i].text));
            notesBox.appendChild(item);
          }
        }
        var noteInp = makeField(notesBox, t('إضافة ملاحظة', 'Add Note'), 'nfaNewNoteInput', t('ملاحظة جديدة...', 'New note...'), 300);
        var noteAct = el('div', 'nfa-actions');
        var addNoteBtn = el('button', 'btn btn-primary', t('حفظ الملاحظة', 'Add Note'));
        addNoteBtn.type = 'button';
        addNoteBtn.addEventListener('click', function () {
          var res = addNote(fam.id, targetMem.id, noteInp.value);
          if (!res) {
            notify(t('أدخل نص الملاحظة.', 'Enter note text.'), 'error');
          } else {
            notify(t('تمت إضافة الملاحظة.', 'Note added.'), 'success');
          }
        });
        noteAct.appendChild(addNoteBtn);
        notesBox.appendChild(noteAct);
        panelBox.appendChild(notesBox);
      }
    }

    panelBox.appendChild(el('h4', '', t('أضف فرد', 'Add Member')));
    var addGrid = el('div', 'nfa-grid');
    var memNameInp = makeField(addGrid, t('اسم الفرد', 'Member Name'), 'nfaMemNameInput', '', 80);

    var relWrap = el('div', 'nfa-field');
    var relLbl = el('label', '', t('الصفة', 'Relation'));
    relLbl.setAttribute('for', 'nfaMemRelSelect');
    var relSel = el('select', 'nfa-select');
    relSel.id = 'nfaMemRelSelect';
    for (i = 0; i < RELATIONS.length; i++) {
      var opt = document.createElement('option');
      opt.value = RELATIONS[i];
      opt.textContent = relationLabel(RELATIONS[i]);
      if (RELATIONS[i] === 'child') opt.selected = true;
      relSel.appendChild(opt);
    }
    relWrap.appendChild(relLbl);
    relWrap.appendChild(relSel);
    addGrid.appendChild(relWrap);

    var birthInp = makeField(addGrid, t('سنة الميلاد', 'Birth Year'), 'nfaMemBirthInput', '1995', 4);
    birthInp.setAttribute('inputmode', 'numeric');
    var allergyInp = makeField(addGrid, t('الحساسية', 'Allergies'), 'nfaMemAllergyInput', t('اختياري', 'Optional'), 200);
    var memNoteInp = makeField(addGrid, t('ملاحظة أولية', 'Initial Note'), 'nfaMemNoteInput', t('اختياري', 'Optional'), 300);
    panelBox.appendChild(addGrid);

    var addMemStatus = el('div', 'nfa-status', '');
    var addMemAct = el('div', 'nfa-actions');
    var addMemBtn = el('button', 'btn btn-primary', t('أضف فرد', 'Add Member'));
    addMemBtn.type = 'button';
    addMemBtn.addEventListener('click', function () {
      var added = addMember(fam.id, {
        name: memNameInp.value,
        relation: relSel.value,
        birthYear: birthInp.value,
        allergies: allergyInp.value,
        note: memNoteInp.value
      });
      if (!added) {
        addMemStatus.textContent = t('تعذرت الإضافة: تحقق من البيانات أو الحد الأقصى للأفراد.', 'Could not add member: check inputs or member limit.');
        notify(addMemStatus.textContent, 'error');
      } else {
        notify(t('تمت إضافة الفرد بنجاح.', 'Member added.'), 'success');
      }
    });
    addMemAct.appendChild(addMemBtn);
    panelBox.appendChild(addMemAct);
    panelBox.appendChild(addMemStatus);
  }

  function buildCard() {
    injectStyles();
    selectedFamilyId = '';
    selectedMemberId = '';
    pendingRemove = null;
    searchQuery = '';

    var card = el('section', 'nova-card');
    card.id = CARD_ID;
    card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    card.appendChild(el('h3', '', t('حساب العائلة', 'Family Accounts')));

    var searchInp = el('input', 'nfa-input');
    searchInp.id = 'nfaSearchInput';
    searchInp.type = 'search';
    searchInp.placeholder = t('ابحث بالاسم أو رقم الموبايل...', 'Search by name or mobile...');
    searchInp.addEventListener('input', function () {
      searchQuery = searchInp.value;
      refreshUI();
    });
    card.appendChild(searchInp);

    var famList = el('div', 'nfa-list');
    famList.id = 'nfaFamilyList';
    card.appendChild(famList);

    card.appendChild(el('h4', '', t('إنشاء حساب عائلة جديد', 'Create Family Account')));
    var createGrid = el('div', 'nfa-grid');
    var famNameInp = makeField(createGrid, t('اسم العائلة', 'Family Name'), 'nfaFamNameInput', t('عائلة أحمد', 'Ahmed Family'), 80);
    var famPhoneInp = makeField(createGrid, t('رقم الموبايل', 'Mobile Phone'), 'nfaFamPhoneInput', '01012345678', 15);
    famPhoneInp.setAttribute('inputmode', 'tel');
    var famHeadInp = makeField(createGrid, t('اسم رب الأسرة', 'Head Name'), 'nfaFamHeadInput', t('اختياري', 'Optional'), 80);
    card.appendChild(createGrid);

    var createStatus = el('div', 'nfa-status', '');
    var createAct = el('div', 'nfa-actions');
    var createBtn = el('button', 'btn btn-primary', t('إنشاء الحساب', 'Create Family'));
    createBtn.type = 'button';
    createBtn.addEventListener('click', function () {
      var created = createFamily({
        name: famNameInp.value,
        phone: famPhoneInp.value,
        headName: famHeadInp.value
      });
      if (!created) {
        createStatus.textContent = t('تعذر الإنشاء: تحقق من الاسم أو رقم الموبايل غير المكرر.', 'Could not create: check name and unique Egyptian mobile.');
        notify(createStatus.textContent, 'error');
      } else {
        famNameInp.value = '';
        famPhoneInp.value = '';
        famHeadInp.value = '';
        selectedFamilyId = created.id;
        createStatus.textContent = t('تم إنشاء حساب العائلة.', 'Family account created.');
        notify(createStatus.textContent, 'success');
        refreshUI();
      }
    });
    createAct.appendChild(createBtn);
    card.appendChild(createAct);
    card.appendChild(createStatus);

    var selectedPanel = el('div', 'nfa-panel');
    selectedPanel.id = 'nfaSelectedPanel';
    card.appendChild(selectedPanel);

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
;
// app/608-payroll-commissions.js
(function () {
  'use strict';

  var STORAGE_KEY = 'nova-rx-payroll-v1';
  var LANG_KEY = 'nova-rx-language';
  var CARD_ID = 'novaPayroll';
  var STYLE_ID = 'novaPayrollStyle';
  var PRINT_ID = 'novaPayrollPrintArea';
  var MAX_ADJUSTMENTS = 500;
  var UNASSIGNED_AR = 'غير محدد';
  var observer = null;
  var ensuring = false;
  var selectedMonth = currentMonthKey();

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
      } catch (e) {
        // ignore toast errors
      }
    }
  }

  function pad2(n) {
    return n < 10 ? ('0' + n) : String(n);
  }

  function currentMonthKey() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function isValidMonthKey(mk) {
    return typeof mk === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(mk);
  }

  function trimStr(v) {
    return String(v == null ? '' : v).replace(/^\s+|\s+$/g, '');
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
        if (idx !== -1) {
          out += String(idx);
        } else if (ch === '\u066b' || ch === ',') {
          out += '.';
        } else {
          out += ch;
        }
      }
    }
    return out;
  }

  function parseEgpToPiasters(val, allowEmpty) {
    var s = trimStr(normalizeDigits(val));
    if (!s) return allowEmpty ? 0 : NaN;
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
    var parts = s.split('.');
    var whole = parseInt(parts[0], 10);
    var fracStr = parts.length > 1 ? parts[1] : '';
    if (fracStr.length === 1) fracStr += '0';
    var frac = fracStr ? parseInt(fracStr, 10) : 0;
    return whole * 100 + frac;
  }

  function parsePercent(val, allowEmpty) {
    var s = trimStr(normalizeDigits(val));
    if (!s) return allowEmpty ? 0 : NaN;
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
    var n = Number(s);
    if (isNaN(n) || n < 0 || n > 100) return NaN;
    return n;
  }

  function parsePiastersInt(val, defaultZero) {
    if (val === undefined || val === null || val === '') {
      return defaultZero ? 0 : NaN;
    }
    if (typeof val === 'string') {
      var s = trimStr(normalizeDigits(val));
      if (!/^\d+$/.test(s)) return NaN;
      return parseInt(s, 10);
    }
    if (typeof val !== 'number' || !isFinite(val) || Math.floor(val) !== val || val < 0) {
      return NaN;
    }
    return val;
  }

  function fmtPiasters(p) {
    var n = Number(p) || 0;
    var sign = n < 0 ? '-' : '';
    var abs = Math.abs(Math.round(n));
    var whole = Math.floor(abs / 100);
    var frac = abs % 100;
    var val = sign + whole + '.' + (frac < 10 ? ('0' + frac) : String(frac));
    return isEn() ? (val + ' EGP') : (val + ' ج.م');
  }

  function piastersToInput(p) {
    var abs = Math.max(0, Math.round(Number(p) || 0));
    var whole = Math.floor(abs / 100);
    var frac = abs % 100;
    return whole + '.' + (frac < 10 ? ('0' + frac) : String(frac));
  }

  function currentUserName() {
    if (window.novaAuth && typeof window.novaAuth.current === 'function') {
      try {
        var u = window.novaAuth.current();
        if (u && typeof u.name === 'string') return trimStr(u.name);
      } catch (e) {
        return '';
      }
    }
    return '';
  }

  function denyMsg() {
    return t('محتاج صلاحية المالك', 'Owner permission required');
  }

  function hasPerm() {
    if (!window.novaPerms || typeof window.novaPerms.require !== 'function') {
      return false;
    }
    try {
      return !!window.novaPerms.require('accounts.manage');
    } catch (e) {
      return false;
    }
  }

  function requirePerm() {
    if (hasPerm()) return true;
    toast(denyMsg(), 'error');
    return false;
  }

  function emptyStore() {
    return { employees: [], adjustments: [], closedMonths: {} };
  }

  function readStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyStore();
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return emptyStore();
      }
      return {
        employees: Array.isArray(parsed.employees) ? parsed.employees : [],
        adjustments: Array.isArray(parsed.adjustments) ? parsed.adjustments : [],
        closedMonths: (parsed.closedMonths && typeof parsed.closedMonths === 'object' && !Array.isArray(parsed.closedMonths))
          ? parsed.closedMonths
          : {}
      };
    } catch (e) {
      return emptyStore();
    }
  }

  function writeStore(store) {
    try {
      if (store.adjustments.length > MAX_ADJUSTMENTS) {
        store.adjustments = store.adjustments.slice(store.adjustments.length - MAX_ADJUSTMENTS);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      return true;
    } catch (e) {
      return false;
    }
  }

  function cloneObj(o) {
    try {
      return JSON.parse(JSON.stringify(o));
    } catch (e) {
      return o;
    }
  }

  function getSalesList() {
    if (!window.novaSales || typeof window.novaSales.list !== 'function') return [];
    try {
      var list = window.novaSales.list();
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function isSaleCancelled(id) {
    if (!window.novaSales || typeof window.novaSales.isCancelled !== 'function') return false;
    try {
      return !!window.novaSales.isCancelled(id);
    } catch (e) {
      return false;
    }
  }

  function getReturnedMap(saleId) {
    if (!window.novaSales || typeof window.novaSales.returnedQty !== 'function') return {};
    try {
      var m = window.novaSales.returnedQty(saleId);
      return (m && typeof m === 'object') ? m : {};
    } catch (e) {
      return {};
    }
  }

  function getSaleEmployee(sale) {
    if (!sale || typeof sale !== 'object') return UNASSIGNED_AR;
    var fields = ['cashier', 'employee', 'user', 'by'];
    var i, raw, s;
    for (i = 0; i < fields.length; i++) {
      raw = sale[fields[i]];
      if (raw && typeof raw === 'object') raw = raw.name;
      s = trimStr(raw);
      if (s) return s;
    }
    return UNASSIGNED_AR;
  }

  function getSaleMonthKey(sale) {
    if (!sale || !sale.at) return '';
    var raw = trimStr(sale.at);
    if (/^\d{4}-(0[1-9]|1[0-2])(?:-\d{2})?$/.test(raw)) {
      return raw.slice(0, 7);
    }
    var ms = Date.parse(raw);
    if (isNaN(ms)) return '';
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function computeSaleNetPiasters(sale) {
    if (!sale || typeof sale !== 'object') return 0;
    var lines = Array.isArray(sale.lines) ? sale.lines : [];
    if (!lines.length) {
      return Math.round(Math.max(0, Number(sale.total) || 0) * 100);
    }
    var rawRevs = [];
    var saleRawRev = 0;
    var i, line, rawRev;
    for (i = 0; i < lines.length; i++) {
      line = lines[i] || {};
      rawRev = Math.max(0, (Number(line.qty) || 0) * (Number(line.price) || 0) - (Number(line.discount) || 0));
      rawRevs.push(rawRev);
      saleRawRev += rawRev;
    }
    var invDisc = Math.max(0, Number(sale.discount) || 0);
    var retMap = getReturnedMap(sale.id);
    var totalEgp = 0;
    var origQty, discShare, netRev, retQty, effQty, ratio;
    for (i = 0; i < lines.length; i++) {
      line = lines[i] || {};
      origQty = Number(line.qty) || 0;
      rawRev = rawRevs[i];
      discShare = (invDisc > 0 && saleRawRev > 0) ? (rawRev / saleRawRev) * invDisc : 0;
      netRev = Math.max(0, rawRev - discShare);
      retQty = Number(retMap[i]) || 0;
      effQty = Math.max(0, origQty - retQty);
      if (effQty <= 0) continue;
      ratio = origQty > 0 ? Math.max(0, effQty / origQty) : 0;
      totalEgp += netRev * ratio;
    }
    return Math.round(totalEgp * 100);
  }

  function calcSalesInternal(employeeName, monthKey) {
    var targetEmp = trimStr(employeeName) || UNASSIGNED_AR;
    var list = getSalesList();
    var totalPiasters = 0;
    var count = 0;
    var i, sale;
    for (i = 0; i < list.length; i++) {
      sale = list[i];
      if (!sale || isSaleCancelled(sale.id)) continue;
      if (getSaleMonthKey(sale) !== monthKey) continue;
      if (getSaleEmployee(sale) !== targetEmp) continue;
      totalPiasters += computeSaleNetPiasters(sale);
      count += 1;
    }
    return {
      employee: targetEmp,
      monthKey: monthKey,
      totalPiasters: totalPiasters,
      count: count
    };
  }

  function findEmployeeConfig(store, empName) {
    var i;
    for (i = 0; i < store.employees.length; i++) {
      if (store.employees[i] && store.employees[i].name === empName) {
        return store.employees[i];
      }
    }
    return null;
  }

  function computeLive(store, empName, monthKey) {
    var cfg = findEmployeeConfig(store, empName);
    var baseSalaryPiasters = cfg ? (Number(cfg.baseSalaryPiasters) || 0) : 0;
    var commissionPercent = cfg ? (Number(cfg.commissionPercent) || 0) : 0;
    var targetPiasters = cfg ? (Number(cfg.targetPiasters) || 0) : 0;
    var bonusPercent = cfg ? (Number(cfg.bonusPercent) || 0) : 0;

    var salesInfo = calcSalesInternal(empName, monthKey);
    var salesTotalPiasters = salesInfo.totalPiasters;
    var commissionPiasters = Math.round(salesTotalPiasters * commissionPercent / 100);
    var targetReached = targetPiasters > 0 && salesTotalPiasters >= targetPiasters;
    var bonusPiasters = targetReached ? Math.round(salesTotalPiasters * bonusPercent / 100) : 0;

    var rewardsPiasters = 0;
    var advancesPiasters = 0;
    var deductionsPiasters = 0;
    var adjs = [];
    var i, a;
    for (i = 0; i < store.adjustments.length; i++) {
      a = store.adjustments[i];
      if (!a || a.employee !== empName || a.monthKey !== monthKey) continue;
      adjs.push(cloneObj(a));
      if (a.type === 'reward') {
        rewardsPiasters += Number(a.amountPiasters) || 0;
      } else if (a.type === 'advance') {
        advancesPiasters += Number(a.amountPiasters) || 0;
      } else if (a.type === 'deduction') {
        deductionsPiasters += Number(a.amountPiasters) || 0;
      }
    }

    var netPiasters = baseSalaryPiasters + commissionPiasters + bonusPiasters + rewardsPiasters - advancesPiasters - deductionsPiasters;

    return {
      employee: empName,
      monthKey: monthKey,
      baseSalaryPiasters: baseSalaryPiasters,
      commissionPercent: commissionPercent,
      targetPiasters: targetPiasters,
      bonusPercent: bonusPercent,
      salesTotalPiasters: salesTotalPiasters,
      salesCount: salesInfo.count,
      commissionPiasters: commissionPiasters,
      targetReached: targetReached,
      bonusPiasters: bonusPiasters,
      rewardsPiasters: rewardsPiasters,
      advancesPiasters: advancesPiasters,
      deductionsPiasters: deductionsPiasters,
      adjustments: adjs,
      netPiasters: netPiasters,
      closed: false,
      closedAt: null
    };
  }

  function computeFromStore(store, employeeName, monthKey) {
    var empName = trimStr(employeeName) || UNASSIGNED_AR;
    var closedRec = store.closedMonths[monthKey];
    if (closedRec && closedRec.snapshots) {
      if (closedRec.snapshots[empName]) {
        return cloneObj(closedRec.snapshots[empName]);
      }
      return {
        employee: empName,
        monthKey: monthKey,
        baseSalaryPiasters: 0,
        commissionPercent: 0,
        targetPiasters: 0,
        bonusPercent: 0,
        salesTotalPiasters: 0,
        salesCount: 0,
        commissionPiasters: 0,
        targetReached: false,
        bonusPiasters: 0,
        rewardsPiasters: 0,
        advancesPiasters: 0,
        deductionsPiasters: 0,
        adjustments: [],
        netPiasters: 0,
        closed: true,
        closedAt: closedRec.closedAt || null
      };
    }
    return computeLive(store, empName, monthKey);
  }

  function collectMonthEmployees(store, monthKey) {
    var seen = {};
    var names = [];
    var i, nm;

    function addName(n) {
      var s = trimStr(n);
      if (!s || seen[s]) return;
      seen[s] = true;
      names.push(s);
    }

    if (store.closedMonths[monthKey] && store.closedMonths[monthKey].snapshots) {
      var snapKeys = Object.keys(store.closedMonths[monthKey].snapshots);
      for (i = 0; i < snapKeys.length; i++) addName(snapKeys[i]);
      return names;
    }

    for (i = 0; i < store.employees.length; i++) {
      if (store.employees[i]) addName(store.employees[i].name);
    }
    var list = getSalesList();
    for (i = 0; i < list.length; i++) {
      if (!list[i] || isSaleCancelled(list[i].id)) continue;
      if (getSaleMonthKey(list[i]) !== monthKey) continue;
      nm = getSaleEmployee(list[i]);
      addName(nm);
    }
    for (i = 0; i < store.adjustments.length; i++) {
      if (store.adjustments[i] && store.adjustments[i].monthKey === monthKey) {
        addName(store.adjustments[i].employee);
      }
    }
    return names;
  }

  function apiSetEmployee(opts) {
    if (!requirePerm()) return false;
    var o = opts || {};
    var name = trimStr(o.name);
    if (!name) return false;
    var baseSalaryPiasters = parsePiastersInt(o.baseSalaryPiasters, true);
    var targetPiasters = parsePiastersInt(o.targetPiasters, true);
    var commissionPercent = o.commissionPercent === undefined || o.commissionPercent === null || o.commissionPercent === ''
      ? 0
      : parsePercent(o.commissionPercent, true);
    var bonusPercent = o.bonusPercent === undefined || o.bonusPercent === null || o.bonusPercent === ''
      ? 0
      : parsePercent(o.bonusPercent, true);

    if (isNaN(baseSalaryPiasters) || isNaN(targetPiasters) || isNaN(commissionPercent) || isNaN(bonusPercent)) {
      return false;
    }

    var store = readStore();
    var rec = {
      name: name,
      baseSalaryPiasters: baseSalaryPiasters,
      commissionPercent: commissionPercent,
      targetPiasters: targetPiasters,
      bonusPercent: bonusPercent,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUserName()
    };

    var found = false;
    var i;
    for (i = 0; i < store.employees.length; i++) {
      if (store.employees[i] && store.employees[i].name === name) {
        store.employees[i] = rec;
        found = true;
        break;
      }
    }
    if (!found) store.employees.push(rec);
    if (!writeStore(store)) return false;
    refreshCard();
    return cloneObj(rec);
  }

  function apiEmployees() {
    if (!requirePerm()) return false;
    var store = readStore();
    return cloneObj(store.employees);
  }

  function apiSales(employeeName, monthKey) {
    if (!requirePerm()) return false;
    if (!isValidMonthKey(monthKey)) return false;
    return calcSalesInternal(employeeName, monthKey);
  }

  function apiCompute(employeeName, monthKey) {
    if (!requirePerm()) return false;
    if (!isValidMonthKey(monthKey)) return false;
    var store = readStore();
    return computeFromStore(store, employeeName, monthKey);
  }

  function apiAddAdjustment(opts) {
    if (!requirePerm()) return false;
    var o = opts || {};
    var empName = trimStr(o.employee);
    var mk = trimStr(o.monthKey);
    var adjType = trimStr(o.type);
    var amountPiasters = parsePiastersInt(o.amountPiasters, false);
    var reason = trimStr(o.reason);

    if (!empName || !isValidMonthKey(mk)) return false;
    if (adjType !== 'advance' && adjType !== 'deduction' && adjType !== 'reward') return false;
    if (isNaN(amountPiasters) || amountPiasters <= 0) return false;
    if (!reason) return false;

    var store = readStore();
    if (store.closedMonths[mk]) return false;

    var rec = {
      id: 'adj-' + Date.now() + '-' + Math.floor(Math.random() * 100000),
      employee: empName,
      monthKey: mk,
      type: adjType,
      amountPiasters: amountPiasters,
      reason: reason,
      at: new Date().toISOString(),
      by: currentUserName()
    };

    store.adjustments.push(rec);
    if (!writeStore(store)) return false;
    refreshCard();
    return cloneObj(rec);
  }

  function apiCloseMonth(monthKey) {
    if (!requirePerm()) return false;
    if (!isValidMonthKey(monthKey)) return false;
    var store = readStore();
    if (store.closedMonths[monthKey]) return false;

    var nowIso = new Date().toISOString();
    var names = collectMonthEmployees(store, monthKey);
    var snapshots = {};
    var i, snap;
    for (i = 0; i < names.length; i++) {
      snap = computeLive(store, names[i], monthKey);
      snap.closed = true;
      snap.closedAt = nowIso;
      snapshots[names[i]] = snap;
    }

    var closedEntry = {
      monthKey: monthKey,
      closedAt: nowIso,
      closedBy: currentUserName(),
      snapshots: snapshots
    };
    store.closedMonths[monthKey] = closedEntry;
    if (!writeStore(store)) return false;
    refreshCard();
    return cloneObj(closedEntry);
  }

  function apiIsClosed(monthKey) {
    if (!requirePerm()) return false;
    if (!isValidMonthKey(monthKey)) return false;
    var store = readStore();
    return !!store.closedMonths[monthKey];
  }

  window.novaPayroll = {
    setEmployee: apiSetEmployee,
    employees: apiEmployees,
    sales: apiSales,
    compute: apiCompute,
    addAdjustment: apiAddAdjustment,
    closeMonth: apiCloseMonth,
    isClosed: apiIsClosed
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
      '#novaPayroll{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;overflow:hidden;}',
      '#novaPayroll *{box-sizing:border-box;}',
      '#novaPayroll .npr-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;border-bottom:1px solid #343b44;padding-bottom:10px;margin-bottom:14px;}',
      '#novaPayroll .npr-title{margin:0;font-size:1.05rem;color:#e6edf3;}',
      '#novaPayroll .npr-month-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;max-width:100%;}',
      '#novaPayroll .npr-sub{margin:16px 0 8px;font-size:0.95rem;color:#79c9eb;font-weight:600;}',
      '#novaPayroll .npr-denied{padding:14px;border:1px solid #343b44;border-radius:8px;background:#0d1117;color:#e6edf3;text-align:center;font-weight:600;}',
      '#novaPayroll .npr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:10px;margin-bottom:10px;}',
      '#novaPayroll .npr-field{min-width:0;}',
      '#novaPayroll .npr-field label{display:block;font-size:0.82rem;color:#9fb0c2;margin-bottom:4px;}',
      '#novaPayroll .npr-input,#novaPayroll .npr-select{width:100%;max-width:100%;min-height:44px;padding:8px 10px;background:#0d1117;border:1px solid #343b44;border-radius:8px;color:#e6edf3;font-size:0.9rem;}',
      '#novaPayroll .npr-input:focus,#novaPayroll .npr-select:focus{outline:none;border-color:#79c9eb;}',
      '#novaPayroll button{min-height:44px;}',
      '#novaPayroll .npr-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;}',
      '#novaPayroll .npr-badge{display:inline-block;padding:4px 10px;border-radius:6px;border:1px solid #79c9eb;color:#79c9eb;font-size:0.82rem;font-weight:600;}',
      '#novaPayroll .npr-status{font-size:0.85rem;color:#79c9eb;min-height:20px;margin-bottom:8px;}',
      '#novaPayroll .npr-table-wrap{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid #343b44;border-radius:8px;margin-bottom:12px;}',
      '#novaPayroll table{width:100%;border-collapse:collapse;font-size:0.85rem;min-width:480px;}',
      '#novaPayroll th,#novaPayroll td{padding:8px 10px;border-bottom:1px solid #343b44;text-align:start;white-space:nowrap;}',
      '#novaPayroll th{background:#1b2129;color:#79c9eb;font-weight:600;}',
      '#novaPayroll tr:last-child td{border-bottom:0;}',
      '#novaPayroll .npr-empty{padding:12px;color:#9fb0c2;text-align:center;}',
      '#novaPayrollPrintArea{display:none;}',
      '@media print{body *{visibility:hidden!important;}#novaPayrollPrintArea,#novaPayrollPrintArea *{visibility:visible!important;}#novaPayrollPrintArea{display:block!important;position:fixed;inset:0;background:#fff;color:#000;padding:20px;z-index:99999;}}'
    ].join('');
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function displayEmpName(name) {
    if (name === UNASSIGNED_AR) return t('غير محدد', 'Unspecified');
    return name;
  }

  function adjTypeLabel(type) {
    if (type === 'advance') return t('سلفة', 'Advance');
    if (type === 'deduction') return t('خصم', 'Deduction');
    if (type === 'reward') return t('مكافأة', 'Reward');
    return type;
  }

  function printPayslip(snap) {
    if (!hasPerm()) {
      toast(denyMsg(), 'error');
      refreshCard();
      return;
    }
    var existing = document.getElementById(PRINT_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var box = el('div');
    box.id = PRINT_ID;
    box.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    box.appendChild(el('h2', '', t('كشف المرتب الشهري', 'Monthly Payslip')));
    box.appendChild(el('p', '', t('الموظف: ', 'Employee: ') + displayEmpName(snap.employee)));
    box.appendChild(el('p', '', t('الشهر: ', 'Month: ') + snap.monthKey));

    var rows = [
      [t('المرتب الأساسي', 'Base Salary'), fmtPiasters(snap.baseSalaryPiasters)],
      [t('إجمالي المبيعات', 'Total Sales'), fmtPiasters(snap.salesTotalPiasters)],
      [t('العمولة', 'Commission') + ' (' + snap.commissionPercent + '%)', fmtPiasters(snap.commissionPiasters)],
      [t('بونص التارجت', 'Target Bonus') + (snap.targetReached ? ' (' + snap.bonusPercent + '%)' : ''), fmtPiasters(snap.bonusPiasters)],
      [t('المكافآت', 'Rewards'), fmtPiasters(snap.rewardsPiasters)],
      [t('السلف', 'Advances'), fmtPiasters(snap.advancesPiasters)],
      [t('الخصومات', 'Deductions'), fmtPiasters(snap.deductionsPiasters)],
      [t('صافي المرتب', 'Net Salary'), fmtPiasters(snap.netPiasters)]
    ];

    var tbl = document.createElement('table');
    tbl.style.width = '100%';
    tbl.style.borderCollapse = 'collapse';
    var i, tr, td1, td2;
    for (i = 0; i < rows.length; i++) {
      tr = document.createElement('tr');
      td1 = el('td', '', rows[i][0]);
      td2 = el('td', '', rows[i][1]);
      td1.style.border = '1px solid #333';
      td1.style.padding = '6px';
      td2.style.border = '1px solid #333';
      td2.style.padding = '6px';
      tr.appendChild(td1);
      tr.appendChild(td2);
      tbl.appendChild(tr);
    }
    box.appendChild(tbl);
    document.body.appendChild(box);

    if (typeof window.print === 'function') {
      try {
        window.print();
      } catch (e) {
        // ignore print errors in headless environments
      }
    }
  }

  function renderCardContent(card) {
    while (card.firstChild) card.removeChild(card.firstChild);
    card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    var head = el('div', 'npr-head');
    head.appendChild(el('h3', 'npr-title', t('المرتبات والعمولات والتارجت', 'Payroll, Commissions & Targets')));

    if (!hasPerm()) {
      card.appendChild(head);
      var denied = el('div', 'npr-denied', denyMsg());
      denied.id = 'nprDeniedMsg';
      card.appendChild(denied);
      return;
    }

    var store = readStore();
    var closed = !!store.closedMonths[selectedMonth];

    var monthBar = el('div', 'npr-month-bar');
    var monthInput = el('input', 'npr-input');
    monthInput.id = 'nprMonthInput';
    monthInput.type = 'month';
    monthInput.value = selectedMonth;
    monthInput.style.width = 'auto';
    monthInput.addEventListener('change', function () {
      if (isValidMonthKey(monthInput.value)) {
        selectedMonth = monthInput.value;
        refreshCard();
      }
    });
    monthBar.appendChild(monthInput);

    if (closed) {
      monthBar.appendChild(el('span', 'npr-badge', t('الشهر مقفول', 'Month Closed')));
    } else {
      var closeBtn = el('button', 'btn btn-primary', t('قفل الشهر', 'Close Month'));
      closeBtn.id = 'nprCloseMonthBtn';
      closeBtn.type = 'button';
      closeBtn.addEventListener('click', function () {
        if (!hasPerm()) {
          toast(denyMsg(), 'error');
          refreshCard();
          return;
        }
        var res = apiCloseMonth(selectedMonth);
        if (res) {
          toast(t('تم قفل الشهر بنجاح', 'Month closed successfully'), 'success');
        } else {
          toast(t('تعذر قفل الشهر', 'Could not close month'), 'error');
        }
      });
      monthBar.appendChild(closeBtn);
    }
    head.appendChild(monthBar);
    card.appendChild(head);

    var statusEl = el('div', 'npr-status', '');
    statusEl.id = 'nprStatusMsg';
    card.appendChild(statusEl);

    // 1. Employee Settings Form
    card.appendChild(el('div', 'npr-sub', t('إعدادات الموظفين', 'Employee Settings')));
    var empGrid = el('div', 'npr-grid');

    function makeField(parent, id, labelText, placeholder, inputMode) {
      var wrap = el('div', 'npr-field');
      var lbl = el('label', '', labelText);
      lbl.setAttribute('for', id);
      var inp = el('input', 'npr-input');
      inp.id = id;
      inp.type = 'text';
      if (placeholder) inp.placeholder = placeholder;
      if (inputMode) inp.setAttribute('inputmode', inputMode);
      wrap.appendChild(lbl);
      wrap.appendChild(inp);
      parent.appendChild(wrap);
      return inp;
    }

    var empNameIn = makeField(empGrid, 'nprEmpName', t('اسم الموظف', 'Employee Name'), t('مثال: أحمد علي', 'e.g. Ahmed Ali'));
    var empBaseIn = makeField(empGrid, 'nprEmpBase', t('المرتب الأساسي (ج.م)', 'Base Salary (EGP)'), '0.00', 'decimal');
    var empCommIn = makeField(empGrid, 'nprEmpComm', t('نسبة العمولة %', 'Commission %'), '0', 'decimal');
    var empTargetIn = makeField(empGrid, 'nprEmpTarget', t('التارجت الشهري (ج.م)', 'Monthly Target (EGP)'), '0.00', 'decimal');
    var empBonusIn = makeField(empGrid, 'nprEmpBonus', t('نسبة بونص التارجت %', 'Target Bonus %'), '0', 'decimal');
    card.appendChild(empGrid);

    var empActions = el('div', 'npr-actions');
    var saveEmpBtn = el('button', 'btn btn-primary', t('حفظ الموظف', 'Save Employee'));
    saveEmpBtn.id = 'nprSaveEmpBtn';
    saveEmpBtn.type = 'button';
    saveEmpBtn.addEventListener('click', function () {
      if (!hasPerm()) {
        toast(denyMsg(), 'error');
        refreshCard();
        return;
      }
      var nm = trimStr(empNameIn.value);
      var baseP = parseEgpToPiasters(empBaseIn.value, true);
      var commP = parsePercent(empCommIn.value, true);
      var targetP = parseEgpToPiasters(empTargetIn.value, true);
      var bonusP = parsePercent(empBonusIn.value, true);
      if (!nm || isNaN(baseP) || isNaN(commP) || isNaN(targetP) || isNaN(bonusP)) {
        var err = t('تحقق من بيانات الموظف', 'Check employee fields');
        statusEl.textContent = err;
        toast(err, 'error');
        return;
      }
      var saved = apiSetEmployee({
        name: nm,
        baseSalaryPiasters: baseP,
        commissionPercent: commP,
        targetPiasters: targetP,
        bonusPercent: bonusP
      });
      if (!saved) {
        statusEl.textContent = t('تعذر حفظ بيانات الموظف', 'Could not save employee');
        toast(statusEl.textContent, 'error');
        return;
      }
      toast(t('تم حفظ بيانات الموظف', 'Employee saved'), 'success');
    });
    empActions.appendChild(saveEmpBtn);
    card.appendChild(empActions);

    // Employee Settings Table
    var empWrap = el('div', 'npr-table-wrap');
    empWrap.id = 'nprEmpTableWrap';
    if (!store.employees.length) {
      empWrap.appendChild(el('div', 'npr-empty', t('لا يوجد موظفون مسجلون بعد', 'No employees configured yet')));
    } else {
      var empTbl = document.createElement('table');
      var empThead = document.createElement('thead');
      var empHr = document.createElement('tr');
      var empHeaders = [
        t('الموظف', 'Employee'),
        t('الأساسي', 'Base'),
        t('العمولة %', 'Comm %'),
        t('التارجت', 'Target'),
        t('البونص %', 'Bonus %'),
        t('إجراء', 'Action')
      ];
      var i;
      for (i = 0; i < empHeaders.length; i++) empHr.appendChild(el('th', '', empHeaders[i]));
      empThead.appendChild(empHr);
      empTbl.appendChild(empThead);

      var empTbody = document.createElement('tbody');
      for (i = 0; i < store.employees.length; i++) {
        (function (emp) {
          var tr = document.createElement('tr');
          tr.appendChild(el('td', '', emp.name));
          tr.appendChild(el('td', '', fmtPiasters(emp.baseSalaryPiasters)));
          tr.appendChild(el('td', '', String(emp.commissionPercent) + '%'));
          tr.appendChild(el('td', '', emp.targetPiasters > 0 ? fmtPiasters(emp.targetPiasters) : '—'));
          tr.appendChild(el('td', '', String(emp.bonusPercent) + '%'));
          var actTd = document.createElement('td');
          var editBtn = el('button', 'btn btn-secondary', t('تعديل', 'Edit'));
          editBtn.type = 'button';
          editBtn.addEventListener('click', function () {
            empNameIn.value = emp.name;
            empBaseIn.value = piastersToInput(emp.baseSalaryPiasters);
            empCommIn.value = String(emp.commissionPercent);
            empTargetIn.value = piastersToInput(emp.targetPiasters);
            empBonusIn.value = String(emp.bonusPercent);
          });
          actTd.appendChild(editBtn);
          tr.appendChild(actTd);
          empTbody.appendChild(tr);
        })(store.employees[i]);
      }
      empTbl.appendChild(empTbody);
      empWrap.appendChild(empTbl);
    }
    card.appendChild(empWrap);

    // 2. Adjustments Form
    card.appendChild(el('div', 'npr-sub', t('السلف والخصومات والمكافآت', 'Advances, Deductions & Rewards')));
    var adjGrid = el('div', 'npr-grid');
    var adjEmpIn = makeField(adjGrid, 'nprAdjEmp', t('اسم الموظف', 'Employee Name'), t('اسم الموظف', 'Employee name'));
    if (closed) adjEmpIn.disabled = true;

    var typeWrap = el('div', 'npr-field');
    var typeLbl = el('label', '', t('النوع', 'Type'));
    typeLbl.setAttribute('for', 'nprAdjType');
    var adjTypeSel = el('select', 'npr-select');
    adjTypeSel.id = 'nprAdjType';
    var typeOpts = [
      { v: 'advance', l: t('سلفة', 'Advance') },
      { v: 'deduction', l: t('خصم', 'Deduction') },
      { v: 'reward', l: t('مكافأة', 'Reward') }
    ];
    var ti, opt;
    for (ti = 0; ti < typeOpts.length; ti++) {
      opt = el('option', '', typeOpts[ti].l);
      opt.value = typeOpts[ti].v;
      adjTypeSel.appendChild(opt);
    }
    if (closed) adjTypeSel.disabled = true;
    typeWrap.appendChild(typeLbl);
    typeWrap.appendChild(adjTypeSel);
    adjGrid.appendChild(typeWrap);

    var adjAmtIn = makeField(adjGrid, 'nprAdjAmt', t('المبلغ (ج.م)', 'Amount (EGP)'), '0.00', 'decimal');
    var adjReasonIn = makeField(adjGrid, 'nprAdjReason', t('السبب', 'Reason'), t('سبب البند مطلوب', 'Reason is required'));
    if (closed) {
      adjAmtIn.disabled = true;
      adjReasonIn.disabled = true;
    }
    card.appendChild(adjGrid);

    var adjActions = el('div', 'npr-actions');
    var addAdjBtn = el('button', 'btn btn-secondary', t('إضافة بند', 'Add Adjustment'));
    addAdjBtn.id = 'nprAddAdjBtn';
    addAdjBtn.type = 'button';
    if (closed) addAdjBtn.disabled = true;
    addAdjBtn.addEventListener('click', function () {
      if (!hasPerm()) {
        toast(denyMsg(), 'error');
        refreshCard();
        return;
      }
      var emp = trimStr(adjEmpIn.value);
      var amt = parseEgpToPiasters(adjAmtIn.value, false);
      var rsn = trimStr(adjReasonIn.value);
      if (!emp || isNaN(amt) || amt <= 0 || !rsn) {
        var msg = t('أدخل الموظف والمبلغ والسبب', 'Enter employee, amount and reason');
        statusEl.textContent = msg;
        toast(msg, 'error');
        return;
      }
      var added = apiAddAdjustment({
        employee: emp,
        monthKey: selectedMonth,
        type: adjTypeSel.value,
        amountPiasters: amt,
        reason: rsn
      });
      if (!added) {
        var failMsg = t('تعذر إضافة البند', 'Could not add adjustment');
        statusEl.textContent = failMsg;
        toast(failMsg, 'error');
        return;
      }
      toast(t('تمت إضافة البند', 'Adjustment added'), 'success');
    });
    adjActions.appendChild(addAdjBtn);
    card.appendChild(adjActions);

    // 3. Per-employee Statements Table
    card.appendChild(el('div', 'npr-sub', t('كشف المرتبات الشهري', 'Monthly Payroll Statements')));
    var stmtWrap = el('div', 'npr-table-wrap');
    stmtWrap.id = 'nprStatementsWrap';
    var monthEmps = collectMonthEmployees(store, selectedMonth);

    if (!monthEmps.length) {
      stmtWrap.appendChild(el('div', 'npr-empty', t('لا توجد بيانات مرتبات لهذا الشهر', 'No payroll data for this month')));
    } else {
      var stTbl = document.createElement('table');
      var stThead = document.createElement('thead');
      var stHr = document.createElement('tr');
      var stHeaders = [
        t('الموظف', 'Employee'),
        t('المبيعات', 'Sales'),
        t('الأساسي', 'Base'),
        t('العمولة', 'Commission'),
        t('البونص', 'Bonus'),
        t('المكافآت', 'Rewards'),
        t('السلف', 'Advances'),
        t('الخصومات', 'Deductions'),
        t('الصافي', 'Net'),
        t('طباعة', 'Print')
      ];
      var si;
      for (si = 0; si < stHeaders.length; si++) stHr.appendChild(el('th', '', stHeaders[si]));
      stThead.appendChild(stHr);
      stTbl.appendChild(stThead);

      var stTbody = document.createElement('tbody');
      for (si = 0; si < monthEmps.length; si++) {
        (function (empName) {
          var snap = computeFromStore(store, empName, selectedMonth);
          if (!snap) return;
          var tr = document.createElement('tr');
          tr.appendChild(el('td', '', displayEmpName(snap.employee)));
          tr.appendChild(el('td', '', fmtPiasters(snap.salesTotalPiasters)));
          tr.appendChild(el('td', '', fmtPiasters(snap.baseSalaryPiasters)));
          tr.appendChild(el('td', '', fmtPiasters(snap.commissionPiasters)));
          tr.appendChild(el('td', '', fmtPiasters(snap.bonusPiasters)));
          tr.appendChild(el('td', '', fmtPiasters(snap.rewardsPiasters)));
          tr.appendChild(el('td', '', fmtPiasters(snap.advancesPiasters)));
          tr.appendChild(el('td', '', fmtPiasters(snap.deductionsPiasters)));
          tr.appendChild(el('td', '', fmtPiasters(snap.netPiasters)));

          var pTd = document.createElement('td');
          var pBtn = el('button', 'btn btn-secondary', t('اطبع كشف المرتب', 'Print Payslip'));
          pBtn.type = 'button';
          pBtn.addEventListener('click', function () {
            printPayslip(snap);
          });
          pTd.appendChild(pBtn);
          tr.appendChild(pTd);
          stTbody.appendChild(tr);
        })(monthEmps[si]);
      }
      stTbl.appendChild(stTbody);
      stmtWrap.appendChild(stTbl);
    }
    card.appendChild(stmtWrap);

    // Month Adjustments Log
    var monthAdjs = [];
    var ai;
    for (ai = 0; ai < store.adjustments.length; ai++) {
      if (store.adjustments[ai] && store.adjustments[ai].monthKey === selectedMonth) {
        monthAdjs.push(store.adjustments[ai]);
      }
    }
    if (monthAdjs.length) {
      card.appendChild(el('div', 'npr-sub', t('سجل البنود للشهر', 'Month Adjustments Log')));
      var logWrap = el('div', 'npr-table-wrap');
      var logTbl = document.createElement('table');
      var logThead = document.createElement('thead');
      var logHr = document.createElement('tr');
      var logHeaders = [
        t('الموظف', 'Employee'),
        t('النوع', 'Type'),
        t('المبلغ', 'Amount'),
        t('السبب', 'Reason')
      ];
      for (ai = 0; ai < logHeaders.length; ai++) logHr.appendChild(el('th', '', logHeaders[ai]));
      logThead.appendChild(logHr);
      logTbl.appendChild(logThead);

      var logTbody = document.createElement('tbody');
      for (ai = monthAdjs.length - 1; ai >= 0; ai--) {
        var row = document.createElement('tr');
        row.appendChild(el('td', '', displayEmpName(monthAdjs[ai].employee)));
        row.appendChild(el('td', '', adjTypeLabel(monthAdjs[ai].type)));
        row.appendChild(el('td', '', fmtPiasters(monthAdjs[ai].amountPiasters)));
        row.appendChild(el('td', '', monthAdjs[ai].reason));
        logTbody.appendChild(row);
      }
      logTbl.appendChild(logTbody);
      logWrap.appendChild(logTbl);
      card.appendChild(logWrap);
    }
  }

  function refreshCard() {
    var card = document.getElementById(CARD_ID);
    if (!card) return;
    renderCardContent(card);
  }

  function buildCard() {
    injectStyles();
    var card = el('section', 'nova-card');
    card.id = CARD_ID;
    renderCardContent(card);
    return card;
  }

  function isReportsPage() {
    if (document.body && document.body.dataset && document.body.dataset.activePage === 'reports') {
      return true;
    }
    return !!document.querySelector('.nova-tab.active[data-page="reports"],.nova-hostmark.active[data-page="reports"]');
  }

  function ensureMounted() {
    if (ensuring) return;
    var pageView = document.getElementById('novaPageView');
    if (!pageView || pageView.hidden || !isReportsPage()) return;
    if (document.getElementById(CARD_ID)) return;
    ensuring = true;
    try {
      pageView.appendChild(buildCard());
    } finally {
      ensuring = false;
    }
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
// app/610-supplier-notes.js
(function () {
  'use strict';

  var STORAGE_KEY = 'nova-rx-supplier-notes-v1';
  var LANG_KEY = 'nova-rx-language';
  var CARD_ID = 'novaSupplierNotes';
  var STYLE_ID = 'novaSupplierNotesStyle';
  var MAX_RECORDS = 500;
  var observer = null;
  var selectedSupplierFilter = '';

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
      idx = ar.indexOf(ch);
      if (idx !== -1) {
        out += String(idx);
      } else {
        idx = fa.indexOf(ch);
        if (idx !== -1) {
          out += String(idx);
        } else if (ch === '\u066b' || ch === ',') {
          out += '.';
        } else {
          out += ch;
        }
      }
    }
    return out;
  }

  function parseEgpToPiasters(val) {
    var s = trimStr(normalizeDigits(val));
    if (!s || !/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
    var parts = s.split('.');
    var egp = parseInt(parts[0], 10);
    var dec = parts.length > 1 ? (parts[1] + '00').slice(0, 2) : '00';
    var piasters = egp * 100 + parseInt(dec, 10);
    return piasters > 0 ? piasters : NaN;
  }

  function formatPiasters(piasters) {
    var n = Number(piasters) || 0;
    var neg = n < 0;
    var abs = Math.abs(Math.round(n));
    var egp = Math.floor(abs / 100);
    var rem = abs % 100;
    var remStr = rem < 10 ? '0' + String(rem) : String(rem);
    return (neg ? '-' : '') + String(egp) + '.' + remStr;
  }

  function formatMoney(piasters) {
    return formatPiasters(piasters) + ' ' + t('ج.م', 'EGP');
  }

  function formatDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return String(y) + '-' + (m < 10 ? '0' : '') + String(m) + '-' + (day < 10 ? '0' : '') + String(day);
  }

  function canWrite() {
    try {
      return !!(window.novaPerms && typeof window.novaPerms.require === 'function' && window.novaPerms.require('purchases.manage'));
    } catch (e) {
      return false;
    }
  }

  function currentUser() {
    try {
      if (window.novaAuth && typeof window.novaAuth.current === 'function') {
        var u = window.novaAuth.current();
        if (u && typeof u.name === 'string') return u.name;
      }
    } catch (e) {}
    return '';
  }

  function notify(msg, type) {
    try {
      if (typeof window.showToast === 'function') {
        window.showToast(msg, type || 'success');
      }
    } catch (e) {}
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
      var arr = Array.isArray(list) ? list : [];
      if (arr.length > MAX_RECORDS) {
        arr = arr.slice(arr.length - MAX_RECORDS);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
      return true;
    } catch (e) {
      return false;
    }
  }

  function cloneRecord(rec) {
    return {
      id: rec.id,
      supplier: rec.supplier,
      kind: rec.kind,
      amountPiasters: rec.amountPiasters,
      reference: rec.reference,
      reason: rec.reason,
      itemRef: rec.itemRef || '',
      at: rec.at,
      createdBy: rec.createdBy || '',
      status: rec.status || 'open',
      appliedInvoiceRef: rec.appliedInvoiceRef || '',
      appliedAt: rec.appliedAt || '',
      appliedBy: rec.appliedBy || '',
      voidedAt: rec.voidedAt || '',
      voidedBy: rec.voidedBy || '',
      voidReason: rec.voidReason || ''
    };
  }

  function isVoided(rec) {
    return !!(rec && (rec.voidedAt || rec.status === 'voided'));
  }

  function addNote(opts) {
    if (!canWrite()) return false;
    if (!opts || typeof opts !== 'object') return false;

    var supplier = trimStr(opts.supplier);
    var kind = opts.kind === 'credit' || opts.kind === 'debit' ? opts.kind : '';
    var amt = opts.amountPiasters;
    var reference = trimStr(opts.reference);
    var reason = trimStr(opts.reason);
    var itemRef = trimStr(opts.itemRef);

    if (!supplier || !kind || !reference || !reason) return false;
    if (typeof amt !== 'number' || !isFinite(amt) || amt <= 0 || Math.floor(amt) !== amt) {
      return false;
    }

    var at = trimStr(opts.at);
    if (!at || isNaN(Date.parse(at))) {
      at = new Date().toISOString();
    }

    var store = readStore();
    var supLow = supplier.toLowerCase();
    var refLow = reference.toLowerCase();
    var i, existing;
    for (i = 0; i < store.length; i++) {
      existing = store[i];
      if (!existing) continue;
      if (
        trimStr(existing.supplier).toLowerCase() === supLow &&
        trimStr(existing.reference).toLowerCase() === refLow
      ) {
        return false;
      }
    }

    var rec = {
      id: 'sn-' + String(Date.now()) + '-' + String(Math.floor(Math.random() * 100000)),
      supplier: supplier,
      kind: kind,
      amountPiasters: amt,
      reference: reference,
      reason: reason,
      itemRef: itemRef,
      at: at,
      createdBy: currentUser(),
      status: 'open',
      appliedInvoiceRef: '',
      appliedAt: '',
      appliedBy: '',
      voidedAt: '',
      voidedBy: '',
      voidReason: ''
    };

    store.push(rec);
    if (!writeStore(store)) return false;
    refreshCard();
    return cloneRecord(rec);
  }

  function listNotes(filter) {
    var store = readStore();
    var f = filter && typeof filter === 'object' ? filter : null;
    var fSupplier = f && f.supplier ? trimStr(f.supplier).toLowerCase() : '';
    var fKind = f && f.kind ? String(f.kind) : '';
    var fStatus = f && f.status ? String(f.status) : '';
    var out = [];
    var i, rec;

    for (i = 0; i < store.length; i++) {
      rec = store[i];
      if (!rec || typeof rec !== 'object') continue;
      if (fSupplier && trimStr(rec.supplier).toLowerCase() !== fSupplier) continue;
      if (fKind && rec.kind !== fKind) continue;
      if (fStatus) {
        var effStatus = isVoided(rec) ? 'voided' : (rec.status || 'open');
        if (effStatus !== fStatus) continue;
      }
      if (f && f.includeVoided === false && isVoided(rec)) continue;
      out.push(cloneRecord(rec));
    }
    return out;
  }

  function supplierBalance(supplier) {
    var target = trimStr(supplier).toLowerCase();
    if (!target) return 0;
    var store = readStore();
    var sum = 0;
    var i, rec, amt;
    for (i = 0; i < store.length; i++) {
      rec = store[i];
      if (!rec || isVoided(rec)) continue;
      if (trimStr(rec.supplier).toLowerCase() !== target) continue;
      amt = Number(rec.amountPiasters) || 0;
      if (rec.kind === 'debit') {
        sum += amt;
      } else if (rec.kind === 'credit') {
        sum -= amt;
      }
    }
    return sum;
  }

  function computeTotals() {
    var store = readStore();
    var creditTotal = 0;
    var debitTotal = 0;
    var pendingCount = 0;
    var i, rec, amt;
    for (i = 0; i < store.length; i++) {
      rec = store[i];
      if (!rec || isVoided(rec)) continue;
      amt = Number(rec.amountPiasters) || 0;
      if (rec.kind === 'credit') {
        creditTotal += amt;
      } else if (rec.kind === 'debit') {
        debitTotal += amt;
      }
      if ((rec.status || 'open') === 'open') {
        pendingCount += 1;
      }
    }
    return {
      creditTotal: creditTotal,
      debitTotal: debitTotal,
      net: debitTotal - creditTotal,
      pendingCount: pendingCount
    };
  }

  function applyNote(id, invoiceRef) {
    if (!canWrite()) return false;
    var noteId = trimStr(id);
    var inv = trimStr(invoiceRef);
    if (!noteId || !inv) return false;

    var store = readStore();
    var i, rec;
    for (i = 0; i < store.length; i++) {
      rec = store[i];
      if (rec && rec.id === noteId) {
        if (isVoided(rec) || rec.status === 'applied') return false;
        rec.status = 'applied';
        rec.appliedInvoiceRef = inv;
        rec.appliedAt = new Date().toISOString();
        rec.appliedBy = currentUser();
        if (!writeStore(store)) return false;
        refreshCard();
        return cloneRecord(rec);
      }
    }
    return false;
  }

  function voidNote(id, reason) {
    if (!canWrite()) return false;
    var noteId = trimStr(id);
    var why = trimStr(reason);
    if (!noteId || !why) return false;

    var store = readStore();
    var i, rec;
    for (i = 0; i < store.length; i++) {
      rec = store[i];
      if (rec && rec.id === noteId) {
        if (isVoided(rec)) return false;
        rec.voidedAt = new Date().toISOString();
        rec.voidedBy = currentUser();
        rec.voidReason = why;
        rec.status = 'voided';
        if (!writeStore(store)) return false;
        refreshCard();
        return cloneRecord(rec);
      }
    }
    return false;
  }

  window.novaSupplierNotes = {
    add: addNote,
    list: listNotes,
    balance: supplierBalance,
    totals: computeTotals,
    apply: applyNote,
    'void': voidNote
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
      '#novaSupplierNotes{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;overflow-x:hidden;}',
      '#novaSupplierNotes *{box-sizing:border-box;}',
      '#novaSupplierNotes h3,#novaSupplierNotes h4{margin:0 0 12px 0;color:#e6edf3;}',
      '#novaSupplierNotes h3{font-size:1.1rem;border-bottom:1px solid #343b44;padding-bottom:8px;}',
      '#novaSupplierNotes h4{font-size:0.95rem;margin-top:16px;color:#79c9eb;}',
      '.nsn-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px;}',
      '.nsn-stat{background:#0d1117;border:1px solid #343b44;border-radius:8px;padding:10px;}',
      '.nsn-stat-label{font-size:0.8rem;color:#9fb0c2;margin-bottom:4px;}',
      '.nsn-stat-val{font-size:1rem;font-weight:700;color:#e6edf3;}',
      '.nsn-stat-val.nsn-credit{color:#4ade80;}',
      '.nsn-stat-val.nsn-debit{color:#f87171;}',
      '.nsn-stat-val.nsn-accent{color:#79c9eb;}',
      '.nsn-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:10px 0 12px 0;}',
      '.nsn-field{min-width:0;}',
      '.nsn-field label{display:block;font-size:0.85rem;margin-bottom:4px;color:#9fb0c2;}',
      '.nsn-input,.nsn-select{width:100%;min-width:0;max-width:100%;min-height:44px;padding:8px 10px;background:#0d1117;border:1px solid #343b44;border-radius:8px;color:#e6edf3;font-size:0.95rem;}',
      '.nsn-input:focus,.nsn-select:focus{outline:none;border-color:#79c9eb;}',
      '.nsn-actions,.nsn-filter-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0;}',
      '.nsn-filter-row .nsn-select{flex:1 1 160px;}',
      '#novaSupplierNotes button{min-height:44px;}',
      '.nsn-status-msg{font-size:0.85rem;color:#79c9eb;min-height:20px;margin:6px 0;}',
      '.nsn-table-wrap{width:100%;overflow-x:auto;border:1px solid #343b44;border-radius:8px;margin-top:8px;}',
      '.nsn-table{width:100%;border-collapse:collapse;font-size:0.88rem;min-width:620px;}',
      '.nsn-table th,.nsn-table td{padding:8px 10px;border-bottom:1px solid #343b44;text-align:inherit;white-space:nowrap;}',
      '.nsn-table th{background:#1b2129;color:#79c9eb;font-weight:600;}',
      '.nsn-table tr:last-child td{border-bottom:0;}',
      '.nsn-row-void td{opacity:0.55;text-decoration:line-through;}',
      '.nsn-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:0.78rem;font-weight:600;border:1px solid #343b44;}',
      '.nsn-badge-credit{background:#132a1d;color:#4ade80;border-color:#23533a;}',
      '.nsn-badge-debit{background:#2c1619;color:#f87171;border-color:#5b272d;}',
      '.nsn-badge-open{background:#152430;color:#79c9eb;border-color:#26465c;}',
      '.nsn-badge-applied{background:#132a1d;color:#4ade80;border-color:#23533a;}',
      '.nsn-badge-void{background:#22272e;color:#9fb0c2;border-color:#343b44;}',
      '.nsn-row-actions{display:flex;gap:6px;flex-wrap:nowrap;}',
      '.nsn-row-actions button{min-height:44px;padding:6px 10px;font-size:0.82rem;}',
      '.nsn-empty{padding:12px;color:#9fb0c2;font-size:0.9rem;}',
      '.nsn-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:16px;z-index:9999;}',
      '.nsn-modal{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;width:100%;max-width:440px;color:#e6edf3;max-height:90vh;overflow-y:auto;}',
      '.nsn-modal h4{margin:0 0 10px 0;color:#79c9eb;font-size:1rem;}',
      '.nsn-modal p{margin:0 0 10px 0;font-size:0.9rem;color:#c9d1d9;}',
      '.nsn-modal-err{color:#f87171;font-size:0.85rem;min-height:18px;margin-top:6px;}',
      '@media print{body *{visibility:hidden;}#nsnPrintArea,#nsnPrintArea *{visibility:visible;}#nsnPrintArea{position:fixed;left:0;top:0;width:100%;background:#ffffff;color:#000000;padding:16px;}}'
    ].join('');
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function getUniqueSuppliers() {
    var store = readStore();
    var seen = {};
    var out = [];
    var i, sup, key;
    for (i = 0; i < store.length; i++) {
      sup = store[i] && trimStr(store[i].supplier);
      if (!sup) continue;
      key = sup.toLowerCase();
      if (!seen[key]) {
        seen[key] = true;
        out.push(sup);
      }
    }
    out.sort();
    return out;
  }

  function closeModal() {
    var existing = document.getElementById('nsnModalOverlay');
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }

  function openInputDialog(opts) {
    closeModal();
    var card = document.getElementById(CARD_ID);
    if (!card) return;

    var overlay = el('div', 'nsn-overlay');
    overlay.id = 'nsnModalOverlay';
    overlay.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    var modal = el('div', 'nsn-modal');
    modal.setAttribute('role', 'dialog');
    modal.appendChild(el('h4', '', opts.title));
    if (opts.message) {
      modal.appendChild(el('p', '', opts.message));
    }

    var inp = el('input', 'nsn-input');
    inp.id = 'nsnDialogInput';
    inp.type = 'text';
    inp.placeholder = opts.placeholder || '';
    modal.appendChild(inp);

    var errBox = el('div', 'nsn-modal-err', '');
    modal.appendChild(errBox);

    var btns = el('div', 'nsn-actions');
    var okBtn = el('button', 'btn btn-primary', opts.confirmLabel || t('تأكيد', 'Confirm'));
    okBtn.id = 'nsnDialogConfirm';
    okBtn.type = 'button';

    var cancelBtn = el('button', 'btn btn-secondary', t('رجوع', 'Cancel'));
    cancelBtn.id = 'nsnDialogCancel';
    cancelBtn.type = 'button';

    okBtn.addEventListener('click', function () {
      var val = trimStr(inp.value);
      if (!val) {
        errBox.textContent = opts.emptyError || t('هذا الحقل مطلوب.', 'This field is required.');
        return;
      }
      var ok = opts.onConfirm(val);
      if (ok) {
        closeModal();
      } else {
        errBox.textContent = opts.failError || t('تعذر تنفيذ العملية.', 'Operation failed.');
      }
    });

    cancelBtn.addEventListener('click', closeModal);
    btns.appendChild(okBtn);
    btns.appendChild(cancelBtn);
    modal.appendChild(btns);
    overlay.appendChild(modal);
    card.appendChild(overlay);
    inp.focus();
  }

  function openSupplierStatement(supplier) {
    closeModal();
    var card = document.getElementById(CARD_ID);
    if (!card) return;

    var notes = listNotes({ supplier: supplier, includeVoided: false });
    var bal = supplierBalance(supplier);
    var creditSum = 0;
    var debitSum = 0;
    var i;
    for (i = 0; i < notes.length; i++) {
      if (notes[i].kind === 'credit') creditSum += notes[i].amountPiasters;
      else if (notes[i].kind === 'debit') debitSum += notes[i].amountPiasters;
    }

    var overlay = el('div', 'nsn-overlay');
    overlay.id = 'nsnModalOverlay';
    overlay.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    var modal = el('div', 'nsn-modal');
    modal.id = 'nsnPrintArea';
    modal.appendChild(el('h4', '', t('كشف إشعارات المورد: ', 'Supplier Statement: ') + supplier));
    modal.appendChild(el('p', '', t('إجمالي الخصم: ', 'Credit Total: ') + formatMoney(creditSum) + ' | ' + t('إجمالي الإضافة: ', 'Debit Total: ') + formatMoney(debitSum)));
    modal.appendChild(el('p', '', t('صافي الرصيد: ', 'Net Balance: ') + formatMoney(bal)));

    var wrap = el('div', 'nsn-table-wrap');
    if (!notes.length) {
      wrap.appendChild(el('div', 'nsn-empty', t('لا توجد إشعارات فعالة لهذا المورد.', 'No active notes for this supplier.')));
    } else {
      var tbl = el('table', 'nsn-table');
      var thead = document.createElement('thead');
      var hr = document.createElement('tr');
      var headers = [t('التاريخ', 'Date'), t('النوع', 'Type'), t('المبلغ', 'Amount'), t('المرجع', 'Ref'), t('الحالة', 'Status')];
      for (i = 0; i < headers.length; i++) hr.appendChild(el('th', '', headers[i]));
      thead.appendChild(hr);
      tbl.appendChild(thead);
      var tbody = document.createElement('tbody');
      for (i = 0; i < notes.length; i++) {
        var r = notes[i];
        var tr = document.createElement('tr');
        tr.appendChild(el('td', '', formatDate(r.at)));
        tr.appendChild(el('td', '', r.kind === 'credit' ? t('إشعار خصم', 'Credit') : t('إشعار إضافة', 'Debit')));
        tr.appendChild(el('td', '', formatMoney(r.amountPiasters)));
        tr.appendChild(el('td', '', r.reference));
        tr.appendChild(el('td', '', r.status === 'applied' ? t('مطبّق', 'Applied') : t('مفتوح', 'Open')));
        tbody.appendChild(tr);
      }
      tbl.appendChild(tbody);
      wrap.appendChild(tbl);
    }
    modal.appendChild(wrap);

    var btns = el('div', 'nsn-actions');
    var printBtn = el('button', 'btn btn-primary', t('طباعة', 'Print'));
    printBtn.type = 'button';
    printBtn.addEventListener('click', function () {
      try {
        if (typeof window.print === 'function') window.print();
      } catch (e) {}
    });
    var closeBtn = el('button', 'btn btn-secondary', t('إغلاق', 'Close'));
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', closeModal);
    btns.appendChild(printBtn);
    btns.appendChild(closeBtn);
    modal.appendChild(btns);
    overlay.appendChild(modal);
    card.appendChild(overlay);
  }

  function refreshCard() {
    var summaryBox = document.getElementById('nsnSummary');
    var filterSel = document.getElementById('nsnSupplierFilter');
    var tableBox = document.getElementById('nsnTableWrap');
    if (!summaryBox || !filterSel || !tableBox) return;

    var totals = computeTotals();
    while (summaryBox.firstChild) summaryBox.removeChild(summaryBox.firstChild);

    function addStat(label, valText, extraCls) {
      var box = el('div', 'nsn-stat');
      box.appendChild(el('div', 'nsn-stat-label', label));
      box.appendChild(el('div', 'nsn-stat-val' + (extraCls ? ' ' + extraCls : ''), valText));
      summaryBox.appendChild(box);
    }

    addStat(t('إجمالي الخصم', 'Credit Total'), formatMoney(totals.creditTotal), 'nsn-credit');
    addStat(t('إجمالي الإضافة', 'Debit Total'), formatMoney(totals.debitTotal), 'nsn-debit');
    addStat(t('الصافي', 'Net Balance'), formatMoney(totals.net), 'nsn-accent');
    addStat(t('إشعارات مفتوحة', 'Open Notes'), String(totals.pendingCount), '');

    var suppliers = getUniqueSuppliers();
    while (filterSel.firstChild) filterSel.removeChild(filterSel.firstChild);
    var allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = t('كل الموردين', 'All Suppliers');
    filterSel.appendChild(allOpt);
    var i, opt;
    for (i = 0; i < suppliers.length; i++) {
      opt = document.createElement('option');
      opt.value = suppliers[i];
      opt.textContent = suppliers[i];
      filterSel.appendChild(opt);
    }
    filterSel.value = selectedSupplierFilter;
    if (filterSel.value !== selectedSupplierFilter) {
      selectedSupplierFilter = '';
      filterSel.value = '';
    }

    while (tableBox.firstChild) tableBox.removeChild(tableBox.firstChild);
    var rows = listNotes(selectedSupplierFilter ? { supplier: selectedSupplierFilter } : null);
    if (!rows.length) {
      tableBox.appendChild(el('div', 'nsn-empty', t('لا توجد إشعارات مسجلة.', 'No supplier notes recorded.')));
      return;
    }

    var writable = canWrite();
    var table = el('table', 'nsn-table');
    var thead = document.createElement('thead');
    var trHead = document.createElement('tr');
    var headers = [
      t('التاريخ', 'Date'),
      t('المورد', 'Supplier'),
      t('النوع', 'Type'),
      t('المبلغ', 'Amount'),
      t('المرجع', 'Reference'),
      t('السبب', 'Reason'),
      t('الحالة', 'Status'),
      t('إجراءات', 'Actions')
    ];
    for (i = 0; i < headers.length; i++) {
      trHead.appendChild(el('th', '', headers[i]));
    }
    thead.appendChild(trHead);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    var j, rec, tr, tdKind, tdStatus, tdActions, actWrap;
    for (j = rows.length - 1; j >= 0; j--) {
      rec = rows[j];
      tr = document.createElement('tr');
      if (isVoided(rec)) tr.className = 'nsn-row-void';

      tr.appendChild(el('td', '', formatDate(rec.at)));
      tr.appendChild(el('td', '', rec.supplier));

      tdKind = document.createElement('td');
      tdKind.appendChild(el(
        'span',
        'nsn-badge ' + (rec.kind === 'credit' ? 'nsn-badge-credit' : 'nsn-badge-debit'),
        rec.kind === 'credit' ? t('إشعار خصم', 'Credit') : t('إشعار إضافة', 'Debit')
      ));
      tr.appendChild(tdKind);

      tr.appendChild(el('td', '', formatMoney(rec.amountPiasters)));
      tr.appendChild(el('td', '', rec.reference));

      var reasonText = rec.reason;
      if (rec.itemRef) reasonText += ' (' + rec.itemRef + ')';
      if (isVoided(rec) && rec.voidReason) {
        reasonText += ' — ' + t('سبب الإلغاء: ', 'Void: ') + rec.voidReason;
      }
      tr.appendChild(el('td', '', reasonText));

      tdStatus = document.createElement('td');
      if (isVoided(rec)) {
        tdStatus.appendChild(el('span', 'nsn-badge nsn-badge-void', t('ملغى', 'Voided')));
      } else if (rec.status === 'applied') {
        tdStatus.appendChild(el(
          'span',
          'nsn-badge nsn-badge-applied',
          t('مطبّق', 'Applied') + (rec.appliedInvoiceRef ? ' #' + rec.appliedInvoiceRef : '')
        ));
      } else {
        tdStatus.appendChild(el('span', 'nsn-badge nsn-badge-open', t('مفتوح', 'Open')));
      }
      tr.appendChild(tdStatus);

      tdActions = document.createElement('td');
      actWrap = el('div', 'nsn-row-actions');
      if (!isVoided(rec) && writable) {
        if (rec.status === 'open') {
          (function (note) {
            var applyBtn = el('button', 'btn btn-secondary', t('طبّق على فاتورة', 'Apply to Invoice'));
            applyBtn.type = 'button';
            applyBtn.setAttribute('data-action', 'apply');
            applyBtn.setAttribute('data-id', note.id);
            applyBtn.addEventListener('click', function () {
              openInputDialog({
                title: t('تطبيق الإشعار على فاتورة', 'Apply Note to Invoice'),
                message: note.supplier + ' — ' + note.reference,
                placeholder: t('رقم الفاتورة', 'Invoice reference'),
                confirmLabel: t('تطبيق', 'Apply'),
                emptyError: t('أدخل رقم الفاتورة.', 'Enter invoice reference.'),
                failError: t('تعذر تطبيق الإشعار.', 'Failed to apply note.'),
                onConfirm: function (invRef) {
                  var res = applyNote(note.id, invRef);
                  if (res) {
                    notify(t('تم تطبيق الإشعار على الفاتورة.', 'Note applied to invoice.'), 'success');
                    return true;
                  }
                  notify(t('تعذر تطبيق الإشعار.', 'Failed to apply note.'), 'error');
                  return false;
                }
              });
            });
            actWrap.appendChild(applyBtn);
          })(rec);
        }
        (function (note) {
          var voidBtn = el('button', 'btn btn-secondary', t('إلغاء', 'Void'));
          voidBtn.type = 'button';
          voidBtn.setAttribute('data-action', 'void');
          voidBtn.setAttribute('data-id', note.id);
          voidBtn.addEventListener('click', function () {
            openInputDialog({
              title: t('إلغاء الإشعار', 'Void Note'),
              message: note.supplier + ' — ' + note.reference,
              placeholder: t('سبب الإلغاء', 'Reason for voiding'),
              confirmLabel: t('تأكيد الإلغاء', 'Confirm Void'),
              emptyError: t('سبب الإلغاء مطلوب.', 'Void reason is required.'),
              failError: t('تعذر إلغاء الإشعار.', 'Failed to void note.'),
              onConfirm: function (why) {
                var res = voidNote(note.id, why);
                if (res) {
                  notify(t('تم إلغاء الإشعار.', 'Note voided.'), 'success');
                  return true;
                }
                notify(t('تعذر إلغاء الإشعار.', 'Failed to void note.'), 'error');
                return false;
              }
            });
          });
          actWrap.appendChild(voidBtn);
        })(rec);
      } else {
        actWrap.appendChild(el('span', '', '—'));
      }
      tdActions.appendChild(actWrap);
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    tableBox.appendChild(table);
  }

  function buildCard() {
    injectStyles();
    selectedSupplierFilter = '';
    var writable = canWrite();
    var card = el('section', 'nova-card');
    card.id = CARD_ID;
    card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    card.appendChild(el('h3', '', t('إشعارات الخصم والإضافة للموردين', 'Supplier Debit & Credit Notes')));

    var summaryBox = el('div', 'nsn-summary');
    summaryBox.id = 'nsnSummary';
    card.appendChild(summaryBox);

    card.appendChild(el('h4', '', t('إضافة إشعار جديد', 'Add New Note')));

    var form = el('div', 'nsn-form');

    function makeField(labelText, id, placeholder) {
      var wrap = el('div', 'nsn-field');
      var lbl = el('label', '', labelText);
      lbl.setAttribute('for', id);
      var inp = el('input', 'nsn-input');
      inp.id = id;
      inp.type = 'text';
      if (placeholder) inp.placeholder = placeholder;
      if (!writable) inp.disabled = true;
      wrap.appendChild(lbl);
      wrap.appendChild(inp);
      form.appendChild(wrap);
      return inp;
    }

    var supInput = makeField(t('المورد', 'Supplier'), 'nsnSupplierInput', t('اسم المورد', 'Supplier name'));

    var kindWrap = el('div', 'nsn-field');
    var kindLbl = el('label', '', t('النوع', 'Type'));
    kindLbl.setAttribute('for', 'nsnKindSelect');
    var kindSel = el('select', 'nsn-select');
    kindSel.id = 'nsnKindSelect';
    if (!writable) kindSel.disabled = true;
    var optCredit = document.createElement('option');
    optCredit.value = 'credit';
    optCredit.textContent = t('إشعار خصم', 'Credit Note');
    var optDebit = document.createElement('option');
    optDebit.value = 'debit';
    optDebit.textContent = t('إشعار إضافة', 'Debit Note');
    kindSel.appendChild(optCredit);
    kindSel.appendChild(optDebit);
    kindWrap.appendChild(kindLbl);
    kindWrap.appendChild(kindSel);
    form.appendChild(kindWrap);

    var amtInput = makeField(t('المبلغ', 'Amount'), 'nsnAmountInput', t('١٥٠٫٠٠', '150.00'));
    amtInput.setAttribute('inputmode', 'decimal');

    var refInput = makeField(t('رقم المرجع', 'Reference'), 'nsnRefInput', t('رقم إشعار المورد', 'Supplier note number'));
    var reasonInput = makeField(t('السبب', 'Reason'), 'nsnReasonInput', t('مرتجع أو فرق سعر أو مسحوبات', 'Returns, price difference, withdrawn stock'));
    var itemInput = makeField(t('مرجع الصنف', 'Item Ref'), 'nsnItemRefInput', t('اختياري', 'Optional'));

    card.appendChild(form);

    var formActions = el('div', 'nsn-actions');
    var addBtn = el('button', 'btn btn-primary', t('إضافة إشعار', 'Add Note'));
    addBtn.id = 'nsnAddBtn';
    addBtn.type = 'button';
    if (!writable) addBtn.disabled = true;
    formActions.appendChild(addBtn);
    card.appendChild(formActions);

    var statusMsg = el('div', 'nsn-status-msg', writable ? '' : t('وضع العرض فقط.', 'Read-only mode.'));
    statusMsg.id = 'nsnStatusMsg';
    card.appendChild(statusMsg);

    addBtn.addEventListener('click', function () {
      var piasters = parseEgpToPiasters(amtInput.value);
      if (isNaN(piasters) || piasters <= 0) {
        statusMsg.textContent = t('أدخل مبلغًا صحيحًا أكبر من صفر.', 'Enter a valid amount greater than zero.');
        notify(statusMsg.textContent, 'error');
        return;
      }
      var res = addNote({
        supplier: supInput.value,
        kind: kindSel.value,
        amountPiasters: piasters,
        reference: refInput.value,
        reason: reasonInput.value,
        itemRef: itemInput.value
      });
      if (!res) {
        statusMsg.textContent = t('تعذر الإضافة: تحقق من البيانات أو تكرار المرجع أو الصلاحية.', 'Failed to add: check fields, duplicate reference, or permission.');
        notify(statusMsg.textContent, 'error');
        return;
      }
      amtInput.value = '';
      refInput.value = '';
      reasonInput.value = '';
      itemInput.value = '';
      statusMsg.textContent = t('تم تسجيل الإشعار بنجاح.', 'Note recorded successfully.');
      notify(statusMsg.textContent, 'success');
    });

    card.appendChild(el('h4', '', t('سجل الإشعارات', 'Notes Ledger')));

    var filterRow = el('div', 'nsn-filter-row');
    var filterSel = el('select', 'nsn-select');
    filterSel.id = 'nsnSupplierFilter';
    filterSel.setAttribute('aria-label', t('تصفية حسب المورد', 'Filter by supplier'));
    filterSel.addEventListener('change', function () {
      selectedSupplierFilter = filterSel.value;
      refreshCard();
    });

    var printBtn = el('button', 'btn btn-secondary', t('طباعة كشف المورد', 'Print Supplier Statement'));
    printBtn.id = 'nsnPrintBtn';
    printBtn.type = 'button';
    printBtn.addEventListener('click', function () {
      var sup = filterSel.value;
      if (!sup) {
        statusMsg.textContent = t('اختر موردًا من التصفية أولًا.', 'Select a supplier from the filter first.');
        notify(statusMsg.textContent, 'error');
        return;
      }
      openSupplierStatement(sup);
    });

    filterRow.appendChild(filterSel);
    filterRow.appendChild(printBtn);
    card.appendChild(filterRow);

    var tableWrap = el('div', 'nsn-table-wrap');
    tableWrap.id = 'nsnTableWrap';
    card.appendChild(tableWrap);

    return card;
  }

  function isReportsPage() {
    if (document.body && document.body.dataset && document.body.dataset.activePage === 'reports') {
      return true;
    }
    return !!document.querySelector('.nova-tab.active[data-page="reports"],.nova-hostmark.active[data-page="reports"]');
  }

  function ensureMounted() {
    var pageView = document.getElementById('novaPageView');
    if (!pageView || pageView.hidden || !isReportsPage()) return;
    if (document.getElementById(CARD_ID)) return;
    pageView.appendChild(buildCard());
    refreshCard();
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
// app/612-internal-barcodes.js
(function () {
  'use strict';

  var STORAGE_KEY = 'nova-rx-internal-barcodes-v1';
  var LANG_KEY = 'nova-rx-language';
  var CARD_ID = 'novaInternalBarcodes';
  var STYLE_ID = 'novaInternalBarcodesStyle';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var observer = null;
  var mounting = false;
  var selectedKey = '';
  var currentCode = '';

  var L_CODES = [
    '0001101', '0011001', '0010011', '0111101', '0100011',
    '0110001', '0101111', '0111011', '0110111', '0001011'
  ];
  var G_CODES = [
    '0100111', '0110011', '0011011', '0100001', '0011101',
    '0111001', '0000101', '0010001', '0001001', '0010111'
  ];
  var R_CODES = [
    '1110010', '1100110', '1101100', '1000010', '1011100',
    '1001110', '1010000', '1000100', '1001000', '1110100'
  ];
  var PARITY_PATTERNS = [
    'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
    'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'
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

  function toArabicDigits(str) {
    var s = String(str == null ? '' : str);
    var ar = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669';
    var out = '';
    var i, code;
    for (i = 0; i < s.length; i++) {
      code = s.charCodeAt(i);
      if (code >= 48 && code <= 57) {
        out += ar.charAt(code - 48);
      } else {
        out += s.charAt(i);
      }
    }
    return out;
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

  function canEdit() {
    if (!window.novaPerms || typeof window.novaPerms.require !== 'function') {
      return false;
    }
    try {
      return !!window.novaPerms.require('prices.edit');
    } catch (e) {
      return false;
    }
  }

  function readStore() {
    var empty = { counter: 0, items: [] };
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return empty;
      var parsed = JSON.parse(raw);
      var items = [];
      var counter = 0;
      var i, rec;
      if (Array.isArray(parsed)) {
        items = parsed;
      } else if (parsed && typeof parsed === 'object') {
        items = Array.isArray(parsed.items) ? parsed.items : [];
        if (typeof parsed.counter === 'number' && parsed.counter > 0 && isFinite(parsed.counter)) {
          counter = Math.floor(parsed.counter);
        }
      } else {
        return empty;
      }
      for (i = 0; i < items.length; i++) {
        rec = items[i];
        if (rec && typeof rec.seq === 'number' && rec.seq > counter && isFinite(rec.seq)) {
          counter = Math.floor(rec.seq);
        }
      }
      return { counter: counter, items: items };
    } catch (e) {
      return empty;
    }
  }

  function writeStore(store) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        counter: store.counter,
        items: store.items
      }));
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
      return trimStr(window.novaStock.keyOf(product));
    }
    return trimStr(product.barcode || product.id || product.name || '');
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
      if (!query || (p.name && p.name.toLowerCase().indexOf(query) !== -1) || (p.barcode && String(p.barcode).indexOf(query) !== -1)) {
        out.push(p);
      }
    }
    return out;
  }

  function computeCheckDigit(code12) {
    var sum = 0;
    var i, d;
    for (i = 0; i < 12; i++) {
      d = code12.charCodeAt(i) - 48;
      sum += (i % 2 === 0) ? d : d * 3;
    }
    return (10 - (sum % 10)) % 10;
  }

  function checkCode(code) {
    var s = trimStr(normalizeDigits(code));
    if (!/^\d{13}$/.test(s)) return false;
    var expected = computeCheckDigit(s.slice(0, 12));
    return (s.charCodeAt(12) - 48) === expected;
  }

  function pad9(num) {
    var s = String(num);
    while (s.length < 9) s = '0' + s;
    return s;
  }

  function buildInternalCode(seq) {
    var base12 = '299' + pad9(seq);
    return base12 + String(computeCheckDigit(base12));
  }

  function encodeEan13Bits(code) {
    var s = trimStr(normalizeDigits(code));
    if (!/^\d{13}$/.test(s)) return '';
    var first = s.charCodeAt(0) - 48;
    var pattern = PARITY_PATTERNS[first];
    var bits = '101';
    var i, d;
    for (i = 1; i <= 6; i++) {
      d = s.charCodeAt(i) - 48;
      bits += pattern.charAt(i - 1) === 'G' ? G_CODES[d] : L_CODES[d];
    }
    bits += '01010';
    for (i = 7; i <= 12; i++) {
      d = s.charCodeAt(i) - 48;
      bits += R_CODES[d];
    }
    bits += '101';
    return bits;
  }

  function createBarcodeSvg(code) {
    var bits = encodeEan13Bits(code);
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('viewBox', '0 0 95 40');
    svg.setAttribute('width', '190');
    svg.setAttribute('height', '64');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', code);
    svg.setAttribute('data-modules', '95');

    var bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', '0');
    bg.setAttribute('y', '0');
    bg.setAttribute('width', '95');
    bg.setAttribute('height', '40');
    bg.setAttribute('fill', '#ffffff');
    svg.appendChild(bg);

    var i = 0;
    var start, len, rect, isGuard;
    while (i < bits.length) {
      if (bits.charAt(i) === '1') {
        start = i;
        while (i < bits.length && bits.charAt(i) === '1') i++;
        len = i - start;
        isGuard = (start < 3) || (start >= 45 && start < 50) || (start >= 92);
        rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', String(start));
        rect.setAttribute('y', '2');
        rect.setAttribute('width', String(len));
        rect.setAttribute('height', isGuard ? '36' : '32');
        rect.setAttribute('fill', '#000000');
        svg.appendChild(rect);
      } else {
        i++;
      }
    }
    return svg;
  }

  function getCode(itemKey) {
    var k = trimStr(itemKey);
    if (!k) return null;
    var items = readStore().items;
    var i;
    for (i = 0; i < items.length; i++) {
      if (items[i] && items[i].itemKey === k) return items[i].code;
    }
    return null;
  }

  function findByCode(code) {
    var s = trimStr(normalizeDigits(code));
    if (!s) return null;
    var items = readStore().items;
    var i;
    for (i = 0; i < items.length; i++) {
      if (items[i] && items[i].code === s) return items[i].itemKey;
    }
    return null;
  }

  function listAssigned() {
    var items = readStore().items;
    var out = [];
    var i, rec, prod;
    for (i = 0; i < items.length; i++) {
      rec = items[i];
      if (!rec || !rec.itemKey || !rec.code) continue;
      prod = findProductByKey(rec.itemKey);
      out.push({
        itemKey: rec.itemKey,
        code: rec.code,
        seq: rec.seq,
        name: prod && prod.name ? prod.name : (rec.name || rec.itemKey),
        price: prod && prod.price !== undefined ? prod.price : null,
        at: rec.at || '',
        by: rec.by || ''
      });
    }
    return out;
  }

  function codeInUse(items, code) {
    var i;
    for (i = 0; i < items.length; i++) {
      if (items[i] && items[i].code === code) return true;
    }
    return false;
  }

  function assignCode(itemKey) {
    if (!canEdit()) {
      toast(t('لا تملك صلاحية تعديل الأصناف.', 'No permission to edit products.'), 'error');
      return false;
    }
    var k = trimStr(itemKey);
    if (!k) return false;

    var prod = findProductByKey(k);
    if (prod && prod.barcode && trimStr(prod.barcode) !== '') {
      toast(t('الصنف ليه باركود', 'Item already has a barcode'), 'error');
      return false;
    }

    var store = readStore();
    var i;
    for (i = 0; i < store.items.length; i++) {
      if (store.items[i] && store.items[i].itemKey === k) {
        return store.items[i].code;
      }
    }

    var nextSeq = store.counter + 1;
    var code = buildInternalCode(nextSeq);
    while (codeInUse(store.items, code)) {
      nextSeq += 1;
      code = buildInternalCode(nextSeq);
    }

    store.counter = nextSeq;
    store.items.push({
      itemKey: k,
      code: code,
      seq: nextSeq,
      name: prod && prod.name ? String(prod.name) : k,
      at: new Date().toISOString(),
      by: currentUserName()
    });
    if (!writeStore(store)) {
      toast(t('تعذر حفظ الباركود الداخلي.', 'Failed to save internal barcode.'), 'error');
      return false;
    }
    refreshList();
    return code;
  }

  function buildLabelsFragment(itemKeys, size) {
    var keys = Array.isArray(itemKeys) ? itemKeys : (itemKeys ? [itemKeys] : []);
    var isSmall = size === 'small';
    var wMm = isSmall ? '38mm' : '50mm';
    var hMm = isSmall ? '25mm' : '30mm';
    var wrap = document.createElement('div');
    wrap.className = 'nib-print-sheet';
    wrap.setAttribute('data-size', isSmall ? 'small' : 'medium');

    var i, k, code, prod, card, nameEl, priceEl, priceStr, svgWrap, digitsEl;
    for (i = 0; i < keys.length; i++) {
      k = trimStr(keys[i]);
      code = getCode(k);
      if (!code) continue;
      prod = findProductByKey(k);

      card = document.createElement('div');
      card.className = 'nib-label';
      card.style.width = wMm;
      card.style.height = hMm;
      card.style.boxSizing = 'border-box';
      card.style.padding = '2mm';
      card.style.border = '1px solid #cccccc';
      card.style.display = 'inline-flex';
      card.style.flexDirection = 'column';
      card.style.justifyContent = 'space-between';
      card.style.alignItems = 'center';
      card.style.background = '#ffffff';
      card.style.color = '#000000';
      card.style.margin = '1mm';
      card.style.pageBreakInside = 'avoid';

      nameEl = document.createElement('div');
      nameEl.className = 'nib-label-name';
      nameEl.style.fontSize = isSmall ? '8pt' : '9pt';
      nameEl.style.fontWeight = '700';
      nameEl.style.textAlign = 'center';
      nameEl.style.maxWidth = '100%';
      nameEl.style.overflow = 'hidden';
      nameEl.style.whiteSpace = 'nowrap';
      nameEl.textContent = prod && prod.name ? String(prod.name) : k;
      card.appendChild(nameEl);

      if (prod && prod.price !== undefined && prod.price !== null && prod.price !== '') {
        priceEl = document.createElement('div');
        priceEl.className = 'nib-label-price';
        priceEl.style.fontSize = isSmall ? '7.5pt' : '8.5pt';
        priceStr = isEn() ? String(prod.price) : toArabicDigits(String(prod.price));
        priceEl.textContent = priceStr + ' ' + t('ج.م', 'EGP');
        card.appendChild(priceEl);
      }

      svgWrap = document.createElement('div');
      svgWrap.className = 'nib-label-svg';
      svgWrap.style.width = '100%';
      svgWrap.style.display = 'flex';
      svgWrap.style.justifyContent = 'center';
      svgWrap.appendChild(createBarcodeSvg(code));
      card.appendChild(svgWrap);

      digitsEl = document.createElement('div');
      digitsEl.className = 'nib-label-digits';
      digitsEl.style.fontSize = isSmall ? '7.5pt' : '8.5pt';
      digitsEl.style.letterSpacing = '1px';
      digitsEl.style.fontFamily = 'monospace';
      digitsEl.textContent = code;
      card.appendChild(digitsEl);

      wrap.appendChild(card);
    }
    return wrap;
  }

  function renderHtml(itemKeys, size) {
    var wrap = buildLabelsFragment(itemKeys, size);
    return wrap.innerHTML;
  }

  function printLabels(itemKeys, size) {
    var frag = buildLabelsFragment(itemKeys, size);
    if (!frag.childNodes.length) {
      toast(t('لا يوجد باركود للطباعة.', 'No barcode to print.'), 'error');
      return false;
    }
    var iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
    if (!doc) {
      document.body.removeChild(iframe);
      return false;
    }
    doc.open();
    doc.close();
    var style = doc.createElement('style');
    style.textContent = 'body{margin:0;padding:4mm;font-family:sans-serif;background:#fff;color:#000;}svg{max-width:100%;height:auto;}';
    if (doc.head) doc.head.appendChild(style);
    if (doc.body) doc.body.appendChild(doc.importNode(frag, true));

    var cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }

    try {
      if (iframe.contentWindow) {
        iframe.contentWindow.onafterprint = cleanup;
        if (typeof iframe.contentWindow.print === 'function') {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        }
      }
    } catch (e) {}

    setTimeout(cleanup, 1500);
    return true;
  }

  window.novaInternalBarcodes = {
    assign: assignCode,
    get: getCode,
    findByCode: findByCode,
    list: listAssigned,
    html: renderHtml,
    check: checkCode
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
      '#novaInternalBarcodes{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;overflow:hidden;}',
      '#novaInternalBarcodes *{box-sizing:border-box;}',
      '#novaInternalBarcodes h3,#novaInternalBarcodes h4{margin:0 0 12px 0;color:#e6edf3;}',
      '#novaInternalBarcodes h3{font-size:1.1rem;border-bottom:1px solid #343b44;padding-bottom:8px;}',
      '#novaInternalBarcodes h4{font-size:0.95rem;margin-top:16px;color:#79c9eb;}',
      '.nib-search-wrap{position:relative;margin-bottom:10px;}',
      '.nib-input,.nib-select{width:100%;min-height:44px;padding:8px 12px;background:#0d1117;border:1px solid #343b44;border-radius:8px;color:#e6edf3;font-size:0.95rem;}',
      '.nib-input:focus,.nib-select:focus{outline:none;border-color:#79c9eb;}',
      '.nib-results{margin-top:6px;border:1px solid #343b44;border-radius:8px;background:#0d1117;max-height:220px;overflow-y:auto;}',
      '.nib-result-btn{display:block;width:100%;min-height:44px;text-align:inherit;padding:8px 12px;background:transparent;border:0;border-bottom:1px solid #343b44;color:#e6edf3;cursor:pointer;overflow-wrap:anywhere;}',
      '.nib-result-btn:last-child{border-bottom:0;}',
      '.nib-result-btn:hover{background:#1c232b;}',
      '.nib-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px;}',
      '.nib-controls button{min-height:44px;}',
      '.nib-size-wrap{min-width:150px;flex:1 1 150px;}',
      '.nib-status{font-size:0.85rem;color:#79c9eb;min-height:20px;margin-top:8px;overflow-wrap:anywhere;}',
      '.nib-preview{margin-top:12px;padding:12px;background:#0d1117;border:1px solid #343b44;border-radius:8px;display:flex;flex-direction:column;align-items:center;gap:8px;}',
      '.nib-preview svg{max-width:100%;height:auto;}',
      '.nib-preview-code{font-family:monospace;font-size:1rem;letter-spacing:2px;color:#e6edf3;}',
      '.nib-table-wrap{width:100%;overflow-x:auto;border:1px solid #343b44;border-radius:8px;margin-top:8px;}',
      '.nib-table{width:100%;border-collapse:collapse;font-size:0.9rem;min-width:300px;}',
      '.nib-table th,.nib-table td{padding:8px 10px;border-bottom:1px solid #343b44;text-align:inherit;white-space:nowrap;}',
      '.nib-table th{background:#1b2129;color:#79c9eb;font-weight:600;}',
      '.nib-table tr:last-child td{border-bottom:0;}',
      '.nib-row-btn{min-height:44px;padding:6px 12px;}',
      '.nib-empty{padding:12px;color:#9fb0c2;font-size:0.9rem;}'
    ].join('');
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function renderPreview(code) {
    var box = document.getElementById('nibPreviewBox');
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    if (!code) {
      box.style.display = 'none';
      return;
    }
    box.style.display = 'flex';
    box.appendChild(createBarcodeSvg(code));
    box.appendChild(el('div', 'nib-preview-code', code));
  }

  function refreshList() {
    var wrap = document.getElementById('nibListWrap');
    if (!wrap) return;
    while (wrap.firstChild) wrap.removeChild(wrap.firstChild);

    var items = listAssigned();
    var box = el('div', 'nib-table-wrap');
    if (!items.length) {
      box.appendChild(el('div', 'nib-empty', t('لا توجد أصناف بباركود داخلي بعد.', 'No items with internal barcodes yet.')));
      wrap.appendChild(box);
      return;
    }

    var table = el('table', 'nib-table');
    var thead = document.createElement('thead');
    var trH = document.createElement('tr');
    trH.appendChild(el('th', '', t('الصنف', 'Item')));
    trH.appendChild(el('th', '', t('الباركود الداخلي', 'Internal Barcode')));
    trH.appendChild(el('th', '', t('إجراء', 'Action')));
    thead.appendChild(trH);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    var i;
    for (i = items.length - 1; i >= 0; i--) {
      (function (item) {
        var tr = document.createElement('tr');
        tr.appendChild(el('td', '', item.name));
        tr.appendChild(el('td', '', item.code));
        var tdAct = document.createElement('td');
        var btn = el('button', 'btn btn-secondary nib-row-btn', t('اطبع', 'Print'));
        btn.type = 'button';
        btn.addEventListener('click', function () {
          var sel = document.getElementById('nibSizeSelect');
          printLabels([item.itemKey], sel ? sel.value : 'medium');
        });
        tdAct.appendChild(btn);
        tr.appendChild(tdAct);
        tbody.appendChild(tr);
      })(items[i]);
    }
    table.appendChild(tbody);
    box.appendChild(table);
    wrap.appendChild(box);
  }

  function buildCard() {
    injectStyles();
    selectedKey = '';
    currentCode = '';
    var editable = canEdit();
    var card = el('section', 'nova-card');
    card.id = CARD_ID;
    card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    card.appendChild(el('h3', '', t('طباعة باركود لصنف من غير باركود', 'Internal Item Barcodes')));

    var searchWrap = el('div', 'nib-search-wrap');
    var searchInput = el('input', 'nib-input');
    searchInput.type = 'search';
    searchInput.placeholder = t('ابحث عن صنف بالاسم...', 'Search item by name...');
    var resultsBox = el('div', 'nib-results');
    resultsBox.style.display = 'none';
    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(resultsBox);
    card.appendChild(searchWrap);

    var selectedTitle = el('div', 'nib-status', '');
    card.appendChild(selectedTitle);

    var controls = el('div', 'nib-controls');
    var sizeWrap = el('div', 'nib-size-wrap');
    var sizeSelect = el('select', 'nib-select');
    sizeSelect.id = 'nibSizeSelect';
    var optSmall = el('option', '', t('صغير ٣٨×٢٥', 'Small 38x25'));
    optSmall.value = 'small';
    var optMed = el('option', '', t('متوسط ٥٠×٣٠', 'Medium 50x30'));
    optMed.value = 'medium';
    optMed.selected = true;
    sizeSelect.appendChild(optSmall);
    sizeSelect.appendChild(optMed);
    sizeWrap.appendChild(sizeSelect);

    var genBtn = el('button', 'btn btn-primary', t('ولّد باركود', 'Generate Barcode'));
    genBtn.type = 'button';
    if (!editable) genBtn.disabled = true;

    var printBtn = el('button', 'btn btn-secondary', t('اطبع', 'Print'));
    printBtn.type = 'button';

    controls.appendChild(sizeWrap);
    controls.appendChild(genBtn);
    controls.appendChild(printBtn);
    card.appendChild(controls);

    var statusMsg = el('div', 'nib-status', editable ? '' : t('وضع العرض فقط.', 'Read-only mode.'));
    card.appendChild(statusMsg);

    var previewBox = el('div', 'nib-preview');
    previewBox.id = 'nibPreviewBox';
    previewBox.style.display = 'none';
    card.appendChild(previewBox);

    card.appendChild(el('h4', '', t('الأصناف المخصّص لها باركود', 'Assigned Barcodes')));
    var listWrap = el('div', '');
    listWrap.id = 'nibListWrap';
    card.appendChild(listWrap);

    function selectProduct(prod) {
      selectedKey = keyOf(prod);
      selectedTitle.textContent = prod.name || selectedKey;
      resultsBox.style.display = 'none';
      currentCode = getCode(selectedKey) || '';
      renderPreview(currentCode);
      statusMsg.textContent = currentCode ? t('الباركود الداخلي جاهز.', 'Internal barcode ready.') : '';
    }

    searchInput.addEventListener('input', function () {
      var q = trimStr(searchInput.value);
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
          btn = el('button', 'nib-result-btn', p.name);
          btn.type = 'button';
          btn.addEventListener('click', function () {
            selectProduct(p);
          });
          resultsBox.appendChild(btn);
        })(hits[i]);
      }
      resultsBox.style.display = 'block';
    });

    genBtn.addEventListener('click', function () {
      if (!selectedKey) {
        statusMsg.textContent = t('اختر صنفًا أولًا.', 'Select an item first.');
        return;
      }
      var prod = findProductByKey(selectedKey);
      if (prod && prod.barcode && trimStr(prod.barcode) !== '') {
        statusMsg.textContent = t('الصنف ليه باركود', 'Item already has a barcode');
        toast(statusMsg.textContent, 'error');
        return;
      }
      var code = assignCode(selectedKey);
      if (!code) {
        statusMsg.textContent = t('تعذر توليد الباركود.', 'Failed to generate barcode.');
        return;
      }
      currentCode = code;
      renderPreview(code);
      statusMsg.textContent = t('تم توليد الباركود الداخلي.', 'Internal barcode generated.');
    });

    printBtn.addEventListener('click', function () {
      if (!selectedKey || !getCode(selectedKey)) {
        statusMsg.textContent = t('ولّد باركود للصنف أولًا.', 'Generate a barcode for the item first.');
        return;
      }
      printLabels([selectedKey], sizeSelect.value);
    });

    return card;
  }

  function isProductsPage() {
    if (document.body && document.body.dataset && document.body.dataset.activePage === 'products') {
      return true;
    }
    return !!document.querySelector('.nova-tab.active[data-page="products"],.nova-hostmark.active[data-page="products"]');
  }

  function ensureMounted() {
    if (mounting) return;
    var pageView = document.getElementById('novaPageView');
    if (!pageView || pageView.hidden || !isProductsPage()) return;
    if (document.getElementById(CARD_ID)) return;
    mounting = true;
    try {
      pageView.appendChild(buildCard());
      refreshList();
    } finally {
      mounting = false;
    }
  }

  function initObserver() {
    var pageView = document.getElementById('novaPageView');
    if (!pageView || observer) return;
    observer = new MutationObserver(function () {
      if (!mounting && !document.getElementById(CARD_ID) && isProductsPage()) {
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
// app/614-official-prices.js
(function () {
  'use strict';

  var STORAGE_KEY = 'nova-rx-official-prices-v1';
  var LANG_KEY = 'nova-rx-language';
  var CARD_ID = 'novaOfficialPrices';
  var STYLE_ID = 'novaOfficialPricesStyle';
  var observer = null;
  var lastParsedRows = [];
  var lastCompare = null;
  var lastErrors = [];

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

  function trim(s) {
    return String(s == null ? '' : s).replace(/^\s+|\s+$/g, '');
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
        if (idx !== -1) {
          out += String(idx);
        } else if (ch === '\u066b') {
          out += '.';
        } else {
          out += ch;
        }
      }
    }
    return out;
  }

  function toDisplayDigits(val) {
    var s = String(val == null ? '' : val);
    if (isEn()) return s;
    var ar = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669';
    var out = '';
    var i, ch, code;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      code = ch.charCodeAt(0);
      if (code >= 48 && code <= 57) {
        out += ar.charAt(code - 48);
      } else if (ch === '.') {
        out += '\u066b';
      } else {
        out += ch;
      }
    }
    return out;
  }

  function normalizeName(str) {
    return trim(str)
      .toLowerCase()
      .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
      .replace(/[\u0622\u0623\u0625]/g, '\u0627')
      .replace(/\u0649/g, '\u064a')
      .replace(/\u0629/g, '\u0647')
      .replace(/\s+/g, ' ');
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

  function canEditPrice() {
    if (!window.novaPerms || typeof window.novaPerms.require !== 'function') {
      return false;
    }
    try {
      return !!window.novaPerms.require('prices.edit');
    } catch (e) {
      return false;
    }
  }

  function getPriceSetter() {
    if (window.novaItemCard && typeof window.novaItemCard.setPrice === 'function') {
      return window.novaItemCard.setPrice;
    }
    return null;
  }

  function readStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { lastImport: null, history: [] };
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return { lastImport: null, history: [] };
      return {
        lastImport: parsed.lastImport && typeof parsed.lastImport === 'object' ? parsed.lastImport : null,
        history: Array.isArray(parsed.history) ? parsed.history : []
      };
    } catch (e) {
      return { lastImport: null, history: [] };
    }
  }

  function writeStore(data) {
    try {
      var hist = Array.isArray(data.history) ? data.history : [];
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        lastImport: data.lastImport || null,
        history: hist
      }));
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

  function fmtMoney(baisa) {
    var n = Number(baisa) || 0;
    return toDisplayDigits((n / 100).toFixed(2));
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function fmtLocalTime(iso) {
    if (!iso) return '\u2014';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '\u2014';
    var s = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    return toDisplayDigits(s);
  }

  function splitLine(line, delim) {
    var out = [];
    var cur = '';
    var inQuotes = false;
    var i, ch;
    for (i = 0; i < line.length; i++) {
      ch = line.charAt(i);
      if (ch === '"') {
        if (inQuotes && line.charAt(i + 1) === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delim && !inQuotes) {
        out.push(trim(cur));
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(trim(cur));
    return out;
  }

  function detectDelimiter(headerLine) {
    if (headerLine.indexOf('\t') !== -1) return '\t';
    if (headerLine.indexOf(';') !== -1 && headerLine.indexOf(',') === -1) return ';';
    return ',';
  }

  function matchHeaderCol(rawHeader) {
    var h = normalizeName(String(rawHeader == null ? '' : rawHeader).replace(/^\ufeff/, ''));
    if (h === 'barcode' || h === 'باركود' || h === 'الباركود' || h === 'كود') return 'barcode';
    if (h === 'name' || h === 'الاسم' || h === 'الصنف' || h === 'اسم الصنف') return 'name';
    if (h === 'price' || h === 'السعر' || h === 'السعر الجديد' || h === 'السعر الرسمي' || h === 'new price') return 'price';
    return '';
  }

  function parsePriceBaisa(raw) {
    var s = normalizeDigits(raw);
    s = trim(s).replace(/\s+/g, '');
    if (!s) return NaN;
    if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
    var num = Number(s);
    if (!isFinite(num) || num <= 0) return NaN;
    var baisa = Math.round((num + 1e-9) * 100);
    return baisa > 0 ? baisa : NaN;
  }

  function parse(text) {
    var raw = String(text == null ? '' : text);
    var lines = raw.split(/\r?\n/);
    var rows = [];
    var errors = [];
    var headerIdx = -1;
    var i;

    for (i = 0; i < lines.length; i++) {
      if (trim(lines[i])) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) {
      return { rows: [], errors: [{ line: 1, message: t('القائمة فارغة.', 'List is empty.') }] };
    }

    var delim = detectDelimiter(lines[headerIdx]);
    var headers = splitLine(lines[headerIdx], delim);
    var colMap = { barcode: -1, name: -1, price: -1 };
    var c, role;
    for (c = 0; c < headers.length; c++) {
      role = matchHeaderCol(headers[c]);
      if (role && colMap[role] === -1) colMap[role] = c;
    }

    if (colMap.price === -1 || (colMap.barcode === -1 && colMap.name === -1)) {
      return {
        rows: [],
        errors: [{
          line: headerIdx + 1,
          message: t('تأكد من وجود أعمدة الباركود أو الاسم والسعر في السطر الأول.', 'Header must include barcode or name and price.')
        }]
      };
    }

    for (i = headerIdx + 1; i < lines.length; i++) {
      if (!trim(lines[i])) continue;
      var cells = splitLine(lines[i], delim);
      var barcode = colMap.barcode !== -1 ? trim(normalizeDigits(cells[colMap.barcode] || '')) : '';
      var name = colMap.name !== -1 ? trim(cells[colMap.name] || '') : '';
      var priceRaw = colMap.price !== -1 ? (cells[colMap.price] || '') : '';
      var priceBaisa = parsePriceBaisa(priceRaw);

      if (!barcode && !name) {
        errors.push({ line: i + 1, message: t('سطر بدون باركود أو اسم.', 'Row missing barcode and name.') });
        continue;
      }
      if (isNaN(priceBaisa) || priceBaisa <= 0) {
        errors.push({ line: i + 1, message: t('سعر غير صالح.', 'Invalid price.') });
        continue;
      }
      rows.push({
        barcode: barcode,
        name: name,
        priceBaisa: priceBaisa
      });
    }

    return { rows: rows, errors: errors };
  }

  function compare(rows) {
    var list = Array.isArray(rows) ? rows : [];
    var products = getProducts();
    var byBarcode = {};
    var byName = {};
    var i, p, bc, nm;

    for (i = 0; i < products.length; i++) {
      p = products[i];
      if (!p) continue;
      bc = trim(normalizeDigits(p.barcode || ''));
      if (bc && !byBarcode[bc]) byBarcode[bc] = p;
      nm = normalizeName(p.name || '');
      if (nm && !byName[nm]) byName[nm] = p;
    }

    var changed = [];
    var same = [];
    var notFound = [];
    var row, matched, curBaisa, offBaisa, diffBaisa, pct, isLower;

    for (i = 0; i < list.length; i++) {
      row = list[i];
      if (!row || typeof row.priceBaisa !== 'number' || !isFinite(row.priceBaisa) || row.priceBaisa <= 0) {
        continue;
      }
      matched = null;
      bc = trim(normalizeDigits(row.barcode || ''));
      if (bc && byBarcode[bc]) {
        matched = byBarcode[bc];
      }
      if (!matched && row.name) {
        nm = normalizeName(row.name);
        if (nm && byName[nm]) matched = byName[nm];
      }

      if (!matched) {
        notFound.push({
          barcode: row.barcode || '',
          name: row.name || '',
          officialBaisa: row.priceBaisa
        });
        continue;
      }

      curBaisa = Math.round(((Number(matched.price) || 0) + 1e-9) * 100);
      offBaisa = Math.round(row.priceBaisa);
      if (curBaisa === offBaisa) {
        same.push({
          itemKey: keyOf(matched),
          barcode: matched.barcode || row.barcode || '',
          name: matched.name || row.name || '',
          currentBaisa: curBaisa,
          officialBaisa: offBaisa
        });
      } else {
        diffBaisa = offBaisa - curBaisa;
        pct = curBaisa > 0 ? Math.round((diffBaisa / curBaisa) * 1000) / 10 : 0;
        isLower = offBaisa < curBaisa;
        changed.push({
          itemKey: keyOf(matched),
          barcode: matched.barcode || row.barcode || '',
          name: matched.name || row.name || '',
          currentBaisa: curBaisa,
          officialBaisa: offBaisa,
          diffBaisa: diffBaisa,
          pct: pct,
          direction: isLower ? 'down' : 'up',
          severity: isLower ? 'red' : 'amber',
          flag: isLower ? t('لازم تنزّل', 'Must lower') : t('يتحدّث', 'Update')
        });
      }
    }

    var store = readStore();
    store.lastImport = {
      at: new Date().toISOString(),
      changed: changed.length,
      same: same.length,
      notFound: notFound.length
    };
    writeStore(store);

    return { changed: changed, same: same, notFound: notFound };
  }

  function apply(changes, reason) {
    if (!canEditPrice()) {
      return { ok: false, error: t('ليس لديك صلاحية تعديل الأسعار.', 'Permission denied for price updates.'), applied: [] };
    }
    var cleanReason = trim(reason);
    if (!cleanReason) {
      return { ok: false, error: t('السبب مطلوب قبل تطبيق التعديل.', 'Reason is required.'), applied: [] };
    }
    var setter = getPriceSetter();
    if (!setter) {
      return { ok: false, error: t('التسعير مش متاح من هنا', 'Pricing is not available from here.'), applied: [] };
    }
    var list = Array.isArray(changes) ? changes : [];
    if (!list.length) {
      return { ok: false, error: t('لا توجد أصناف مختارة.', 'No items selected.'), applied: [] };
    }

    var store = readStore();
    var applied = [];
    var skipped = 0;
    var by = currentUserName();
    var at = new Date().toISOString();
    var i, ch, key, newBaisa, targetBaisa, prod, oldBaisa, res, entry;

    for (i = 0; i < list.length; i++) {
      ch = list[i];
      if (!ch) continue;
      key = String(ch.itemKey || ch.key || '');
      newBaisa = Number(ch.officialBaisa != null ? ch.officialBaisa : ch['new']);
      if (!key || !isFinite(newBaisa) || newBaisa <= 0) continue;
      targetBaisa = Math.round(newBaisa);
      if (targetBaisa <= 0) continue;
      prod = findProductByKey(key);
      if (!prod) continue;
      oldBaisa = Math.round(((Number(prod.price) || 0) + 1e-9) * 100);
      if (oldBaisa === targetBaisa) {
        skipped++;
        continue;
      }
      try {
        res = setter(key, targetBaisa / 100, cleanReason);
      } catch (e) {
        if (applied.length) {
          writeStore(store);
          refreshHistoryTable();
        }
        return { ok: false, error: t('تعذر تحديث السعر.', 'Failed to update price.'), applied: applied };
      }
      if (res === false) {
        if (applied.length) {
          writeStore(store);
          refreshHistoryTable();
        }
        return { ok: false, error: t('تم رفض تحديث السعر.', 'Price update rejected.'), applied: applied };
      }
      entry = {
        at: at,
        by: by,
        itemKey: key,
        old: oldBaisa,
        'new': targetBaisa,
        reason: cleanReason
      };
      store.history.push(entry);
      applied.push({
        at: entry.at,
        by: entry.by,
        itemKey: entry.itemKey,
        old: entry.old,
        'new': entry['new'],
        reason: entry.reason
      });
    }

    if (!applied.length) {
      if (skipped > 0) {
        return { ok: true, applied: [], skipped: skipped };
      }
      return { ok: false, error: t('لم يتم تطبيق أي تعديل.', 'No changes applied.'), applied: [] };
    }

    writeStore(store);
    refreshHistoryTable();
    return { ok: true, applied: applied, skipped: skipped };
  }

  function history() {
    var store = readStore();
    var out = [];
    var i, h;
    for (i = 0; i < store.history.length; i++) {
      h = store.history[i];
      if (!h || typeof h !== 'object') continue;
      out.push({
        at: String(h.at || ''),
        by: String(h.by || ''),
        itemKey: String(h.itemKey || ''),
        old: Number(h.old) || 0,
        'new': Number(h['new']) || 0,
        reason: String(h.reason || '')
      });
    }
    return out;
  }

  window.novaOfficialPrices = {
    parse: parse,
    compare: compare,
    apply: apply,
    history: history
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
      '#novaOfficialPrices{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;min-width:0;overflow-x:hidden;}',
      '#novaOfficialPrices *{box-sizing:border-box;}',
      '#novaOfficialPrices h3,#novaOfficialPrices h4{margin:0 0 12px 0;color:#e6edf3;}',
      '#novaOfficialPrices h3{font-size:1.1rem;border-bottom:1px solid #343b44;padding-bottom:8px;}',
      '#novaOfficialPrices h4{font-size:0.95rem;margin-top:16px;color:#79c9eb;}',
      '.nop-textarea{width:100%;min-height:110px;padding:10px 12px;background:#0d1117;border:1px solid #343b44;border-radius:8px;color:#e6edf3;font-size:0.95rem;resize:vertical;}',
      '.nop-textarea:focus,.nop-input:focus{outline:none;border-color:#79c9eb;}',
      '.nop-input{width:100%;min-height:44px;padding:8px 12px;background:#0d1117;border:1px solid #343b44;border-radius:8px;color:#e6edf3;font-size:0.95rem;}',
      '.nop-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center;}',
      '.nop-actions button{min-height:44px;}',
      '.nop-notice{margin-top:10px;padding:10px 12px;border-radius:8px;background:#3a1d1d;border:1px solid #b91c1c;color:#fecaca;font-size:0.9rem;word-break:break-word;}',
      '.nop-summary{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}',
      '.nop-pill{padding:6px 10px;border-radius:8px;background:#1b2129;border:1px solid #343b44;font-size:0.88rem;color:#e6edf3;}',
      '.nop-status{font-size:0.88rem;color:#79c9eb;min-height:20px;margin-top:8px;word-break:break-word;}',
      '.nop-errors{margin-top:8px;padding:8px 12px;border-radius:8px;background:#2b1b1b;border:1px solid #7f1d1d;color:#fecaca;font-size:0.85rem;}',
      '.nop-errors ul{margin:0;padding:0 16px;}',
      '.nop-table-wrap{width:100%;max-width:100%;min-width:0;overflow-x:auto;border:1px solid #343b44;border-radius:8px;margin-top:10px;}',
      '.nop-table{width:100%;border-collapse:collapse;font-size:0.88rem;min-width:320px;}',
      '.nop-table th,.nop-table td{padding:8px 10px;border-bottom:1px solid #343b44;text-align:inherit;white-space:nowrap;}',
      '.nop-table th{background:#1b2129;color:#79c9eb;font-weight:600;}',
      '.nop-table tr:last-child td{border-bottom:0;}',
      '.nop-badge-red{display:inline-block;padding:2px 8px;border-radius:999px;background:#5c1d1d;color:#fecaca;border:1px solid #ef4444;font-size:0.78rem;font-weight:600;}',
      '.nop-badge-amber{display:inline-block;padding:2px 8px;border-radius:999px;background:#523b12;color:#fde68a;border:1px solid #f59e0b;font-size:0.78rem;font-weight:600;}',
      '.nop-empty{padding:12px;color:#9fb0c2;font-size:0.9rem;}',
      '.nop-check{width:20px;height:20px;cursor:pointer;}',
      '.nop-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9950;display:flex;align-items:center;justify-content:center;padding:16px;}',
      '.nop-modal{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;width:100%;max-width:420px;color:#e6edf3;}',
      '.nop-modal h4{margin:0 0 10px 0;color:#79c9eb;}',
      '.nop-modal-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;justify-content:flex-end;}',
      '.nop-modal-actions button{min-height:44px;}'
    ].join('');
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function refreshHistoryTable() {
    var host = document.getElementById('nopHistoryWrap');
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);

    var items = history().reverse();
    var wrap = el('div', 'nop-table-wrap');
    if (!items.length) {
      wrap.appendChild(el('div', 'nop-empty', t('لا يوجد سجل تعديلات بعد.', 'No price change history yet.')));
      host.appendChild(wrap);
      return;
    }

    var table = el('table', 'nop-table');
    var thead = document.createElement('thead');
    var trh = document.createElement('tr');
    var cols = [
      t('الوقت', 'Time'),
      t('بواسطة', 'By'),
      t('الصنف', 'Item'),
      t('القديم', 'Old'),
      t('الجديد', 'New'),
      t('السبب', 'Reason')
    ];
    var i, tr, h;
    for (i = 0; i < cols.length; i++) {
      trh.appendChild(el('th', '', cols[i]));
    }
    thead.appendChild(trh);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (i = 0; i < items.length; i++) {
      h = items[i];
      tr = document.createElement('tr');
      tr.appendChild(el('td', '', fmtLocalTime(h.at)));
      tr.appendChild(el('td', '', h.by || '\u2014'));
      tr.appendChild(el('td', '', toDisplayDigits(h.itemKey)));
      tr.appendChild(el('td', '', fmtMoney(h.old)));
      tr.appendChild(el('td', '', fmtMoney(h['new'])));
      tr.appendChild(el('td', '', h.reason));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  function openReasonDialog(onConfirm) {
    var backdrop = el('div', 'nop-modal-backdrop');
    backdrop.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    var modal = el('div', 'nop-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.appendChild(el('h4', '', t('سبب تحديث الأسعار', 'Reason for Price Update')));

    var input = el('input', 'nop-input');
    input.type = 'text';
    input.placeholder = t('مثال: قائمة هيئة الدواء الشهرية', 'Example: Monthly official price list');
    modal.appendChild(input);

    var errMsg = el('div', 'nop-status', '');
    modal.appendChild(errMsg);

    var btns = el('div', 'nop-modal-actions');
    var cancelBtn = el('button', 'btn btn-secondary', t('إلغاء', 'Cancel'));
    cancelBtn.type = 'button';
    var okBtn = el('button', 'btn btn-primary', t('تأكيد التطبيق', 'Confirm Apply'));
    okBtn.type = 'button';

    function onKey(ev) {
      if (ev.key === 'Escape') close();
    }

    function close() {
      document.removeEventListener('keydown', onKey);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    function submit() {
      var val = trim(input.value);
      if (!val) {
        errMsg.textContent = t('السبب مطلوب.', 'Reason is required.');
        return;
      }
      close();
      onConfirm(val);
    }

    document.addEventListener('keydown', onKey);
    cancelBtn.addEventListener('click', close);
    okBtn.addEventListener('click', submit);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') submit();
    });

    btns.appendChild(cancelBtn);
    btns.appendChild(okBtn);
    modal.appendChild(btns);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    input.focus();
  }

  function buildCard() {
    injectStyles();
    var card = el('section', 'nova-card');
    card.id = CARD_ID;
    card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    card.appendChild(el('h3', '', t('تحديث الأسعار الرسمية من قائمة هيئة الدواء', 'Official Price List Update')));

    if (!getPriceSetter()) {
      card.appendChild(el('div', 'nop-notice', t('التسعير مش متاح من هنا', 'Pricing is not available from here')));
    }

    var ta = el('textarea', 'nop-textarea');
    ta.id = 'nopInput';
    ta.placeholder = t('الصق القائمة هنا (باركود، الاسم، السعر)...', 'Paste CSV/TSV list here (barcode, name, price)...');
    card.appendChild(ta);

    var actions = el('div', 'nop-actions');
    var analyzeBtn = el('button', 'btn btn-primary', t('حلّل', 'Analyze'));
    analyzeBtn.type = 'button';
    analyzeBtn.id = 'nopAnalyzeBtn';

    var applyBtn = el('button', 'btn btn-secondary', t('طبّق على المختار', 'Apply Selected'));
    applyBtn.type = 'button';
    applyBtn.id = 'nopApplyBtn';
    applyBtn.disabled = true;

    actions.appendChild(analyzeBtn);
    actions.appendChild(applyBtn);
    card.appendChild(actions);

    var statusMsg = el('div', 'nop-status', '');
    statusMsg.id = 'nopStatus';
    card.appendChild(statusMsg);

    var summaryBox = el('div', 'nop-summary');
    summaryBox.id = 'nopSummary';
    card.appendChild(summaryBox);

    var errorsBox = el('div', '');
    errorsBox.id = 'nopErrors';
    card.appendChild(errorsBox);

    var diffWrap = el('div', '');
    diffWrap.id = 'nopDiffWrap';
    card.appendChild(diffWrap);

    card.appendChild(el('h4', '', t('سجل التعديلات', 'Update History')));
    var histWrap = el('div', '');
    histWrap.id = 'nopHistoryWrap';
    card.appendChild(histWrap);

    function renderComparison() {
      while (summaryBox.firstChild) summaryBox.removeChild(summaryBox.firstChild);
      while (errorsBox.firstChild) errorsBox.removeChild(errorsBox.firstChild);
      while (diffWrap.firstChild) diffWrap.removeChild(diffWrap.firstChild);
      if (!lastCompare) return;

      summaryBox.appendChild(el('div', 'nop-pill', t('مختلف: ', 'Changed: ') + toDisplayDigits(lastCompare.changed.length)));
      summaryBox.appendChild(el('div', 'nop-pill', t('مطابق: ', 'Same: ') + toDisplayDigits(lastCompare.same.length)));
      summaryBox.appendChild(el('div', 'nop-pill', t('غير موجود: ', 'Not found: ') + toDisplayDigits(lastCompare.notFound.length)));
      summaryBox.appendChild(el('div', 'nop-pill', t('أخطاء: ', 'Errors: ') + toDisplayDigits(lastErrors.length)));

      var i;
      if (lastErrors.length) {
        var errWrap = el('div', 'nop-errors');
        var ul = document.createElement('ul');
        for (i = 0; i < lastErrors.length; i++) {
          ul.appendChild(el('li', '', t('سطر ', 'Line ') + toDisplayDigits(lastErrors[i].line) + ': ' + lastErrors[i].message));
        }
        errWrap.appendChild(ul);
        errorsBox.appendChild(errWrap);
      }

      var wrap = el('div', 'nop-table-wrap');
      if (!lastCompare.changed.length) {
        wrap.appendChild(el('div', 'nop-empty', t('لا توجد فروق أسعار.', 'No price differences found.')));
        diffWrap.appendChild(wrap);
        applyBtn.disabled = true;
        return;
      }

      var table = el('table', 'nop-table');
      var thead = document.createElement('thead');
      var trh = document.createElement('tr');
      var headers = [
        t('اختيار', 'Pick'),
        t('الصنف', 'Item'),
        t('الحالي', 'Current'),
        t('الرسمي', 'Official'),
        t('الفرق', 'Diff'),
        t('الحالة', 'Flag')
      ];
      var row, tr, cb, tdFlag, badge;
      for (i = 0; i < headers.length; i++) {
        trh.appendChild(el('th', '', headers[i]));
      }
      thead.appendChild(trh);
      table.appendChild(thead);

      var tbody = document.createElement('tbody');
      for (i = 0; i < lastCompare.changed.length; i++) {
        row = lastCompare.changed[i];
        tr = document.createElement('tr');

        var tdCb = document.createElement('td');
        cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'nop-check';
        cb.setAttribute('data-idx', String(i));
        cb.checked = row.direction === 'down';
        tdCb.appendChild(cb);
        tr.appendChild(tdCb);

        tr.appendChild(el('td', '', row.name));
        tr.appendChild(el('td', '', fmtMoney(row.currentBaisa)));
        tr.appendChild(el('td', '', fmtMoney(row.officialBaisa)));
        tr.appendChild(el('td', '', (row.diffBaisa > 0 ? '+' : '') + fmtMoney(row.diffBaisa) + ' (' + toDisplayDigits(row.pct) + '%)'));

        tdFlag = document.createElement('td');
        badge = el('span', row.severity === 'red' ? 'nop-badge-red' : 'nop-badge-amber', row.flag);
        tdFlag.appendChild(badge);
        tr.appendChild(tdFlag);

        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      diffWrap.appendChild(wrap);
      applyBtn.disabled = false;
    }

    analyzeBtn.addEventListener('click', function () {
      var parsed = parse(ta.value);
      lastParsedRows = parsed.rows;
      lastErrors = parsed.errors;
      lastCompare = compare(parsed.rows);
      renderComparison();
      statusMsg.textContent = lastErrors.length
        ? t('تم التحليل مع وجود أخطاء في بعض السطور.', 'Analyzed with some row errors.')
        : t('تم التحليل بنجاح.', 'Analysis complete.');
    });

    applyBtn.addEventListener('click', function () {
      if (!lastCompare || !lastCompare.changed.length) return;
      var checks = diffWrap.querySelectorAll('input.nop-check:checked');
      var picked = [];
      var i, idx;
      for (i = 0; i < checks.length; i++) {
        idx = parseInt(checks[i].getAttribute('data-idx'), 10);
        if (!isNaN(idx) && lastCompare.changed[idx]) {
          picked.push(lastCompare.changed[idx]);
        }
      }
      if (!picked.length) {
        statusMsg.textContent = t('اختر صنفًا واحدًا على الأقل.', 'Select at least one item.');
        return;
      }
      openReasonDialog(function (reason) {
        var res = apply(picked, reason);
        if (!res.ok) {
          statusMsg.textContent = res.error;
          toast(res.error, 'error');
        } else {
          lastCompare = compare(lastParsedRows);
          renderComparison();
          statusMsg.textContent = t('تم تحديث الأسعار بنجاح.', 'Prices updated successfully.');
          toast(statusMsg.textContent, 'success');
        }
      });
    });

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
    refreshHistoryTable();
  }

  function initObserver() {
    var pageView = document.getElementById('novaPageView');
    if (!pageView || observer) return;
    observer = new MutationObserver(function () {
      if (!document.getElementById(CARD_ID) && isProductsPage()) {
        ensureMounted();
      }
    });
    observer.observe(pageView, { childList: true, attributes: true, attributeFilter: ['hidden'] });
    ensureMounted();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initObserver);
  } else {
    initObserver();
  }
})();

;
// app/616-corporate-accounts.js
(function () {
  'use strict';

  var STORAGE_KEY = 'nova-rx-corporate-v1';
  var LANG_KEY = 'nova-rx-language';
  var CARD_ID = 'novaCorporate';
  var STYLE_ID = 'novaCorporateStyle';
  var observer = null;
  var selectedCompany = '';
  var selectedMonth = '';

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
    try {
      if (typeof window.showToast === 'function') {
        window.showToast(msg, type || 'success');
      }
    } catch (e) {}
  }

  function currentUser() {
    try {
      if (window.novaAuth && typeof window.novaAuth.current === 'function') {
        var u = window.novaAuth.current();
        return u && u.name ? String(u.name) : '';
      }
    } catch (e) {}
    return '';
  }

  function canWrite() {
    if (window.novaPerms && typeof window.novaPerms.require === 'function') {
      try {
        return !!window.novaPerms.require('accounts.manage');
      } catch (e) {
        return false;
      }
    }
    return true;
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
        if (idx !== -1) {
          out += String(idx);
        } else if (ch === '\u066b') {
          out += '.';
        } else if (ch === '\u2212') {
          out += '-';
        } else {
          out += ch;
        }
      }
    }
    return out;
  }

  function trimStr(val) {
    return String(val == null ? '' : val).replace(/^\s+|\s+$/g, '');
  }

  function normKey(name) {
    return trimStr(name).toLowerCase();
  }

  function parseEgpToPiasters(val) {
    var s = normalizeDigits(val).replace(/,/g, '.').replace(/^\s+|\s+$/g, '');
    if (!s) return NaN;
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) return NaN;
    var num = parseFloat(s);
    if (!isFinite(num)) return NaN;
    return Math.round(num * 100);
  }

  function parsePiastersArg(val) {
    if (typeof val === 'number') {
      if (!isFinite(val)) return NaN;
      return Math.round(val);
    }
    var s = normalizeDigits(val).replace(/^\s+|\s+$/g, '');
    if (!s || !/^-?\d+$/.test(s)) return NaN;
    return parseInt(s, 10);
  }

  function parseIntArg(val, fallback) {
    if (val === undefined || val === null || val === '') return fallback;
    if (typeof val === 'number') {
      if (!isFinite(val)) return NaN;
      return Math.round(val);
    }
    var s = normalizeDigits(val).replace(/^\s+|\s+$/g, '');
    if (!s) return fallback;
    if (!/^-?\d+$/.test(s)) return NaN;
    return parseInt(s, 10);
  }

  function formatEgp(piasters) {
    var n = Number(piasters) || 0;
    return (n / 100).toFixed(2);
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function currentMonthKey() {
    return todayStr().slice(0, 7);
  }

  function normalizeDateStr(val) {
    var s = normalizeDigits(val).replace(/^\s+|\s+$/g, '');
    if (!s) return todayStr();
    if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)) return '';
    var parts = s.split('-');
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var d = parseInt(parts[2], 10);
    var check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() !== y || (check.getUTCMonth() + 1) !== m || check.getUTCDate() !== d) {
      return '';
    }
    return s;
  }

  function normalizeMonthKey(val) {
    var s = normalizeDigits(val).replace(/^\s+|\s+$/g, '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) return '';
    return s;
  }

  function computeDueDate(monthKey, payDays) {
    var parts = monthKey.split('-');
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var endUtc = Date.UTC(y, m, 0);
    var days = Number(payDays) || 0;
    var due = new Date(endUtc + days * 86400000);
    return due.getUTCFullYear() + '-' + pad2(due.getUTCMonth() + 1) + '-' + pad2(due.getUTCDate());
  }

  function makeId(prefix) {
    return prefix + '-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
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

  function writeStore(records) {
    var list = Array.isArray(records) ? records : [];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  function findCompanyRecord(records, companyName) {
    var key = normKey(companyName);
    if (!key) return null;
    var i, rec;
    for (i = 0; i < records.length; i++) {
      rec = records[i];
      if (rec && rec.type === 'company' && normKey(rec.name) === key) {
        return rec;
      }
    }
    return null;
  }

  function findCloseRecord(records, companyName, monthKey) {
    var key = normKey(companyName);
    var mk = normalizeMonthKey(monthKey);
    if (!key || !mk) return null;
    var i, rec;
    for (i = 0; i < records.length; i++) {
      rec = records[i];
      if (rec && rec.type === 'close' && normKey(rec.company) === key && rec.monthKey === mk) {
        return rec;
      }
    }
    return null;
  }

  function computeBalanceFromRecords(records, companyName) {
    var key = normKey(companyName);
    if (!key) return 0;
    var bal = 0;
    var i, rec;
    for (i = 0; i < records.length; i++) {
      rec = records[i];
      if (!rec || normKey(rec.company) !== key) continue;
      if (rec.type === 'charge') {
        bal += Number(rec.netPiasters) || 0;
      } else if (rec.type === 'payment') {
        bal -= Number(rec.amountPiasters) || 0;
      }
    }
    return bal;
  }

  function apiBalance(company) {
    return computeBalanceFromRecords(readStore(), company);
  }

  function apiIsClosed(company, monthKey) {
    return !!findCloseRecord(readStore(), company, monthKey);
  }

  function apiCompanies() {
    var records = readStore();
    var out = [];
    var i, rec, bal;
    for (i = 0; i < records.length; i++) {
      rec = records[i];
      if (!rec || rec.type !== 'company') continue;
      bal = computeBalanceFromRecords(records, rec.name);
      out.push({
        id: rec.id,
        name: rec.name,
        taxNo: rec.taxNo || '',
        contact: rec.contact || '',
        phone: rec.phone || '',
        creditLimitPiasters: Number(rec.creditLimitPiasters) || 0,
        discountPercent: Number(rec.discountPercent) || 0,
        payDays: Number(rec.payDays) || 0,
        balancePiasters: bal,
        overLimit: (Number(rec.creditLimitPiasters) || 0) > 0 && bal > (Number(rec.creditLimitPiasters) || 0),
        createdAt: rec.at || '',
        createdBy: rec.by || ''
      });
    }
    return out;
  }

  function apiAddCompany(opts) {
    if (!canWrite()) {
      return { ok: false, error: t('لا توجد صلاحية للتعديل', 'Permission denied') };
    }
    var o = opts || {};
    var name = trimStr(o.name);
    if (!name) {
      return { ok: false, error: t('اسم الشركة مطلوب', 'Company name is required') };
    }
    var records = readStore();
    if (findCompanyRecord(records, name)) {
      return { ok: false, error: t('الشركة مسجلة بالفعل', 'Company already exists') };
    }
    var creditLimitPiasters = o.creditLimitPiasters === undefined || o.creditLimitPiasters === null || o.creditLimitPiasters === ''
      ? 0
      : parsePiastersArg(o.creditLimitPiasters);
    if (isNaN(creditLimitPiasters) || creditLimitPiasters < 0) {
      return { ok: false, error: t('حد الائتمان غير صالح', 'Invalid credit limit') };
    }
    var discountPercent = parseIntArg(o.discountPercent, 0);
    if (isNaN(discountPercent) || discountPercent < 0 || discountPercent > 50) {
      return { ok: false, error: t('نسبة الخصم يجب أن تكون بين ٠ و ٥٠', 'Discount must be between 0 and 50') };
    }
    var payDays = parseIntArg(o.payDays, 30);
    if (isNaN(payDays) || payDays < 0 || payDays > 365) {
      return { ok: false, error: t('أيام السداد غير صالحة', 'Invalid payment days') };
    }

    var rec = {
      type: 'company',
      id: makeId('cmp'),
      name: name,
      taxNo: trimStr(o.taxNo),
      contact: trimStr(o.contact),
      phone: trimStr(o.phone),
      creditLimitPiasters: creditLimitPiasters,
      discountPercent: discountPercent,
      payDays: payDays,
      at: new Date().toISOString(),
      by: currentUser()
    };
    records.push(rec);
    writeStore(records);
    if (!selectedCompany) selectedCompany = rec.name;
    refreshAll();
    return {
      ok: true,
      company: {
        id: rec.id,
        name: rec.name,
        taxNo: rec.taxNo,
        contact: rec.contact,
        phone: rec.phone,
        creditLimitPiasters: rec.creditLimitPiasters,
        discountPercent: rec.discountPercent,
        payDays: rec.payDays,
        balancePiasters: 0,
        overLimit: false
      }
    };
  }

  function apiCharges(company, monthKey) {
    var records = readStore();
    var key = normKey(company);
    var mk = monthKey ? normalizeMonthKey(monthKey) : '';
    if (!key) return [];
    if (monthKey && !mk) return [];
    var out = [];
    var i, rec;
    for (i = 0; i < records.length; i++) {
      rec = records[i];
      if (!rec || rec.type !== 'charge' || normKey(rec.company) !== key) continue;
      if (mk && String(rec.date || '').slice(0, 7) !== mk) continue;
      out.push({
        id: rec.id,
        company: rec.company,
        date: rec.date,
        ref: rec.ref || '',
        description: rec.description || '',
        grossPiasters: rec.grossPiasters,
        discountPercent: rec.discountPercent,
        discountPiasters: rec.discountPiasters,
        netPiasters: rec.netPiasters,
        amountPiasters: rec.netPiasters,
        at: rec.at || '',
        by: rec.by || ''
      });
    }
    out.sort(function (a, b) {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      return a.at < b.at ? -1 : (a.at > b.at ? 1 : 0);
    });
    return out;
  }

  function apiAddCharge(opts) {
    if (!canWrite()) {
      return { ok: false, error: t('لا توجد صلاحية للتعديل', 'Permission denied') };
    }
    var o = opts || {};
    var records = readStore();
    var comp = findCompanyRecord(records, o.company);
    if (!comp) {
      return { ok: false, error: t('الشركة غير موجودة', 'Company not found') };
    }
    var date = normalizeDateStr(o.date);
    if (!date) {
      return { ok: false, error: t('تاريخ غير صالح', 'Invalid date') };
    }
    var monthKey = date.slice(0, 7);
    if (findCloseRecord(records, comp.name, monthKey)) {
      return { ok: false, error: t('الشهر مقفول ولا يمكن إضافة حركات', 'Month is closed') };
    }
    var grossPiasters = parsePiastersArg(o.amountPiasters);
    if (isNaN(grossPiasters) || grossPiasters === 0) {
      return { ok: false, error: t('المبلغ غير صالح', 'Invalid amount') };
    }
    var desc = trimStr(o.description);
    if (grossPiasters < 0 && !desc) {
      return { ok: false, error: t('سبب التصحيح مطلوب للحركة السالبة', 'Correction reason is required for negative charge') };
    }

    var pct = Number(comp.discountPercent) || 0;
    var discountPiasters = Math.round(grossPiasters * pct / 100);
    var netPiasters = grossPiasters - discountPiasters;

    var limit = Number(comp.creditLimitPiasters) || 0;
    var currentBal = computeBalanceFromRecords(records, comp.name);
    if (limit > 0 && netPiasters > 0 && (currentBal + netPiasters) > limit) {
      return { ok: false, error: t('تعدّى حد الائتمان', 'Credit limit exceeded') };
    }

    var rec = {
      type: 'charge',
      id: makeId('chg'),
      company: comp.name,
      date: date,
      ref: trimStr(o.ref),
      description: desc,
      grossPiasters: grossPiasters,
      discountPercent: pct,
      discountPiasters: discountPiasters,
      netPiasters: netPiasters,
      at: new Date().toISOString(),
      by: currentUser()
    };
    records.push(rec);
    writeStore(records);
    refreshAll();
    return {
      ok: true,
      charge: {
        id: rec.id,
        company: rec.company,
        date: rec.date,
        ref: rec.ref,
        description: rec.description,
        grossPiasters: rec.grossPiasters,
        discountPercent: rec.discountPercent,
        discountPiasters: rec.discountPiasters,
        netPiasters: rec.netPiasters,
        amountPiasters: rec.netPiasters
      }
    };
  }

  function apiAddPayment(opts) {
    if (!canWrite()) {
      return { ok: false, error: t('لا توجد صلاحية للتعديل', 'Permission denied') };
    }
    var o = opts || {};
    var records = readStore();
    var comp = findCompanyRecord(records, o.company);
    if (!comp) {
      return { ok: false, error: t('الشركة غير موجودة', 'Company not found') };
    }
    var date = normalizeDateStr(o.date);
    if (!date) {
      return { ok: false, error: t('تاريخ غير صالح', 'Invalid date') };
    }
    var monthKey = date.slice(0, 7);
    if (findCloseRecord(records, comp.name, monthKey)) {
      return { ok: false, error: t('الشهر مقفول ولا يمكن إضافة سداد', 'Month is closed') };
    }
    var amountPiasters = parsePiastersArg(o.amountPiasters);
    if (isNaN(amountPiasters) || amountPiasters <= 0) {
      return { ok: false, error: t('مبلغ السداد غير صالح', 'Invalid payment amount') };
    }

    var rec = {
      type: 'payment',
      id: makeId('pay'),
      company: comp.name,
      date: date,
      amountPiasters: amountPiasters,
      method: trimStr(o.method) || t('نقدي', 'Cash'),
      ref: trimStr(o.ref),
      at: new Date().toISOString(),
      by: currentUser()
    };
    records.push(rec);
    writeStore(records);
    refreshAll();
    return {
      ok: true,
      payment: {
        id: rec.id,
        company: rec.company,
        date: rec.date,
        amountPiasters: rec.amountPiasters,
        method: rec.method,
        ref: rec.ref
      }
    };
  }

  function cloneSnapshot(snap) {
    try {
      return JSON.parse(JSON.stringify(snap));
    } catch (e) {
      return snap;
    }
  }

  function apiStatement(company, monthKey) {
    var records = readStore();
    var comp = findCompanyRecord(records, company);
    var mk = normalizeMonthKey(monthKey);
    if (!comp || !mk) return null;

    var closedRec = findCloseRecord(records, comp.name, mk);
    if (closedRec && closedRec.snapshot) {
      return cloneSnapshot(closedRec.snapshot);
    }

    var key = normKey(comp.name);
    var opening = 0;
    var monthCharges = [];
    var monthPayments = [];
    var grossTotal = 0;
    var discountTotal = 0;
    var chargesTotal = 0;
    var paymentsTotal = 0;
    var i, rec, recMonth;

    for (i = 0; i < records.length; i++) {
      rec = records[i];
      if (!rec || normKey(rec.company) !== key) continue;
      if (rec.type !== 'charge' && rec.type !== 'payment') continue;
      recMonth = String(rec.date || '').slice(0, 7);
      if (recMonth < mk) {
        if (rec.type === 'charge') opening += Number(rec.netPiasters) || 0;
        else opening -= Number(rec.amountPiasters) || 0;
      } else if (recMonth === mk) {
        if (rec.type === 'charge') {
          monthCharges.push({
            id: rec.id,
            date: rec.date,
            ref: rec.ref || '',
            description: rec.description || '',
            grossPiasters: rec.grossPiasters,
            discountPercent: rec.discountPercent,
            discountPiasters: rec.discountPiasters,
            netPiasters: rec.netPiasters
          });
          grossTotal += Number(rec.grossPiasters) || 0;
          discountTotal += Number(rec.discountPiasters) || 0;
          chargesTotal += Number(rec.netPiasters) || 0;
        } else {
          monthPayments.push({
            id: rec.id,
            date: rec.date,
            amountPiasters: rec.amountPiasters,
            method: rec.method || '',
            ref: rec.ref || ''
          });
          paymentsTotal += Number(rec.amountPiasters) || 0;
        }
      }
    }

    monthCharges.sort(function (a, b) {
      return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
    });
    monthPayments.sort(function (a, b) {
      return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
    });

    var closing = opening + chargesTotal - paymentsTotal;

    return {
      company: comp.name,
      taxNo: comp.taxNo || '',
      contact: comp.contact || '',
      phone: comp.phone || '',
      discountPercent: Number(comp.discountPercent) || 0,
      payDays: Number(comp.payDays) || 0,
      monthKey: mk,
      openingBalancePiasters: opening,
      grossChargesPiasters: grossTotal,
      discountTotalPiasters: discountTotal,
      chargesTotalPiasters: chargesTotal,
      paymentsTotalPiasters: paymentsTotal,
      closingBalancePiasters: closing,
      dueDate: computeDueDate(mk, comp.payDays),
      charges: monthCharges,
      payments: monthPayments,
      closed: false
    };
  }

  function apiCloseMonth(company, monthKey) {
    if (!canWrite()) {
      return { ok: false, error: t('لا توجد صلاحية للتعديل', 'Permission denied') };
    }
    var records = readStore();
    var comp = findCompanyRecord(records, company);
    var mk = normalizeMonthKey(monthKey);
    if (!comp || !mk) {
      return { ok: false, error: t('بيانات الشركة أو الشهر غير صالحة', 'Invalid company or month') };
    }
    if (findCloseRecord(records, comp.name, mk)) {
      return { ok: false, error: t('الشهر مقفول بالفعل', 'Month already closed') };
    }

    var stmt = apiStatement(comp.name, mk);
    stmt.closed = true;
    stmt.closedAt = new Date().toISOString();
    stmt.closedBy = currentUser();

    var rec = {
      type: 'close',
      id: makeId('cls'),
      company: comp.name,
      monthKey: mk,
      snapshot: stmt,
      at: stmt.closedAt,
      by: stmt.closedBy
    };
    records.push(rec);
    writeStore(records);
    refreshAll();
    return { ok: true, statement: cloneSnapshot(stmt) };
  }

  window.novaCorporate = {
    addCompany: apiAddCompany,
    companies: apiCompanies,
    addCharge: apiAddCharge,
    charges: apiCharges,
    addPayment: apiAddPayment,
    statement: apiStatement,
    balance: apiBalance,
    closeMonth: apiCloseMonth,
    isClosed: apiIsClosed
  };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function escHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildPrintableHtml(stmt) {
    var en = isEn();
    var dir = en ? 'ltr' : 'rtl';
    var cur = en ? 'EGP' : 'ج.م';
    var rows = '';
    var i, c;
    for (i = 0; i < stmt.charges.length; i++) {
      c = stmt.charges[i];
      rows += '<tr>' +
        '<td>' + escHtml(c.date) + '</td>' +
        '<td>' + escHtml(c.ref || '—') + '</td>' +
        '<td>' + escHtml(c.description || '—') + '</td>' +
        '<td>' + escHtml(formatEgp(c.grossPiasters)) + '</td>' +
        '<td>' + escHtml(formatEgp(c.discountPiasters)) + '</td>' +
        '<td>' + escHtml(formatEgp(c.netPiasters)) + '</td>' +
        '</tr>';
    }
    if (!rows) {
      rows = '<tr><td colspan="6">' + escHtml(t('لا توجد حركات في هذا الشهر', 'No charges this month')) + '</td></tr>';
    }
    return '<!doctype html><html dir="' + dir + '"><head><meta charset="utf-8"><title>' +
      escHtml(t('فاتورة شهرية - ', 'Monthly Invoice - ') + stmt.company + ' ' + stmt.monthKey) +
      '</title><style>body{font-family:sans-serif;padding:24px;color:#111;}h2{margin:0 0 8px;}table{width:100%;border-collapse:collapse;margin:16px 0;}th,td{border:1px solid #ccc;padding:8px;text-align:inherit;}th{background:#f2f2f2;}.meta{margin-bottom:12px;line-height:1.6;}.tot{margin-top:12px;font-weight:bold;line-height:1.8;}</style></head><body>' +
      '<h2>' + escHtml(t('الفاتورة الشهرية للشركة', 'Corporate Monthly Invoice')) + '</h2>' +
      '<div class="meta">' +
      '<div>' + escHtml(t('الشركة: ', 'Company: ') + stmt.company) + '</div>' +
      '<div>' + escHtml(t('الرقم الضريبي: ', 'Tax No: ') + (stmt.taxNo || '—')) + '</div>' +
      '<div>' + escHtml(t('الشهر: ', 'Month: ') + stmt.monthKey) + '</div>' +
      '<div>' + escHtml(t('تاريخ الاستحقاق: ', 'Due Date: ') + stmt.dueDate) + '</div>' +
      '</div>' +
      '<table><thead><tr>' +
      '<th>' + escHtml(t('التاريخ', 'Date')) + '</th>' +
      '<th>' + escHtml(t('المرجع', 'Ref')) + '</th>' +
      '<th>' + escHtml(t('البيان', 'Description')) + '</th>' +
      '<th>' + escHtml(t('الإجمالي', 'Gross')) + '</th>' +
      '<th>' + escHtml(t('الخصم', 'Discount')) + '</th>' +
      '<th>' + escHtml(t('الصافي', 'Net')) + '</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="tot">' +
      '<div>' + escHtml(t('الرصيد الافتتاحي: ', 'Opening Balance: ') + formatEgp(stmt.openingBalancePiasters) + ' ' + cur) + '</div>' +
      '<div>' + escHtml(t('إجمالي الخصم: ', 'Total Discount: ') + formatEgp(stmt.discountTotalPiasters) + ' ' + cur) + '</div>' +
      '<div>' + escHtml(t('صافي المسحوبات: ', 'Net Charges: ') + formatEgp(stmt.chargesTotalPiasters) + ' ' + cur) + '</div>' +
      '<div>' + escHtml(t('إجمالي السداد: ', 'Total Payments: ') + formatEgp(stmt.paymentsTotalPiasters) + ' ' + cur) + '</div>' +
      '<div>' + escHtml(t('الرصيد الختامي المستحق: ', 'Closing Balance Due: ') + formatEgp(stmt.closingBalancePiasters) + ' ' + cur) + '</div>' +
      '</div></body></html>';
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '#novaCorporate{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;}',
      '#novaCorporate *{box-sizing:border-box;}',
      '#novaCorporate h3,#novaCorporate h4{margin:0 0 12px 0;color:#e6edf3;}',
      '#novaCorporate h3{font-size:1.1rem;border-bottom:1px solid #343b44;padding-bottom:8px;}',
      '#novaCorporate h4{font-size:0.95rem;margin-top:16px;color:#79c9eb;}',
      '.ncorp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin:10px 0;}',
      '.ncorp-field label{display:block;font-size:0.85rem;margin-bottom:4px;color:#9fb0c2;}',
      '.ncorp-input,.ncorp-select{width:100%;min-height:44px;padding:8px 12px;background:#0d1117;border:1px solid #343b44;border-radius:8px;color:#e6edf3;font-size:0.95rem;}',
      '.ncorp-input:focus,.ncorp-select:focus{outline:none;border-color:#79c9eb;}',
      '.ncorp-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center;}',
      '.ncorp-actions button{min-height:44px;}',
      '.ncorp-status{font-size:0.85rem;color:#79c9eb;min-height:20px;margin-top:6px;}',
      '.ncorp-status.err{color:#f87171;}',
      '.ncorp-table-wrap{width:100%;overflow-x:auto;border:1px solid #343b44;border-radius:8px;margin-top:8px;}',
      '.ncorp-table{width:100%;border-collapse:collapse;font-size:0.9rem;min-width:300px;}',
      '.ncorp-table th,.ncorp-table td{padding:8px 10px;border-bottom:1px solid #343b44;text-align:inherit;white-space:nowrap;}',
      '.ncorp-table th{background:#1b2129;color:#79c9eb;font-weight:600;}',
      '.ncorp-table tr:last-child td{border-bottom:0;}',
      '.ncorp-empty{padding:12px;color:#9fb0c2;font-size:0.9rem;}',
      '.ncorp-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:0.78rem;background:#1b2129;border:1px solid #343b44;color:#79c9eb;}',
      '.ncorp-badge.over{background:#3b1518;border-color:#f87171;color:#fca5a5;}',
      '.ncorp-badge.closed{background:#163022;border-color:#3fb950;color:#7ee787;}',
      '.ncorp-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:8px;margin:10px 0;}',
      '.ncorp-kpi{background:#0d1117;border:1px solid #343b44;border-radius:8px;padding:10px;}',
      '.ncorp-kpi-lbl{font-size:0.78rem;color:#9fb0c2;margin-bottom:4px;}',
      '.ncorp-kpi-val{font-size:1rem;font-weight:600;color:#e6edf3;}',
      '.ncorp-section{border-top:1px solid #343b44;margin-top:16px;padding-top:12px;}'
    ].join('');
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function populateSelect(sel, list, currentVal) {
    if (!sel) return;
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    if (!list.length) {
      var opt0 = document.createElement('option');
      opt0.value = '';
      opt0.textContent = t('لا توجد شركات', 'No companies');
      sel.appendChild(opt0);
      return;
    }
    var i, opt;
    var found = false;
    for (i = 0; i < list.length; i++) {
      opt = document.createElement('option');
      opt.value = list[i].name;
      opt.textContent = list[i].name;
      if (list[i].name === currentVal) found = true;
      sel.appendChild(opt);
    }
    sel.value = found ? currentVal : list[0].name;
  }

  function buildTable(headers, rows, emptyMsg) {
    var wrap = el('div', 'ncorp-table-wrap');
    if (!rows.length) {
      wrap.appendChild(el('div', 'ncorp-empty', emptyMsg));
      return wrap;
    }
    var table = el('table', 'ncorp-table');
    var thead = document.createElement('thead');
    var trHead = document.createElement('tr');
    var i, j, tr, cell;
    for (i = 0; i < headers.length; i++) {
      trHead.appendChild(el('th', '', headers[i]));
    }
    thead.appendChild(trHead);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (i = 0; i < rows.length; i++) {
      tr = document.createElement('tr');
      for (j = 0; j < rows[i].length; j++) {
        cell = rows[i][j];
        if (cell && cell.nodeType === 1) {
          var td = document.createElement('td');
          td.appendChild(cell);
          tr.appendChild(td);
        } else {
          tr.appendChild(el('td', '', cell));
        }
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function refreshAll() {
    var card = document.getElementById(CARD_ID);
    if (!card) return;
    var list = apiCompanies();
    if (!selectedCompany && list.length) {
      selectedCompany = list[0].name;
    }
    if (!selectedMonth) {
      selectedMonth = currentMonthKey();
    }

    var compWrap = document.getElementById('ncorpCompaniesWrap');
    if (compWrap) {
      while (compWrap.firstChild) compWrap.removeChild(compWrap.firstChild);
      var rows = [];
      var i, c, badge;
      var cur = t('ج.م', 'EGP');
      for (i = 0; i < list.length; i++) {
        c = list[i];
        badge = c.overLimit
          ? el('span', 'ncorp-badge over', t('تعدّى الحد', 'Over Limit'))
          : el('span', 'ncorp-badge', c.creditLimitPiasters > 0 ? formatEgp(c.creditLimitPiasters) + ' ' + cur : t('بلا حد', 'No limit'));
        rows.push([
          c.name,
          formatEgp(c.balancePiasters) + ' ' + cur,
          String(c.discountPercent) + '%',
          badge
        ]);
      }
      compWrap.appendChild(buildTable(
        [
          t('الشركة', 'Company'),
          t('الرصيد', 'Balance'),
          t('الخصم', 'Discount'),
          t('حد الائتمان', 'Credit Limit')
        ],
        rows,
        t('لا توجد شركات مسجلة بعد.', 'No companies registered yet.')
      ));
    }

    var chargeSel = document.getElementById('ncorpChargeCompany');
    var paySel = document.getElementById('ncorpPayCompany');
    var stmtSel = document.getElementById('ncorpStmtCompany');
    populateSelect(chargeSel, list, chargeSel && chargeSel.value ? chargeSel.value : selectedCompany);
    populateSelect(paySel, list, paySel && paySel.value ? paySel.value : selectedCompany);
    populateSelect(stmtSel, list, selectedCompany);
    if (stmtSel && stmtSel.value) selectedCompany = stmtSel.value;

    refreshStatement();
  }

  function refreshStatement() {
    var box = document.getElementById('ncorpStatementWrap');
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);

    var stmtSel = document.getElementById('ncorpStmtCompany');
    var monthInp = document.getElementById('ncorpStmtMonth');
    var compName = stmtSel ? stmtSel.value : selectedCompany;
    var mk = normalizeMonthKey(monthInp ? monthInp.value : selectedMonth);
    if (!compName || !mk) {
      box.appendChild(el('div', 'ncorp-empty', t('اختر شركة وشهرًا لعرض كشف الحساب.', 'Select a company and month to view statement.')));
      return;
    }

    var stmt = apiStatement(compName, mk);
    if (!stmt) {
      box.appendChild(el('div', 'ncorp-empty', t('تعذر تحميل كشف الحساب.', 'Unable to load statement.')));
      return;
    }

    var cur = t('ج.م', 'EGP');
    var headInfo = el('div', 'ncorp-actions');
    headInfo.appendChild(el('span', 'ncorp-badge', t('تاريخ الاستحقاق: ', 'Due: ') + stmt.dueDate));
    if (stmt.taxNo) {
      headInfo.appendChild(el('span', 'ncorp-badge', t('ضريبي: ', 'Tax: ') + stmt.taxNo));
    }
    if (stmt.closed) {
      headInfo.appendChild(el('span', 'ncorp-badge closed', t('الشهر مقفول', 'Closed')));
    }
    box.appendChild(headInfo);

    var kpis = el('div', 'ncorp-summary');
    function addKpi(label, val) {
      var k = el('div', 'ncorp-kpi');
      k.appendChild(el('div', 'ncorp-kpi-lbl', label));
      k.appendChild(el('div', 'ncorp-kpi-val', val));
      kpis.appendChild(k);
    }
    addKpi(t('الرصيد الافتتاحي', 'Opening'), formatEgp(stmt.openingBalancePiasters) + ' ' + cur);
    addKpi(t('صافي المسحوبات', 'Net Charges'), formatEgp(stmt.chargesTotalPiasters) + ' ' + cur);
    addKpi(t('الخصم', 'Discount'), formatEgp(stmt.discountTotalPiasters) + ' ' + cur);
    addKpi(t('السداد', 'Payments'), formatEgp(stmt.paymentsTotalPiasters) + ' ' + cur);
    addKpi(t('الرصيد الختامي', 'Closing'), formatEgp(stmt.closingBalancePiasters) + ' ' + cur);
    box.appendChild(kpis);

    var cRows = [];
    var i, c, p;
    for (i = 0; i < stmt.charges.length; i++) {
      c = stmt.charges[i];
      cRows.push([
        c.date,
        c.ref || '—',
        c.description || '—',
        formatEgp(c.grossPiasters),
        formatEgp(c.discountPiasters),
        formatEgp(c.netPiasters)
      ]);
    }
    box.appendChild(buildTable(
      [
        t('التاريخ', 'Date'),
        t('المرجع', 'Ref'),
        t('البيان', 'Description'),
        t('قبل الخصم', 'Gross'),
        t('الخصم', 'Discount'),
        t('الصافي', 'Net')
      ],
      cRows,
      t('لا توجد مسحوبات في هذا الشهر.', 'No charges in this month.')
    ));

    var pRows = [];
    for (i = 0; i < stmt.payments.length; i++) {
      p = stmt.payments[i];
      pRows.push([
        p.date,
        p.method || '—',
        p.ref || '—',
        formatEgp(p.amountPiasters) + ' ' + cur
      ]);
    }
    box.appendChild(buildTable(
      [
        t('تاريخ السداد', 'Payment Date'),
        t('الطريقة', 'Method'),
        t('المرجع', 'Ref'),
        t('المبلغ', 'Amount')
      ],
      pRows,
      t('لا توجد مدفوعات في هذا الشهر.', 'No payments in this month.')
    ));

    var closeBtn = document.getElementById('ncorpCloseMonthBtn');
    if (closeBtn) {
      closeBtn.disabled = stmt.closed || !canWrite();
    }
  }

  function buildCard() {
    injectStyles();
    selectedMonth = currentMonthKey();
    var editable = canWrite();

    var card = el('section', 'nova-card');
    card.id = CARD_ID;
    card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    card.appendChild(el('h3', '', t('عقود الشركات والفاتورة الشهرية', 'Corporate Accounts & Monthly Invoice')));

    var statusMsg = el('div', 'ncorp-status', editable ? '' : t('وضع العرض فقط.', 'Read-only mode.'));
    function setStatus(msg, isErr) {
      statusMsg.textContent = msg;
      statusMsg.className = isErr ? 'ncorp-status err' : 'ncorp-status';
      if (msg) toast(msg, isErr ? 'error' : 'success');
    }

    // 1. Companies list
    card.appendChild(el('h4', '', t('الشركات المتعاقدة', 'Contracted Companies')));
    var compWrap = el('div', '');
    compWrap.id = 'ncorpCompaniesWrap';
    card.appendChild(compWrap);

    function makeField(parent, labelText, id, placeholder, inputmode) {
      var wrap = el('div', 'ncorp-field');
      var lbl = el('label', '', labelText);
      lbl.setAttribute('for', id);
      var inp = el('input', 'ncorp-input');
      inp.id = id;
      inp.type = 'text';
      if (placeholder) inp.placeholder = placeholder;
      if (inputmode) inp.setAttribute('inputmode', inputmode);
      if (!editable) inp.disabled = true;
      wrap.appendChild(lbl);
      wrap.appendChild(inp);
      parent.appendChild(wrap);
      return inp;
    }

    function makeSelectField(parent, labelText, id, readOnlyAllowed) {
      var wrap = el('div', 'ncorp-field');
      var lbl = el('label', '', labelText);
      lbl.setAttribute('for', id);
      var sel = el('select', 'ncorp-select');
      sel.id = id;
      if (!readOnlyAllowed && !editable) sel.disabled = true;
      wrap.appendChild(lbl);
      wrap.appendChild(sel);
      parent.appendChild(wrap);
      return sel;
    }

    // 2. Add Company Form
    var addSec = el('div', 'ncorp-section');
    addSec.appendChild(el('h4', '', t('إضافة شركة جديدة', 'Add New Company')));
    var compGrid = el('div', 'ncorp-grid');
    var cName = makeField(compGrid, t('اسم الشركة', 'Company Name'), 'ncorpCompName', t('شركة النيل', 'Nile Co.'));
    var cTax = makeField(compGrid, t('الرقم الضريبي', 'Tax No'), 'ncorpCompTax', t('اختياري', 'Optional'));
    var cContact = makeField(compGrid, t('المسؤول', 'Contact'), 'ncorpCompContact', t('اختياري', 'Optional'));
    var cPhone = makeField(compGrid, t('الهاتف', 'Phone'), 'ncorpCompPhone', t('اختياري', 'Optional'), 'tel');
    var cLimit = makeField(compGrid, t('حد الائتمان (ج.م)', 'Credit Limit (EGP)'), 'ncorpCompLimit', '0', 'decimal');
    var cDisc = makeField(compGrid, t('نسبة الخصم %', 'Discount %'), 'ncorpCompDiscount', '0', 'numeric');
    var cDays = makeField(compGrid, t('أيام السداد', 'Pay Days'), 'ncorpCompDays', '30', 'numeric');
    addSec.appendChild(compGrid);

    var compAct = el('div', 'ncorp-actions');
    var addCompBtn = el('button', 'btn btn-primary', t('حفظ الشركة', 'Add Company'));
    addCompBtn.type = 'button';
    addCompBtn.id = 'ncorpAddCompBtn';
    if (!editable) addCompBtn.disabled = true;
    addCompBtn.addEventListener('click', function () {
      var limitVal = trimStr(cLimit.value);
      var limitPiasters = limitVal ? parseEgpToPiasters(limitVal) : 0;
      if (isNaN(limitPiasters) || limitPiasters < 0) {
        setStatus(t('حد الائتمان غير صالح', 'Invalid credit limit'), true);
        return;
      }
      var res = apiAddCompany({
        name: cName.value,
        taxNo: cTax.value,
        contact: cContact.value,
        phone: cPhone.value,
        creditLimitPiasters: limitPiasters,
        discountPercent: cDisc.value === '' ? 0 : cDisc.value,
        payDays: cDays.value === '' ? 30 : cDays.value
      });
      if (!res.ok) {
        setStatus(res.error, true);
      } else {
        cName.value = '';
        cTax.value = '';
        cContact.value = '';
        cPhone.value = '';
        cLimit.value = '';
        cDisc.value = '';
        cDays.value = '';
        setStatus(t('تمت إضافة الشركة بنجاح.', 'Company added successfully.'), false);
      }
    });
    compAct.appendChild(addCompBtn);
    addSec.appendChild(compAct);
    card.appendChild(addSec);

    // 3. Charge Form
    var chgSec = el('div', 'ncorp-section');
    chgSec.appendChild(el('h4', '', t('تسجيل مسحوبات / تصحيح', 'Add Charge / Correction')));
    var chgGrid = el('div', 'ncorp-grid');
    var chgComp = makeSelectField(chgGrid, t('الشركة', 'Company'), 'ncorpChargeCompany', false);
    var chgDate = makeField(chgGrid, t('التاريخ', 'Date'), 'ncorpChargeDate', t('٢٠٢٦-١١-٢١', '2026-11-21'));
    chgDate.value = todayStr();
    var chgRef = makeField(chgGrid, t('رقم الفاتورة / الإيصال', 'Invoice / Receipt Ref'), 'ncorpChargeRef', t('اختياري', 'Optional'));
    var chgDesc = makeField(chgGrid, t('البيان / سبب التصحيح', 'Description / Reason'), 'ncorpChargeDesc', t('أدوية شهرية', 'Monthly meds'));
    var chgAmt = makeField(chgGrid, t('المبلغ قبل الخصم (ج.م)', 'Gross Amount (EGP)'), 'ncorpChargeAmount', '0.00', 'decimal');
    chgSec.appendChild(chgGrid);

    var chgAct = el('div', 'ncorp-actions');
    var addChgBtn = el('button', 'btn btn-primary', t('تسجيل المسحوبات', 'Add Charge'));
    addChgBtn.type = 'button';
    addChgBtn.id = 'ncorpAddChargeBtn';
    if (!editable) addChgBtn.disabled = true;
    addChgBtn.addEventListener('click', function () {
      var amtPiasters = parseEgpToPiasters(chgAmt.value);
      if (isNaN(amtPiasters) || amtPiasters === 0) {
        setStatus(t('المبلغ غير صالح', 'Invalid amount'), true);
        return;
      }
      var res = apiAddCharge({
        company: chgComp.value,
        date: chgDate.value,
        ref: chgRef.value,
        description: chgDesc.value,
        amountPiasters: amtPiasters
      });
      if (!res.ok) {
        setStatus(res.error, true);
      } else {
        chgRef.value = '';
        chgDesc.value = '';
        chgAmt.value = '';
        setStatus(t('تم تسجيل الحركة بنجاح.', 'Charge recorded.'), false);
      }
    });
    chgAct.appendChild(addChgBtn);
    chgSec.appendChild(chgAct);
    card.appendChild(chgSec);

    // 4. Payment Form
    var paySec = el('div', 'ncorp-section');
    paySec.appendChild(el('h4', '', t('تسجيل سداد شركة', 'Record Payment')));
    var payGrid = el('div', 'ncorp-grid');
    var payComp = makeSelectField(payGrid, t('الشركة', 'Company'), 'ncorpPayCompany', false);
    var payDate = makeField(payGrid, t('التاريخ', 'Date'), 'ncorpPayDate', t('٢٠٢٦-١١-٢١', '2026-11-21'));
    payDate.value = todayStr();
    var payAmt = makeField(payGrid, t('المبلغ (ج.م)', 'Amount (EGP)'), 'ncorpPayAmount', '0.00', 'decimal');
    var payMethod = makeSelectField(payGrid, t('طريقة السداد', 'Method'), 'ncorpPayMethod', false);
    var methods = [
      t('نقدي', 'Cash'),
      t('تحويل بنكي', 'Bank Transfer'),
      t('شيك', 'Cheque')
    ];
    var mi, mOpt;
    for (mi = 0; mi < methods.length; mi++) {
      mOpt = document.createElement('option');
      mOpt.value = methods[mi];
      mOpt.textContent = methods[mi];
      payMethod.appendChild(mOpt);
    }
    var payRef = makeField(payGrid, t('المرجع', 'Ref'), 'ncorpPayRef', t('اختياري', 'Optional'));
    paySec.appendChild(payGrid);

    var payAct = el('div', 'ncorp-actions');
    var addPayBtn = el('button', 'btn btn-secondary', t('تسجيل السداد', 'Add Payment'));
    addPayBtn.type = 'button';
    addPayBtn.id = 'ncorpAddPayBtn';
    if (!editable) addPayBtn.disabled = true;
    addPayBtn.addEventListener('click', function () {
      var amtPiasters = parseEgpToPiasters(payAmt.value);
      if (isNaN(amtPiasters) || amtPiasters <= 0) {
        setStatus(t('مبلغ السداد غير صالح', 'Invalid payment amount'), true);
        return;
      }
      var res = apiAddPayment({
        company: payComp.value,
        date: payDate.value,
        amountPiasters: amtPiasters,
        method: payMethod.value,
        ref: payRef.value
      });
      if (!res.ok) {
        setStatus(res.error, true);
      } else {
        payAmt.value = '';
        payRef.value = '';
        setStatus(t('تم تسجيل السداد بنجاح.', 'Payment recorded.'), false);
      }
    });
    payAct.appendChild(addPayBtn);
    paySec.appendChild(payAct);
    card.appendChild(paySec);

    // 5. Statement View + Month Picker + Print & Close Month
    var stmtSec = el('div', 'ncorp-section');
    stmtSec.appendChild(el('h4', '', t('كشف الحساب والفاتورة الشهرية', 'Monthly Statement & Invoice')));
    var stmtGrid = el('div', 'ncorp-grid');
    var stmtComp = makeSelectField(stmtGrid, t('الشركة', 'Company'), 'ncorpStmtCompany', true);
    var stmtMonthWrap = el('div', 'ncorp-field');
    var stmtMonthLbl = el('label', '', t('الشهر (سنة-شهر)', 'Month (YYYY-MM)'));
    stmtMonthLbl.setAttribute('for', 'ncorpStmtMonth');
    var stmtMonth = el('input', 'ncorp-input');
    stmtMonth.id = 'ncorpStmtMonth';
    stmtMonth.type = 'text';
    stmtMonth.value = selectedMonth;
    stmtMonth.placeholder = t('٢٠٢٦-١١', '2026-11');
    stmtMonthWrap.appendChild(stmtMonthLbl);
    stmtMonthWrap.appendChild(stmtMonth);
    stmtGrid.appendChild(stmtMonthWrap);
    stmtSec.appendChild(stmtGrid);

    stmtComp.addEventListener('change', function () {
      selectedCompany = stmtComp.value;
      refreshStatement();
    });
    stmtMonth.addEventListener('input', function () {
      var mk = normalizeMonthKey(stmtMonth.value);
      if (mk) {
        selectedMonth = mk;
        refreshStatement();
      }
    });

    var stmtAct = el('div', 'ncorp-actions');
    var printBtn = el('button', 'btn btn-secondary', t('اطبع الفاتورة الشهرية', 'Print Monthly Invoice'));
    printBtn.type = 'button';
    printBtn.id = 'ncorpPrintBtn';
    printBtn.addEventListener('click', function () {
      var mk = normalizeMonthKey(stmtMonth.value);
      var stmt = apiStatement(stmtComp.value, mk);
      if (!stmt) {
        setStatus(t('اختر شركة وشهرًا صالحًا أولًا.', 'Select a valid company and month first.'), true);
        return;
      }
      var html = buildPrintableHtml(stmt);
      var win = null;
      try {
        win = window.open('', '_blank');
      } catch (e) {
        win = null;
      }
      if (!win) {
        setStatus(t('تعذر فتح نافذة الطباعة.', 'Could not open print window.'), true);
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
      try {
        win.focus();
        win.print();
      } catch (e) {}
    });

    var closeBtn = el('button', 'btn btn-primary', t('قفل الشهر', 'Close Month'));
    closeBtn.type = 'button';
    closeBtn.id = 'ncorpCloseMonthBtn';
    if (!editable) closeBtn.disabled = true;
    closeBtn.addEventListener('click', function () {
      var mk = normalizeMonthKey(stmtMonth.value);
      var res = apiCloseMonth(stmtComp.value, mk);
      if (!res.ok) {
        setStatus(res.error, true);
      } else {
        setStatus(t('تم قفل الشهر وحفظ الفاتورة.', 'Month closed and snapshot frozen.'), false);
      }
    });

    stmtAct.appendChild(printBtn);
    stmtAct.appendChild(closeBtn);
    stmtSec.appendChild(stmtAct);

    var stmtWrap = el('div', '');
    stmtWrap.id = 'ncorpStatementWrap';
    stmtSec.appendChild(stmtWrap);
    card.appendChild(stmtSec);

    card.appendChild(statusMsg);
    return card;
  }

  function isReportsPage() {
    if (document.body && document.body.dataset && document.body.dataset.activePage === 'reports') {
      return true;
    }
    return !!document.querySelector('.nova-tab.active[data-page="reports"],.nova-hostmark.active[data-page="reports"]');
  }

  function ensureMounted() {
    var pageView = document.getElementById('novaPageView');
    if (!pageView || pageView.hidden || !isReportsPage()) return;
    if (document.getElementById(CARD_ID)) return;
    pageView.appendChild(buildCard());
    refreshAll();
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

// app/624-vault-bank.js
(function () {
  'use strict';

  var STORAGE_KEY = 'nova-rx-vault-moves-v1';
  var MAX_RECORDS = 500;
  var CARD_ID = 'novaVaultCard';
  var STYLE_ID = 'novaVaultStyle';
  var TZ = 'Africa/Cairo';
  var MOVE_TYPES = ['drawer_in', 'bank_deposit', 'bank_withdraw', 'vault_expense'];

  function isEn() {
    try { return localStorage.getItem('nova-rx-language') === 'en'; } catch (e) { return false; }
  }

  var AR = {
    title: 'الخزنة الرئيسية والبنك',
    vault: 'رصيد الخزنة الرئيسية',
    bank: 'رصيد البنك',
    currency: 'ج.م',
    moveType: 'نوع الحركة',
    amount: 'المبلغ',
    reason: 'السبب / البيان',
    shiftRef: 'مرجع الوردية (اختياري)',
    submit: 'تسجيل الحركة',
    pullShift: 'جلب نقدية آخر وردية',
    dayLabel: 'حركات يوم',
    printBtn: 'طباعة كشف اليوم',
    empty: 'لا توجد حركات مسجلة لهذا اليوم',
    noPerm: 'ليس لديك صلاحية تسجيل حركات الخزنة',
    saved: 'تم تسجيل الحركة بنجاح',
    negErr: 'الرصيد غير كافٍ لإتمام هذه الحركة',
    badAmt: 'يرجى إدخال مبلغ صحيح أكبر من صفر',
    badReason: 'يرجى كتابة سبب الحركة',
    dupShift: 'تم توريد هذه الوردية مسبقاً',
    noShiftCash: 'لا توجد نقدية وردية مغلقة متاحة',
    colTime: 'الوقت',
    colType: 'الحركة',
    colAmt: 'المبلغ',
    colReason: 'البيان',
    colBy: 'بواسطة',
    drawer_in: 'توريد من الدرج',
    bank_deposit: 'إيداع في البنك',
    bank_withdraw: 'سحب من البنك',
    vault_expense: 'مصروف من الخزنة'
  };

  var EN = {
    title: 'Main Vault & Bank',
    vault: 'Main Vault Balance',
    bank: 'Bank Balance',
    currency: 'EGP',
    moveType: 'Move Type',
    amount: 'Amount',
    reason: 'Reason / Note',
    shiftRef: 'Shift Ref (optional)',
    submit: 'Record Move',
    pullShift: 'Load Closed Shift Cash',
    dayLabel: 'Daily Moves',
    printBtn: 'Print Day Sheet',
    empty: 'No moves recorded for this day',
    noPerm: 'Missing permission to record vault moves',
    saved: 'Move recorded successfully',
    negErr: 'Insufficient balance for this move',
    badAmt: 'Enter a valid amount greater than zero',
    badReason: 'Reason is required',
    dupShift: 'This shift was already handed over',
    noShiftCash: 'No closed shift counted cash found',
    colTime: 'Time',
    colType: 'Type',
    colAmt: 'Amount',
    colReason: 'Reason',
    colBy: 'By',
    drawer_in: 'Drawer Handover',
    bank_deposit: 'Bank Deposit',
    bank_withdraw: 'Bank Withdrawal',
    vault_expense: 'Vault Expense'
  };

  function t(k) { return (isEn() ? EN : AR)[k] || k; }

  function toast(msg, kind) {
    try { if (typeof window.showToast === 'function') window.showToast(msg, kind || 'success'); } catch (e) {}
  }

  function hasPerm(perm) {
    try {
      return !!(window.novaPerms && typeof window.novaPerms.require === 'function' && window.novaPerms.require(perm));
    } catch (e) {
      return false;
    }
  }

  function currentUser() {
    try {
      var u = window.novaAuth && typeof window.novaAuth.current === 'function' && window.novaAuth.current();
      return u && typeof u === 'object' ? { name: String(u.name || ''), role: String(u.role || '') } : { name: '', role: '' };
    } catch (e) {
      return { name: '', role: '' };
    }
  }

  function normalizeDigits(str) {
    return String(str == null ? '' : str)
      .replace(/[\u0660-\u0669]/g, function (ch) { return String(ch.charCodeAt(0) - 0x0660); })
      .replace(/[\u06F0-\u06F9]/g, function (ch) { return String(ch.charCodeAt(0) - 0x06F0); })
      .replace(/\u066B/g, '.')
      .replace(/[\u066C,]/g, '')
      .trim();
  }

  function toPiastres(raw) {
    var clean = normalizeDigits(raw);
    if (!clean) return -1;
    var n = Number(clean);
    if (!isFinite(n) || n <= 0) return -1;
    var c = Math.round(n * 100);
    if (c <= 0 || Math.abs(c / 100 - n) > 1e-6) return -1;
    return c;
  }

  function fromPiastres(c) { return Math.round(c) / 100; }
  function fmtMoney(n) { return Number(n || 0).toFixed(2) + ' ' + t('currency'); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function cairoDate(ms) {
    var d = new Date(ms || Date.now());
    try {
      var parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(d);
      var m = {};
      for (var i = 0; i < parts.length; i++) m[parts[i].type] = parts[i].value;
      return m.year + '-' + m.month + '-' + m.day;
    } catch (e) {
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
  }

  function cairoTime(ms) {
    var d = new Date(ms || Date.now());
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit'
      }).format(d);
    } catch (e) {
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
  }

  function loadMoves() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function saveMoves(arr) {
    try {
      var trimmed = arr.length > MAX_RECORDS ? arr.slice(arr.length - MAX_RECORDS) : arr;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return true;
    } catch (e) {
      return false;
    }
  }

  function computeBalances(moves) {
    var v = 0, b = 0;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      if (!m || typeof m !== 'object') continue;
      var c = (typeof m.amountCents === 'number' && isFinite(m.amountCents))
        ? Math.round(m.amountCents)
        : Math.round((Number(m.amount) || 0) * 100);
      if (!isFinite(c) || c <= 0) continue;
      if (m.type === 'drawer_in') { v += c; }
      else if (m.type === 'bank_deposit') { v -= c; b += c; }
      else if (m.type === 'bank_withdraw') { b -= c; v += c; }
      else if (m.type === 'vault_expense') { v -= c; }
    }
    return { vault: fromPiastres(v), bank: fromPiastres(b), vaultCents: v, bankCents: b };
  }

  // The last closed shift is the last row of nova-rx-shift-closings-v1 (written by the shift close in app/130): { id, at, counted, ... }.
  // nova-rx-shift-v1.counted is only the count being typed before the close, so it is never used here.
  function getClosedShiftCash() {
    var rec = null;
    try {
      var arr = JSON.parse(localStorage.getItem('nova-rx-shift-closings-v1') || '[]');
      if (Array.isArray(arr) && arr.length) rec = arr[arr.length - 1];
    } catch (e) { rec = null; }
    if (!rec || typeof rec !== 'object' || rec.counted == null) return null;
    var amt = Number(rec.counted);
    if (!isFinite(amt) || amt <= 0) return null;
    var ref = String(rec.id || ('SC' + (rec.at || '')));
    return { amount: fromPiastres(Math.round(amt * 100)), shiftRef: ref };
  }

  function move(opts) {
    if (!hasPerm('accounts.manage')) { // owner/manager (auth-permissions ACTIONS; an unknown action is always denied)
      toast(t('noPerm'), 'error');
      return { ok: false, error: 'forbidden' };
    }
    opts = opts || {};
    var type = String(opts.type || '');
    if (MOVE_TYPES.indexOf(type) === -1) return { ok: false, error: 'bad-type' };
    var cents = toPiastres(opts.amount);
    if (cents <= 0) {
      toast(t('badAmt'), 'error');
      return { ok: false, error: 'bad-amount' };
    }
    var reason = String(opts.reason || '').trim();
    if (!reason) {
      toast(t('badReason'), 'error');
      return { ok: false, error: 'reason-required' };
    }
    var shiftRef = opts.shiftRef ? String(opts.shiftRef).trim() : '';
    var list = loadMoves();
    if (type === 'drawer_in' && shiftRef) {
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].type === 'drawer_in' && list[i].shiftRef === shiftRef) {
          toast(t('dupShift'), 'error');
          return { ok: false, error: 'duplicate-shift' };
        }
      }
    }
    var bal = computeBalances(list);
    if ((type === 'bank_deposit' || type === 'vault_expense') && cents > bal.vaultCents) {
      toast(t('negErr'), 'error');
      return { ok: false, error: 'insufficient-vault' };
    }
    if (type === 'bank_withdraw' && cents > bal.bankCents) {
      toast(t('negErr'), 'error');
      return { ok: false, error: 'insufficient-bank' };
    }
    var now = typeof opts.at === 'number' && isFinite(opts.at) ? opts.at : Date.now();
    var u = currentUser();
    var rec = {
      id: 'vm-' + now + '-' + Math.floor(Math.random() * 10000),
      type: type,
      amount: fromPiastres(cents),
      amountCents: cents,
      reason: reason,
      shiftRef: shiftRef || null,
      by: u.name,
      role: u.role,
      at: now,
      date: cairoDate(now)
    };
    list.push(rec);
    if (!saveMoves(list)) return { ok: false, error: 'storage-failed' };
    toast(t('saved'), 'success');
    return { ok: true, move: rec, balances: balances() };
  }

  function balances() {
    var b = computeBalances(loadMoves());
    return { vault: b.vault, bank: b.bank };
  }

  function list() { return loadMoves(); }

  function daily(dateStr) {
    var day = dateStr || cairoDate(Date.now());
    var all = loadMoves();
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i] && all[i].date === day) out.push(all[i]);
    }
    return out;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '#' + CARD_ID + '{background:#14181d;border:1px solid #343b44;border-radius:12px;padding:16px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;}' +
      '#' + CARD_ID + ' *{box-sizing:border-box;}' +
      '#' + CARD_ID + ' .nv-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px;}' +
      '#' + CARD_ID + ' .nv-title{margin:0;font-size:18px;color:#79c9eb;}' +
      '#' + CARD_ID + ' .nv-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px;}' +
      '#' + CARD_ID + ' .nv-kpi{background:#0f1318;border:1px solid #343b44;border-radius:10px;padding:10px;}' +
      '#' + CARD_ID + ' .nv-kpi-lbl{font-size:12px;color:#9fb0c0;margin-bottom:4px;}' +
      '#' + CARD_ID + ' .nv-kpi-val{font-size:18px;font-weight:700;color:#e6edf3;}' +
      '#' + CARD_ID + ' .nv-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px;}' +
      '#' + CARD_ID + ' .nv-field{display:flex;flex-direction:column;gap:4px;min-width:0;}' +
      '#' + CARD_ID + ' .nv-field label{font-size:12px;color:#9fb0c0;}' +
      '#' + CARD_ID + ' .nv-input{min-height:44px;width:100%;max-width:100%;padding:8px 10px;background:#0f1318;border:1px solid #343b44;border-radius:8px;color:#e6edf3;font-size:14px;}' +
      '#' + CARD_ID + ' .nv-actions{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;}' +
      '#' + CARD_ID + ' .nv-actions .btn{min-height:44px;}' +
      '#' + CARD_ID + ' .nv-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px;}' +
      '#' + CARD_ID + ' .nv-tbl-wrap{width:100%;overflow-x:auto;border:1px solid #343b44;border-radius:8px;}' +
      '#' + CARD_ID + ' table{width:100%;border-collapse:collapse;font-size:13px;}' +
      '#' + CARD_ID + ' th,#' + CARD_ID + ' td{padding:8px 10px;border-bottom:1px solid #343b44;text-align:start;white-space:nowrap;}' +
      '#' + CARD_ID + ' th{background:#0f1318;color:#79c9eb;}';
    document.head.appendChild(s);
  }

  function printDaily(dayStr) {
    var rows = daily(dayStr);
    var bal = balances();
    var w = window.open('', '_blank', 'width=720,height=600');
    if (!w) return;
    var doc = w.document;
    doc.title = t('title') + ' - ' + dayStr;
    doc.documentElement.setAttribute('dir', isEn() ? 'ltr' : 'rtl');
    var style = doc.createElement('style');
    style.textContent = 'body{font-family:sans-serif;padding:16px;color:#111;}table{width:100%;border-collapse:collapse;margin-top:12px;}th,td{border:1px solid #ccc;padding:6px 8px;text-align:start;}';
    doc.head.appendChild(style);
    var h = doc.createElement('h2');
    h.textContent = t('title') + ' - ' + dayStr;
    doc.body.appendChild(h);
    var p = doc.createElement('p');
    p.textContent = t('vault') + ': ' + fmtMoney(bal.vault) + ' | ' + t('bank') + ': ' + fmtMoney(bal.bank);
    doc.body.appendChild(p);
    var tbl = doc.createElement('table');
    var thead = doc.createElement('thead');
    var hr = doc.createElement('tr');
    ['colTime', 'colType', 'colAmt', 'colReason', 'colBy'].forEach(function (k) {
      var th = doc.createElement('th');
      th.textContent = t(k);
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    tbl.appendChild(thead);
    var tb = doc.createElement('tbody');
    if (!rows.length) {
      var er = doc.createElement('tr');
      var ed = doc.createElement('td');
      ed.colSpan = 5;
      ed.textContent = t('empty');
      er.appendChild(ed);
      tb.appendChild(er);
    } else {
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var tr = doc.createElement('tr');
        var vals = [cairoTime(r.at), t(r.type), fmtMoney(r.amount), r.reason, r.by || '-'];
        for (var j = 0; j < vals.length; j++) {
          var td = doc.createElement('td');
          td.textContent = vals[j];
          tr.appendChild(td);
        }
        tb.appendChild(tr);
      }
    }
    tbl.appendChild(tb);
    doc.body.appendChild(tbl);
    w.focus();
    w.print();
  }

  function renderCard(card) {
    while (card.firstChild) card.removeChild(card.firstChild);
    card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    var selectedDay = card.getAttribute('data-day') || cairoDate(Date.now());
    var bal = balances();

    var head = document.createElement('div');
    head.className = 'nv-head';
    var h3 = document.createElement('h3');
    h3.className = 'nv-title';
    h3.textContent = t('title');
    head.appendChild(h3);
    card.appendChild(head);

    var kpis = document.createElement('div');
    kpis.className = 'nv-kpis';
    var k1 = document.createElement('div');
    k1.className = 'nv-kpi';
    var k1l = document.createElement('div'); k1l.className = 'nv-kpi-lbl'; k1l.textContent = t('vault');
    var k1v = document.createElement('div'); k1v.className = 'nv-kpi-val'; k1v.id = 'nvVaultBal'; k1v.textContent = fmtMoney(bal.vault);
    k1.appendChild(k1l); k1.appendChild(k1v);
    var k2 = document.createElement('div');
    k2.className = 'nv-kpi';
    var k2l = document.createElement('div'); k2l.className = 'nv-kpi-lbl'; k2l.textContent = t('bank');
    var k2v = document.createElement('div'); k2v.className = 'nv-kpi-val'; k2v.id = 'nvBankBal'; k2v.textContent = fmtMoney(bal.bank);
    k2.appendChild(k2l); k2.appendChild(k2v);
    kpis.appendChild(k1); kpis.appendChild(k2);
    card.appendChild(kpis);

    var form = document.createElement('div');
    form.className = 'nv-form';

    var fType = document.createElement('div'); fType.className = 'nv-field';
    var lType = document.createElement('label'); lType.textContent = t('moveType');
    var sel = document.createElement('select'); sel.className = 'nv-input'; sel.id = 'nvMoveType';
    for (var i = 0; i < MOVE_TYPES.length; i++) {
      var opt = document.createElement('option');
      opt.value = MOVE_TYPES[i];
      opt.textContent = t(MOVE_TYPES[i]);
      sel.appendChild(opt);
    }
    fType.appendChild(lType); fType.appendChild(sel);

    var fAmt = document.createElement('div'); fAmt.className = 'nv-field';
    var lAmt = document.createElement('label'); lAmt.textContent = t('amount');
    var inAmt = document.createElement('input');
    inAmt.type = 'text'; inAmt.setAttribute('inputmode', 'decimal'); inAmt.className = 'nv-input'; inAmt.id = 'nvMoveAmt';
    fAmt.appendChild(lAmt); fAmt.appendChild(inAmt);

    var fReason = document.createElement('div'); fReason.className = 'nv-field';
    var lReason = document.createElement('label'); lReason.textContent = t('reason');
    var inReason = document.createElement('input');
    inReason.type = 'text'; inReason.className = 'nv-input'; inReason.id = 'nvMoveReason';
    fReason.appendChild(lReason); fReason.appendChild(inReason);

    var fRef = document.createElement('div'); fRef.className = 'nv-field';
    var lRef = document.createElement('label'); lRef.textContent = t('shiftRef');
    var inRef = document.createElement('input');
    inRef.type = 'text'; inRef.className = 'nv-input'; inRef.id = 'nvShiftRef';
    fRef.appendChild(lRef); fRef.appendChild(inRef);

    form.appendChild(fType); form.appendChild(fAmt); form.appendChild(fReason); form.appendChild(fRef);
    card.appendChild(form);

    var actions = document.createElement('div');
    actions.className = 'nv-actions';
    var btnSave = document.createElement('button');
    btnSave.type = 'button'; btnSave.className = 'btn btn-primary'; btnSave.id = 'nvSaveBtn';
    btnSave.textContent = t('submit');
    btnSave.addEventListener('click', function () {
      var res = move({ type: sel.value, amount: inAmt.value, reason: inReason.value, shiftRef: inRef.value });
      if (res.ok) renderCard(card);
    });
    var btnShift = document.createElement('button');
    btnShift.type = 'button'; btnShift.className = 'btn btn-secondary'; btnShift.id = 'nvPullShiftBtn';
    btnShift.textContent = t('pullShift');
    btnShift.addEventListener('click', function () {
      var sc = getClosedShiftCash();
      if (!sc) { toast(t('noShiftCash'), 'error'); return; }
      sel.value = 'drawer_in';
      inAmt.value = String(sc.amount);
      inRef.value = sc.shiftRef;
      if (!inReason.value.trim()) inReason.value = t('drawer_in');
    });
    actions.appendChild(btnSave);
    actions.appendChild(btnShift);
    card.appendChild(actions);

    var bar = document.createElement('div');
    bar.className = 'nv-bar';
    var lDay = document.createElement('label'); lDay.textContent = t('dayLabel');
    var inDay = document.createElement('input');
    inDay.type = 'date'; inDay.className = 'nv-input'; inDay.style.width = 'auto'; inDay.value = selectedDay;
    inDay.addEventListener('change', function () {
      card.setAttribute('data-day', inDay.value || cairoDate(Date.now()));
      renderCard(card);
    });
    var btnPrint = document.createElement('button');
    btnPrint.type = 'button'; btnPrint.className = 'btn btn-secondary';
    btnPrint.textContent = t('printBtn');
    btnPrint.addEventListener('click', function () { printDaily(selectedDay); });
    bar.appendChild(lDay); bar.appendChild(inDay); bar.appendChild(btnPrint);
    card.appendChild(bar);

    var wrap = document.createElement('div');
    wrap.className = 'nv-tbl-wrap';
    var tbl = document.createElement('table');
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    var cols = ['colTime', 'colType', 'colAmt', 'colReason', 'colBy'];
    for (var c = 0; c < cols.length; c++) {
      var th = document.createElement('th');
      th.textContent = t(cols[c]);
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    tbl.appendChild(thead);

    var tbody = document.createElement('tbody');
    var rows = daily(selectedDay);
    if (!rows.length) {
      var er = document.createElement('tr');
      var ed = document.createElement('td');
      ed.colSpan = 5;
      ed.textContent = t('empty');
      er.appendChild(ed);
      tbody.appendChild(er);
    } else {
      for (var r = rows.length - 1; r >= 0; r--) {
        var item = rows[r];
        var tr = document.createElement('tr');
        var cells = [cairoTime(item.at), t(item.type), fmtMoney(item.amount), item.reason, item.by || '-'];
        for (var j = 0; j < cells.length; j++) {
          var td = document.createElement('td');
          td.textContent = cells[j];
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    }
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    card.appendChild(wrap);
  }

  function isReportsActive() {
    if (document.body && document.body.dataset && document.body.dataset.activePage === 'reports') return true;
    return !!document.querySelector('.nova-tab.active[data-page="reports"],.nova-hostmark.active[data-page="reports"]');
  }

  var mounting = false;
  function tryMount() {
    if (mounting) return;
    var pv = document.getElementById('novaPageView');
    if (!pv) return;
    var existing = document.getElementById(CARD_ID);
    if (!isReportsActive()) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }
    if (existing) return;
    mounting = true;
    try {
      injectStyles();
      var card = document.createElement('section');
      card.id = CARD_ID;
      renderCard(card);
      pv.appendChild(card);
    } finally {
      mounting = false;
    }
  }

  function initObserver() {
    var pv = document.getElementById('novaPageView');
    if (pv && typeof MutationObserver === 'function') {
      new MutationObserver(function () { tryMount(); }).observe(pv, { childList: true });
    }
    if (document.body && typeof MutationObserver === 'function') {
      new MutationObserver(function () { tryMount(); }).observe(document.body, { attributes: true, attributeFilter: ['data-active-page'] });
    }
    document.addEventListener('click', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('.nova-tab')) setTimeout(tryMount, 30);
    });
    tryMount();
  }

  window.novaVault = {
    move: move,
    balances: balances,
    list: list,
    daily: daily,
    getClosedShiftCash: getClosedShiftCash,
    mount: tryMount
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initObserver);
  else initObserver();
})();

// app/626-staff-attendance-kpis.js
(function () {
  'use strict';

  var STORAGE_KEY = 'nova-rx-staff-attendance-v1';
  var CFG_KEY = 'nova-rx-staff-start-time-v1';
  var MAX_RECORDS = 500;
  var CARD_ID = 'novaStaffStatsCard';
  var STYLE_ID = 'novaStaffStatsStyle';
  var TZ = 'Africa/Cairo';
  var GRACE_MIN = 10;

  function isEn() {
    try { return localStorage.getItem('nova-rx-language') === 'en'; } catch (e) { return false; }
  }

  var AR = {
    title: 'الحضور ومبيعات كل موظف',
    checkIn: 'تسجيل حضور',
    checkOut: 'تسجيل انصراف',
    startTime: 'موعد بدء العمل',
    saveTime: 'حفظ الموعد',
    from: 'من تاريخ',
    to: 'إلى تاريخ',
    refresh: 'تحديث التقرير',
    ownerOnly: 'عرض مؤشرات الموظفين متاح للمالك فقط',
    notLogged: 'يرجى تسجيل الدخول أولاً',
    checkedIn: 'تم تسجيل الحضور',
    checkedOut: 'تم تسجيل الانصراف',
    alreadyIn: 'تم تسجيل الحضور بالفعل',
    notIn: 'لا يوجد حضور مفتوح لتسجيل الانصراف',
    badTime: 'صيغة الوقت غير صحيحة',
    timeSaved: 'تم حفظ موعد بدء العمل',
    noData: 'لا توجد بيانات موظفين في هذه الفترة',
    unattr: 'فواتير غير منسوبة لموظف',
    currency: 'ج.م',
    colEmp: 'الموظف',
    colHrs: 'الساعات',
    colLate: 'التأخير (د)',
    colSales: 'المبيعات',
    colRet: 'المرتجعات',
    colDisc: 'الخصومات',
    colSph: 'مبيعات/ساعة',
    colRetRate: 'نسبة المرتجع',
    colDiscRate: 'نسبة الخصم'
  };

  var EN = {
    title: 'Attendance & Staff Sales',
    checkIn: 'Check In',
    checkOut: 'Check Out',
    startTime: 'Shift Start Time',
    saveTime: 'Save Time',
    from: 'From Date',
    to: 'To Date',
    refresh: 'Refresh',
    ownerOnly: 'Staff KPIs are restricted to owner permission',
    notLogged: 'Please sign in first',
    checkedIn: 'Checked in',
    checkedOut: 'Checked out',
    alreadyIn: 'Already checked in',
    notIn: 'No open check-in found',
    badTime: 'Invalid time format (HH:MM)',
    timeSaved: 'Start time saved',
    noData: 'No employee data in this range',
    unattr: 'Unattributed invoices',
    currency: 'EGP',
    colEmp: 'Employee',
    colHrs: 'Hours',
    colLate: 'Late (m)',
    colSales: 'Sales',
    colRet: 'Returns',
    colDisc: 'Discounts',
    colSph: 'Sales/Hr',
    colRetRate: 'Return %',
    colDiscRate: 'Discount %'
  };

  function t(k) { return (isEn() ? EN : AR)[k] || k; }
  function toast(msg, kind) {
    try { if (typeof window.showToast === 'function') window.showToast(msg, kind || 'success'); } catch (e) {}
  }

  function hasPerm(perm) {
    try {
      return !!(window.novaPerms && typeof window.novaPerms.require === 'function' && window.novaPerms.require(perm));
    } catch (e) {
      return false;
    }
  }

  function currentUser() {
    try {
      var u = window.novaAuth && typeof window.novaAuth.current === 'function' && window.novaAuth.current();
      if (!u || typeof u !== 'object') return null;
      var name = String(u.name || '').trim();
      var id = String(u.id || name).trim();
      if (!id) return null;
      return { id: id, name: name || id, role: String(u.role || '') };
    } catch (e) {
      return null;
    }
  }

  function normalizeDigits(str) {
    return String(str == null ? '' : str)
      .replace(/[\u0660-\u0669]/g, function (ch) { return String(ch.charCodeAt(0) - 0x0660); })
      .replace(/[\u06F0-\u06F9]/g, function (ch) { return String(ch.charCodeAt(0) - 0x06F0); })
      .trim();
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function r2(n) { return Math.round(n * 100) / 100; }

  var cairoFmt = null;
  try {
    cairoFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  } catch (e) {}

  function cairoParts(ms) {
    var d = new Date(ms);
    if (cairoFmt) {
      var p = {};
      var arr = cairoFmt.formatToParts(d);
      for (var i = 0; i < arr.length; i++) p[arr[i].type] = +arr[i].value;
      return p;
    }
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() };
  }

  function offsetMs(ms) {
    var p = cairoParts(ms);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  }

  function cairoDate(ms) {
    var p = cairoParts(ms || Date.now());
    return p.year + '-' + pad2(p.month) + '-' + pad2(p.day);
  }

  function cairoToMs(date, hhmm, addDays) {
    var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    var tm = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
    if (!d || !tm) return NaN;
    var wall = Date.UTC(+d[1], +d[2] - 1, +d[3] + (addDays || 0), +tm[1], +tm[2]);
    var guess = wall - offsetMs(wall);
    return wall - offsetMs(guess);
  }

  function getStartTime() {
    try {
      var v = localStorage.getItem(CFG_KEY);
      if (v && /^([01]\d|2[0-3]):([0-5]\d)$/.test(v)) return v;
    } catch (e) {}
    return '09:00';
  }

  function setStartTime(hhmm) {
    if (!hasPerm('accounts.manage')) { toast(t('ownerOnly'), 'error'); return { ok: false, error: 'forbidden' }; }
    var clean = normalizeDigits(hhmm);
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(clean)) { toast(t('badTime'), 'error'); return { ok: false, error: 'bad-time' }; }
    try { localStorage.setItem(CFG_KEY, clean); } catch (e) { return { ok: false, error: 'storage-failed' }; }
    toast(t('timeSaved'), 'success');
    return { ok: true, startTime: clean };
  }

  function loadEvents() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function saveEvents(arr) {
    try {
      var trimmed = arr.length > MAX_RECORDS ? arr.slice(arr.length - MAX_RECORDS) : arr;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return true;
    } catch (e) {
      return false;
    }
  }

  function findOpenIn(events, empId) {
    var open = null;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (!e || e.empId !== empId) continue;
      if (e.kind === 'in') open = e;
      else if (e.kind === 'out') open = null;
    }
    return open;
  }

  function checkIn(opts) {
    opts = opts || {};
    var u = currentUser();
    if (!u) { toast(t('notLogged'), 'error'); return { ok: false, error: 'not-logged-in' }; }
    var events = loadEvents();
    if (findOpenIn(events, u.id)) { toast(t('alreadyIn'), 'error'); return { ok: false, error: 'already-clocked-in' }; }
    var now = typeof opts.at === 'number' && isFinite(opts.at) ? opts.at : Date.now();
    var day = cairoDate(now);
    var schedMs = cairoToMs(day, getStartTime(), 0);
    var diffMin = isFinite(schedMs) ? Math.round((now - schedMs) / 60000) : 0;
    var lateMin = diffMin > GRACE_MIN ? diffMin : 0;
    var ev = {
      id: 'att-' + now + '-' + Math.floor(Math.random() * 10000),
      kind: 'in',
      empId: u.id,
      empName: u.name,
      date: day,
      at: now,
      lateMinutes: lateMin
    };
    events.push(ev);
    if (!saveEvents(events)) return { ok: false, error: 'storage-failed' };
    toast(t('checkedIn'), 'success');
    return { ok: true, event: ev };
  }

  function checkOut(opts) {
    opts = opts || {};
    var u = currentUser();
    if (!u) { toast(t('notLogged'), 'error'); return { ok: false, error: 'not-logged-in' }; }
    var events = loadEvents();
    var open = findOpenIn(events, u.id);
    if (!open) { toast(t('notIn'), 'error'); return { ok: false, error: 'not-clocked-in' }; }
    var now = typeof opts.at === 'number' && isFinite(opts.at) ? opts.at : Date.now();
    if (now < open.at) return { ok: false, error: 'bad-time' };
    var ev = {
      id: 'att-' + now + '-' + Math.floor(Math.random() * 10000),
      kind: 'out',
      empId: u.id,
      empName: u.name,
      date: cairoDate(now),
      at: now,
      inId: open.id,
      workedMinutes: Math.max(0, Math.round((now - open.at) / 60000))
    };
    events.push(ev);
    if (!saveEvents(events)) return { ok: false, error: 'storage-failed' };
    toast(t('checkedOut'), 'success');
    return { ok: true, event: ev };
  }

  function listPunches() {
    if (!hasPerm('accounts.manage')) return { ok: false, error: 'forbidden', events: [] };
    return { ok: true, events: loadEvents() };
  }

  function readAppSales() {
    var keys = ['nova-rx-sales-v1', 'nova-rx-invoices-v1', 'nova-rx-ledger-v1', 'nova_rx_sales', 'nova-rx-returns-v1'];
    var out = [];
    var seen = {};
    for (var k = 0; k < keys.length; k++) {
      try {
        var raw = localStorage.getItem(keys[k]);
        if (!raw) continue;
        var parsed = JSON.parse(raw);
        var arr = Array.isArray(parsed)
          ? parsed
          : (parsed && Array.isArray(parsed.sales) ? parsed.sales : (parsed && Array.isArray(parsed.items) ? parsed.items : []));
        for (var i = 0; i < arr.length; i++) {
          var s = arr[i];
          if (!s || typeof s !== 'object') continue;
          var sid = s.id || s.invoiceId || (keys[k] + '-' + i);
          if (seen[sid]) continue;
          seen[sid] = 1;
          if (keys[k] === 'nova-rx-returns-v1' && !s.type) {
            var copy = {};
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) copy[p] = s[p];
            copy.type = 'return';
            out.push(copy);
          } else {
            out.push(s);
          }
        }
      } catch (e) {}
    }
    return out;
  }

  function parseSaleTime(s) {
    var v = s.at != null ? s.at : (s.timestamp != null ? s.timestamp : (s.createdAt != null ? s.createdAt : s.date));
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v) {
      var parsed = Date.parse(v);
      if (isFinite(parsed)) return parsed;
    }
    return NaN;
  }

  function report(fromDate, toDate, overrideSales) {
    if (!hasPerm('accounts.manage')) return { ok: false, error: 'forbidden' };
    var from = fromDate || cairoDate(Date.now());
    var to = toDate || from;
    var fromMs = cairoToMs(from, '00:00', 0);
    var toMs = cairoToMs(to, '00:00', 1);
    if (!isFinite(fromMs) || !isFinite(toMs) || toMs <= fromMs) return { ok: false, error: 'bad-period' };

    var map = {};
    function ensure(id, name) {
      if (!map[id]) {
        map[id] = {
          empId: id, empName: name || id,
          workedMinutes: 0, lateMinutes: 0, openPunches: 0,
          salesCents: 0, returnsCents: 0, discountsCents: 0, invoices: 0
        };
      }
      if (name && map[id].empName === id) map[id].empName = name;
      return map[id];
    }

    var events = loadEvents();
    var openByEmp = {};
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (!e || !e.empId) continue;
      if (e.kind === 'in') {
        openByEmp[e.empId] = e;
        if (e.at >= fromMs && e.at < toMs) {
          var rowIn = ensure(e.empId, e.empName);
          rowIn.lateMinutes += Number(e.lateMinutes) || 0;
        }
      } else if (e.kind === 'out') {
        var op = openByEmp[e.empId];
        openByEmp[e.empId] = null;
        if (op && e.at > op.at) {
          var a = Math.max(op.at, fromMs);
          var b = Math.min(e.at, toMs);
          if (b > a) {
            var rowOut = ensure(e.empId, e.empName || op.empName);
            rowOut.workedMinutes += Math.round((b - a) / 60000);
          }
        }
      }
    }
    var oKeys = Object.keys(openByEmp);
    for (var oi = 0; oi < oKeys.length; oi++) {
      var oe = openByEmp[oKeys[oi]];
      if (oe && oe.at >= fromMs && oe.at < toMs) {
        ensure(oe.empId, oe.empName).openPunches++;
      }
    }

    var salesList = Array.isArray(overrideSales) ? overrideSales : readAppSales();
    var unattributed = 0;
    var bySale = {}; // app return rows carry only saleId: the return counts for whoever made that sale
    for (var bi = 0; bi < salesList.length; bi++) if (salesList[bi] && salesList[bi].id && salesList[bi].type !== 'return') bySale[salesList[bi].id] = salesList[bi];
    for (var si = 0; si < salesList.length; si++) {
      var s = salesList[si];
      if (!s || s.voided) continue;
      var ts = parseSaleTime(s);
      if (!isFinite(ts) || ts < fromMs || ts >= toMs) continue;
      var src = (s.type === 'return' && s.saleId && bySale[s.saleId] && !(s.employeeId || s.cashierId || s.cashier)) ? bySale[s.saleId] : s;
      var empKey = src.employeeId || src.cashierId || src.cashier || src.cashierName || src.user || src.createdBy || '';
      empKey = String(empKey).trim();
      if (!empKey) { unattributed++; continue; }
      var erow = ensure(empKey, String(src.cashierName || src.cashier || empKey));
      var tot = Number(s.total != null ? s.total : (s.grandTotal != null ? s.grandTotal : (s.amount != null ? s.amount : 0))) || 0;
      var ref = Number(s.refunded != null ? s.refunded : (s.returnAmount != null ? s.returnAmount : 0)) || 0;
      var disc = Number(s.discount != null ? s.discount : (s.discountTotal != null ? s.discountTotal : 0)) || 0;
      if (s.type === 'return' || tot < 0) {
        erow.returnsCents += Math.round(Math.abs(tot) * 100);
      } else {
        erow.salesCents += Math.round(Math.max(0, tot) * 100);
        erow.returnsCents += Math.round(Math.max(0, ref) * 100);
        erow.discountsCents += Math.round(Math.max(0, disc) * 100);
        erow.invoices++;
      }
    }

    var rows = [];
    var ids = Object.keys(map);
    for (var ri = 0; ri < ids.length; ri++) {
      var x = map[ids[ri]];
      var sales = x.salesCents / 100;
      var returns = x.returnsCents / 100;
      var netSales = (x.salesCents - x.returnsCents) / 100;
      var discounts = x.discountsCents / 100;
      var workedHours = r2(x.workedMinutes / 60);
      rows.push({
        empId: x.empId,
        empName: x.empName,
        workedMinutes: x.workedMinutes,
        workedHours: workedHours,
        lateMinutes: x.lateMinutes,
        openPunches: x.openPunches,
        invoices: x.invoices,
        sales: r2(sales),
        returns: r2(returns),
        netSales: r2(netSales),
        discounts: r2(discounts),
        salesPerHour: x.workedMinutes > 0 ? r2(netSales / (x.workedMinutes / 60)) : null,
        returnRatePct: x.salesCents > 0 ? r2((x.returnsCents / x.salesCents) * 100) : null,
        discountRatePct: x.salesCents > 0 ? r2((x.discountsCents / x.salesCents) * 100) : null
      });
    }
    return { ok: true, from: from, to: to, rows: rows, unattributedSales: unattributed };
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '#' + CARD_ID + '{background:#14181d;border:1px solid #343b44;border-radius:12px;padding:16px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;}' +
      '#' + CARD_ID + ' *{box-sizing:border-box;}' +
      '#' + CARD_ID + ' .ns-title{margin:0 0 12px 0;font-size:18px;color:#79c9eb;}' +
      '#' + CARD_ID + ' .ns-row{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:12px;}' +
      '#' + CARD_ID + ' .ns-field{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 120px;}' +
      '#' + CARD_ID + ' .ns-field label{font-size:12px;color:#9fb0c0;}' +
      '#' + CARD_ID + ' .ns-input{min-height:44px;width:100%;max-width:100%;padding:8px 10px;background:#0f1318;border:1px solid #343b44;border-radius:8px;color:#e6edf3;font-size:14px;}' +
      '#' + CARD_ID + ' .btn{min-height:44px;}' +
      '#' + CARD_ID + ' .ns-note{font-size:13px;color:#9fb0c0;margin:8px 0;}' +
      '#' + CARD_ID + ' .ns-tbl-wrap{width:100%;overflow-x:auto;border:1px solid #343b44;border-radius:8px;}' +
      '#' + CARD_ID + ' table{width:100%;border-collapse:collapse;font-size:13px;}' +
      '#' + CARD_ID + ' th,#' + CARD_ID + ' td{padding:8px 10px;border-bottom:1px solid #343b44;text-align:start;white-space:nowrap;}' +
      '#' + CARD_ID + ' th{background:#0f1318;color:#79c9eb;}';
    document.head.appendChild(s);
  }

  function renderCard(card) {
    while (card.firstChild) card.removeChild(card.firstChild);
    card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    var today = cairoDate(Date.now());
    var fromVal = card.getAttribute('data-from') || today;
    var toVal = card.getAttribute('data-to') || today;

    var h3 = document.createElement('h3');
    h3.className = 'ns-title';
    h3.textContent = t('title');
    card.appendChild(h3);

    var punchRow = document.createElement('div');
    punchRow.className = 'ns-row';
    var btnIn = document.createElement('button');
    btnIn.type = 'button'; btnIn.className = 'btn btn-primary'; btnIn.id = 'nsCheckInBtn';
    btnIn.textContent = t('checkIn');
    btnIn.addEventListener('click', function () { checkIn(); renderCard(card); });
    var btnOut = document.createElement('button');
    btnOut.type = 'button'; btnOut.className = 'btn btn-secondary'; btnOut.id = 'nsCheckOutBtn';
    btnOut.textContent = t('checkOut');
    btnOut.addEventListener('click', function () { checkOut(); renderCard(card); });
    punchRow.appendChild(btnIn);
    punchRow.appendChild(btnOut);
    card.appendChild(punchRow);

    if (!hasPerm('accounts.manage')) {
      var lock = document.createElement('p');
      lock.className = 'ns-note';
      lock.id = 'nsOwnerLock';
      lock.textContent = t('ownerOnly');
      card.appendChild(lock);
      return;
    }

    var cfgRow = document.createElement('div');
    cfgRow.className = 'ns-row';

    var fStart = document.createElement('div'); fStart.className = 'ns-field';
    var lStart = document.createElement('label'); lStart.textContent = t('startTime');
    var inStart = document.createElement('input');
    inStart.type = 'text'; inStart.className = 'ns-input'; inStart.value = getStartTime();
    fStart.appendChild(lStart); fStart.appendChild(inStart);

    var btnTime = document.createElement('button');
    btnTime.type = 'button'; btnTime.className = 'btn btn-secondary';
    btnTime.textContent = t('saveTime');
    btnTime.addEventListener('click', function () { setStartTime(inStart.value); renderCard(card); });

    var fFrom = document.createElement('div'); fFrom.className = 'ns-field';
    var lFrom = document.createElement('label'); lFrom.textContent = t('from');
    var inFrom = document.createElement('input'); inFrom.type = 'date'; inFrom.className = 'ns-input'; inFrom.value = fromVal;
    fFrom.appendChild(lFrom); fFrom.appendChild(inFrom);

    var fTo = document.createElement('div'); fTo.className = 'ns-field';
    var lTo = document.createElement('label'); lTo.textContent = t('to');
    var inTo = document.createElement('input'); inTo.type = 'date'; inTo.className = 'ns-input'; inTo.value = toVal;
    fTo.appendChild(lTo); fTo.appendChild(inTo);

    var btnRef = document.createElement('button');
    btnRef.type = 'button'; btnRef.className = 'btn btn-primary';
    btnRef.textContent = t('refresh');
    btnRef.addEventListener('click', function () {
      card.setAttribute('data-from', inFrom.value || today);
      card.setAttribute('data-to', inTo.value || today);
      renderCard(card);
    });

    cfgRow.appendChild(fStart); cfgRow.appendChild(btnTime);
    cfgRow.appendChild(fFrom); cfgRow.appendChild(fTo); cfgRow.appendChild(btnRef);
    card.appendChild(cfgRow);

    var rep = report(fromVal, toVal);
    var wrap = document.createElement('div');
    wrap.className = 'ns-tbl-wrap';
    var tbl = document.createElement('table');
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    var cols = ['colEmp', 'colHrs', 'colLate', 'colSales', 'colRet', 'colDisc', 'colSph', 'colRetRate', 'colDiscRate'];
    for (var c = 0; c < cols.length; c++) {
      var th = document.createElement('th');
      th.textContent = t(cols[c]);
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    tbl.appendChild(thead);

    var tb = document.createElement('tbody');
    if (!rep.ok || !rep.rows.length) {
      var er = document.createElement('tr');
      var ed = document.createElement('td');
      ed.colSpan = cols.length;
      ed.textContent = t('noData');
      er.appendChild(ed);
      tb.appendChild(er);
    } else {
      for (var i = 0; i < rep.rows.length; i++) {
        var r = rep.rows[i];
        var tr = document.createElement('tr');
        var vals = [
          r.empName,
          String(r.workedHours),
          String(r.lateMinutes),
          r.sales.toFixed(2) + ' ' + t('currency'),
          r.returns.toFixed(2) + ' ' + t('currency'),
          r.discounts.toFixed(2) + ' ' + t('currency'),
          r.salesPerHour == null ? '-' : (r.salesPerHour.toFixed(2) + ' ' + t('currency')),
          r.returnRatePct == null ? '-' : (r.returnRatePct.toFixed(1) + '%'),
          r.discountRatePct == null ? '-' : (r.discountRatePct.toFixed(1) + '%')
        ];
        for (var j = 0; j < vals.length; j++) {
          var td = document.createElement('td');
          td.textContent = vals[j];
          tr.appendChild(td);
        }
        tb.appendChild(tr);
      }
    }
    tbl.appendChild(tb);
    wrap.appendChild(tbl);
    card.appendChild(wrap);

    if (rep.ok && rep.unattributedSales > 0) {
      var un = document.createElement('p');
      un.className = 'ns-note';
      un.textContent = t('unattr') + ': ' + rep.unattributedSales;
      card.appendChild(un);
    }
  }

  function isReportsActive() {
    if (document.body && document.body.dataset && document.body.dataset.activePage === 'reports') return true;
    return !!document.querySelector('.nova-tab.active[data-page="reports"],.nova-hostmark.active[data-page="reports"]');
  }

  var mounting = false;
  function tryMount() {
    if (mounting) return;
    var pv = document.getElementById('novaPageView');
    if (!pv) return;
    var existing = document.getElementById(CARD_ID);
    if (!isReportsActive()) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }
    if (existing) return;
    mounting = true;
    try {
      injectStyles();
      var card = document.createElement('section');
      card.id = CARD_ID;
      renderCard(card);
      pv.appendChild(card);
    } finally {
      mounting = false;
    }
  }

  function initObserver() {
    var pv = document.getElementById('novaPageView');
    if (pv && typeof MutationObserver === 'function') {
      new MutationObserver(function () { tryMount(); }).observe(pv, { childList: true });
    }
    if (document.body && typeof MutationObserver === 'function') {
      new MutationObserver(function () { tryMount(); }).observe(document.body, { attributes: true, attributeFilter: ['data-active-page'] });
    }
    document.addEventListener('click', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('.nova-tab')) setTimeout(tryMount, 30);
    });
    tryMount();
  }

  window.novaStaffStats = {
    checkIn: checkIn,
    checkOut: checkOut,
    setStartTime: setStartTime,
    getStartTime: getStartTime,
    report: report,
    listPunches: listPunches,
    mount: tryMount
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initObserver);
  else initObserver();
})();

// app/628-monthly-income.js
(function () {
  'use strict';

  var CARD_ID = 'novaIncomeCard';
  var STYLE_ID = 'novaIncomeStyle';
  var TZ = 'Africa/Cairo';

  function isEn() {
    try { return localStorage.getItem('nova-rx-language') === 'en'; } catch (e) { return false; }
  }

  var AR = {
    title: 'قائمة الدخل الشهرية',
    month: 'الشهر',
    printBtn: 'طباعة',
    csvBtn: 'تصدير إكسل',
    currency: 'ج.م',
    colItem: 'البند',
    colVal: 'القيمة',
    grossSales: 'إجمالي المبيعات',
    returns: 'مرتجعات المبيعات',
    netSales: 'صافي المبيعات',
    cogs: 'تكلفة البضاعة المباعة',
    grossProfit: 'مجمل الربح',
    grossMargin: 'هامش مجمل الربح',
    drawerExp: 'مصروفات الدرج',
    vaultExp: 'مصروفات الخزنة',
    payrollExp: 'الرواتب والأجور',
    totalExp: 'إجمالي المصروفات',
    netProfit: 'صافي الربح',
    netMargin: 'هامش صافي الربح',
    unknownCost: 'تنبيه: توجد أصناف مباعة بتكلفة غير معروفة، عددها'
  };

  var EN = {
    title: 'Monthly Income Statement',
    month: 'Month',
    printBtn: 'Print',
    csvBtn: 'Export Excel',
    currency: 'EGP',
    colItem: 'Line Item',
    colVal: 'Amount',
    grossSales: 'Gross Sales',
    returns: 'Sales Returns',
    netSales: 'Net Sales',
    cogs: 'Cost of Goods Sold',
    grossProfit: 'Gross Profit',
    grossMargin: 'Gross Margin',
    drawerExp: 'Drawer Expenses',
    vaultExp: 'Vault Expenses',
    payrollExp: 'Payroll',
    totalExp: 'Total Expenses',
    netProfit: 'Net Profit',
    netMargin: 'Net Margin',
    unknownCost: 'Note: sold lines with unknown cost'
  };

  function t(k) { return (isEn() ? EN : AR)[k] || k; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function c(p) { return Math.round((Number(p) || 0) * 100); }
  function pounds(m) { return Math.round(m) / 100; }
  function pct(num, den) { return den > 0 ? Math.round((num / den) * 10000) / 100 : null; }
  function fmtNeg(n) { return n > 0 ? (-n).toFixed(2) : '0.00'; }

  function cairoMonth(ms) {
    var d = new Date(ms || Date.now());
    try {
      var parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: TZ, year: 'numeric', month: '2-digit'
      }).formatToParts(d);
      var m = {};
      for (var i = 0; i < parts.length; i++) m[parts[i].type] = parts[i].value;
      return m.year + '-' + m.month;
    } catch (e) {
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
    }
  }

  function recordMonth(rec) {
    if (!rec || typeof rec !== 'object') return '';
    if (typeof rec.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(rec.month)) return rec.month;
    if (typeof rec.date === 'string' && /^\d{4}-(0[1-9]|1[0-2])/.test(rec.date)) return rec.date.slice(0, 7);
    var v = rec.at != null ? rec.at : (rec.timestamp != null ? rec.timestamp : rec.createdAt);
    if (typeof v === 'number' && isFinite(v)) return cairoMonth(v);
    if (typeof v === 'string' && v) {
      var p = Date.parse(v);
      if (isFinite(p)) return cairoMonth(p);
    }
    return '';
  }

  function readArrayKeys(keys) {
    var out = [];
    var seen = {};
    for (var k = 0; k < keys.length; k++) {
      try {
        var raw = localStorage.getItem(keys[k]);
        if (!raw) continue;
        var parsed = JSON.parse(raw);
        var arr = Array.isArray(parsed)
          ? parsed
          : (parsed && Array.isArray(parsed.items) ? parsed.items
            : (parsed && Array.isArray(parsed.sales) ? parsed.sales
              : (parsed && Array.isArray(parsed.records) ? parsed.records : [])));
        for (var i = 0; i < arr.length; i++) {
          var r = arr[i];
          if (!r || typeof r !== 'object') continue;
          var id = r.id || r.invoiceId || (keys[k] + '-' + i);
          if (seen[id]) continue;
          seen[id] = 1;
          out.push(r);
        }
      } catch (e) {}
    }
    return out;
  }

  function calcSaleCogs(sale) {
    var totalCents = 0;
    var unknown = 0;
    if (sale.cogs != null && isFinite(Number(sale.cogs))) {
      return { cents: c(Math.abs(Number(sale.cogs))), unknown: 0 };
    }
    var lines = Array.isArray(sale.lines) ? sale.lines : (Array.isArray(sale.items) ? sale.items : []);
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (!ln) continue;
      if (Array.isArray(ln.lots) && ln.lots.length) {
        var lineUnknown = false;
        for (var j = 0; j < ln.lots.length; j++) {
          var lt = ln.lots[j];
          var lc = Number(lt && lt.cost) || 0;
          var lq = Number(lt && lt.qty) || 0;
          if (lq > 0) {
            if (lc > 0) totalCents += Math.round(lc * lq * 100);
            else lineUnknown = true;
          }
        }
        if (lineUnknown) unknown++;
      } else {
        var uc = Number(ln.cost != null ? ln.cost : ln.unitCost) || 0;
        var qty = Number(ln.qty != null ? ln.qty : 1) || 0;
        if (uc > 0 && qty > 0) totalCents += Math.round(uc * qty * 100);
        else if (qty > 0) unknown++;
      }
    }
    return { cents: totalCents, unknown: unknown };
  }

  function returnCogsCents(r, sales) {
    if (r.costReversed != null && isFinite(Number(r.costReversed))) return c(Math.abs(Number(r.costReversed))); // app/120 return rows record it
    if (r.cogs != null && isFinite(Number(r.cogs))) return c(Math.abs(Number(r.cogs)));
    var sale = null;
    for (var i = 0; i < sales.length; i++) if (sales[i] && sales[i].id === r.saleId) { sale = sales[i]; break; }
    if (!sale || !Array.isArray(sale.lines) || !Array.isArray(r.lines)) return 0;
    var total = 0;
    for (var k = 0; k < r.lines.length; k++) {
      var rl = r.lines[k];
      var ln = rl && sale.lines[Number(rl.idx)];
      var q = Number(rl && rl.qty) || 0, lq = Number(ln && ln.qty) || 0;
      if (!ln || q <= 0 || lq <= 0) continue;
      var lc = calcSaleCogs({ lines: [ln] });
      if (lc.unknown) continue;
      total += Math.round(lc.cents * Math.min(1, q / lq));
    }
    return total;
  }

  function readPayrollCents(month) {
    var store = null;
    try { store = JSON.parse(localStorage.getItem('nova-rx-payroll-v1') || 'null'); } catch (e) { store = null; }
    var closed = store && store.closedMonths && store.closedMonths[month];
    var total = 0, names, i, snap;
    if (closed && closed.snapshots && typeof closed.snapshots === 'object') {
      names = Object.keys(closed.snapshots);
      for (i = 0; i < names.length; i++) {
        snap = closed.snapshots[names[i]];
        total += Math.max(0, Math.round(Number(snap && snap.netPiasters) || 0));
      }
      return total;
    }
    try {
      var P = window.novaPayroll, perms = window.novaPerms;
      if (P && typeof P.employees === 'function' && typeof P.compute === 'function' && perms && typeof perms.can === 'function' && perms.can('accounts.manage')) {
        var emps = P.employees();
        if (Array.isArray(emps)) {
          for (i = 0; i < emps.length; i++) {
            var r = emps[i] && P.compute(emps[i].name, month);
            if (r && typeof r === 'object') total += Math.max(0, Math.round(Number(r.netPiasters) || 0));
          }
        }
      }
    } catch (e) {}
    return total;
  }

  function compute(month) {
    var m = month || cairoMonth(Date.now());
    if (typeof m !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return { ok: false, error: 'bad-month' };

    var sales = readArrayKeys(['nova-rx-sales-v1', 'nova-rx-invoices-v1', 'nova-rx-ledger-v1', 'nova_rx_sales']);
    var grossC = 0, retC = 0, cogsC = 0, unknownCostLines = 0;
    for (var i = 0; i < sales.length; i++) {
      var s = sales[i];
      if (!s || s.voided || recordMonth(s) !== m) continue;
      var tot = Number(s.total != null ? s.total : (s.grandTotal != null ? s.grandTotal : 0)) || 0;
      var ref = Number(s.refunded != null ? s.refunded : (s.returnAmount != null ? s.returnAmount : 0)) || 0;
      if (s.type === 'return' || tot < 0) {
        retC += c(Math.abs(tot));
        cogsC -= calcSaleCogs(s).cents;
      } else {
        grossC += c(Math.max(0, tot));
        retC += c(Math.max(0, ref));
        var cg = calcSaleCogs(s);
        cogsC += cg.cents;
        unknownCostLines += cg.unknown;
      }
    }

    var extraRets = readArrayKeys(['nova-rx-returns-v1']);
    for (var ri = 0; ri < extraRets.length; ri++) {
      var r = extraRets[ri];
      if (r && !r.voided && recordMonth(r) === m) {
        retC += c(Math.abs(Number(r.total != null ? r.total : r.amount) || 0));
        cogsC -= returnCogsCents(r, sales);
      }
    }
    if (cogsC < 0) cogsC = 0;

    var drawerList = readArrayKeys(['nova-rx-cash-out-v1']);
    var drawerExpC = 0;
    for (var di = 0; di < drawerList.length; di++) {
      var de = drawerList[di];
      if (!de || de.voided || recordMonth(de) !== m) continue;
      if (/^(سداد مورد|Supplier payment)/.test(String(de.note || ''))) continue; // purchases, not an expense
      drawerExpC += c(Math.max(0, Number(de.amount) || 0));
    }

    var vaultList = [];
    try {
      if (window.novaVault && typeof window.novaVault.list === 'function') vaultList = window.novaVault.list();
      else vaultList = readArrayKeys(['nova-rx-vault-moves-v1']);
    } catch (e) {}
    var vaultExpC = 0;
    for (var vi = 0; vi < vaultList.length; vi++) {
      var vm = vaultList[vi];
      if (vm && vm.type === 'vault_expense' && recordMonth(vm) === m) {
        var vc = (typeof vm.amountCents === 'number' && isFinite(vm.amountCents))
          ? Math.max(0, Math.round(vm.amountCents))
          : c(Math.max(0, Number(vm.amount) || 0));
        vaultExpC += vc;
      }
    }

    var payrollExpC = readPayrollCents(m);
    var netSalesC = grossC - retC;
    var grossProfitC = netSalesC - cogsC;
    var totalExpC = drawerExpC + vaultExpC + payrollExpC;
    var netProfitC = grossProfitC - totalExpC;

    return {
      ok: true,
      month: m,
      grossSales: pounds(grossC),
      returns: pounds(retC),
      netSales: pounds(netSalesC),
      cogs: pounds(cogsC),
      grossProfit: pounds(grossProfitC),
      grossMarginPct: pct(grossProfitC, netSalesC),
      drawerExpenses: pounds(drawerExpC),
      vaultExpenses: pounds(vaultExpC),
      payrollExpenses: pounds(payrollExpC),
      totalExpenses: pounds(totalExpC),
      netProfit: pounds(netProfitC),
      netMarginPct: pct(netProfitC, netSalesC),
      unknownCostLines: unknownCostLines
    };
  }

  function statementRows(data) {
    var cur = ' ' + t('currency');
    return [
      [t('grossSales'), data.grossSales.toFixed(2) + cur, false],
      [t('returns'), fmtNeg(data.returns) + cur, false],
      [t('netSales'), data.netSales.toFixed(2) + cur, true],
      [t('cogs'), fmtNeg(data.cogs) + cur, false],
      [t('grossProfit'), data.grossProfit.toFixed(2) + cur, true],
      [t('grossMargin'), data.grossMarginPct == null ? '-' : (data.grossMarginPct.toFixed(2) + '%'), false],
      [t('drawerExp'), fmtNeg(data.drawerExpenses) + cur, false],
      [t('vaultExp'), fmtNeg(data.vaultExpenses) + cur, false],
      [t('payrollExp'), fmtNeg(data.payrollExpenses) + cur, false],
      [t('totalExp'), fmtNeg(data.totalExpenses) + cur, true],
      [t('netProfit'), data.netProfit.toFixed(2) + cur, true],
      [t('netMargin'), data.netMarginPct == null ? '-' : (data.netMarginPct.toFixed(2) + '%'), false]
    ];
  }

  function csvEsc(v) {
    var s = String(v == null ? '' : v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCsv(month) {
    var data = compute(month);
    if (!data.ok) return '';
    var lines = [csvEsc(t('colItem')) + ',' + csvEsc(t('colVal'))];
    var rows = statementRows(data);
    for (var i = 0; i < rows.length; i++) {
      lines.push(csvEsc(rows[i][0]) + ',' + csvEsc(rows[i][1]));
    }
    return '\uFEFF' + lines.join('\r\n');
  }

  function downloadCsv(month) {
    var content = toCsv(month);
    if (!content) return;
    var blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'income-' + month + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 500);
  }

  function printStatement(month) {
    var data = compute(month);
    if (!data.ok) return;
    var w = window.open('', '_blank', 'width=700,height=600');
    if (!w) return;
    var doc = w.document;
    doc.title = t('title') + ' - ' + month;
    doc.documentElement.setAttribute('dir', isEn() ? 'ltr' : 'rtl');
    var style = doc.createElement('style');
    style.textContent = 'body{font-family:sans-serif;padding:16px;color:#111;}table{width:100%;border-collapse:collapse;margin-top:12px;}th,td{border:1px solid #ccc;padding:8px;text-align:start;}.bold{font-weight:700;background:#f4f4f4;}';
    doc.head.appendChild(style);
    var h = doc.createElement('h2');
    h.textContent = t('title') + ' - ' + month;
    doc.body.appendChild(h);
    var tbl = doc.createElement('table');
    var tb = doc.createElement('tbody');
    var rows = statementRows(data);
    for (var i = 0; i < rows.length; i++) {
      var tr = doc.createElement('tr');
      if (rows[i][2]) tr.className = 'bold';
      var td1 = doc.createElement('td'); td1.textContent = rows[i][0];
      var td2 = doc.createElement('td'); td2.textContent = rows[i][1];
      tr.appendChild(td1); tr.appendChild(td2);
      tb.appendChild(tr);
    }
    tbl.appendChild(tb);
    doc.body.appendChild(tbl);
    w.focus();
    w.print();
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '#' + CARD_ID + '{background:#14181d;border:1px solid #343b44;border-radius:12px;padding:16px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;}' +
      '#' + CARD_ID + ' *{box-sizing:border-box;}' +
      '#' + CARD_ID + ' .ni-title{margin:0 0 12px 0;font-size:18px;color:#79c9eb;}' +
      '#' + CARD_ID + ' .ni-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;}' +
      '#' + CARD_ID + ' .ni-input{min-height:44px;padding:8px 10px;background:#0f1318;border:1px solid #343b44;border-radius:8px;color:#e6edf3;font-size:14px;}' +
      '#' + CARD_ID + ' .btn{min-height:44px;}' +
      '#' + CARD_ID + ' .ni-tbl-wrap{width:100%;overflow-x:auto;border:1px solid #343b44;border-radius:8px;}' +
      '#' + CARD_ID + ' table{width:100%;border-collapse:collapse;font-size:14px;}' +
      '#' + CARD_ID + ' th,#' + CARD_ID + ' td{padding:9px 10px;border-bottom:1px solid #343b44;text-align:start;}' +
      '#' + CARD_ID + ' th{background:#0f1318;color:#79c9eb;}' +
      '#' + CARD_ID + ' tr.ni-bold{background:#0f1318;font-weight:700;color:#79c9eb;}' +
      '#' + CARD_ID + ' .ni-warn{font-size:12px;color:#f0b429;margin-top:8px;}';
    document.head.appendChild(s);
  }

  function renderCard(card) {
    while (card.firstChild) card.removeChild(card.firstChild);
    card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    var selMonth = card.getAttribute('data-month') || cairoMonth(Date.now());
    var data = compute(selMonth);

    var h3 = document.createElement('h3');
    h3.className = 'ni-title';
    h3.textContent = t('title');
    card.appendChild(h3);

    var bar = document.createElement('div');
    bar.className = 'ni-bar';
    var lbl = document.createElement('label'); lbl.textContent = t('month');
    var inp = document.createElement('input');
    inp.type = 'month'; inp.className = 'ni-input'; inp.id = 'niMonthInput'; inp.value = selMonth;
    inp.addEventListener('change', function () {
      if (inp.value) { card.setAttribute('data-month', inp.value); renderCard(card); }
    });
    var btnPr = document.createElement('button');
    btnPr.type = 'button'; btnPr.className = 'btn btn-secondary'; btnPr.textContent = t('printBtn');
    btnPr.addEventListener('click', function () { printStatement(selMonth); });
    var btnCsv = document.createElement('button');
    btnCsv.type = 'button'; btnCsv.className = 'btn btn-primary'; btnCsv.textContent = t('csvBtn');
    btnCsv.addEventListener('click', function () { downloadCsv(selMonth); });

    bar.appendChild(lbl); bar.appendChild(inp); bar.appendChild(btnPr); bar.appendChild(btnCsv);
    card.appendChild(bar);

    var wrap = document.createElement('div');
    wrap.className = 'ni-tbl-wrap';
    var tbl = document.createElement('table');
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    var th1 = document.createElement('th'); th1.textContent = t('colItem');
    var th2 = document.createElement('th'); th2.textContent = t('colVal');
    hr.appendChild(th1); hr.appendChild(th2);
    thead.appendChild(hr);
    tbl.appendChild(thead);

    var tb = document.createElement('tbody');
    if (data.ok) {
      var rows = statementRows(data);
      for (var i = 0; i < rows.length; i++) {
        var tr = document.createElement('tr');
        if (rows[i][2]) tr.className = 'ni-bold';
        var td1 = document.createElement('td'); td1.textContent = rows[i][0];
        var td2 = document.createElement('td'); td2.textContent = rows[i][1];
        tr.appendChild(td1); tr.appendChild(td2);
        tb.appendChild(tr);
      }
    }
    tbl.appendChild(tb);
    wrap.appendChild(tbl);
    card.appendChild(wrap);

    if (data.ok && data.unknownCostLines > 0) {
      var warn = document.createElement('p');
      warn.className = 'ni-warn';
      warn.textContent = t('unknownCost') + ': ' + data.unknownCostLines;
      card.appendChild(warn);
    }
  }

  function isReportsActive() {
    if (document.body && document.body.dataset && document.body.dataset.activePage === 'reports') return true;
    return !!document.querySelector('.nova-tab.active[data-page="reports"],.nova-hostmark.active[data-page="reports"]');
  }

  var mounting = false;
  function tryMount() {
    if (mounting) return;
    var pv = document.getElementById('novaPageView');
    if (!pv) return;
    var existing = document.getElementById(CARD_ID);
    var canView = true;
    try { if (window.novaPerms && typeof window.novaPerms.can === 'function') canView = !!window.novaPerms.can('reports.view'); } catch (e) { canView = false; }
    if (!isReportsActive() || !canView) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }
    if (existing) return;
    mounting = true;
    try {
      injectStyles();
      var card = document.createElement('section');
      card.id = CARD_ID;
      renderCard(card);
      pv.appendChild(card);
    } finally {
      mounting = false;
    }
  }

  function initObserver() {
    var pv = document.getElementById('novaPageView');
    if (pv && typeof MutationObserver === 'function') {
      new MutationObserver(function () { tryMount(); }).observe(pv, { childList: true });
    }
    if (document.body && typeof MutationObserver === 'function') {
      new MutationObserver(function () { tryMount(); }).observe(document.body, { attributes: true, attributeFilter: ['data-active-page'] });
    }
    document.addEventListener('click', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('.nova-tab')) setTimeout(tryMount, 30);
    });
    tryMount();
  }

  window.novaIncome = {
    compute: compute,
    toCsv: toCsv,
    mount: tryMount
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initObserver);
  else initObserver();
})();

// app/618-cash-drawer.js
(function () {
    'use strict';
    var LOG_KEY = 'nova-rx-cash-drawer-log';
    var AUTO_KEY = 'nova-rx-drawer-auto';
    var CARD_ID = 'novaCashDrawerCard';
    var MAX_RECORDS = 500;
    var PULSE_BYTES = [27, 112, 0, 25, 250];
    var PULSE_STR = String.fromCharCode(27, 112, 0, 25, 250);
    function isEn() {
      try { return localStorage.getItem('nova-rx-language') === 'en'; } catch (e) { return false; }
    }
    function t(ar, en) {
      return isEn() ? en : ar;
    }
    function toast(msg, type) {
      try {
        if (typeof window.showToast === 'function') window.showToast(msg, type || 'success');
      } catch (e) {}
    }
    function currentUserName() {
      try {
        if (!window.novaAuth) return '';
        var u = null;
        if (typeof window.novaAuth.current === 'function') u = window.novaAuth.current();
        else if (typeof window.novaAuth.currentUser === 'function') u = window.novaAuth.currentUser();
        else if (typeof window.novaAuth.user === 'function') u = window.novaAuth.user();
        return (u && u.name) ? String(u.name) : '';
      } catch (e) {
        return '';
      }
    }
    function hasDrawerPerm() {
      try {
        if (!window.novaPerms || typeof window.novaPerms.require !== 'function') return false;
        // 'drawer.open' is not in auth-permissions ACTIONS (unknown actions are refused for everyone); whoever may sell may open the drawer, with a reason.
        return window.novaPerms.require('sale.create') === true;
      } catch (e) {
        return false;
      }
    }
    function readLog() {
      try {
        var raw = localStorage.getItem(LOG_KEY);
        if (!raw) return [];
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }
    function appendLog(entry) {
      var list = readLog();
      list.push(entry);
      if (list.length > MAX_RECORDS) {
        list = list.slice(list.length - MAX_RECORDS);
      }
      try { localStorage.setItem(LOG_KEY, JSON.stringify(list)); } catch (e) {}
      return list;
    }
    function isAutoEnabled() {
      try { return localStorage.getItem(AUTO_KEY) === '1'; } catch (e) { return false; }
    }
    function setAutoEnabled(flag) {
      try { localStorage.setItem(AUTO_KEY, flag ? '1' : '0'); } catch (e) {}
      return isAutoEnabled();
    }
    function sendDrawerPulse() {
      var printerId = '';
      try {
        if (window.novaDevicePrint && typeof window.novaDevicePrint.selectedPrinter === 'function') {
          var sp = window.novaDevicePrint.selectedPrinter();
          printerId = (sp && sp.id) ? sp.id : (typeof sp === 'string' ? sp : '');
        }
      } catch (e) {}
      // 1. Direct raw ESC/POS channel via device gateway
      try {
        if (window.novaDeviceGateway && typeof window.novaDeviceGateway.send === 'function') {
          var gwRes = window.novaDeviceGateway.send({
              type: 'raw',
              action: 'cash-drawer',
              deviceId: printerId || 'receipt-printer',
              bytes: PULSE_BYTES.slice(),
              command: PULSE_STR
          });
          if (gwRes !== false && (!gwRes || gwRes.ok !== false)) {
            return { sent: true, method: 'gateway-raw' };
          }
        }
      } catch (e) {}
      // 2. Fallback: tiny receipt carrying the pulse via device print
      try {
        // printInvoice() without a gateway+printer only returns {via:'browser'} and prints nothing, so it is used only when hasGateway() is true.
        if (window.novaDevicePrint && typeof window.novaDevicePrint.printInvoice === 'function' && typeof window.novaDevicePrint.hasGateway === 'function' && window.novaDevicePrint.hasGateway()) {
          var prRes = window.novaDevicePrint.printInvoice({
              id: 'DRAWER-' + Date.now(),
              lines: [{ name: PULSE_STR, qty: 1, price: 0 }],
              total: 0,
              note: PULSE_STR
            }, 1);
          if (prRes !== false && (!prRes || prRes.ok !== false)) {
            return { sent: true, method: 'fallback-receipt' };
          }
        }
      } catch (e) {}
      return { sent: false, method: 'no-printer' };
    }
    function open(reason, opts) {
      var isAuto = Boolean(opts && opts.auto === true);
      var cleanReason = String(reason == null ? '' : reason).trim();
      if (!isAuto) {
        if (!hasDrawerPerm()) {
          toast(t('غير مصرح بفتح الدرج', 'Not authorized to open cash drawer'), 'error');
          return { ok: false, error: 'forbidden' };
        }
        if (!cleanReason) {
          toast(t('يرجى كتابة سبب فتح الدرج', 'Please enter a reason to open the drawer'), 'error');
          return { ok: false, error: 'reason-required' };
        }
      } else {
        if (!isAutoEnabled()) {
          return { ok: false, error: 'auto-disabled' };
        }
        if (!cleanReason) cleanReason = t('دفع نقدي تلقائي', 'Auto cash payment');
      }
      var dispatch = sendDrawerPulse();
      var entry = {
        id: 'DRW-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        at: new Date().toISOString(),
        user: currentUserName(),
        reason: cleanReason,
        mode: isAuto ? 'auto' : 'manual',
        method: dispatch.method,
        sent: dispatch.sent,
        sale: (opts && opts.sale) ? String(opts.sale) : ''
      };
      appendLog(entry);
      if (dispatch.method === 'fallback-receipt') {
        toast(t('تم فتح الدرج عبر إيصال قصير للطابعة', 'Drawer opened via tiny receipt fallback'), 'success');
      } else if (dispatch.sent) {
        toast(t('تم إرسال أمر فتح الدرج', 'Cash drawer pulse sent'), 'success');
      } else {
        toast(t('تم تسجيل الفتح بدون طابعة متصلة', 'Drawer open logged (no printer connected)'), 'success');
      }
      renderLogList();
      return { ok: true, entry: entry, method: dispatch.method };
    }
    function log() {
      return readLog().slice();
    }
    function isSalePageActive() {
      // #novaPageView is hidden on the sale screen (.pos-root), so this card lives on the reports page.
      if (document.body && document.body.dataset && document.body.dataset.activePage === 'reports') return true;
      return Boolean(document.querySelector('.nova-tab.active[data-page="reports"],.nova-hostmark.active[data-page="reports"]'));
    }
    function renderLogList() {
      var ul = document.getElementById('novaCashDrawerLogList');
      if (!ul) return;
      while (ul.firstChild) ul.removeChild(ul.firstChild);
      var items = readLog().slice(-5).reverse();
      if (!items.length) {
        var empty = document.createElement('div');
        empty.style.cssText = 'color:#9aa4b2;font-size:13px;';
        empty.textContent = t('لا توجد عمليات فتح مسجلة بعد', 'No drawer opens logged yet');
        ul.appendChild(empty);
        return;
      }
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var row = document.createElement('div');
        row.style.cssText = 'padding:8px 10px;border:1px solid #343b44;border-radius:6px;margin-top:6px;font-size:13px;word-break:break-word;';
        var who = it.user ? (it.user + ' — ') : '';
        var timeStr = String(it.at || '').replace('T', ' ').slice(0, 16);
        row.textContent = who + it.reason + ' (' + timeStr + ')';
        ul.appendChild(row);
      }
    }
    function buildCard() {
      var card = document.createElement('section');
      card.id = CARD_ID;
      card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');
      card.style.cssText = 'background:#14181d;border:1px solid #343b44;border-radius:10px;padding:14px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;overflow-x:hidden;';
      var title = document.createElement('h3');
      title.style.cssText = 'margin:0 0 10px 0;font-size:16px;color:#79c9eb;';
      title.textContent = t('درج الكاش', 'Cash Drawer');
      card.appendChild(title);
      var controls = document.createElement('div');
      controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;';
      var reasonInput = document.createElement('input');
      reasonInput.id = 'novaCashDrawerReason';
      reasonInput.type = 'text';
      reasonInput.placeholder = t('سبب فتح الدرج (إلزامي)', 'Reason to open drawer (required)');
      reasonInput.style.cssText = 'flex:1 1 180px;min-width:0;min-height:44px;padding:0 12px;background:#0d1117;color:#e6edf3;border:1px solid #343b44;border-radius:8px;box-sizing:border-box;';
      controls.appendChild(reasonInput);
      var openBtn = document.createElement('button');
      openBtn.id = 'novaCashDrawerOpenBtn';
      openBtn.type = 'button';
      openBtn.className = 'btn btn-primary';
      openBtn.style.cssText = 'min-height:44px;padding:0 16px;cursor:pointer;';
      openBtn.textContent = t('افتح الدرج', 'Open Drawer');
      openBtn.addEventListener('click', function () {
          var res = open(reasonInput.value);
          if (res && res.ok) reasonInput.value = '';
      });
      controls.appendChild(openBtn);
      card.appendChild(controls);
      var autoRow = document.createElement('label');
      autoRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:12px;min-height:44px;cursor:pointer;font-size:14px;';
      var autoChk = document.createElement('input');
      autoChk.id = 'novaCashDrawerAutoChk';
      autoChk.type = 'checkbox';
      autoChk.checked = isAutoEnabled();
      autoChk.style.cssText = 'width:20px;height:20px;accent-color:#79c9eb;';
      autoChk.addEventListener('change', function () {
          setAutoEnabled(autoChk.checked);
      });
      var autoTxt = document.createElement('span');
      autoTxt.textContent = t('فتح الدرج تلقائيا بعد الدفع النقدي', 'Auto-open drawer after cash payment');
      autoRow.appendChild(autoChk);
      autoRow.appendChild(autoTxt);
      card.appendChild(autoRow);
      var logWrap = document.createElement('div');
      logWrap.id = 'novaCashDrawerLogList';
      logWrap.style.cssText = 'margin-top:8px;';
      card.appendChild(logWrap);
      return card;
    }
    function mountIfNeeded() {
      var root = document.getElementById('novaPageView');
      if (!root || !isSalePageActive()) return;
      if (document.getElementById(CARD_ID)) return;
      root.appendChild(buildCard());
      renderLogList();
    }
    // The POS fires 'nova:invoice-completed' after the sale is saved; open only when cash was taken, once per invoice.
    function onInvoiceCompleted(ev) {
      try {
        if (!isAutoEnabled()) return;
        var num = ev && ev.detail && ev.detail.id != null ? String(ev.detail.id) : '';
        if (!num || !window.novaSales || typeof window.novaSales.list !== 'function') return;
        var sale = null, all = window.novaSales.list();
        for (var i = 0; i < all.length; i++) { if (String(all[i].number) === num) { sale = all[i]; break; } }
        if (!sale) return;
        var cash = sale.payment === 'cash';
        var tn = Array.isArray(sale.tenders) ? sale.tenders : [];
        for (var k = 0; k < tn.length; k++) { if (tn[k] && tn[k].method === 'cash' && Number(tn[k].amount) > 0) cash = true; }
        if (!cash) return;
        var lg = readLog();
        for (var j = 0; j < lg.length; j++) { if (lg[j] && lg[j].sale === num) return; }
        open(t('دفع نقدي تلقائي', 'Auto cash payment'), { auto: true, sale: num });
      } catch (e) {}
    }
    window.addEventListener('nova:invoice-completed', onInvoiceCompleted);
    window.novaCashDrawer = {
      open: open,
      log: log,
      isAutoEnabled: isAutoEnabled,
      setAutoEnabled: setAutoEnabled
    };
    var observer = null;
    function initObserver() {
      var root = document.getElementById('novaPageView');
      if (!root || observer) return;
      observer = new MutationObserver(function () {
          mountIfNeeded();
      });
      observer.observe(root, { childList: true });
      mountIfNeeded();
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initObserver);
    } else {
      initObserver();
    }
})();

// app/620-alt-barcodes.js
(function () {
    'use strict';
    var STORAGE_KEY = 'nova-rx-alt-barcodes';
    var CARD_ID = 'novaAltBarcodesCard';
    var MAX_RECORDS = 500;
    function isEn() {
      try { return localStorage.getItem('nova-rx-language') === 'en'; } catch (e) { return false; }
    }
    function t(ar, en) {
      return isEn() ? en : ar;
    }
    function toast(msg, type) {
      try {
        if (typeof window.showToast === 'function') window.showToast(msg, type || 'success');
      } catch (e) {}
    }
    function currentUserName() {
      try {
        if (!window.novaAuth) return '';
        var u = null;
        if (typeof window.novaAuth.current === 'function') u = window.novaAuth.current();
        else if (typeof window.novaAuth.currentUser === 'function') u = window.novaAuth.currentUser();
        else if (typeof window.novaAuth.user === 'function') u = window.novaAuth.user();
        return (u && u.name) ? String(u.name) : '';
      } catch (e) {
        return '';
      }
    }
    function normalizeDigits(str) {
      var s = String(str == null ? '' : str);
      var out = '';
      for (var i = 0; i < s.length; i++) {
        var ch = s.charAt(i);
        if (/\s/.test(ch)) continue;
        var c = s.charCodeAt(i);
        if (c >= 0x0660 && c <= 0x0669) out += String(c - 0x0660);
        else if (c >= 0x06F0 && c <= 0x06F9) out += String(c - 0x06F0);
        else out += ch;
      }
      return out;
    }
    function readAll() {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }
    function writeAll(arr) {
      var trimmed = arr.length > MAX_RECORDS ? arr.slice(arr.length - MAX_RECORDS) : arr;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed)); } catch (e) {}
      return trimmed;
    }
    function canEdit() {
      try {
        if (!window.novaPerms || typeof window.novaPerms.require !== 'function') return false;
        return window.novaPerms.require('prices.edit') === true; // same gate as internal barcodes (612)
      } catch (e) { return false; }
    }
    function catalog() {
      try { return (window.NOVA_DEMO && Array.isArray(window.NOVA_DEMO.products)) ? window.NOVA_DEMO.products : []; } catch (e) { return []; }
    }
    function add(itemKey, code) {
      var key = String(itemKey == null ? '' : itemKey).trim();
      var cleanCode = normalizeDigits(code);
      if (!canEdit()) {
        toast(t('غير مصرح بتعديل الأصناف', 'Not allowed to edit items'), 'error');
        return { ok: false, error: 'forbidden' };
      }
      if (!key) {
        toast(t('يرجى تحديد الصنف أولا', 'Please select an item first'), 'error');
        return { ok: false, error: 'item-required' };
      }
      if (!/^\d{8,14}$/.test(cleanCode)) {
        toast(t('الباركود يجب أن يكون من 8 إلى 14 رقما فقط', 'Barcode must be 8 to 14 digits only'), 'error');
        return { ok: false, error: 'invalid-code' };
      }
      // The item must exist, and the code must not already be any item's own barcode/GTIN (the normal lookup would win and the extra code would never work).
      var cat = catalog(), found = false;
      for (var p = 0; p < cat.length; p++) {
        var pr = cat[p] || {};
        if (String(pr.id) === key || String(pr.barcode) === key) found = true;
        var own = [pr.barcode, pr.gtin].concat(Array.isArray(pr.barcodes) ? pr.barcodes : []);
        for (var q = 0; q < own.length; q++) {
          if (own[q] != null && normalizeDigits(own[q]) === cleanCode) {
            toast(t('هذا الباركود مستخدم بالفعل لصنف آخر', 'This barcode is already assigned'), 'error');
            return { ok: false, error: 'duplicate', existingItemKey: String(pr.id) };
          }
        }
      }
      if (cat.length && !found) {
        toast(t('الصنف غير موجود', 'Item not found'), 'error');
        return { ok: false, error: 'item-not-found' };
      }
      var all = readAll();
      for (var i = 0; i < all.length; i++) {
        if (all[i] && all[i].code === cleanCode) {
          toast(t('هذا الباركود مستخدم بالفعل لصنف آخر', 'This barcode is already assigned'), 'error');
          return { ok: false, error: 'duplicate', existingItemKey: all[i].itemKey };
        }
      }
      // A mapping table, not a log: never drop old codes silently.
      if (all.length >= MAX_RECORDS) {
        toast(t('تم الوصول للحد الأقصى من الباركودات الإضافية', 'Extra barcode limit reached'), 'error');
        return { ok: false, error: 'limit' };
      }
      var rec = {
        itemKey: key,
        code: cleanCode,
        addedAt: new Date().toISOString(),
        addedBy: currentUserName()
      };
      all.push(rec);
      writeAll(all);
      toast(t('تمت إضافة الباركود الإضافي بنجاح', 'Alternate barcode added'), 'success');
      renderList();
      return { ok: true, record: rec };
    }
    function remove(itemKey, code) {
      var key = String(itemKey == null ? '' : itemKey).trim();
      var cleanCode = normalizeDigits(code);
      if (!canEdit()) {
        toast(t('غير مصرح بتعديل الأصناف', 'Not allowed to edit items'), 'error');
        return { ok: false, error: 'forbidden' };
      }
      var all = readAll();
      var next = [];
      var removed = false;
      for (var i = 0; i < all.length; i++) {
        if (all[i] && all[i].itemKey === key && all[i].code === cleanCode && !removed) {
          removed = true;
          continue;
        }
        next.push(all[i]);
      }
      if (!removed) return { ok: false, error: 'not-found' };
      writeAll(next);
      toast(t('تم حذف الباركود الإضافي', 'Alternate barcode removed'), 'success');
      renderList();
      return { ok: true };
    }
    function list(itemKey) {
      var all = readAll();
      if (itemKey == null || String(itemKey).trim() === '') return all.slice();
      var key = String(itemKey).trim();
      var out = [];
      for (var i = 0; i < all.length; i++) {
        if (all[i] && all[i].itemKey === key) out.push(all[i].code);
      }
      return out;
    }
    function lookup(code) {
      var cleanCode = normalizeDigits(code);
      if (!cleanCode) return null;
      var all = readAll();
      for (var i = 0; i < all.length; i++) {
        if (all[i] && all[i].code === cleanCode) return all[i].itemKey;
      }
      return null;
    }
    function isProductsPageActive() {
      if (document.body && document.body.dataset && document.body.dataset.activePage === 'products') return true;
      return Boolean(document.querySelector('.nova-tab.active[data-page="products"],.nova-hostmark.active[data-page="products"]'));
    }
    function renderList() {
      var box = document.getElementById('novaAltBarcodesList');
      if (!box) return;
      while (box.firstChild) box.removeChild(box.firstChild);
      var all = readAll().slice(-10).reverse();
      if (!all.length) {
        var empty = document.createElement('div');
        empty.style.cssText = 'color:#9aa4b2;font-size:13px;';
        empty.textContent = t('لا توجد باركودات إضافية مسجلة', 'No alternate barcodes saved');
        box.appendChild(empty);
        return;
      }
      for (var i = 0; i < all.length; i++) {
        (function (rec) {
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;border:1px solid #343b44;border-radius:6px;margin-top:6px;font-size:13px;';
            var lbl = document.createElement('span');
            lbl.textContent = rec.itemKey + ' — ' + rec.code;
            var delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn btn-secondary';
            delBtn.style.cssText = 'min-height:44px;padding:0 12px;cursor:pointer;';
            delBtn.textContent = t('حذف', 'Remove');
            delBtn.addEventListener('click', function () {
                remove(rec.itemKey, rec.code);
            });
            row.appendChild(lbl);
            row.appendChild(delBtn);
            box.appendChild(row);
        })(all[i]);
      }
    }
    function buildCard() {
      var card = document.createElement('section');
      card.id = CARD_ID;
      card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');
      card.style.cssText = 'background:#14181d;border:1px solid #343b44;border-radius:10px;padding:14px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;overflow-x:hidden;';
      var title = document.createElement('h3');
      title.style.cssText = 'margin:0 0 10px 0;font-size:16px;color:#79c9eb;';
      title.textContent = t('باركودات إضافية للصنف', 'Alternate Item Barcodes');
      card.appendChild(title);
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;';
      var itemInput = document.createElement('input');
      itemInput.id = 'novaAltBarcodeItem';
      itemInput.type = 'text';
      itemInput.placeholder = t('معرف الصنف', 'Item ID');
      itemInput.style.cssText = 'flex:1 1 130px;min-width:0;min-height:44px;padding:0 12px;background:#0d1117;color:#e6edf3;border:1px solid #343b44;border-radius:8px;box-sizing:border-box;';
      row.appendChild(itemInput);
      var codeInput = document.createElement('input');
      codeInput.id = 'novaAltBarcodeCode';
      codeInput.type = 'text';
      codeInput.setAttribute('inputmode', 'numeric');
      codeInput.placeholder = t('الباركود الإضافي (8 إلى 14 رقم)', 'Extra barcode (8-14 digits)');
      codeInput.style.cssText = 'flex:1 1 160px;min-width:0;min-height:44px;padding:0 12px;background:#0d1117;color:#e6edf3;border:1px solid #343b44;border-radius:8px;box-sizing:border-box;';
      row.appendChild(codeInput);
      var addBtn = document.createElement('button');
      addBtn.id = 'novaAltBarcodeAddBtn';
      addBtn.type = 'button';
      addBtn.className = 'btn btn-primary';
      addBtn.style.cssText = 'min-height:44px;padding:0 16px;cursor:pointer;';
      addBtn.textContent = t('إضافة', 'Add');
      addBtn.addEventListener('click', function () {
          var res = add(itemInput.value, codeInput.value);
          if (res && res.ok) codeInput.value = '';
      });
      row.appendChild(addBtn);
      card.appendChild(row);
      var listBox = document.createElement('div');
      listBox.id = 'novaAltBarcodesList';
      listBox.style.cssText = 'margin-top:10px;';
      card.appendChild(listBox);
      return card;
    }
    function mountIfNeeded() {
      var root = document.getElementById('novaPageView');
      if (!root || !isProductsPageActive()) return;
      if (document.getElementById(CARD_ID)) return;
      root.appendChild(buildCard());
      renderList();
    }
    window.novaAltBarcodes = {
      add: add,
      remove: remove,
      list: list,
      lookup: lookup
    };
    var observer = null;
    function initObserver() {
      var root = document.getElementById('novaPageView');
      if (!root || observer) return;
      observer = new MutationObserver(function () {
          mountIfNeeded();
      });
      observer.observe(root, { childList: true });
      mountIfNeeded();
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initObserver);
    } else {
      initObserver();
    }
})();

// app/622-gs1-datamatrix.js
(function () {
    'use strict';
    var CARD_ID = 'novaGs1Card';
    var FNC1 = String.fromCharCode(29);
    function isEn() {
      try { return localStorage.getItem('nova-rx-language') === 'en'; } catch (e) { return false; }
    }
    function t(ar, en) {
      return isEn() ? en : ar;
    }
    function toast(msg, type) {
      try {
        if (typeof window.showToast === 'function') window.showToast(msg, type || 'success');
      } catch (e) {}
    }
    function cairoTodayIso() {
      try {
        var parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Africa/Cairo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(new Date());
        var y = '', m = '', d = '';
        for (var i = 0; i < parts.length; i++) {
          if (parts[i].type === 'year') y = parts[i].value;
          else if (parts[i].type === 'month') m = parts[i].value;
          else if (parts[i].type === 'day') d = parts[i].value;
        }
        if (y && m && d) return y + '-' + m + '-' + d;
      } catch (e) {}
      return new Date().toISOString().slice(0, 10);
    }
    function pad2(n) {
      return n < 10 ? ('0' + n) : String(n);
    }
    function parseYyMmDd(six) {
      if (!/^\d{6}$/.test(six)) return '';
      var yy = parseInt(six.slice(0, 2), 10);
      var mm = parseInt(six.slice(2, 4), 10);
      var dd = parseInt(six.slice(4, 6), 10);
      if (mm < 1 || mm > 12) return '';
      var year = 2000 + yy;
      var lastDay = new Date(Date.UTC(year, mm, 0)).getUTCDate();
      if (dd === 0) dd = lastDay;
      if (dd < 1 || dd > lastDay) return '';
      return String(year) + '-' + pad2(mm) + '-' + pad2(dd);
    }
    function isExpired(isoDate, refIso) {
      if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;
      var today = refIso || cairoTodayIso();
      return isoDate < today;
    }
    function findVarEndNoFnc1(str, start, curAi, seen) {
      var maxEnd = Math.min(str.length, start + 20);
      for (var j = start + 1; j <= maxEnd; j++) {
        var two = str.slice(j, j + 2);
        if (two === '17' && !seen['17'] && j + 8 <= str.length && parseYyMmDd(str.slice(j + 2, j + 8))) {
          return j;
        }
        if (two === '01' && !seen['01'] && j + 16 <= str.length && /^\d{14}$/.test(str.slice(j + 2, j + 16))) {
          return j;
        }
        if (curAi === '10' && two === '21' && !seen['21'] && (str.length - (j + 2)) >= 4) {
          return j;
        }
        if (curAi === '21' && two === '10' && !seen['10'] && (str.length - (j + 2)) >= 2) {
          return j;
        }
      }
      return str.length;
    }
    function parse(raw) {
      if (typeof raw !== 'string') return null;
      var s = raw.trim();
      if (!s) return null;
      if (/^\][A-Za-z][0-9]/.test(s)) {
        s = s.slice(3);
      }
      while (s.charAt(0) === FNC1) s = s.slice(1);
      var gtin = '';
      var expiry = '';
      var batch = '';
      var serial = '';
      var seen = {};
      var idx = 0;
      while (idx < s.length) {
        if (s.charAt(idx) === FNC1) {
          idx += 1;
          continue;
        }
        var ai = s.slice(idx, idx + 2);
        if (ai === '01' && !seen['01'] && idx + 16 <= s.length && /^\d{14}$/.test(s.slice(idx + 2, idx + 16))) {
          gtin = s.slice(idx + 2, idx + 16);
          seen['01'] = true;
          idx += 16;
        } else if (ai === '17' && !seen['17'] && idx + 8 <= s.length) {
          var iso = parseYyMmDd(s.slice(idx + 2, idx + 8));
          if (!iso) break;
          expiry = iso;
          seen['17'] = true;
          idx += 8;
        } else if ((ai === '10' && !seen['10']) || (ai === '21' && !seen['21'])) {
          var valStart = idx + 2;
          var fncPos = s.indexOf(FNC1, valStart);
          var valEnd = fncPos !== -1 ? fncPos : findVarEndNoFnc1(s, valStart, ai, seen);
          var val = s.slice(valStart, valEnd);
          if (ai === '10') batch = val;
          else serial = val;
          seen[ai] = true;
          idx = fncPos !== -1 ? (fncPos + 1) : valEnd;
        } else {
          break;
        }
      }
      if (!gtin) return null;
      var ean13 = gtin.charAt(0) === '0' ? gtin.slice(1) : gtin;
      return {
        gtin: gtin,
        ean13: ean13,
        expiry: expiry,
        batch: batch,
        serial: serial,
        expired: isExpired(expiry)
      };
    }
    function isSalePageActive() {
      // #novaPageView is hidden on the sale screen (.pos-root), so this card lives on the products page.
      if (document.body && document.body.dataset && document.body.dataset.activePage === 'products') return true;
      return Boolean(document.querySelector('.nova-tab.active[data-page="products"],.nova-hostmark.active[data-page="products"]'));
    }
    function buildCard() {
      var card = document.createElement('section');
      card.id = CARD_ID;
      card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');
      card.style.cssText = 'background:#14181d;border:1px solid #343b44;border-radius:10px;padding:14px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;overflow-x:hidden;';
      var title = document.createElement('h3');
      title.style.cssText = 'margin:0 0 10px 0;font-size:16px;color:#79c9eb;';
      title.textContent = t('قراءة الباركود الثنائي للتتبع الدوائي', '2D Track-and-Trace Barcode');
      card.appendChild(title);
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;';
      var input = document.createElement('input');
      input.id = 'novaGs1Input';
      input.type = 'text';
      input.placeholder = t('امسح الباركود الثنائي هنا', 'Scan 2D barcode here');
      input.style.cssText = 'flex:1 1 180px;min-width:0;min-height:44px;padding:0 12px;background:#0d1117;color:#e6edf3;border:1px solid #343b44;border-radius:8px;box-sizing:border-box;';
      row.appendChild(input);
      var btn = document.createElement('button');
      btn.id = 'novaGs1ParseBtn';
      btn.type = 'button';
      btn.className = 'btn btn-primary';
      btn.style.cssText = 'min-height:44px;padding:0 16px;cursor:pointer;';
      btn.textContent = t('قراءة الرمز', 'Read Code');
      row.appendChild(btn);
      card.appendChild(row);
      var out = document.createElement('div');
      out.id = 'novaGs1Result';
      out.style.cssText = 'margin-top:10px;font-size:13px;color:#9aa4b2;word-break:break-word;';
      card.appendChild(out);
      btn.addEventListener('click', function () {
          var res = parse(input.value);
          if (!res) {
            out.style.color = '#f85149';
            out.textContent = t('رمز غير صالح', 'Invalid 2D barcode');
            toast(t('رمز غير صالح', 'Invalid 2D barcode'), 'error');
            return;
          }
          if (res.expired) {
            out.style.color = '#f85149';
            out.textContent = t('تم رفض العبوة: منتهية الصلاحية', 'Pack refused: expired') + ' (' + res.expiry + ')';
            toast(t('تم رفض العبوة: منتهية الصلاحية', 'Pack refused: expired'), 'error');
            return;
          }
          out.style.color = '#79c9eb';
          out.textContent = t('الرقم العالمي: ', 'GTIN: ') + res.gtin +
          (res.expiry ? (' | ' + t('الصلاحية: ', 'Expiry: ') + res.expiry) : '') +
          (res.batch ? (' | ' + t('التشغيلة: ', 'Batch: ') + res.batch) : '') +
          (res.serial ? (' | ' + t('التسلسلي: ', 'Serial: ') + res.serial) : '');
          toast(t('تمت قراءة الباركود الثنائي بنجاح', '2D barcode parsed'), 'success');
      });
      return card;
    }
    function mountIfNeeded() {
      var root = document.getElementById('novaPageView');
      if (!root || !isSalePageActive()) return;
      if (document.getElementById(CARD_ID)) return;
      root.appendChild(buildCard());
    }
    window.novaGs1 = {
      parse: parse,
      isExpired: isExpired
    };
    var observer = null;
    function initObserver() {
      var root = document.getElementById('novaPageView');
      if (!root || observer) return;
      observer = new MutationObserver(function () {
          mountIfNeeded();
      });
      observer.observe(root, { childList: true });
      mountIfNeeded();
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initObserver);
    } else {
      initObserver();
    }
})();

/* Q21-2c «الأدوات» hub (lazy). One page with every ops card as a tile, grouped and searchable. A tile opens only that card
   (app/130 view «tool:<id>» on its host page, with «→ الأدوات» to come back). The cards keep their own code and checks. */
(function () {
  'use strict';
  if (window.novaToolsHub) return;
  var en = function () { try { return localStorage.getItem('nova-rx-language') === 'en'; } catch (e) { return false; } };
  var T = function (a, e) { return en() ? e : a; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); };
  var GROUPS = [
    ['money', 'فلوس', 'Money'], ['stock', 'مخزون', 'Stock'], ['suppliers', 'موردين', 'Suppliers'],
    ['customers', 'عملاء', 'Customers'], ['legal', 'قانوني ورقابة', 'Legal & control'], ['staff', 'موظفين', 'Staff']
  ];
  // [card id, group, ar title, en title, ar hint]
  var TOOLS = [
    ['novaVaultCard', 'money', 'الخزنة والبنك', 'Vault & bank', 'رصيد الخزنة الرئيسية والإيداع في البنك'],
    ['novaIncomeCard', 'money', 'قائمة الدخل الشهرية', 'Monthly income statement', 'المبيعات والتكلفة والمصروفات والصافي'],
    ['novaExcelExport', 'money', 'تصدير لإكسل', 'Export to Excel', 'المبيعات والأصناف في ملف إكسل'],
    ['novaProfitSlow', 'money', 'الربح والأصناف الراكدة', 'Profit & slow movers', 'ربح كل صنف واللي مش بيتباع'],
    ['novaStockCount', 'stock', 'الجرد', 'Stock count', 'عدّ الرف ومقارنته بالرصيد'],
    ['novaItemLimits', 'stock', 'الحدود ومكان الرف', 'Limits & shelf place', 'أقل كمية ومكان الصنف'],
    ['novaExpiryClearance', 'stock', 'تصفية قريب الانتهاء', 'Near-expiry clearance', 'خصم مخطط على الأصناف اللي قربت تنتهي'],
    ['novaShelfLabels', 'stock', 'ملصقات أسعار الرف', 'Shelf price labels', 'طباعة سعر الصنف للرف'],
    ['novaInternalBarcodes', 'stock', 'باركود داخلي', 'Internal barcodes', 'باركود لصنف ملوش باركود'],
    ['novaAltBarcodesCard', 'stock', 'باركودات إضافية', 'Extra barcodes', 'أكتر من باركود لنفس الصنف'],
    ['novaGs1Card', 'stock', 'الباركود الثنائي (التتبع)', '2D barcode (tracking)', 'قراءة باركود التتبع الدوائي'],
    ['novaOfficialPrices', 'stock', 'الأسعار الرسمية', 'Official prices', 'تحديث الأسعار من قائمة هيئة الدواء'],
    ['novaSupplierAccountsSection', 'suppliers', 'حسابات الموردين', 'Supplier accounts', 'المستحقات والدفعات'],
    ['novaSupplierCheques', 'suppliers', 'الشيكات الآجلة', 'Post-dated cheques', 'شيكات الموردين ومواعيدها'],
    ['novaSupplierNotes', 'suppliers', 'إشعارات الخصم والإضافة', 'Debit / credit notes', 'تسويات مع الموردين'],
    ['novaPharmacySwaps', 'suppliers', 'الاستلاف والتبديل', 'Pharmacy swaps', 'مع الصيدليات المجاورة'],
    ['novaCustomerRequests', 'customers', 'طلبات العملاء', 'Customer requests', 'صنف مطلوب لعميل'],
    ['novaFamilyAccounts', 'customers', 'حساب العائلة', 'Family accounts', 'أكتر من فرد على حساب واحد'],
    ['novaCorporate', 'customers', 'عقود الشركات', 'Company contracts', 'الفاتورة الشهرية للشركات'],
    ['novaDoctorRx', 'customers', 'روشتات الأطباء', 'Doctor prescriptions', 'متابعة روشتات كل طبيب'],
    ['novaControlledRegister', 'legal', 'دفتر الأدوية المراقبة', 'Controlled drugs register', 'القيود والطباعة'],
    ['novaDestruction', 'legal', 'محضر إعدام المنتهي', 'Destruction record', 'الأدوية المنتهية'],
    ['novaFridgeLog', 'legal', 'حرارة التلاجة', 'Fridge temperature', 'تسجيل الحرارة كل يوم'],
    ['novaLicenseReminders', 'legal', 'تجديد الرخص', 'Licence renewals', 'الرخص والشهادات ومواعيدها'],
    ['novaSensitiveLogSection', 'legal', 'سجل العمليات الحساسة', 'Sensitive operations log', 'مين عمل إيه وإمتى'],
    ['novaStaffStatsCard', 'staff', 'الحضور ومبيعات الموظفين', 'Attendance & staff sales', 'حضور وانصراف ومبيعات كل موظف'],
    ['novaPayroll', 'staff', 'المرتبات والعمولات', 'Payroll & commissions', 'المرتب والتارجت']
  ];
  var HOST_PRODUCTS = { novaStockCount: 1, novaItemLimits: 1, novaDestruction: 1, novaCustomerRequests: 1, novaShelfLabels: 1, novaFamilyAccounts: 1,
    novaInternalBarcodes: 1, novaOfficialPrices: 1, novaAltBarcodesCard: 1, novaGs1Card: 1 };
  var QUICK = [
    ['receiving', 'استلام فاتورة مورد', 'Receive a supplier invoice'],
    ['purchases', 'النواقص وطلبيات الموردين', 'Shortages & supplier orders'],
    ['shift', 'الوردية', 'Shift'],
    ['settings', 'الإعدادات', 'Settings']
  ];
  var q = '';
  function norm(x) { return (window.novaNormAr ? window.novaNormAr(x) : String(x || '').toLowerCase()).trim(); }
  function open(id) {
    var sw = window.novaSwitchPage; if (!sw) return;
    sw(HOST_PRODUCTS[id] ? 'products' : 'reports', 'tool:' + id);
  }
  function tiles() {
    var nq = norm(q);
    var hits = TOOLS.filter(function (t) { return !nq || norm(t[2] + ' ' + t[3] + ' ' + t[4]).indexOf(nq) >= 0; });
    if (!hits.length) return '<p class="nova-muted" role="status" style="padding:12px 4px">' + T('مفيش أداة بالاسم ده', 'No tool with that name') + '</p>';
    return GROUPS.map(function (g) {
      var gs = hits.filter(function (t) { return t[1] === g[0]; }); if (!gs.length) return '';
      return '<section class="nth-group" data-group="' + g[0] + '"><h2>' + (en() ? g[2] : g[1]) + '</h2><div class="nth-grid">'
        + gs.map(function (t) { return '<button type="button" class="nth-tile" data-tool="' + t[0] + '"><b>' + esc(en() ? t[3] : t[2]) + '</b>' + (en() ? '' : '<small>' + esc(t[4]) + '</small>') + '</button>'; }).join('')
        + '</div></section>';
    }).join('');
  }
  function css() {
    if (document.getElementById('novaToolsHubCss')) return;
    var st = document.createElement('style'); st.id = 'novaToolsHubCss';
    st.textContent = '.nth-quick{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin:0 0 16px}'
      + '.nth-quick .btn{min-height:52px;font-size:15px;font-weight:700}'
      + '.nth-search{width:100%;max-width:420px;min-height:44px;box-sizing:border-box;margin:0 0 6px}'
      + '.nth-group h2{font-size:15px;margin:16px 2px 8px;color:#9eacb9}'
      + '.nth-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}'
      + '.nth-tile{display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-height:64px;padding:10px 14px;text-align:start;background:#1b2027;border:1px solid #2a3139;border-radius:12px;color:#e8eef3;font:inherit;cursor:pointer}'
      + '.nth-tile:hover{border-color:#79c9eb}.nth-tile:focus-visible{outline:2px solid #79c9eb;outline-offset:2px}'
      + '.nth-tile b{font-size:15px}.nth-tile small{font-size:12px;color:#8896a4}'
      + '@media (max-width:780px){.nth-grid,.nth-quick{grid-template-columns:1fr 1fr}.nth-tile small{display:none}}';
    document.head.appendChild(st);
  }
  function render(view) {
    if (!view) view = document.getElementById('novaPageView'); if (!view) return;
    css();
    view.innerHTML = '<div class="nova-page-header"><div><h1>' + T('الأدوات', 'Tools') + '</h1><p>' + T('كل الأدوات في مكان واحد — دوس على الأداة تفتح لوحدها', 'Every tool in one place — tap one to open it on its own') + '</p></div>'
      + '<input class="nova-page-search nth-search" id="novaToolsSearch" type="search" placeholder="' + T('دوّر على أداة…', 'Find a tool…') + '" aria-label="' + T('بحث في الأدوات', 'Search tools') + '"></div>'
      + '<div class="nth-quick">' + QUICK.map(function (k) { return '<button type="button" class="btn btn-secondary" data-quick="' + k[0] + '">' + (en() ? k[2] : k[1]) + '</button>'; }).join('') + '</div>'
      + '<div id="novaToolsGrid">' + tiles() + '</div>';
    var inp = view.querySelector('#novaToolsSearch'); inp.value = q;
    inp.addEventListener('input', function () { q = inp.value; var g = document.getElementById('novaToolsGrid'); if (g) g.innerHTML = tiles(); });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var f = view.querySelector('.nth-tile'); if (f) f.click(); } });
    view.onclick = function (e) {
      var t = e.target.closest && e.target.closest('[data-tool]'); if (t) { open(t.getAttribute('data-tool')); return; }
      var k = e.target.closest && e.target.closest('[data-quick]'); if (!k) return;
      var p = k.getAttribute('data-quick');
      if (p === 'purchases') { location.href = '/purchases'; return; }
      if (window.novaSwitchPage) window.novaSwitchPage(p);
    };
  }
  // leaving the hub clears the click handler set above
  new MutationObserver(function () { var v = document.getElementById('novaPageView'); if (v && document.body.dataset.activePage !== 'tools') v.onclick = null; })
    .observe(document.body, { attributes: true, attributeFilter: ['data-active-page'] });
  window.novaToolsHub = { render: render, open: open, TOOLS: TOOLS, GROUPS: GROUPS };
  if (document.body && document.body.dataset.activePage === 'tools') render();
})();
