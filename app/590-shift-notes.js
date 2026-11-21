/* app/590-shift-notes.js — NOVA Rx Shift Handover Notes (ES5 IIFE, Lazy) */
(function () {
  'use strict';

  var STORAGE_KEY = 'nova-rx-shift-notes-v1';
  var MAX_RECORDS = 500;
  var MAX_TEXT_LEN = 300;
  var CARD_ID = 'novaShiftNotes';
  var BADGE_ID = 'novaShiftNotesBadge';
  var PANEL_ID = 'novaShiftNotesPanel';
  var STYLE_ID = 'novaShiftNotesStyle';

  var toastShown = false;
  var isSyncing = false;
  var panelOpen = false;
  var observerAttached = false;
  var bodyObserverAttached = false;

  function isEn() {
    try {
      return window.localStorage && window.localStorage.getItem('nova-rx-language') === 'en';
    } catch (e) {
      return false;
    }
  }

  function t(ar, en) {
    return isEn() ? en : ar;
  }

  function currentUserName() {
    try {
      if (window.novaAuth && typeof window.novaAuth.current === 'function') {
        var u = window.novaAuth.current();
        if (u && typeof u.name === 'string') {
          return u.name.trim();
        }
      }
    } catch (e) {
      return '';
    }
    return '';
  }

  function notify(msg, type) {
    try {
      if (typeof window.showToast === 'function') {
        window.showToast(msg, type || 'success');
      }
    } catch (e) {
      /* ignore toast errors */
    }
  }

  function normalizePriority(p) {
    if (typeof p === 'string') {
      var v = p.trim().toLowerCase();
      if (v === 'مهم' || v === 'important' || v === 'high') {
        return 'مهم';
      }
    }
    return 'عادي';
  }

  function readAll() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      var clean = [];
      for (var i = 0; i < parsed.length; i++) {
        var item = parsed[i];
        if (item && typeof item === 'object' && typeof item.text === 'string') {
          clean.push({
            id: typeof item.id === 'string' && item.id ? item.id : ('sn-legacy-' + i),
            text: item.text.slice(0, MAX_TEXT_LEN),
            priority: normalizePriority(item.priority),
            by: typeof item.by === 'string' ? item.by : '',
            at: typeof item.at === 'string' ? item.at : '',
            doneAt: typeof item.doneAt === 'string' ? item.doneAt : null,
            doneBy: typeof item.doneBy === 'string' ? item.doneBy : null
          });
        }
      }
      return clean;
    } catch (e) {
      return [];
    }
  }

  function writeAll(records) {
    var trimmed = records;
    if (records.length > MAX_RECORDS) {
      trimmed = records.slice(records.length - MAX_RECORDS);
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
      /* ignore quota errors */
    }
  }

  function cloneNote(n) {
    return {
      id: n.id,
      text: n.text,
      priority: n.priority,
      by: n.by,
      at: n.at,
      doneAt: n.doneAt,
      doneBy: n.doneBy
    };
  }

  function sortNotes(items) {
    var copy = [];
    for (var i = 0; i < items.length; i++) {
      copy.push(cloneNote(items[i]));
    }
    copy.sort(function (a, b) {
      var aDone = a.doneAt ? 1 : 0;
      var bDone = b.doneAt ? 1 : 0;
      if (aDone !== bDone) {
        return aDone - bDone;
      }
      if (!aDone) {
        var aImp = a.priority === 'مهم' ? 0 : 1;
        var bImp = b.priority === 'مهم' ? 0 : 1;
        if (aImp !== bImp) {
          return aImp - bImp;
        }
      }
      var aTime = a.at || '';
      var bTime = b.at || '';
      if (bTime > aTime) {
        return 1;
      }
      if (bTime < aTime) {
        return -1;
      }
      return 0;
    });
    return copy;
  }

  function add(input) {
    var actor = currentUserName();
    if (!actor) {
      return null;
    }
    if (!input || typeof input !== 'object') {
      return null;
    }
    var rawText = typeof input.text === 'string' ? input.text.trim() : '';
    if (!rawText || rawText.length > MAX_TEXT_LEN) {
      return null;
    }
    var records = readAll();
    var note = {
      id: 'sn-' + Date.now() + '-' + Math.floor(Math.random() * 1000000),
      text: rawText,
      priority: normalizePriority(input.priority),
      by: actor,
      at: new Date().toISOString(),
      doneAt: null,
      doneBy: null
    };
    records.push(note);
    writeAll(records);
    refreshUI();
    return cloneNote(note);
  }

  function list() {
    return sortNotes(readAll());
  }

  function open() {
    var all = sortNotes(readAll());
    var result = [];
    for (var i = 0; i < all.length; i++) {
      if (!all[i].doneAt) {
        result.push(all[i]);
      }
    }
    return result;
  }

  function markDone(id) {
    var actor = currentUserName();
    if (!actor) {
      return null;
    }
    if (typeof id !== 'string' || !id) {
      return null;
    }
    var records = readAll();
    var target = null;
    for (var i = 0; i < records.length; i++) {
      if (records[i].id === id) {
        target = records[i];
        break;
      }
    }
    if (!target) {
      return null;
    }
    if (!target.doneAt) {
      target.doneAt = new Date().toISOString();
      target.doneBy = actor;
      writeAll(records);
      refreshUI();
    }
    return cloneNote(target);
  }

  function checkImportantToast() {
    if (toastShown) {
      return;
    }
    var me = currentUserName();
    var openNotes = open();
    var hasOtherImportant = false;
    for (var i = 0; i < openNotes.length; i++) {
      var n = openNotes[i];
      if (n.priority === 'مهم') {
        if (me ? (n.by !== me) : (!!n.by)) {
          hasOtherImportant = true;
          break;
        }
      }
    }
    if (hasOtherImportant) {
      toastShown = true;
      notify(
        t('فيه ملاحظة مهمة من الوردية اللي فاتت', 'There is an important note from the previous shift'),
        'error'
      );
    }
  }

  function isPageActive(pageName) {
    if (document.body && document.body.dataset && document.body.dataset.activePage === pageName) {
      return true;
    }
    return !!document.querySelector('.nova-tab.active[data-page="' + pageName + '"]');
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#' + CARD_ID + ' {',
      '  background: #14181d;',
      '  border: 1px solid #343b44;',
      '  border-radius: 12px;',
      '  padding: 16px;',
      '  margin-top: 16px;',
      '  color: #e6edf3;',
      '  box-sizing: border-box;',
      '  max-width: 100%;',
      '  overflow-x: hidden;',
      '}',
      '#' + CARD_ID + ' *, #' + PANEL_ID + ' * {',
      '  box-sizing: border-box;',
      '}',
      '.nsn-header {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 8px;',
      '  flex-wrap: wrap;',
      '  margin-bottom: 12px;',
      '}',
      '.nsn-title {',
      '  margin: 0;',
      '  font-size: 1.05rem;',
      '  font-weight: 700;',
      '  color: #79c9eb;',
      '}',
      '.nsn-count-pill {',
      '  font-size: 0.85rem;',
      '  padding: 4px 10px;',
      '  border-radius: 999px;',
      '  background: #1e242c;',
      '  border: 1px solid #343b44;',
      '  color: #e6edf3;',
      '}',
      '.nsn-form {',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 10px;',
      '  margin-bottom: 14px;',
      '}',
      '.nsn-textarea {',
      '  width: 100%;',
      '  min-height: 68px;',
      '  padding: 10px 12px;',
      '  background: #0d1117;',
      '  color: #e6edf3;',
      '  border: 1px solid #343b44;',
      '  border-radius: 8px;',
      '  font-family: inherit;',
      '  font-size: 0.95rem;',
      '  resize: vertical;',
      '}',
      '.nsn-controls {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  flex-wrap: wrap;',
      '}',
      '.nsn-select {',
      '  min-height: 44px;',
      '  padding: 0 12px;',
      '  background: #0d1117;',
      '  color: #e6edf3;',
      '  border: 1px solid #343b44;',
      '  border-radius: 8px;',
      '  font-family: inherit;',
      '  font-size: 0.92rem;',
      '}',
      '.nsn-btn {',
      '  min-height: 44px;',
      '  padding: 0 14px;',
      '  border-radius: 8px;',
      '  cursor: pointer;',
      '  font-family: inherit;',
      '  font-size: 0.92rem;',
      '}',
      '.nsn-list {',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 10px;',
      '}',
      '.nsn-item {',
      '  background: #1b2129;',
      '  border: 1px solid #343b44;',
      '  border-radius: 10px;',
      '  padding: 12px;',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 8px;',
      '  word-wrap: break-word;',
      '  overflow-wrap: anywhere;',
      '}',
      '.nsn-item-important {',
      '  border-color: #f59e0b;',
      '  background: rgba(245, 158, 11, 0.12);',
      '}',
      '.nsn-item-done {',
      '  opacity: 0.65;',
      '  border-color: #343b44;',
      '  background: #14181d;',
      '}',
      '.nsn-item-top {',
      '  display: flex;',
      '  align-items: flex-start;',
      '  justify-content: space-between;',
      '  gap: 8px;',
      '  flex-wrap: wrap;',
      '}',
      '.nsn-text {',
      '  margin: 0;',
      '  font-size: 0.95rem;',
      '  line-height: 1.5;',
      '  color: #e6edf3;',
      '  flex: 1 1 200px;',
      '}',
      '.nsn-item-done .nsn-text {',
      '  text-decoration: line-through;',
      '}',
      '.nsn-badge-priority {',
      '  font-size: 0.78rem;',
      '  font-weight: 700;',
      '  padding: 3px 8px;',
      '  border-radius: 999px;',
      '  border: 1px solid #343b44;',
      '  color: #79c9eb;',
      '  background: #14181d;',
      '  white-space: nowrap;',
      '}',
      '.nsn-badge-important {',
      '  border-color: #f59e0b;',
      '  color: #fbbf24;',
      '  background: rgba(245, 158, 11, 0.18);',
      '}',
      '.nsn-meta-row {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 8px;',
      '  flex-wrap: wrap;',
      '  font-size: 0.8rem;',
      '  color: #9aa7b4;',
      '}',
      '.nsn-empty {',
      '  margin: 0;',
      '  padding: 12px;',
      '  text-align: center;',
      '  color: #9aa7b4;',
      '  font-size: 0.9rem;',
      '}',
      '#' + BADGE_ID + ' {',
      '  position: fixed;',
      '  right: 10px;',
      '  bottom: 160px;',
      '  z-index: 950;',
      '  min-height: 44px;',
      '  max-width: 190px;',
      '  padding: 6px 12px;',
      '  background: #14181d;',
      '  color: #e6edf3;',
      '  border: 1px solid #79c9eb;',
      '  border-radius: 999px;',
      '  font-family: inherit;',
      '  font-size: 0.82rem;',
      '  font-weight: 600;',
      '  cursor: pointer;',
      '  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);',
      '  white-space: nowrap;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '}',
      '@media (max-width: 700px) { #' + BADGE_ID + ' { bottom: 250px; } }',
      '#' + BADGE_ID + '.nsn-sale-important {',
      '  border-color: #f59e0b;',
      '  color: #fbbf24;',
      '}',
      '#' + PANEL_ID + ' {',
      '  position: fixed;',
      '  left: 10px;',
      '  right: 10px;',
      '  bottom: 124px;',
      '  max-width: 368px;',
      '  max-height: 65vh;',
      '  overflow-y: auto;',
      '  z-index: 960;',
      '  background: #14181d;',
      '  border: 1px solid #343b44;',
      '  border-radius: 12px;',
      '  padding: 14px;',
      '  color: #e6edf3;',
      '  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function clearEl(el) {
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  function pad2(n) {
    var s = String(n);
    return s.length < 2 ? ('0' + s) : s;
  }

  function formatTime(iso) {
    if (!iso) {
      return '';
    }
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) {
        return iso;
      }
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    } catch (e) {
      return iso;
    }
  }

  function renderNotesBody(container, showCloseBtn) {
    clearEl(container);
    container.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    var openNotes = open();
    var allNotes = list();

    var header = document.createElement('div');
    header.className = 'nsn-header';

    var title = document.createElement('h3');
    title.className = 'nsn-title';
    title.textContent = t('دفتر تسليم الوردية', 'Shift Handover Notes');
    header.appendChild(title);

    var rightWrap = document.createElement('div');
    rightWrap.className = 'nsn-controls';

    var countPill = document.createElement('span');
    countPill.className = 'nsn-count-pill';
    countPill.textContent = t('مفتوحة: ', 'Open: ') + String(openNotes.length);
    rightWrap.appendChild(countPill);

    if (showCloseBtn) {
      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn btn-secondary nsn-btn';
      closeBtn.textContent = t('إغلاق', 'Close');
      closeBtn.addEventListener('click', function () {
        panelOpen = false;
        removePanel();
      });
      rightWrap.appendChild(closeBtn);
    }

    header.appendChild(rightWrap);
    container.appendChild(header);

    var form = document.createElement('form');
    form.className = 'nsn-form';

    var textarea = document.createElement('textarea');
    textarea.className = 'nsn-textarea';
    textarea.maxLength = MAX_TEXT_LEN;
    textarea.placeholder = t(
      'اكتب ملاحظة للوردية القادمة (حتى ٣٠٠ حرف)...',
      'Write a note for the next shift (up to 300 chars)...'
    );
    form.appendChild(textarea);

    var controls = document.createElement('div');
    controls.className = 'nsn-controls';

    var select = document.createElement('select');
    select.className = 'nsn-select';
    select.setAttribute('aria-label', t('الأولوية', 'Priority'));

    var optNormal = document.createElement('option');
    optNormal.value = 'عادي';
    optNormal.textContent = t('عادي', 'Normal');
    select.appendChild(optNormal);

    var optImp = document.createElement('option');
    optImp.value = 'مهم';
    optImp.textContent = t('مهم', 'Important');
    select.appendChild(optImp);

    controls.appendChild(select);

    var submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'btn btn-primary nsn-btn';
    submitBtn.textContent = t('إضافة ملاحظة', 'Add Note');
    controls.appendChild(submitBtn);

    form.appendChild(controls);

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!currentUserName()) {
        notify(t('سجّل الدخول أولاً لإضافة ملاحظة', 'Sign in first to add a note'), 'error');
        return;
      }
      var txt = textarea.value.trim();
      if (!txt) {
        notify(t('اكتب نص الملاحظة أولاً', 'Enter note text first'), 'error');
        return;
      }
      if (txt.length > MAX_TEXT_LEN) {
        notify(t('الملاحظة أطول من ٣٠٠ حرف', 'Note exceeds 300 characters'), 'error');
        return;
      }
      var created = add({ text: txt, priority: select.value });
      if (created) {
        textarea.value = '';
        notify(t('تمت إضافة الملاحظة', 'Note added'), 'success');
      }
    });

    container.appendChild(form);

    var listWrap = document.createElement('div');
    listWrap.className = 'nsn-list';

    if (allNotes.length === 0) {
      var empty = document.createElement('p');
      empty.className = 'nsn-empty';
      empty.textContent = t('لا توجد ملاحظات بعد', 'No shift notes yet');
      listWrap.appendChild(empty);
    } else {
      for (var i = 0; i < allNotes.length; i++) {
        listWrap.appendChild(buildNoteItem(allNotes[i]));
      }
    }

    container.appendChild(listWrap);
  }

  function buildNoteItem(note) {
    var item = document.createElement('div');
    var cls = 'nsn-item';
    if (note.doneAt) {
      cls += ' nsn-item-done';
    } else if (note.priority === 'مهم') {
      cls += ' nsn-item-important';
    }
    item.className = cls;

    var top = document.createElement('div');
    top.className = 'nsn-item-top';

    var textEl = document.createElement('p');
    textEl.className = 'nsn-text';
    textEl.textContent = note.text;
    top.appendChild(textEl);

    var pill = document.createElement('span');
    pill.className = 'nsn-badge-priority' + (note.priority === 'مهم' ? ' nsn-badge-important' : '');
    pill.textContent = note.priority === 'مهم' ? t('مهم', 'Important') : t('عادي', 'Normal');
    top.appendChild(pill);

    item.appendChild(top);

    var meta = document.createElement('div');
    meta.className = 'nsn-meta-row';

    var info = document.createElement('span');
    var infoParts = [];
    if (note.by) {
      infoParts.push(t('بواسطة: ', 'By: ') + note.by);
    }
    if (note.at) {
      infoParts.push(formatTime(note.at));
    }
    if (note.doneAt) {
      var doneStr = t('منفذة', 'Done');
      if (note.doneBy) {
        doneStr += ' - ' + t('أنهى بواسطة: ', 'Done by: ') + note.doneBy;
      }
      infoParts.push(doneStr);
    }
    info.textContent = infoParts.join(' • ');
    meta.appendChild(info);

    if (!note.doneAt) {
      var doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.className = 'btn btn-secondary nsn-btn';
      doneBtn.textContent = t('تم', 'Done');
      doneBtn.addEventListener('click', function () {
        if (!currentUserName()) {
          notify(t('سجّل الدخول أولاً لإنهاء الملاحظة', 'Sign in first to mark done'), 'error');
          return;
        }
        var res = markDone(note.id);
        if (res) {
          notify(t('تم إنهاء الملاحظة', 'Note marked done'), 'success');
        }
      });
      meta.appendChild(doneBtn);
    }

    item.appendChild(meta);
    return item;
  }

  function removePanel() {
    var existing = document.getElementById(PANEL_ID);
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }

  function renderSalePanel() {
    removePanel();
    if (!panelOpen || !isPageActive('sale')) {
      return;
    }
    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    renderNotesBody(panel, true);
    document.body.appendChild(panel);
  }

  function mountReportsCard() {
    var pageView = document.getElementById('novaPageView');
    if (!pageView) {
      return;
    }
    var existing = document.getElementById(CARD_ID);
    if (!existing) {
      existing = document.createElement('section');
      existing.id = CARD_ID;
      pageView.appendChild(existing);
      renderNotesBody(existing, false);
    }
  }

  function removeSaleBadge() {
    var badge = document.getElementById(BADGE_ID);
    if (badge && badge.parentNode) {
      badge.parentNode.removeChild(badge);
    }
    removePanel();
  }

  function mountSaleBadge() {
    var openNotes = open();
    var hasImp = false;
    for (var i = 0; i < openNotes.length; i++) {
      if (openNotes[i].priority === 'مهم') {
        hasImp = true;
        break;
      }
    }

    var pageView = document.getElementById('novaPageView');
    var targetParent = (pageView && pageView.childNodes.length > 0) ? pageView : document.body;
    if (!targetParent) {
      return;
    }

    var badge = document.getElementById(BADGE_ID);
    if (!badge) {
      badge = document.createElement('button');
      badge.id = BADGE_ID;
      badge.type = 'button';
      badge.addEventListener('click', function () {
        panelOpen = !panelOpen;
        renderSalePanel();
      });
      targetParent.appendChild(badge);
    } else if (badge.parentNode !== targetParent) {
      targetParent.appendChild(badge);
    }

    badge.className = hasImp ? 'nsn-sale-important' : '';
    badge.textContent = t('ملاحظات التسليم', 'Shift Notes') + ' (' + String(openNotes.length) + ')';

    if (panelOpen) {
      renderSalePanel();
    }
  }

  function syncMount() {
    if (isSyncing) {
      return;
    }
    isSyncing = true;
    try {
      injectStyles();
      if (isPageActive('reports')) {
        removeSaleBadge();
        mountReportsCard();
      } else if (isPageActive('sale')) {
        mountSaleBadge();
      } else {
        removeSaleBadge();
      }
    } finally {
      isSyncing = false;
    }
  }

  function refreshUI() {
    if (isPageActive('reports')) {
      var card = document.getElementById(CARD_ID);
      if (card) {
        renderNotesBody(card, false);
      } else {
        syncMount();
      }
    }
    if (isPageActive('sale')) {
      mountSaleBadge();
    }
  }

  function attachObservers() {
    var pageView = document.getElementById('novaPageView');
    if (pageView && !observerAttached && typeof MutationObserver === 'function') {
      observerAttached = true;
      var obs = new MutationObserver(function () {
        if (isPageActive('reports') && !document.getElementById(CARD_ID)) {
          syncMount();
        } else if (isPageActive('sale') && !document.getElementById(BADGE_ID)) {
          syncMount();
        } else if (!isPageActive('sale') && document.getElementById(BADGE_ID)) {
          removeSaleBadge();
        }
      });
      obs.observe(pageView, { childList: true });
    }

    if (document.body && !bodyObserverAttached && typeof MutationObserver === 'function') {
      bodyObserverAttached = true;
      var bodyObs = new MutationObserver(function () {
        syncMount();
      });
      bodyObs.observe(document.body, { attributes: true, attributeFilter: ['data-active-page'] });
    }

    document.addEventListener('click', function (ev) {
      var el = ev.target;
      while (el && el !== document) {
        if (el.classList && el.classList.contains('nova-tab')) {
          window.setTimeout(syncMount, 0);
          break;
        }
        el = el.parentNode;
      }
    });
  }

  window.novaShiftNotes = {
    add: add,
    list: list,
    open: open,
    markDone: markDone
  };

  function boot() {
    attachObservers();
    syncMount();
    checkImportantToast();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();