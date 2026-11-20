/* NOVA Rx — BACKUP-01 (owner decision 2026-11-20) full encrypted backup file + daily reminder. Reviewed Gemini Neon draft, integrated
   by Claude; loaded lazily (app/548). The passphrase is never stored. Cloud copies come later with the backend.
   Vanilla JS, no framework, no template literals, Egyptian Arabic UI, Western digits.
   Exposes window.novaFullBackup = { collect, create, restore, lastBackup }. */
(function (root) {
  'use strict';

  var ITER = 150000;
  var LAST_BACKUP_KEY = 'nova-rx-last-backup-v1';
  var LAST_RESTORE_KEY = 'nova-rx-last-restore-v1';
  var SNOOZE_KEY = 'nova-rx-backup-snooze-v1';
  var PENDING_JOURNAL_KEY = 'nova.receipt-transaction-v1';
  var DAY_MS = 24 * 60 * 60 * 1000;
  var SNOOZE_MS = 12 * 60 * 60 * 1000;
  var STYLE_ID = 'novaFullBackupStyles';
  var CARD_ID = 'novaFullBackupCard';
  var BANNER_ID = 'novaFullBackupBanner';
  var reminderShown = false;

  /* ---------- Crypto (from backup-schedule.js) ---------- */
  function fail(code, msg) {
    var e = new Error(msg || code);
    e.code = code;
    throw e;
  }

  function cry() {
    var c = root.crypto;
    if (!c || !c.subtle) fail('no-webcrypto', 'المتصفح مش بيدعم التشفير (WebCrypto)');
    return c;
  }

  function b64(buf) {
    var b = new Uint8Array(buf);
    var s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }

  function unb64(s) {
    var r = atob(s);
    var b = new Uint8Array(r.length);
    for (var i = 0; i < r.length; i++) b[i] = r.charCodeAt(i);
    return b;
  }

  function deriveKey(pass, salt, iter) {
    var c = cry();
    return c.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
      .then(function (m) {
        return c.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' },
          m,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }

  function encryptText(text, pass, iter) {
    return Promise.resolve().then(function () { return encryptTextNow(text, pass, iter); });
  }
  function encryptTextNow(text, pass, iter) {
    if (typeof pass !== 'string' || pass.length < 8) {
      var err = new Error('الباسورد لازم يكون 8 حروف أو أكتر');
      err.code = 'weak-passphrase';
      return Promise.reject(err);
    }
    iter = iter || ITER;
    var c = cry();
    var salt = c.getRandomValues(new Uint8Array(16));
    var iv = c.getRandomValues(new Uint8Array(12));
    return deriveKey(pass, salt, iter)
      .then(function (k) {
        return c.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(text));
      })
      .then(function (ct) {
        return {
          format: 'nova-rx-encrypted-backup',
          version: 1,
          kind: 'full',
          iter: iter,
          salt: b64(salt),
          iv: b64(iv),
          data: b64(ct)
        };
      });
  }

  function decryptEnvelope(env, pass) {
    return Promise.resolve().then(function () { return decryptEnvelopeNow(env, pass); });
  }
  function decryptEnvelopeNow(env, pass) {
    if (!env || env.format !== 'nova-rx-encrypted-backup' || env.version !== 1 || !env.salt || !env.iv || !env.data || typeof env.iter !== 'number' || !isFinite(env.iter) || env.iter < 10000 || env.iter > 1000000) {
      var err = new Error('الملف ده مش نسخة احتياطية صالحة');
      err.code = 'wrong-format';
      return Promise.reject(err);
    }
    if (typeof pass !== 'string' || !pass.length) {
      var pe = new Error('اكتب الباسورد الأول');
      pe.code = 'missing-passphrase';
      return Promise.reject(pe);
    }
    return deriveKey(pass, unb64(env.salt), env.iter)
      .then(function (k) {
        return cry().subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, k, unb64(env.data));
      })
      .then(
        function (pt) { return new TextDecoder().decode(pt); },
        function () { fail('bad-passphrase-or-tampered', 'الباسورد غلط أو الملف تالف'); }
      );
  }

  /* ---------- Helpers ---------- */
  function pad2(n) {
    return (n < 10 ? '0' : '') + String(n);
  }

  function formatFileStamp(d) {
    var dt = d || new Date();
    return String(dt.getFullYear()) + '-' +
      pad2(dt.getMonth() + 1) + '-' +
      pad2(dt.getDate()) + '-' +
      pad2(dt.getHours()) +
      pad2(dt.getMinutes());
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return String(d.getFullYear()) + '-' +
      pad2(d.getMonth() + 1) + '-' +
      pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + ':' +
      pad2(d.getMinutes());
  }

  function formatBytes(n) {
    if (typeof n !== 'number' || isNaN(n)) return '';
    if (n < 1024) return String(n) + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function shortUA() {
    var ua = (root.navigator && root.navigator.userAgent) ? String(root.navigator.userAgent) : 'unknown';
    return ua.length > 120 ? ua.slice(0, 120) : ua;
  }

  function isBackupKey(name) {
    if (typeof name !== 'string' || name.indexOf('nova') !== 0) return false;
    if (name === PENDING_JOURNAL_KEY) return false;
    var low = name.toLowerCase();
    if (low.indexOf('session') !== -1) return false;
    if (low.indexOf('holds') !== -1) return false;
    if (low.indexOf('active-invoice') !== -1) return false;
    return true;
  }

  function arrayLenFromRaw(raw) {
    if (typeof raw !== 'string' || !raw) return 0;
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch (e) {
      return 0;
    }
  }

  function computeCounts(keysObj) {
    return {
      sales: arrayLenFromRaw(keysObj['nova-rx-sales-v1']),
      receipts: arrayLenFromRaw(keysObj['nova-rx-receipts-v1']),
      customers: arrayLenFromRaw(keysObj['nova-rx-demo-customers-v1']),
      lots: arrayLenFromRaw(keysObj['nova-rx-lots-v1'])
    };
  }

  function checkPerm(action) {
    if (!root.novaPerms || typeof root.novaPerms.require !== 'function') return true;
    try {
      var res = root.novaPerms.require(action);
      return res !== false;
    } catch (e) {
      return false;
    }
  }

  function triggerDownload(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  /* ---------- Core API ---------- */
  function collect() {
    if (localStorage.getItem(PENDING_JOURNAL_KEY) !== null) {
      fail('pending-transaction', 'فيه عملية مخزون مش مكتملة — استنى ثواني وجرب تاني');
    }
    var keys = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (isBackupKey(k)) {
        keys[k] = localStorage.getItem(k);
      }
    }
    return {
      format: 'nova-rx-full-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      device: shortUA(),
      keys: keys,
      counts: computeCounts(keys)
    };
  }

  function create(passphrase, prefix) {
    var payload;
    try {
      payload = collect();
    } catch (e) {
      return Promise.reject(e);
    }
    var jsonText = JSON.stringify(payload);
    return encryptText(jsonText, passphrase, ITER).then(function (envelope) {
      var envText = JSON.stringify(envelope);
      var blob = new Blob([envText], { type: 'application/json' });
      var filePrefix = prefix || 'nova-rx-backup-';
      var fileName = filePrefix + formatFileStamp(new Date()) + '.novabak';
      return {
        blob: blob,
        fileName: fileName,
        envelope: envelope
      };
    });
  }

  function validatePayload(payload) {
    if (!payload || typeof payload !== 'object') {
      fail('invalid-payload', 'بيانات النسخة غير صالحة');
    }
    if (payload.format !== 'nova-rx-full-backup' || payload.version !== 1) {
      fail('invalid-format', 'صيغة النسخة غير مدعومة');
    }
    if (!payload.keys || typeof payload.keys !== 'object' || Array.isArray(payload.keys)) {
      fail('invalid-keys', 'مفاتيح النسخة غير صالحة');
    }
    var names = Object.keys(payload.keys);
    for (var i = 0; i < names.length; i++) {
      var k = names[i];
      if (k.indexOf('nova') !== 0 || typeof payload.keys[k] !== 'string') {
        fail('invalid-key-entry', 'فيه مفتاح غير صالح داخل النسخة');
      }
    }
    return {
      createdAt: payload.createdAt || '',
      device: payload.device || '',
      counts: payload.counts || computeCounts(payload.keys),
      keyCount: names.length
    };
  }

  function restore(fileText, passphrase, opts) {
    opts = opts || {};
    var env;
    try {
      env = typeof fileText === 'string' ? JSON.parse(fileText) : fileText;
    } catch (e) {
      var pe = new Error('الملف مش بصيغة JSON صالحة');
      pe.code = 'invalid-json';
      return Promise.reject(pe);
    }

    return decryptEnvelope(env, passphrase).then(function (plainText) {
      var payload;
      try {
        payload = JSON.parse(plainText);
      } catch (e) {
        fail('invalid-payload-json', 'محتوى النسخة تالف');
      }
      var summary = validatePayload(payload);
      if (opts.dryRun) {
        return summary;
      }
      if (!checkPerm('data.import')) fail('permission', 'محتاج صلاحية');

      if (localStorage.getItem(PENDING_JOURNAL_KEY) !== null) {
        fail('pending-transaction', 'فيه عملية مخزون مش مكتملة — استنى ثواني وجرب تاني');
      }

      /* Snapshot current backup-eligible keys in memory for rollback */
      var previous = {};
      var currentKeys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var ck = localStorage.key(i);
        if (isBackupKey(ck)) {
          currentKeys.push(ck);
          previous[ck] = localStorage.getItem(ck);
        }
      }

      try {
        for (var r = 0; r < currentKeys.length; r++) {
          localStorage.removeItem(currentKeys[r]);
        }
        var incoming = Object.keys(payload.keys);
        for (var w = 0; w < incoming.length; w++) {
          var ik = incoming[w];
          if (isBackupKey(ik)) {
            localStorage.setItem(ik, payload.keys[ik]);
          }
        }
        try {
          localStorage.setItem(LAST_RESTORE_KEY, JSON.stringify({
            at: new Date().toISOString(),
            from: payload.createdAt || ''
          }));
        } catch (metaErr) {}
      } catch (writeErr) {
        /* Rollback from memory */
        try {
          var toClear = [];
          for (var c = 0; c < localStorage.length; c++) {
            var lk = localStorage.key(c);
            if (isBackupKey(lk)) toClear.push(lk);
          }
          for (var d = 0; d < toClear.length; d++) {
            localStorage.removeItem(toClear[d]);
          }
          var prevNames = Object.keys(previous);
          for (var p = 0; p < prevNames.length; p++) {
            localStorage.setItem(prevNames[p], previous[prevNames[p]]);
          }
        } catch (rollbackErr) {
          /* Best-effort rollback */
        }
        fail('quota-or-write-failed', 'المساحة في المتصفح مش كافية لاسترجاع النسخة — تم إرجاع البيانات القديمة');
      }

      return summary;
    });
  }

  function lastBackup() {
    var raw = localStorage.getItem(LAST_BACKUP_KEY);
    if (!raw) return null;
    try {
      var obj = JSON.parse(raw);
      return obj && obj.at ? obj : null;
    } catch (e) {
      return null;
    }
  }

  function recordLastBackup(fileName, size) {
    try {
      localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify({
        at: new Date().toISOString(),
        size: size,
        file: fileName
      }));
    } catch (e) {
      /* Ignore storage error on metadata */
    }
  }

  /* ---------- Styles ---------- */
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      '.nfb-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.68);display:flex;align-items:center;justify-content:center;z-index:10050;direction:rtl;padding:16px;}' +
      '.nfb-dialog{background:#1b2027;color:#e6edf3;border:1px solid #343b44;border-radius:10px;width:100%;max-width:460px;padding:18px 20px;box-shadow:0 12px 32px rgba(0,0,0,0.5);font-family:inherit;}' +
      '.nfb-dialog h3{margin:0 0 10px 0;font-size:17px;color:#79c9eb;}' +
      '.nfb-note{background:#14181d;border:1px solid #343b44;border-radius:6px;padding:10px 12px;font-size:13px;line-height:1.6;margin:10px 0;color:#d0d7de;}' +
      '.nfb-warn{border-color:#d29922;color:#f2cc60;}' +
      '.nfb-danger-box{border-color:#f85149;color:#ffa198;}' +
      '.nfb-field{margin:10px 0;}' +
      '.nfb-field label{display:block;font-size:13px;margin-bottom:4px;color:#c9d1d9;}' +
      '.nfb-field input[type="password"],.nfb-field input[type="file"]{width:100%;box-sizing:border-box;background:#14181d;color:#e6edf3;border:1px solid #343b44;border-radius:6px;padding:8px 10px;font-size:14px;}' +
      '.nfb-field input:focus{outline:2px solid #79c9eb;outline-offset:1px;}' +
      '.nfb-error{color:#ff7b72;font-size:13px;margin:8px 0;min-height:18px;}' +
      '.nfb-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap;}' +
      '.nfb-summary{background:#14181d;border:1px solid #343b44;border-radius:6px;padding:10px 12px;font-size:13px;margin:10px 0;line-height:1.7;}' +
      '.nfb-card-meta{font-size:13px;color:#9da7b3;margin:6px 0 10px 0;line-height:1.6;}' +
      '.nfb-card-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}' +
      '.nfb-banner{position:fixed;bottom:calc(16px + var(--nova-bbar-h, 0px));left:16px;right:auto;max-width:min(340px, calc(100vw - 32px));z-index:9900;background:#1b2027;color:#e6edf3;border:1px solid #343b44;border-right:3px solid #79c9eb;border-radius:8px;padding:12px 14px;box-shadow:0 8px 24px rgba(0,0,0,0.45);direction:rtl;font-size:13px;}' +
      '.nfb-banner-actions{display:flex;gap:8px;margin-top:8px;}';
    document.head.appendChild(st);
  }

  /* ---------- Accessible In-Page Dialog ---------- */
  function openDialog(opts) {
    injectStyles();
    var prevFocus = document.activeElement;
    var backdrop = document.createElement('div');
    backdrop.className = 'nfb-backdrop';

    var dlg = document.createElement('div');
    dlg.className = 'nfb-dialog';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    if (opts.titleId) dlg.setAttribute('aria-labelledby', opts.titleId);

    backdrop.appendChild(dlg);
    document.body.appendChild(backdrop);

    function getFocusables() {
      var list = dlg.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
      var out = [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].offsetParent !== null) out.push(list[i]);
      }
      return out;
    }

    function close() {
      if (opts.canClose && !opts.canClose()) return;
      document.removeEventListener('keydown', onKeyDown, true);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      if (prevFocus && typeof prevFocus.focus === 'function') {
        try { prevFocus.focus(); } catch (e) {}
      }
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === 'Tab') {
        var f = getFocusables();
        if (!f.length) return;
        var first = f[0];
        var last = f[f.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || !dlg.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !dlg.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) close();
    });

    opts.render(dlg, close);

    var focusables = getFocusables();
    if (focusables.length) focusables[0].focus();
    return { close: close, el: dlg };
  }

  function showMessageDialog(title, message) {
    openDialog({
      titleId: 'nfbMsgTitle',
      render: function (dlg, close) {
        var h = document.createElement('h3');
        h.id = 'nfbMsgTitle';
        h.textContent = title;
        dlg.appendChild(h);

        var p = document.createElement('div');
        p.className = 'nfb-note';
        p.textContent = message;
        dlg.appendChild(p);

        var actions = document.createElement('div');
        actions.className = 'nfb-actions';
        var okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = 'btn btn-primary';
        okBtn.textContent = 'تمام';
        okBtn.addEventListener('click', close);
        actions.appendChild(okBtn);
        dlg.appendChild(actions);
      }
    });
  }

  /* ---------- Create Backup Dialog ---------- */
  function openCreateDialog() {
    if (!checkPerm('data.export')) {
      showMessageDialog('النسخ الاحتياطي الكامل', 'محتاج صلاحية');
      return;
    }

    openDialog({
      titleId: 'nfbCreateTitle',
      render: function (dlg, close) {
        var h = document.createElement('h3');
        h.id = 'nfbCreateTitle';
        h.textContent = 'عمل نسخة احتياطية كاملة مشفرة';
        dlg.appendChild(h);

        var warn = document.createElement('div');
        warn.className = 'nfb-note nfb-warn';
        warn.textContent = 'الباسورد ده مش محفوظ في أي مكان — لو نسيته النسخة مش هتتفتح. اكتبه في مكان أمين.';
        dlg.appendChild(warn);

        var f1 = document.createElement('div');
        f1.className = 'nfb-field';
        var l1 = document.createElement('label');
        l1.setAttribute('for', 'nfbPass1');
        l1.textContent = 'الباسورد (8 حروف على الأقل)';
        var i1 = document.createElement('input');
        i1.id = 'nfbPass1';
        i1.type = 'password';
        i1.autocomplete = 'new-password';
        f1.appendChild(l1);
        f1.appendChild(i1);
        dlg.appendChild(f1);

        var f2 = document.createElement('div');
        f2.className = 'nfb-field';
        var l2 = document.createElement('label');
        l2.setAttribute('for', 'nfbPass2');
        l2.textContent = 'تأكيد الباسورد';
        var i2 = document.createElement('input');
        i2.id = 'nfbPass2';
        i2.type = 'password';
        i2.autocomplete = 'new-password';
        f2.appendChild(l2);
        f2.appendChild(i2);
        dlg.appendChild(f2);

        var errEl = document.createElement('div');
        errEl.className = 'nfb-error';
        errEl.setAttribute('role', 'alert');
        dlg.appendChild(errEl);

        var actions = document.createElement('div');
        actions.className = 'nfb-actions';

        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn-secondary';
        cancelBtn.textContent = 'إلغاء';
        cancelBtn.addEventListener('click', close);

        var goBtn = document.createElement('button');
        goBtn.type = 'button';
        goBtn.className = 'btn btn-primary';
        goBtn.textContent = 'تشفير وتنزيل النسخة';

        goBtn.addEventListener('click', function () {
          errEl.textContent = '';
          var p1 = i1.value;
          var p2 = i2.value;
          if (!p1 || p1.length < 8) {
            errEl.textContent = 'الباسورد لازم يكون 8 حروف أو أكتر';
            i1.focus();
            return;
          }
          if (p1 !== p2) {
            errEl.textContent = 'الباسورد وتأكيده مش متطابقين';
            i2.focus();
            return;
          }
          goBtn.disabled = true;
          goBtn.textContent = 'جاري التشفير...';
          create(p1).then(function (res) {
            triggerDownload(res.blob, res.fileName);
            recordLastBackup(res.fileName, res.blob.size);
            refreshCardMeta();
            removeBanner();
            close();
          }, function (err) {
            goBtn.disabled = false;
            goBtn.textContent = 'تشفير وتنزيل النسخة';
            errEl.textContent = (err && err.message) ? err.message : 'حصل خطأ أثناء عمل النسخة';
          });
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(goBtn);
        dlg.appendChild(actions);
      }
    });
  }

  /* ---------- Restore Backup Dialog ---------- */
  function openRestoreDialog() {
    if (!checkPerm('data.import')) {
      showMessageDialog('استرجاع نسخة احتياطية', 'محتاج صلاحية');
      return;
    }

    var inFlight = false;
    openDialog({
      titleId: 'nfbRestoreTitle',
      canClose: function () { return !inFlight; },
      render: function (dlg, close) {
        var h = document.createElement('h3');
        h.id = 'nfbRestoreTitle';
        h.textContent = 'استرجاع من نسخة احتياطية';
        dlg.appendChild(h);

        var step1 = document.createElement('div');
        var fFile = document.createElement('div');
        fFile.className = 'nfb-field';
        var lFile = document.createElement('label');
        lFile.setAttribute('for', 'nfbRestoreFile');
        lFile.textContent = 'اختار ملف النسخة (.novabak)';
        var iFile = document.createElement('input');
        iFile.id = 'nfbRestoreFile';
        iFile.type = 'file';
        iFile.accept = '.novabak,application/json';
        fFile.appendChild(lFile);
        fFile.appendChild(iFile);
        step1.appendChild(fFile);

        var fPass = document.createElement('div');
        fPass.className = 'nfb-field';
        var lPass = document.createElement('label');
        lPass.setAttribute('for', 'nfbRestorePass');
        lPass.textContent = 'باسورد النسخة';
        var iPass = document.createElement('input');
        iPass.id = 'nfbRestorePass';
        iPass.type = 'password';
        iPass.autocomplete = 'current-password';
        fPass.appendChild(lPass);
        fPass.appendChild(iPass);
        step1.appendChild(fPass);

        var errEl = document.createElement('div');
        errEl.className = 'nfb-error';
        errEl.setAttribute('role', 'alert');

        var confirmBox = document.createElement('div');
        confirmBox.style.display = 'none';

        var summaryEl = document.createElement('div');
        summaryEl.className = 'nfb-summary';
        confirmBox.appendChild(summaryEl);

        var dangerNote = document.createElement('div');
        dangerNote.className = 'nfb-note nfb-danger-box';
        dangerNote.textContent = 'هيتم استبدال كل بيانات البرنامج على الجهاز ده ببيانات النسخة. متأكد؟';
        confirmBox.appendChild(dangerNote);

        var actions = document.createElement('div');
        actions.className = 'nfb-actions';

        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn-secondary';
        cancelBtn.textContent = 'إلغاء';
        cancelBtn.addEventListener('click', close);

        var verifyBtn = document.createElement('button');
        verifyBtn.type = 'button';
        verifyBtn.className = 'btn btn-primary';
        verifyBtn.textContent = 'فحص النسخة';

        var applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'btn btn-danger';
        applyBtn.textContent = 'استبدال البيانات الآن';
        applyBtn.style.display = 'none';
        applyBtn.disabled = true;

        var safetyBtn = document.createElement('button');
        safetyBtn.type = 'button';
        safetyBtn.className = 'btn btn-primary';
        safetyBtn.textContent = 'جاري تجهيز نسخة الأمان...';
        safetyBtn.style.display = 'none';
        safetyBtn.disabled = true;
        var safetyReady = null;

        var verifiedFileText = null;
        var verifiedPass = null;

        verifyBtn.addEventListener('click', function () {
          errEl.textContent = '';
          var file = iFile.files && iFile.files[0];
          var pass = iPass.value;
          if (!file) {
            errEl.textContent = 'اختار ملف النسخة الأول';
            return;
          }
          if (!pass) {
            errEl.textContent = 'اكتب الباسورد الأول';
            iPass.focus();
            return;
          }
          verifyBtn.disabled = true;
          verifyBtn.textContent = 'جاري الفحص...';

          var reader = new FileReader();
          reader.onload = function () {
            var text = String(reader.result || '');
            restore(text, pass, { dryRun: true }).then(function (summary) {
              verifiedFileText = text;
              verifiedPass = pass;
              summaryEl.textContent =
                'تاريخ النسخة: ' + formatDateTime(summary.createdAt) +
                ' | المبيعات: ' + String(summary.counts.sales || 0) +
                ' | الإيصالات: ' + String(summary.counts.receipts || 0) +
                ' | العملاء: ' + String(summary.counts.customers || 0) +
                ' | التشغيلات: ' + String(summary.counts.lots || 0);
              step1.style.display = 'none';
              confirmBox.style.display = 'block';
              verifyBtn.style.display = 'none';
              applyBtn.style.display = 'inline-block';
              safetyBtn.style.display = 'inline-block';
              // step 1: an encrypted copy of what is on this device now, saved by its own click before anything is replaced
              create(pass, 'nova-rx-before-restore-').then(function (safety) {
                safetyReady = safety;
                safetyBtn.disabled = false;
                safetyBtn.textContent = '1) نزّل نسخة أمان من بياناتك الحالية';
                safetyBtn.focus();
              }, function (err) {
                errEl.textContent = 'مش قادر أعمل نسخة أمان: ' + ((err && err.message) || '') + ' — الاسترجاع متوقف.';
              });
            }, function (err) {
              verifyBtn.disabled = false;
              verifyBtn.textContent = 'فحص النسخة';
              errEl.textContent = (err && err.message) ? err.message : 'فشل فتح النسخة';
            });
          };
          reader.onerror = function () {
            verifyBtn.disabled = false;
            verifyBtn.textContent = 'فحص النسخة';
            errEl.textContent = 'مش قادر أقرأ الملف';
          };
          reader.readAsText(file);
        });

        safetyBtn.addEventListener('click', function () {
          if (!safetyReady) return;
          triggerDownload(safetyReady.blob, safetyReady.fileName);
          safetyBtn.textContent = '✓ اتنزلت نسخة الأمان';
          safetyBtn.disabled = true;
          applyBtn.disabled = false;
          applyBtn.textContent = '2) استبدال البيانات الآن';
          applyBtn.focus();
        });

        applyBtn.addEventListener('click', function () {
          if (applyBtn.disabled) return;
          errEl.textContent = '';
          applyBtn.disabled = true;
          inFlight = true;
          cancelBtn.disabled = true;
          applyBtn.textContent = 'جاري الاسترجاع...';
          restore(verifiedFileText, verifiedPass, { dryRun: false }).then(function () {
            errEl.textContent = '';
            applyBtn.textContent = 'اتسترجعت — بيتعمل تحديث للبرنامج...';
            // give the safety download time to finish before the page reloads
            setTimeout(function () { root.location.reload(); }, 2000);
          }, function (err) {
            inFlight = false;
            cancelBtn.disabled = false;
            applyBtn.disabled = false;
            applyBtn.textContent = 'استبدال البيانات الآن';
            errEl.textContent = (err && err.message) ? err.message : 'فشل استرجاع النسخة';
          });
        });

        dlg.appendChild(step1);
        dlg.appendChild(confirmBox);
        dlg.appendChild(errEl);
        actions.appendChild(cancelBtn);
        actions.appendChild(verifyBtn);
        actions.appendChild(safetyBtn);
        actions.appendChild(applyBtn);
        dlg.appendChild(actions);
      }
    });
  }

  /* ---------- Settings Card ---------- */
  function formatLastBackupLine() {
    var lb = lastBackup();
    if (!lb) return 'آخر نسخة: لسه ما اتعملتش نسخة';
    var extra = lb.size ? ' (' + formatBytes(lb.size) + ')' : '';
    return 'آخر نسخة: ' + formatDateTime(lb.at) + extra;
  }

  function refreshCardMeta() {
    var el = document.getElementById('nfbCardLastLine');
    if (el) el.textContent = formatLastBackupLine();
  }

  function ensureSettingsCard() {
    var page = document.getElementById('novaPageView');
    if (!page) return;
    var grid = page.querySelector('.nova-settings-grid');
    if (!grid) return;
    if (document.getElementById(CARD_ID)) {
      refreshCardMeta();
      return;
    }
    injectStyles();

    var card = document.createElement('div');
    card.className = 'nova-setting-card';
    card.id = CARD_ID;

    var h = document.createElement('h3');
    h.textContent = 'النسخ الاحتياطي الكامل';
    card.appendChild(h);

    var meta = document.createElement('div');
    meta.id = 'nfbCardLastLine';
    meta.className = 'nfb-card-meta';
    meta.textContent = formatLastBackupLine();
    card.appendChild(meta);

    var howto = document.createElement('div');
    howto.className = 'nfb-card-meta';
    howto.textContent = 'احفظ الملف على فلاشة أو ارفعه على جوجل درايف';
    card.appendChild(howto);

    var btns = document.createElement('div');
    btns.className = 'nfb-card-actions';

    var createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'btn btn-primary';
    createBtn.textContent = 'اعمل نسخة دلوقتي';
    createBtn.addEventListener('click', openCreateDialog);

    var restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'btn btn-secondary';
    restoreBtn.textContent = 'استرجاع من نسخة';
    restoreBtn.addEventListener('click', openRestoreDialog);

    btns.appendChild(createBtn);
    btns.appendChild(restoreBtn);
    card.appendChild(btns);

    grid.appendChild(card);
  }

  function attachSettingsObserver() {
    var page = document.getElementById('novaPageView');
    if (!page || page.__nfbObserved) return;
    page.__nfbObserved = true;
    ensureSettingsCard();
    var obs = new MutationObserver(function () {
      ensureSettingsCard();
    });
    obs.observe(page, { childList: true });
  }

  /* ---------- Daily Reminder Banner ---------- */
  function removeBanner() {
    var b = document.getElementById(BANNER_ID);
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }

  function hasAnyData() {
    var s = arrayLenFromRaw(localStorage.getItem('nova-rx-sales-v1'));
    var r = arrayLenFromRaw(localStorage.getItem('nova-rx-receipts-v1'));
    return (s + r) > 0;
  }

  function maybeShowReminder() {
    if (reminderShown) return;
    if (!hasAnyData()) return;

    var snoozeUntil = Number(localStorage.getItem(SNOOZE_KEY) || 0);
    if (snoozeUntil && Date.now() < snoozeUntil) return;

    var lb = lastBackup();
    var now = Date.now();
    var ageMs = lb ? (now - new Date(lb.at).getTime()) : Infinity;
    if (ageMs < DAY_MS) return;

    /* Never show on top of an open dialog */
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

    reminderShown = true;
    injectStyles();

    var banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.className = 'nfb-banner';
    banner.setAttribute('role', 'status');

    var text = document.createElement('div');
    if (!lb || !isFinite(ageMs)) {
      text.textContent = 'لسه ما اتعملتش نسخة احتياطية';
    } else {
      var days = Math.max(1, Math.floor(ageMs / DAY_MS));
      text.textContent = 'آخر نسخة احتياطية: من ' + String(days) + ' يوم';
    }
    banner.appendChild(text);

    var acts = document.createElement('div');
    acts.className = 'nfb-banner-actions';

    var nowBtn = document.createElement('button');
    nowBtn.type = 'button';
    nowBtn.className = 'btn btn-primary';
    nowBtn.textContent = 'اعمل نسخة';
    nowBtn.addEventListener('click', function () {
      removeBanner();
      openCreateDialog();
    });

    var laterBtn = document.createElement('button');
    laterBtn.type = 'button';
    laterBtn.className = 'btn btn-secondary';
    laterBtn.textContent = 'بعدين';
    laterBtn.addEventListener('click', function () {
      try {
        localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
      } catch (e) {}
      removeBanner();
    });

    acts.appendChild(nowBtn);
    acts.appendChild(laterBtn);
    banner.appendChild(acts);
    document.body.appendChild(banner);
  }

  /* ---------- Init ---------- */
  function init() {
    attachSettingsObserver();
    setTimeout(maybeShowReminder, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  root.novaFullBackup = {
    collect: collect,
    create: create,
    restore: restore,
    lastBackup: lastBackup
  };
})(typeof window !== 'undefined' ? window : globalThis);