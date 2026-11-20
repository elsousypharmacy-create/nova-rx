/* NOVA Rx — CTRL-01 (owner decision 2026-11-20) «دفتر الأدوية المراقبة»: generic register until the official rules are confirmed.
   Reviewed Gemini Neon draft, integrated by Claude; loaded lazily (app/548). window.novaControlled.capture() is for checkout (sale lane). */
(function () {
  'use strict';

  if (window.__novaControlledLoaded) return;
  window.__novaControlledLoaded = true;

  var ITEMS_KEY = 'nova-rx-controlled-items-v1';
  var LOG_KEY = 'nova-rx-controlled-log-v1';
  var IDB_NAME = 'nova-rx-media';
  var IDB_STORE = 'rx';
  var STYLE_ID = 'nova-ctrl-styles';
  var REGISTER_ID = 'novaControlledRegister';
  var PRINT_HOST_ID = 'novaCtrlPrintHost';
  var PRINT_BODY_CLASS = 'nova-ctrl-printing';

  var unlockedBy = null; // { id, name, role } in-memory only, never persisted
  var printCleanupTimer = null;
  var moScheduled = false;
  var activeDialogs = [];

  /* -------------------- Storage & Helpers -------------------- */

  function safeParse(raw, fallback) {
    if (!raw) return fallback;
    try {
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function loadItemsMap() {
    return safeParse(localStorage.getItem(ITEMS_KEY), {});
  }

  function saveItemsMap(map) {
    localStorage.setItem(ITEMS_KEY, JSON.stringify(map || {}));
  }

  function loadLog() {
    var arr = safeParse(localStorage.getItem(LOG_KEY), []);
    return Array.isArray(arr) ? arr : [];
  }

  function saveLog(arr) {
    localStorage.setItem(LOG_KEY, JSON.stringify(arr));
  }

  function currentUser() {
    try {
      if (window.novaAuth && typeof window.novaAuth.current === 'function') {
        var u = window.novaAuth.current();
        if (u) return { id: u.id || '', name: u.name || '', role: u.role || '' };
      }
    } catch (e) {}
    return { id: '', name: 'غير معروف', role: '' };
  }

  function isManagerOrOwner(user) {
    if (!user || !user.role) return false;
    return user.role === 'manager' || user.role === 'owner';
  }

  function checkManagePerm() {
    if (window.novaPerms && typeof window.novaPerms.require === 'function') {
      try {
        return !!window.novaPerms.require('accounts.manage');
      } catch (e) {
        return false;
      }
    }
    return !window.novaAuth || isManagerOrOwner(currentUser());
  }

  function resolveKey(keyOrProduct) {
    if (!keyOrProduct) return '';
    if (typeof keyOrProduct === 'string') return keyOrProduct.trim();
    if (typeof keyOrProduct === 'object') {
      if (keyOrProduct.key) return String(keyOrProduct.key).trim();
      try {
        if (window.novaStock && typeof window.novaStock.keyOf === 'function') {
          var k = window.novaStock.keyOf(keyOrProduct);
          if (k) return String(k).trim();
        }
      } catch (e) {}
      if (keyOrProduct.barcode) return String(keyOrProduct.barcode).trim();
    }
    return '';
  }

  function resolveKeyByBarcode(barcode) {
    var b = String(barcode || '').trim();
    if (!b) return '';
    try {
      if (window.novaSearch && typeof window.novaSearch.search === 'function' &&
          window.novaStock && typeof window.novaStock.keyOf === 'function') {
        var res = window.novaSearch.search(b, 1);
        if (res && res.length && res[0]) {
          var k = window.novaStock.keyOf(res[0]);
          if (k) return String(k).trim();
        }
      }
    } catch (e) {}
    return '';
  }

  function normalizeDigits(str) {
    var s = String(str || '');
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (code >= 0x0660 && code <= 0x0669) {
        out += String(code - 0x0660);
      } else if (code >= 0x06F0 && code <= 0x06F9) {
        out += String(code - 0x06F0);
      } else {
        out += s.charAt(i);
      }
    }
    return out;
  }

  function normalizeNationalId(raw) {
    return normalizeDigits(raw).replace(/[\s\-]+/g, '').trim();
  }

  function isValidNationalId(nid) {
    return /^\d{14}$/.test(nid);
  }

  function maskNationalId(nid) {
    var clean = normalizeNationalId(nid);
    if (!clean) return '—';
    if (clean.length <= 4) return clean;
    return '**********' + clean.slice(-4);
  }

  function formatDateYMD(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    if (m.length < 2) m = '0' + m;
    if (day.length < 2) day = '0' + day;
    return y + '-' + m + '-' + day;
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    var hh = String(d.getHours());
    var mm = String(d.getMinutes());
    if (m.length < 2) m = '0' + m;
    if (day.length < 2) day = '0' + day;
    if (hh.length < 2) hh = '0' + hh;
    if (mm.length < 2) mm = '0' + mm;
    return y + '-' + m + '-' + day + ' ' + hh + ':' + mm;
  }

  function generateId() {
    var rnd = Math.floor(Math.random() * 1e9).toString(36);
    return 'ctrl-' + Date.now().toString(36) + '-' + rnd;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* -------------------- IndexedDB Media Store -------------------- */

  function openMediaDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      var req;
      try {
        req = window.indexedDB.open(IDB_NAME, 1);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error || new Error('IndexedDB open failed'));
      };
    });
  }

  function putRxImage(entryId, blob) {
    return openMediaDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction(IDB_STORE, 'readwrite');
          var store = tx.objectStore(IDB_STORE);
          store.put(blob, entryId);
          tx.oncomplete = function () {
            db.close();
            resolve(true);
          };
          tx.onerror = function () {
            db.close();
            reject(tx.error || new Error('IndexedDB write failed'));
          };
          tx.onabort = function () {
            try { db.close(); } catch (e) {}
            reject(tx.error || new Error('IndexedDB aborted'));
          };
        } catch (e) {
          db.close();
          reject(e);
        }
      });
    });
  }

  function getRxImage(entryId) {
    return openMediaDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction(IDB_STORE, 'readonly');
          var store = tx.objectStore(IDB_STORE);
          var req = store.get(entryId);
          req.onsuccess = function () {
            db.close();
            resolve(req.result || null);
          };
          req.onerror = function () {
            db.close();
            reject(req.error || new Error('IndexedDB read failed'));
          };
        } catch (e) {
          db.close();
          reject(e);
        }
      });
    });
  }

  function downscaleImageFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var maxDim = 1280;
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (w > maxDim || h > maxDim) {
            if (w >= h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          if (canvas.toBlob) {
            canvas.toBlob(function (blob) {
              if (blob) resolve(blob);
              else reject(new Error('Image encode failed'));
            }, 'image/jpeg', 0.7);
          } else {
            var dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            resolve(dataUrl);
          }
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Invalid image file'));
      };
      img.src = url;
    });
  }

  /* -------------------- Styles -------------------- */

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.nova-ctrl-badge{display:inline-block;margin-inline-start:6px;padding:1px 6px;font-size:11px;font-weight:700;border-radius:4px;background:rgba(121,201,235,0.16);color:#79c9eb;border:1px solid #79c9eb;vertical-align:middle;}' +
      '.nova-ctrl-ic-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 10px;margin:8px 0;background:#14181d;border:1px solid #343b44;border-radius:6px;font-size:13px;}' +
      '.nova-ctrl-ic-row label{display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-weight:600;color:#e6edf3;}' +
      '.nova-ctrl-ic-row input[type="text"]{flex:1 1 160px;min-width:120px;background:#1b2027;color:#e6edf3;border:1px solid #343b44;border-radius:4px;padding:4px 8px;font-size:12px;}' +
      '.nova-ctrl-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.68);z-index:9990;display:flex;align-items:center;justify-content:center;padding:16px;}' +
      '.nova-ctrl-dialog{background:#1b2027;color:#e6edf3;border:1px solid #343b44;border-radius:8px;width:100%;max-width:560px;max-height:90vh;overflow:auto;padding:16px;box-shadow:0 12px 32px rgba(0,0,0,0.5);direction:rtl;}' +
      '.nova-ctrl-dialog-head{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #343b44;padding-bottom:10px;margin-bottom:12px;}' +
      '.nova-ctrl-dialog-head h3{margin:0;font-size:16px;color:#79c9eb;}' +
      '.nova-ctrl-field{margin-bottom:10px;}' +
      '.nova-ctrl-field label{display:block;font-size:13px;margin-bottom:4px;color:#cbd5e1;}' +
      '.nova-ctrl-field input,.nova-ctrl-field select,.nova-ctrl-field textarea{width:100%;box-sizing:border-box;background:#14181d;color:#e6edf3;border:1px solid #343b44;border-radius:5px;padding:7px 9px;font-size:13px;}' +
      '.nova-ctrl-field input:focus,.nova-ctrl-field select:focus,.nova-ctrl-field textarea:focus{outline:1px solid #79c9eb;border-color:#79c9eb;}' +
      '.nova-ctrl-lines{background:#14181d;border:1px solid #343b44;border-radius:6px;padding:8px 10px;margin-bottom:12px;font-size:13px;}' +
      '.nova-ctrl-lines ul{margin:4px 0 0 0;padding-inline-start:18px;}' +
      '.nova-ctrl-err{color:#ff7b72;font-size:12px;margin:6px 0;min-height:16px;}' +
      '.nova-ctrl-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;}' +
      '.nova-ctrl-toast{position:fixed;bottom:18px;left:18px;z-index:10000;background:#1b2027;color:#e6edf3;border:1px solid #79c9eb;border-radius:6px;padding:10px 14px;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,0.45);max-width:340px;}' +
      '.nova-ctrl-reg{margin-top:20px;background:#1b2027;border:1px solid #343b44;border-radius:8px;padding:14px;color:#e6edf3;}' +
      '.nova-ctrl-reg-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid #343b44;padding-bottom:10px;margin-bottom:12px;}' +
      '.nova-ctrl-reg-head h2{margin:0;font-size:17px;color:#79c9eb;}' +
      '.nova-ctrl-reg-filters{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:12px;}' +
      '.nova-ctrl-reg-filters label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#cbd5e1;}' +
      '.nova-ctrl-reg-filters input,.nova-ctrl-reg-filters select{background:#14181d;color:#e6edf3;border:1px solid #343b44;border-radius:4px;padding:5px 8px;font-size:13px;}' +
      '.nova-ctrl-table-wrap{overflow-x:auto;}' +
      '.nova-ctrl-table{width:100%;border-collapse:collapse;font-size:13px;}' +
      '.nova-ctrl-table th,.nova-ctrl-table td{border:1px solid #343b44;padding:6px 8px;text-align:right;vertical-align:top;}' +
      '.nova-ctrl-table th{background:#14181d;color:#79c9eb;font-weight:600;}' +
      '.nova-ctrl-totals{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}' +
      '.nova-ctrl-total-chip{background:#14181d;border:1px solid #343b44;border-radius:6px;padding:6px 10px;font-size:12px;}' +
      '.nova-ctrl-corr-tag{display:inline-block;padding:1px 5px;border-radius:4px;background:rgba(255,166,87,0.18);color:#ffa657;border:1px solid #ffa657;font-size:11px;margin-inline-start:4px;}' +
      '#' + PRINT_HOST_ID + '{display:none;}' +
      '@media print{' +
      'body.' + PRINT_BODY_CLASS + ' > *:not(#' + PRINT_HOST_ID + '){display:none !important;}' +
      'body.' + PRINT_BODY_CLASS + ' #' + PRINT_HOST_ID + '{display:block !important;direction:rtl;color:#000;background:#fff;font-family:sans-serif;padding:12px;}' +
      'body.' + PRINT_BODY_CLASS + ' #' + PRINT_HOST_ID + ' table{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px;}' +
      'body.' + PRINT_BODY_CLASS + ' #' + PRINT_HOST_ID + ' th,body.' + PRINT_BODY_CLASS + ' #' + PRINT_HOST_ID + ' td{border:1px solid #333;padding:5px 6px;text-align:right;}' +
      '}';
    document.head.appendChild(style);
  }

  function showToast(msg) {
    var el = document.createElement('div');
    el.className = 'nova-ctrl-toast';
    el.setAttribute('role', 'status');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 4000);
  }

  /* -------------------- Accessible In-Page Dialog -------------------- */

  function getFocusable(container) {
    var nodes = container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    var list = [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].offsetParent !== null) list.push(nodes[i]);
    }
    return list;
  }

  function openDialog(opts) {
    var opener = document.activeElement;
    var backdrop = document.createElement('div');
    backdrop.className = 'nova-ctrl-backdrop';

    var dlg = document.createElement('div');
    dlg.className = 'nova-ctrl-dialog';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    if (opts.title) dlg.setAttribute('aria-label', opts.title);

    var head = document.createElement('div');
    head.className = 'nova-ctrl-dialog-head';
    var h3 = document.createElement('h3');
    h3.textContent = opts.title || '';
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-secondary';
    closeBtn.textContent = 'إغلاق';
    head.appendChild(h3);
    head.appendChild(closeBtn);
    dlg.appendChild(head);

    var body = document.createElement('div');
    dlg.appendChild(body);
    backdrop.appendChild(dlg);
    document.body.appendChild(backdrop);

    var closed = false;
    function close(reason) {
      if (closed) return;
      closed = true;
      if (typeof opts.onClose === 'function') { try { opts.onClose(); } catch (e) {} }
      document.removeEventListener('keydown', onKeyDown, true);
      var idx = activeDialogs.indexOf(dlg);
      if (idx !== -1) activeDialogs.splice(idx, 1);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      if (opener && typeof opener.focus === 'function') {
        try { opener.focus(); } catch (e) {}
      }
      if (opts.onClose) opts.onClose(reason);
    }

    function onKeyDown(ev) {
      if (activeDialogs[activeDialogs.length - 1] !== dlg) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        close('esc');
        return;
      }
      if (ev.key === 'Tab') {
        var focusables = getFocusable(dlg);
        if (!focusables.length) {
          ev.preventDefault();
          return;
        }
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (ev.shiftKey) {
          if (document.activeElement === first || !dlg.contains(document.activeElement)) {
            ev.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !dlg.contains(document.activeElement)) {
            ev.preventDefault();
            first.focus();
          }
        }
      }
    }

    closeBtn.addEventListener('click', function () { close('cancel'); });
    backdrop.addEventListener('mousedown', function (ev) {
      if (ev.target === backdrop) close('backdrop');
    });

    activeDialogs.push(dlg);
    document.addEventListener('keydown', onKeyDown, true);

    setTimeout(function () {
      var focusables = getFocusable(body);
      if (focusables.length) focusables[0].focus();
      else closeBtn.focus();
    }, 0);

    return {
      dialog: dlg,
      body: body,
      close: close
    };
  }

  /* -------------------- Core API -------------------- */

  function isControlled(keyOrProduct) {
    var key = resolveKey(keyOrProduct);
    if (!key) return false;
    var map = loadItemsMap();
    return !!map[key];
  }

  function listControlled() {
    return loadItemsMap();
  }

  function setControlled(keyOrProduct, enabled, note) {
    var key = resolveKey(keyOrProduct);
    if (!key) return false;
    var map = loadItemsMap();
    if (enabled) {
      var u = currentUser();
      map[key] = {
        by: { id: u.id, name: u.name },
        at: new Date().toISOString(),
        note: String(note || '').trim()
      };
    } else {
      delete map[key];
    }
    saveItemsMap(map);
    decorateProductRows();
    return true;
  }

  function capture(opts) {
    var saleId = opts && opts.saleId ? String(opts.saleId) : '';
    var lines = (opts && Array.isArray(opts.lines)) ? opts.lines : [];

    return new Promise(function (resolve) {
      var resolved = false;
      function finish(val) {
        if (resolved) return;
        resolved = true;
        resolve(val);
      }

      var modal = openDialog({
        title: 'بيانات صرف دواء مراقب',
        onClose: function () {
          finish(null);
        }
      });

      var linesHtml = '<div class="nova-ctrl-lines"><strong>الأصناف المراقبة:</strong><ul>';
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        linesHtml += '<li>' + escapeHtml(ln.name || ln.key) + ' — الكمية: ' + escapeHtml(ln.qty) + ' ' + escapeHtml(ln.unit || '') + '</li>';
      }
      linesHtml += '</ul></div>';

      var form = document.createElement('form');
      form.noValidate = true;
      form.innerHTML =
        linesHtml +
        '<div class="nova-ctrl-field">' +
          '<label for="novaCtrlPatient">اسم المريض *</label>' +
          '<input id="novaCtrlPatient" name="patientName" type="text" required autocomplete="off" />' +
        '</div>' +
        '<div class="nova-ctrl-field">' +
          '<label for="novaCtrlNid">الرقم القومي (14 رقم) *</label>' +
          '<input id="novaCtrlNid" name="nationalId" type="text" inputmode="numeric" dir="ltr" required autocomplete="off" placeholder="14 رقم" />' +
        '</div>' +
        '<div class="nova-ctrl-field">' +
          '<label for="novaCtrlDoctor">اسم الطبيب *</label>' +
          '<input id="novaCtrlDoctor" name="doctor" type="text" required autocomplete="off" />' +
        '</div>' +
        '<div class="nova-ctrl-field">' +
          '<label for="novaCtrlRxRef">رقم الروشتة / تاريخها (اختياري)</label>' +
          '<input id="novaCtrlRxRef" name="rxRef" type="text" autocomplete="off" />' +
        '</div>' +
        '<div class="nova-ctrl-field">' +
          '<label for="novaCtrlRxImg">صورة الروشتة (اختياري)</label>' +
          '<input id="novaCtrlRxImg" name="rxImage" type="file" accept="image/*" capture="environment" />' +
        '</div>' +
        '<div class="nova-ctrl-err" role="alert"></div>' +
        '<div class="nova-ctrl-actions">' +
          '<button type="button" class="btn btn-secondary" data-action="cancel">إلغاء</button>' +
          '<button type="submit" class="btn btn-primary" data-action="save">حفظ البيانات</button>' +
        '</div>';

      modal.body.appendChild(form);

      var errEl = form.querySelector('.nova-ctrl-err');
      var cancelBtn = form.querySelector('[data-action="cancel"]');
      var saveBtn = form.querySelector('[data-action="save"]');

      cancelBtn.addEventListener('click', function () {
        modal.close('cancel');
      });

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        errEl.textContent = '';

        var patientName = form.patientName.value.trim();
        var nationalId = normalizeNationalId(form.nationalId.value);
        var doctor = form.doctor.value.trim();
        var rxRef = form.rxRef.value.trim();
        var fileInput = form.rxImage;
        var file = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;

        if (!patientName) {
          errEl.textContent = 'من فضلك اكتب اسم المريض.';
          form.patientName.focus();
          return;
        }
        if (!isValidNationalId(nationalId)) {
          errEl.textContent = 'الرقم القومي لازم يكون 14 رقم بالضبط.';
          form.nationalId.focus();
          return;
        }
        if (!doctor) {
          errEl.textContent = 'من فضلك اكتب اسم الطبيب.';
          form.doctor.focus();
          return;
        }

        saveBtn.disabled = true;
        var nowIso = new Date().toISOString();
        var u = currentUser();
        var byObj = { id: u.id, name: u.name };

        var entries = [];
        for (var j = 0; j < lines.length; j++) {
          var l = lines[j];
          entries.push({
            id: generateId(),
            at: nowIso,
            saleId: saleId,
            key: resolveKey(l),
            name: String(l.name || ''),
            qty: Number(l.qty) || 0,
            unit: String(l.unit || ''),
            patientName: patientName,
            nationalId: nationalId,
            doctor: doctor,
            rxRef: rxRef,
            hasImage: false,
            by: byObj
          });
        }

        if (!file) {
          finish(entries);
          modal.close('submit');
          return;
        }

        downscaleImageFile(file)
          .then(function (blob) {
            var puts = [];
            for (var k = 0; k < entries.length; k++) {
              puts.push(putRxImage(entries[k].id, blob));
            }
            return Promise.all(puts).then(function () {
              for (var m = 0; m < entries.length; m++) {
                entries[m].hasImage = true;
              }
            });
          })
          .catch(function () {
            for (var m = 0; m < entries.length; m++) {
              entries[m].hasImage = false;
            }
            showToast('تعذر حفظ صورة الروشتة، تم حفظ السجل بدون الصورة.');
          })
          .then(function () {
            finish(entries);
            modal.close('submit');
          });
      });
    });
  }

  function record(entries) {
    if (!entries) return [];
    var list = Array.isArray(entries) ? entries : [entries];
    if (!list.length) return [];

    var log = loadLog();
    var existingIds = {};
    for (var i = 0; i < log.length; i++) {
      if (log[i] && log[i].id) existingIds[log[i].id] = true;
    }

    var u = currentUser();
    var added = [];
    for (var j = 0; j < list.length; j++) {
      var item = list[j];
      if (!item || typeof item !== 'object') continue;
      var id = item.id || generateId();
      if (existingIds[id]) continue;
      var entry = {
        id: id,
        at: item.at || new Date().toISOString(),
        saleId: item.saleId != null ? String(item.saleId) : '',
        key: resolveKey(item),
        name: String(item.name || ''),
        qty: Number(item.qty) || 0,
        unit: String(item.unit || ''),
        patientName: String(item.patientName || ''),
        nationalId: normalizeNationalId(item.nationalId || ''),
        doctor: String(item.doctor || ''),
        rxRef: String(item.rxRef || ''),
        hasImage: !!item.hasImage,
        by: item.by && typeof item.by === 'object'
          ? { id: item.by.id || '', name: item.by.name || '' }
          : { id: u.id, name: u.name }
      };
      if (item.correctionOf) {
        entry.correctionOf = String(item.correctionOf);
        entry.reason = String(item.reason || '');
      }
      log.push(entry);
      existingIds[id] = true;
      added.push(entry);
    }

    if (added.length) {
      saveLog(log);
      renderRegisterIfMounted();
    }
    return added;
  }

  window.novaControlled = {
    isControlled: isControlled,
    list: listControlled,
    setControlled: setControlled,
    capture: capture,
    record: record
  };

  /* -------------------- 1a. Item Card Injection -------------------- */

  function injectItemCardRow() {
    var dlg = document.querySelector('.nova-ic-dialog[role="dialog"]');
    if (!dlg) return;
    if (dlg.querySelector('[data-nova-ctrl-box="1"]')) return;

    var head = dlg.querySelector('.nova-ic-head');
    if (!head) return;

    var barcodeEl = dlg.querySelector('.nova-ic-meta strong[dir="ltr"]');
    if (!barcodeEl) return;

    var barcode = (barcodeEl.textContent || '').trim();
    if (!barcode) return;

    var key = resolveKeyByBarcode(barcode);
    if (!key) return;

    var map = loadItemsMap();
    var entry = map[key] || null;

    var row = document.createElement('div');
    row.className = 'nova-ctrl-ic-row';
    row.setAttribute('data-nova-ctrl-box', '1');

    var label = document.createElement('label');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!entry;
    var span = document.createElement('span');
    span.textContent = 'صنف مراقب (جدول)';
    label.appendChild(cb);
    label.appendChild(span);

    var noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.placeholder = 'ملاحظة (اختياري)';
    noteInput.value = entry && entry.note ? entry.note : '';
    noteInput.disabled = !cb.checked;

    row.appendChild(label);
    row.appendChild(noteInput);

    head.parentNode.insertBefore(row, head.nextSibling);

    cb.addEventListener('change', function () {
      if (!checkManagePerm()) {
        cb.checked = !cb.checked;
        showToast('ليس لديك صلاحية تعديل حالة الأصناف المراقبة.');
        return;
      }
      noteInput.disabled = !cb.checked;
      setControlled(key, cb.checked, noteInput.value);
    });

    noteInput.addEventListener('change', function () {
      if (!cb.checked) return;
      if (!checkManagePerm()) {
        var cur = loadItemsMap()[key];
        noteInput.value = cur && cur.note ? cur.note : '';
        showToast('ليس لديك صلاحية تعديل ملاحظة الصنف المراقب.');
        return;
      }
      setControlled(key, true, noteInput.value);
    });
  }

  /* -------------------- 1b. Products Page Badges -------------------- */

  var rowKeyCache = {};
  function decorateProductRows() {
    var rows = document.querySelectorAll('.nova-prod-panel tr.nova-row-focus');
    if (!rows.length) return;

    var map = loadItemsMap();
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      var nameTd = tr.querySelector('td.pc-name');
      var barTd = tr.querySelector('td.pc-bar');
      if (!nameTd || !barTd) continue;

      var barcode = (barTd.textContent || '').trim();
      // review fix: rows re-run on every DOM change — memoize the barcode -> key search
      var key = rowKeyCache[barcode];
      if (!key) { key = resolveKeyByBarcode(barcode); if (key) rowKeyCache[barcode] = key; }
      var controlled = !!(key && map[key]);
      var existing = nameTd.querySelector('.nova-ctrl-badge');

      if (controlled && !existing) {
        var badge = document.createElement('span');
        badge.className = 'nova-ctrl-badge';
        badge.textContent = 'مراقب';
        nameTd.appendChild(badge);
      } else if (!controlled && existing) {
        existing.parentNode.removeChild(existing);
      }
    }
  }

  /* -------------------- 3. Reports Page Register -------------------- */

  function openManagerUnlockDialog(onSuccess) {
    var modal = openDialog({
      title: 'تأكيد صلاحية المدير لإظهار الرقم القومي'
    });

    var form = document.createElement('form');
    form.noValidate = true;
    form.innerHTML =
      '<div class="nova-ctrl-field">' +
        '<label for="novaCtrlMgrUser">اسم المستخدم (مدير أو مالك)</label>' +
        '<input id="novaCtrlMgrUser" name="username" type="text" required autocomplete="off" />' +
      '</div>' +
      '<div class="nova-ctrl-field">' +
        '<label for="novaCtrlMgrPass">كلمة المرور</label>' +
        '<input id="novaCtrlMgrPass" name="password" type="password" required autocomplete="off" />' +
      '</div>' +
      '<div class="nova-ctrl-err" role="alert"></div>' +
      '<div class="nova-ctrl-actions">' +
        '<button type="button" class="btn btn-secondary" data-action="cancel">إلغاء</button>' +
        '<button type="submit" class="btn btn-primary" data-action="verify">تأكيد</button>' +
      '</div>';

    modal.body.appendChild(form);
    var errEl = form.querySelector('.nova-ctrl-err');
    form.querySelector('[data-action="cancel"]').addEventListener('click', function () {
      modal.close('cancel');
    });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      errEl.textContent = '';
      var uName = form.username.value.trim();
      var pass = form.password.value;
      if (!uName || !pass) {
        errEl.textContent = 'اكتب اسم المستخدم وكلمة المرور.';
        return;
      }
      if (!window.novaAuth || typeof window.novaAuth.verifyAccount !== 'function') {
        errEl.textContent = 'خدمة التحقق من الحساب غير متاحة.';
        return;
      }
      var btn = form.querySelector('[data-action="verify"]');
      btn.disabled = true;
      Promise.resolve(window.novaAuth.verifyAccount(uName, pass))
        .then(function (acc) {
          btn.disabled = false;
          if (!acc || !isManagerOrOwner(acc)) {
            errEl.textContent = 'البيانات غير صحيحة أو الحساب ليس مدير/مالك.';
            return;
          }
          unlockedBy = { id: acc.id || '', name: acc.name || uName, role: acc.role };
          modal.close('verified');
          if (onSuccess) onSuccess();
        })
        .catch(function () {
          btn.disabled = false;
          errEl.textContent = 'حصل خطأ أثناء التحقق.';
        });
    });
  }

  function openRxImageDialog(entry) {
    var imgClosed = false, objectUrl = null;
    var modal = openDialog({
      title: 'صورة الروشتة — ' + (entry.name || ''),
      onClose: function () { imgClosed = true; if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; } }
    });
    var wrap = document.createElement('div');
    wrap.style.textAlign = 'center';
    wrap.textContent = 'جاري تحميل الصورة...';
    modal.body.appendChild(wrap);


    getRxImage(entry.id)
      .then(function (data) {
        if (imgClosed) return;
        wrap.innerHTML = '';
        if (!data) {
          wrap.textContent = 'لا توجد صورة محفوظة لهذا السجل.';
          return;
        }
        var img = document.createElement('img');
        img.style.maxWidth = '100%';
        img.style.borderRadius = '6px';
        img.alt = 'صورة الروشتة';
        if (typeof data === 'string') {
          img.src = data;
        } else {
          objectUrl = URL.createObjectURL(data);
          img.src = objectUrl;
        }
        wrap.appendChild(img);
      })
      .catch(function () {
        wrap.textContent = 'تعذر قراءة الصورة من التخزين المحلي.';
      });
  }

  function openCorrectionDialog(entry) {
    var cur = currentUser();
    if (!isManagerOrOwner(cur)) {
      showToast('التصحيح متاح للمدير أو المالك فقط.');
      return;
    }

    var modal = openDialog({
      title: 'تصحيح سجل دواء مراقب'
    });

    var form = document.createElement('form');
    form.noValidate = true;
    form.innerHTML =
      '<div class="nova-ctrl-lines">' +
        '<div><strong>الصنف:</strong> ' + escapeHtml(entry.name) + '</div>' +
        '<div><strong>الكمية الأصلية:</strong> ' + escapeHtml(entry.qty) + ' ' + escapeHtml(entry.unit || '') + '</div>' +
        '<div><strong>المريض:</strong> ' + escapeHtml(entry.patientName) + '</div>' +
      '</div>' +
      '<div class="nova-ctrl-field">' +
        '<label for="novaCtrlCorrQty">فرق الكمية (+ أو −، مثلاً −1 لو اتصرف أقل)</label>' +
        '<input id="novaCtrlCorrQty" name="qty" type="number" step="any" value="0" required />' +
      '</div>' +
      '<div class="nova-ctrl-field">' +
        '<label for="novaCtrlCorrReason">سبب التصحيح *</label>' +
        '<textarea id="novaCtrlCorrReason" name="reason" rows="3" required placeholder="اكتب سبب التصحيح بوضوح"></textarea>' +
      '</div>' +
      '<div class="nova-ctrl-err" role="alert"></div>' +
      '<div class="nova-ctrl-actions">' +
        '<button type="button" class="btn btn-secondary" data-action="cancel">إلغاء</button>' +
        '<button type="submit" class="btn btn-primary">تسجيل التصحيح</button>' +
      '</div>';

    modal.body.appendChild(form);
    var errEl = form.querySelector('.nova-ctrl-err');
    form.querySelector('[data-action="cancel"]').addEventListener('click', function () {
      modal.close('cancel');
    });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      errEl.textContent = '';
      var reason = form.reason.value.trim();
      var qty = Number(form.qty.value);
      if (!reason) {
        errEl.textContent = 'سبب التصحيح مطلوب.';
        form.reason.focus();
        return;
      }
      if (isNaN(qty)) {
        errEl.textContent = 'الكمية غير صحيحة.';
        form.qty.focus();
        return;
      }
      record([{
        id: generateId(),
        at: new Date().toISOString(),
        saleId: entry.saleId,
        key: entry.key,
        name: entry.name,
        qty: qty,
        unit: entry.unit,
        patientName: entry.patientName,
        nationalId: entry.nationalId,
        doctor: entry.doctor,
        rxRef: entry.rxRef,
        hasImage: false,
        by: { id: cur.id, name: cur.name },
        correctionOf: entry.id,
        reason: reason
      }]);
      modal.close('submit');
      showToast('تم تسجيل قيد التصحيح.');
    });
  }

  function cleanupPrint() {
    if (printCleanupTimer) {
      clearTimeout(printCleanupTimer);
      printCleanupTimer = null;
    }
    document.body.classList.remove(PRINT_BODY_CLASS);
    var host = document.getElementById(PRINT_HOST_ID);
    if (host && host.parentNode) host.parentNode.removeChild(host);
    window.removeEventListener('afterprint', cleanupPrint);
  }

  function printRegister(rows, totals, fromDate, toDate) {
    cleanupPrint();
    var host = document.createElement('div');
    host.id = PRINT_HOST_ID;

    var showFull = !!unlockedBy;
    var html =
      '<h2>دفتر الأدوية المراقبة</h2>' +
      '<div>الفترة: ' + escapeHtml(fromDate) + ' إلى ' + escapeHtml(toDate) + '</div>' +
      '<table><thead><tr>' +
        '<th>التاريخ والوقت</th><th>الصنف</th><th>الكمية</th><th>المريض</th><th>الرقم القومي</th><th>الطبيب</th><th>الروشتة</th>' +
      '</tr></thead><tbody>';

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var nidText = showFull ? normalizeNationalId(r.nationalId) : maskNationalId(r.nationalId);
      var note = r.correctionOf ? ' (تصحيح: ' + escapeHtml(r.reason || '') + ')' : '';
      html +=
        '<tr>' +
          '<td>' + escapeHtml(formatDateTime(r.at)) + '</td>' +
          '<td>' + escapeHtml(r.name) + note + '</td>' +
          '<td>' + escapeHtml(r.qty) + ' ' + escapeHtml(r.unit || '') + '</td>' +
          '<td>' + escapeHtml(r.patientName) + '</td>' +
          '<td dir="ltr">' + escapeHtml(nidText) + '</td>' +
          '<td>' + escapeHtml(r.doctor) + '</td>' +
          '<td>' + escapeHtml(r.rxRef || '—') + '</td>' +
        '</tr>';
    }
    html += '</tbody></table>';

    var totalKeys = Object.keys(totals);
    if (totalKeys.length) {
      html += '<h3>الإجمالي لكل صنف</h3><ul>';
      for (var j = 0; j < totalKeys.length; j++) {
        var t = totals[totalKeys[j]];
        html += '<li>' + escapeHtml(t.name) + ': ' + escapeHtml(t.qty) + ' (' + escapeHtml(t.count) + ' عملية)</li>';
      }
      html += '</ul>';
    }

    host.innerHTML = html;
    document.body.appendChild(host);
    document.body.classList.add(PRINT_BODY_CLASS);
    window.addEventListener('afterprint', cleanupPrint);
    printCleanupTimer = setTimeout(cleanupPrint, 60000);

    try {
      window.print();
    } catch (e) {
      cleanupPrint();
    }
  }

  function renderRegisterContent(root) {
    var fromInput = root.querySelector('[data-ctrl-from]');
    var toInput = root.querySelector('[data-ctrl-to]');
    var itemSelect = root.querySelector('[data-ctrl-item]');
    var unlockBtn = root.querySelector('[data-ctrl-unlock]');
    var tbody = root.querySelector('tbody');
    var totalsEl = root.querySelector('[data-ctrl-totals]');

    var log = loadLog();
    var cur = currentUser();
    var canCorrect = isManagerOrOwner(cur);

    // Populate item filter options while keeping selection
    var prevItem = itemSelect.value;
    var itemsSeen = {};
    for (var i = 0; i < log.length; i++) {
      if (log[i] && log[i].key) {
        itemsSeen[log[i].key] = log[i].name || log[i].key;
      }
    }
    var optsHtml = '<option value="">كل الأصناف</option>';
    var itemKeys = Object.keys(itemsSeen);
    for (var k = 0; k < itemKeys.length; k++) {
      optsHtml += '<option value="' + escapeHtml(itemKeys[k]) + '">' + escapeHtml(itemsSeen[itemKeys[k]]) + '</option>';
    }
    itemSelect.innerHTML = optsHtml;
    itemSelect.value = prevItem;

    unlockBtn.textContent = unlockedBy
      ? 'إخفاء الأرقام القومية (' + unlockedBy.name + ')'
      : 'إظهار الرقم القومي (مدير)';

    var fromVal = fromInput.value;
    var toVal = toInput.value;
    var filterKey = itemSelect.value;

    var filtered = [];
    for (var j = 0; j < log.length; j++) {
      var entry = log[j];
      if (!entry) continue;
      var dayStr = entry.at ? formatDateYMD(new Date(entry.at)) : '';
      if (fromVal && dayStr && dayStr < fromVal) continue;
      if (toVal && dayStr && dayStr > toVal) continue;
      if (filterKey && entry.key !== filterKey) continue;
      filtered.push(entry);
    }

    // Newest first
    filtered.sort(function (a, b) {
      return String(b.at || '').localeCompare(String(a.at || ''));
    });

    var totals = {};
    tbody.innerHTML = '';

    if (!filtered.length) {
      var emptyTr = document.createElement('tr');
      emptyTr.innerHTML = '<td colspan="8" style="text-align:center;color:#8b949e;">لا توجد قيود في الفترة المحددة.</td>';
      tbody.appendChild(emptyTr);
    } else {
      for (var m = 0; m < filtered.length; m++) {
        (function (row) {
          var tKey = row.key || row.name || 'unknown';
          if (!totals[tKey]) totals[tKey] = { name: row.name || tKey, qty: 0, count: 0 };
          totals[tKey].qty += Number(row.qty) || 0;
          if (!row.correctionOf) totals[tKey].count += 1;

          var tr = document.createElement('tr');
          var nidDisplay = unlockedBy
            ? normalizeNationalId(row.nationalId)
            : maskNationalId(row.nationalId);

          var itemCell = escapeHtml(row.name || row.key);
          if (row.correctionOf) {
            itemCell += ' <span class="nova-ctrl-corr-tag">تصحيح</span>';
            if (row.reason) {
              itemCell += '<div style="font-size:11px;color:#ffa657;margin-top:2px;">السبب: ' + escapeHtml(row.reason) + '</div>';
            }
          }

          tr.innerHTML =
            '<td dir="ltr">' + escapeHtml(formatDateTime(row.at)) + '</td>' +
            '<td>' + itemCell + '</td>' +
            '<td>' + escapeHtml(row.qty) + ' ' + escapeHtml(row.unit || '') + '</td>' +
            '<td>' + escapeHtml(row.patientName) + '</td>' +
            '<td dir="ltr" data-ctrl-nid="1">' + escapeHtml(nidDisplay) + '</td>' +
            '<td>' + escapeHtml(row.doctor) + '</td>' +
            '<td>' + escapeHtml(row.rxRef || '—') + '</td>' +
            '<td data-ctrl-acts="1"></td>';

          var actTd = tr.querySelector('[data-ctrl-acts="1"]');
          if (row.hasImage) {
            var imgBtn = document.createElement('button');
            imgBtn.type = 'button';
            imgBtn.className = 'btn btn-secondary';
            imgBtn.textContent = 'صورة';
            imgBtn.style.marginInlineEnd = '4px';
            imgBtn.addEventListener('click', function () {
              openRxImageDialog(row);
            });
            actTd.appendChild(imgBtn);
          }
          if (canCorrect) {
            var corrBtn = document.createElement('button');
            corrBtn.type = 'button';
            corrBtn.className = 'btn btn-secondary';
            corrBtn.textContent = 'تصحيح';
            corrBtn.addEventListener('click', function () {
              openCorrectionDialog(row);
            });
            actTd.appendChild(corrBtn);
          }
          if (!actTd.childNodes.length) {
            actTd.textContent = '—';
          }

          tbody.appendChild(tr);
        })(filtered[m]);
      }
    }

    totalsEl.innerHTML = '';
    var tKeys = Object.keys(totals);
    for (var n = 0; n < tKeys.length; n++) {
      var tObj = totals[tKeys[n]];
      var chip = document.createElement('div');
      chip.className = 'nova-ctrl-total-chip';
      chip.textContent = tObj.name + ': ' + tObj.qty + ' (' + tObj.count + ' عملية)';
      totalsEl.appendChild(chip);
    }

    root._lastFiltered = filtered;
    root._lastTotals = totals;
  }

  function mountRegisterIfNeeded() {
    var activeReports = document.querySelector('.nova-tab.active[data-page="reports"]');
    if (!activeReports) { unlockedBy = null; return; }
    var me = currentUser();
    if (unlockedBy && (!me || me.id !== unlockedBy.id)) unlockedBy = null;
    var pageView = document.getElementById('novaPageView');
    if (!pageView) return;
    if (document.getElementById(REGISTER_ID)) return;

    var now = new Date();
    var firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    var section = document.createElement('section');
    section.id = REGISTER_ID;
    section.className = 'nova-ctrl-reg';
    section.innerHTML =
      '<div class="nova-ctrl-reg-head">' +
        '<h2>دفتر الأدوية المراقبة</h2>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button type="button" class="btn btn-secondary" data-ctrl-unlock="1">إظهار الرقم القومي (مدير)</button>' +
          '<button type="button" class="btn btn-primary" data-ctrl-print="1">طباعة الدفتر</button>' +
        '</div>' +
      '</div>' +
      '<div class="nova-ctrl-reg-filters">' +
        '<label>من تاريخ<input type="date" data-ctrl-from="1" value="' + formatDateYMD(firstOfMonth) + '" /></label>' +
        '<label>إلى تاريخ<input type="date" data-ctrl-to="1" value="' + formatDateYMD(now) + '" /></label>' +
        '<label>الصنف<select data-ctrl-item="1"><option value="">كل الأصناف</option></select></label>' +
      '</div>' +
      '<div class="nova-ctrl-table-wrap">' +
        '<table class="nova-ctrl-table">' +
          '<thead><tr>' +
            '<th>التاريخ والوقت</th><th>الصنف</th><th>الكمية</th><th>المريض</th><th>الرقم القومي</th><th>الطبيب</th><th>الروشتة</th><th>إجراءات</th>' +
          '</tr></thead>' +
          '<tbody></tbody>' +
        '</table>' +
      '</div>' +
      '<div class="nova-ctrl-totals" data-ctrl-totals="1"></div>';

    pageView.appendChild(section);

    section.querySelector('[data-ctrl-from]').addEventListener('change', function () {
      renderRegisterContent(section);
    });
    section.querySelector('[data-ctrl-to]').addEventListener('change', function () {
      renderRegisterContent(section);
    });
    section.querySelector('[data-ctrl-item]').addEventListener('change', function () {
      renderRegisterContent(section);
    });
    section.querySelector('[data-ctrl-unlock]').addEventListener('click', function () {
      if (unlockedBy) {
        unlockedBy = null;
        renderRegisterContent(section);
      } else {
        openManagerUnlockDialog(function () {
          renderRegisterContent(section);
        });
      }
    });
    section.querySelector('[data-ctrl-print]').addEventListener('click', function () {
      printRegister(
        section._lastFiltered || [],
        section._lastTotals || {},
        section.querySelector('[data-ctrl-from]').value,
        section.querySelector('[data-ctrl-to]').value
      );
    });

    renderRegisterContent(section);
  }

  function renderRegisterIfMounted() {
    var root = document.getElementById(REGISTER_ID);
    if (root) renderRegisterContent(root);
  }

  /* -------------------- Observer & Init -------------------- */

  function runDomSync() {
    moScheduled = false;
    injectItemCardRow();
    decorateProductRows();
    mountRegisterIfNeeded();
  }

  function scheduleDomSync() {
    if (moScheduled) return;
    moScheduled = true;
    setTimeout(runDomSync, 0);
  }

  function init() {
    injectStyles();
    runDomSync();

    if (window.MutationObserver && document.body) {
      var observer = new MutationObserver(function () {
        scheduleDomSync();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();