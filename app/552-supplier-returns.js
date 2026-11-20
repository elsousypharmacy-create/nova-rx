/* NOVA Rx — Supplier Returns («مرتجع للمورد»).
   On-device only: deducts lots from nova-rx-lots-v1, appends negative adjustment to nova.stock.ledger,
   records return in nova-rx-supplier-returns-v1, and posts supplier credit in nova.supplierAccounts if matched. */
(function () {
  'use strict';

  var RET_KEY = 'nova-rx-supplier-returns-v1';
  var LOTS_KEY = 'nova-rx-lots-v1';
  var RECEIPTS_KEY = 'nova-rx-receipts-v1';
  var TX_KEY = 'nova.receipt-transaction-v1';
  var LEDGER_KEY = 'nova.stock.ledger';
  var ACCT_KEY = 'nova.supplierAccounts';
  var REASONS = [
    'منتهي الصلاحية',
    'قرب ينتهي',
    'تالف أو مكسور',
    'زيادة عن الطلب',
    'صنف غلط'
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function norm(s) {
    return String(s == null ? '' : s).trim();
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function money(n) {
    return round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م';
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function fmtExpiry(exp) {
    var m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(exp || ''));
    return m ? (m[2] + '/' + m[1].slice(2)) : String(exp || '');
  }

  function makeId() {
    return 'SRET-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  function readArray(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return [];
      var a = JSON.parse(raw);
      return Array.isArray(a) ? a : [];
    } catch (_) {
      return [];
    }
  }

  function listReturns() {
    return readArray(RET_KEY).filter(function (r) { return r && r.id && Array.isArray(r.lines); });
  }

  function currentUserInfo() {
    try {
      var a = window.novaAuth;
      if (a && typeof a.current === 'function') {
        var u = a.current();
        if (u) return { id: u.id || null, name: u.name || null };
      }
    } catch (_) {}
    return null;
  }

  function collectSupplierNames() {
    var seen = {};
    var out = [];
    function add(name) {
      var n = norm(name);
      if (!n) return;
      var k = n.toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      out.push(n);
    }
    try {
      if (window.__novaSupplierProvider && typeof window.__novaSupplierProvider.suppliers === 'function') {
        window.__novaSupplierProvider.suppliers().forEach(function (s) { if (s) add(s.name); });
      }
    } catch (_) {}
    readArray(RECEIPTS_KEY).forEach(function (r) { if (r && r.supplier) add(r.supplier); });
    return out;
  }

  function findProviderSupplier(name) {
    var target = norm(name).toLowerCase();
    if (!target || !window.__novaSupplierProvider || typeof window.__novaSupplierProvider.suppliers !== 'function') return null;
    var list = window.__novaSupplierProvider.suppliers();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && norm(list[i].name).toLowerCase() === target) return list[i];
    }
    return null;
  }

  function supplierExistsInAccounts(supplierId) {
    try {
      var raw = localStorage.getItem(ACCT_KEY);
      if (!raw) return false;
      var s = JSON.parse(raw);
      return !!(s && s.suppliers && s.suppliers[String(supplierId)]);
    } catch (_) {
      return false;
    }
  }

  function withStockLock(fn) {
    if (window.novaStock && typeof window.novaStock.withLock === 'function') {
      return window.novaStock.withLock(fn);
    }
    return Promise.resolve().then(fn);
  }

  function readRawLotRecords() {
    var raw = window.NovaReceiptOperations && typeof window.NovaReceiptOperations.readRaw === 'function'
      ? window.NovaReceiptOperations.readRaw(localStorage, LOTS_KEY)
      : localStorage.getItem(LOTS_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('مخزن التشغيلات غير صالح.');
    return parsed;
  }

  function saveReturn(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('بيانات المرتجع غير صالحة.');
    var supplier = norm(payload.supplier);
    if (!supplier) throw new Error('اختار المورد الأول.');
    var reason = norm(payload.reason);
    if (!reason) throw new Error('اختار سبب المرتجع.');
    var note = norm(payload.note).slice(0, 200);
    var rawLines = Array.isArray(payload.lines) ? payload.lines : [];
    if (!rawLines.length) throw new Error('أضف صنف واحد على الأقل للمرتجع.');

    var returnId = norm(payload.id) || makeId();
    var lines = [];
    var seenLine = {};
    for (var i = 0; i < rawLines.length; i++) {
      var ln = rawLines[i];
      var key = norm(ln && ln.key);
      var code = norm(ln && ln.code) || key;
      var name = norm(ln && ln.name) || key;
      var lot = norm(ln && ln.lot);
      var expiry = norm(ln && ln.expiry);
      var qty = Number(ln && ln.qty);
      var cost = Number(ln && ln.cost) || 0;
      if (!key || !lot || !expiry) throw new Error('بيانات التشغيلة غير مكتملة.');
      if (!Number.isInteger(qty) || qty <= 0) throw new Error('الكمية لازم تكون رقم صحيح أكبر من صفر.');
      var lk = key + '\u0000' + lot + '\u0000' + expiry;
      if (seenLine[lk]) throw new Error('نفس التشغيلة مكررة في المرتجع: ' + name + ' (' + lot + ')');
      seenLine[lk] = true;
      lines.push({ key: key, code: code, name: name, lot: lot, expiry: expiry, qty: qty, cost: cost });
    }

    if (window.novaPerms && typeof window.novaPerms.require === 'function' && !window.novaPerms.require('stock.adjust')) throw new Error('محتاج صلاحية تعديل المخزون لتسجيل مرتجع.');
  var total = round2(lines.reduce(function (s, l) { return s + l.qty * l.cost; }, 0));
    var record = null;

    return withStockLock(function () {
      if (localStorage.getItem(TX_KEY)) {
        throw new Error('في عملية استلام معلّقة محتاجة استكمال الأول. خلّص الاستلام وبعدين سجّل المرتجع.');
      }

      // Idempotency: already saved
      var existingList = listReturns();
      for (var e = 0; e < existingList.length; e++) {
        if (existingList[e].id === returnId) {
          record = existingList[e];
          return;
        }
      }

      // Review fix: lots and ledger are prepared in memory, then committed together through the receipt
      // transaction journal (NovaReceiptOperations.recover replays it under the lock after a crash).
      var allRecords = readRawLotRecords();
      var marker = null;
      var lotRows = [];
      for (var r = 0; r < allRecords.length; r++) {
        var rec = allRecords[r];
        if (rec && Array.isArray(rec.receiptRefs)) marker = rec;
        else lotRows.push(rec);
      }
      var refs = marker ? marker.receiptRefs.slice() : [];
      var alreadyDeducted = refs.indexOf(returnId) >= 0;
      var ledgerRaw = window.NovaReceiptOperations ? window.NovaReceiptOperations.readRaw(localStorage, LEDGER_KEY) : localStorage.getItem(LEDGER_KEY);
      var movements = JSON.parse(ledgerRaw || '[]');
      if (!Array.isArray(movements)) throw new Error('سجل حركة المخزون فيه مشكلة.');

      if (alreadyDeducted) {
        // an earlier attempt committed the stock part; the lines must not have changed since
        for (var c = 0; c < lines.length; c++) {
          var prior = movements.filter(function (m) { return m.kind === 'adjustment' && m.ref === returnId + '/' + c; })[0];
          if (!prior || prior.qty !== -lines[c].qty || prior.code !== lines[c].code) throw new Error('المرتجع ده اتخصم قبل كده بكميات مختلفة — افتح المرتجع من جديد.');
        }
      } else {
        // Re-read lots and verify onHand >= qty for every line
        for (var v = 0; v < lines.length; v++) {
          var line = lines[v];
          var currentLots = window.novaStock.lots(line.key);
          var match = null;
          for (var j = 0; j < currentLots.length; j++) {
            if (currentLots[j].lot === line.lot && currentLots[j].expiry === line.expiry) { match = currentLots[j]; break; }
          }
          var avail = match ? Number(match.onHand) || 0 : 0;
          if (avail < line.qty) {
            throw new Error('الرصيد المتاح مش كفاية للصنف ' + line.name + ' (تشغيلة ' + line.lot + ': متاح ' + avail + ').');
          }
        }
        for (var d = 0; d < lines.length; d++) {
          var dl = lines[d];
          var rem = dl.qty;
          for (var k = 0; k < lotRows.length && rem > 0; k++) {
            var row = lotRows[k];
            if (row && row.key === dl.key && row.lot === dl.lot && row.expiry === dl.expiry && row.qty > 0) {
              var take = Math.min(row.qty, rem);
              row.qty -= take;
              rem -= take;
            }
          }
          if (rem > 0) throw new Error('تعذر خصم الكمية بالكامل من التشغيلة ' + dl.lot);
        }
        lotRows = lotRows.filter(function (row) { return row && row.qty > 0; });
        refs.push(returnId);
        lotRows.push({ receiptRefs: refs });
        var at = new Date().toISOString();
        lines.forEach(function (l, i) {
          movements.push({ seq: movements.length + 1, at: at, kind: 'adjustment', code: l.code, qty: -l.qty, delta: -l.qty, ref: returnId + '/' + i });
        });
        var writes = {};
        writes[LOTS_KEY] = JSON.stringify(lotRows);
        writes[LEDGER_KEY] = JSON.stringify(movements);
        localStorage.setItem(TX_KEY, JSON.stringify({ writes: writes }));
        if (window.NovaReceiptOperations) window.NovaReceiptOperations.recover(localStorage);
        else { localStorage.setItem(LOTS_KEY, writes[LOTS_KEY]); localStorage.setItem(LEDGER_KEY, writes[LEDGER_KEY]); localStorage.removeItem(TX_KEY); }
      }

      // Last: save the return record
      var recOut = {
        id: returnId,
        at: new Date().toISOString(),
        supplier: supplier,
        by: currentUserInfo(),
        reason: reason,
        note: note,
        lines: lines,
        total: total
      };
      existingList.push(recOut);
      localStorage.setItem(RET_KEY, JSON.stringify(existingList));
      record = recOut;
    }).then(function () { return afterLock(record); });
  }

  // novaStock.withLock is async (navigator.locks): the supplier credit runs after the stock writes commit
  function afterLock(record) {
    var creditStatus = 'skipped-zero';
    var creditMessage = '';
    if (record.total > 0) {
      var supMatch = findProviderSupplier(record.supplier);
      if (supMatch && window.NovaSupplierAccounts && typeof window.NovaSupplierAccounts.createSupplierAccounts === 'function') {
        var sid = String(supMatch.id);
        try {
          var acct = window.NovaSupplierAccounts.createSupplierAccounts(localStorage, ACCT_KEY, {});
          if (!supplierExistsInAccounts(sid)) {
            acct.setSupplier(sid, { name: supMatch.name });
          }
          acct.credit({
            id: record.id,
            supplierId: sid,
            amount: record.total,
            ref: record.id,
            reason: record.reason
          });
          creditStatus = 'credited';
          creditMessage = 'تم تسجيل المرتجع وخصم ' + money(record.total) + ' من حساب المورد.';
        } catch (_) {
          creditStatus = 'credit-failed';
          creditMessage = 'المرتجع اتسجل واتخصم من المخزون، بس الخصم من حساب المورد فشل — راجع حساب المورد.';
        }
      } else {
        creditStatus = 'unmatched-supplier';
        creditMessage = 'المرتجع اتسجل، والمورد مش في حسابات الموردين فمفيش خصم على حسابه';
      }
    } else {
      creditMessage = 'تم تسجيل المرتجع بنجاح.';
    }

    renderReturnsList();
    return { record: record, creditStatus: creditStatus, message: creditMessage };
  }

  /* ---- Styles ---- */
  function ensureStyles() {
    if (document.getElementById('nova-sret-styles')) return;
    var st = document.createElement('style');
    st.id = 'nova-sret-styles';
    st.textContent = ''
      + '.sret-list-sec{margin:14px 0 18px;padding:12px 14px;background:#1b2027;border:1px solid #343b44;border-radius:10px;}'
      + '.sret-list-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}'
      + '.sret-list-head h2{margin:0;font-size:15px;color:#e6edf3;}'
      + '.sret-table{width:100%;border-collapse:collapse;font-size:13px;color:#d0d7de;}'
      + '.sret-table th,.sret-table td{padding:7px 8px;border-bottom:1px solid #343b44;text-align:right;}'
      + '.sret-table th{color:#8b949e;font-weight:600;}'
      + '.sret-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.68);z-index:9990;display:flex;align-items:center;justify-content:center;padding:16px;}'
      + '.sret-dialog{background:#1b2027;color:#e6edf3;border:1px solid #343b44;border-radius:12px;width:100%;max-width:760px;max-height:90vh;overflow:auto;padding:18px;box-sizing:border-box;direction:rtl;}'
      + '.sret-dialog h3{margin:0 0 12px;font-size:17px;color:#79c9eb;}'
      + '.sret-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;}'
      + '.sret-field{display:flex;flex-direction:column;gap:4px;font-size:13px;}'
      + '.sret-field input,.sret-field select{background:#14181d;color:#e6edf3;border:1px solid #343b44;border-radius:6px;padding:8px 10px;font-size:13px;}'
      + '.sret-search-res{background:#14181d;border:1px solid #343b44;border-radius:6px;margin-top:4px;max-height:160px;overflow:auto;}'
      + '.sret-search-item{padding:7px 10px;cursor:pointer;border:0;border-bottom:1px solid #262c34;display:flex;justify-content:space-between;font-size:13px;width:100%;background:none;color:inherit;font:inherit;text-align:right;}'
      + '.sret-search-item:hover,.sret-search-item:focus-visible{background:#242b35;outline:none;}'
      + '.sret-lots-box{background:#14181d;border:1px solid #343b44;border-radius:8px;padding:10px;margin:10px 0;}'
      + '.sret-lot-row{display:flex;align-items:center;gap:8px;justify-content:space-between;padding:6px 0;border-bottom:1px solid #262c34;font-size:13px;flex-wrap:wrap;}'
      + '.sret-lot-row:last-child{border-bottom:none;}'
      + '.sret-badge-exp{background:#5a1e24;color:#ff9b9b;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700;}'
      + '.sret-lines{margin:12px 0;background:#14181d;border:1px solid #343b44;border-radius:8px;padding:10px;}'
      + '.sret-msg{padding:8px 10px;border-radius:6px;margin:10px 0;font-size:13px;}'
      + '.sret-msg.err{background:#3a1a1f;border:1px solid #8a3038;color:#ffb4b4;}'
      + '.sret-msg.ok{background:#163126;border:1px solid #2b6f50;color:#9be7c4;}'
      + '.sret-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px;flex-wrap:wrap;}'
      + '.sret-print-host{display:none;}'
      + '@media print{body.sret-printing > *:not(.sret-print-host){display:none !important;}body.sret-printing .sret-print-host{display:block !important;direction:rtl;color:#000;background:#fff;padding:16px;font-family:sans-serif;}}';
    document.head.appendChild(st);
  }

  /* ---- Print Slip ---- */
  function printSlip(rec) {
    if (!rec) return;
    var host = document.getElementById('nova-sret-print-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'nova-sret-print-host';
      host.className = 'sret-print-host';
      document.body.appendChild(host);
    }
    var rows = rec.lines.map(function (l) {
      return '<tr><td>' + esc(l.name) + '</td><td>' + esc(l.lot) + '</td><td>' + esc(fmtExpiry(l.expiry)) + '</td><td>' + l.qty + '</td><td>' + money(l.cost) + '</td><td>' + money(l.qty * l.cost) + '</td></tr>';
    }).join('');
    host.innerHTML = '<h2>إذن مرتجع للمورد</h2>'
      + '<p><strong>رقم الإذن:</strong> ' + esc(rec.id) + ' &nbsp;|&nbsp; <strong>التاريخ:</strong> ' + esc(fmtDate(rec.at)) + '</p>'
      + '<p><strong>المورد:</strong> ' + esc(rec.supplier) + ' &nbsp;|&nbsp; <strong>السبب:</strong> ' + esc(rec.reason) + '</p>'
      + (rec.note ? '<p><strong>ملاحظة:</strong> ' + esc(rec.note) + '</p>' : '')
      + '<table border="1" cellspacing="0" cellpadding="6" style="width:100%;border-collapse:collapse;margin-top:10px;">'
      + '<thead><tr><th>الصنف</th><th>التشغيلة</th><th>الصلاحية</th><th>الكمية</th><th>التكلفة</th><th>الإجمالي</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table>'
      + '<p style="margin-top:12px;font-size:16px;"><strong>إجمالي المرتجع: ' + money(rec.total) + '</strong></p>';
    document.body.classList.add('sret-printing');
  var done = function () { document.body.classList.remove('sret-printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  try { window.print(); } finally { setTimeout(done, 60000); }
}

  /* ---- Returns List UI ---- */
  function renderReturnsList() {
    var rcv = document.querySelector('#novaPageView .rcv');
    if (!rcv) return;
    var sec = rcv.querySelector('.sret-list-sec');
    var items = listReturns().slice().reverse().slice(0, 20);
    if (!sec) {
      sec = document.createElement('section');
      sec.className = 'sret-list-sec';
      var head = rcv.querySelector('.rcv-head');
      if (head && head.parentNode) {
        head.parentNode.insertBefore(sec, head.nextSibling);
      } else {
        rcv.insertBefore(sec, rcv.firstChild);
      }
    }
    var html = '<div class="sret-list-head"><h2>مرتجعات للموردين</h2><span class="rcv-count">' + items.length + '</span></div>';
    if (!items.length) {
      html += '<p class="rcv-empty-line" style="margin:0;">مفيش مرتجعات مسجلة لسه.</p>';
    } else {
      html += '<table class="sret-table"><thead><tr><th>التاريخ</th><th>المورد</th><th>الأصناف</th><th>القيمة</th><th>السبب</th><th></th></tr></thead><tbody>';
      for (var i = 0; i < items.length; i++) {
        var r = items[i];
        html += '<tr>'
          + '<td>' + esc(fmtDate(r.at)) + '</td>'
          + '<td>' + esc(r.supplier) + '</td>'
          + '<td>' + r.lines.length + '</td>'
          + '<td>' + money(r.total) + '</td>'
          + '<td>' + esc(r.reason) + '</td>'
          + '<td><button type="button" class="btn btn-secondary" data-sret-print="' + esc(r.id) + '" style="padding:3px 8px;font-size:12px;">طباعة</button></td>'
          + '</tr>';
      }
      html += '</tbody></table>';
    }
    sec.innerHTML = html;
    var btns = sec.querySelectorAll('[data-sret-print]');
    for (var b = 0; b < btns.length; b++) {
      btns[b].addEventListener('click', function (ev) {
        var id = ev.currentTarget.getAttribute('data-sret-print');
        var found = listReturns().filter(function (x) { return x.id === id; })[0];
        if (found) printSlip(found);
      });
    }
  }

  /* ---- Dialog ---- */
  var closeActive = null;
  function openReturnDialog() {
    ensureStyles();
    if (closeActive) closeActive();   // review fix: never leave an old dialog's key listener behind

    var prevFocus = document.activeElement;
    var suppliers = collectSupplierNames();
    var lines = [];
    var saving = false;
  var lastSaved = null;
  var attemptId = makeId();

    var backdrop = document.createElement('div');
    backdrop.id = 'nova-sret-backdrop';
    backdrop.className = 'sret-backdrop';

    var supOptions = '<option value="">-- اختار المورد --</option>' + suppliers.map(function (s) {
      return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
    }).join('');
    var reasonOptions = REASONS.map(function (r) {
      return '<option value="' + esc(r) + '">' + esc(r) + '</option>';
    }).join('');

    backdrop.innerHTML = '<div class="sret-dialog" role="dialog" aria-modal="true" aria-labelledby="sret-title">'
      + '<h3 id="sret-title">مرتجع للمورد</h3>'
      + '<div class="sret-grid">'
      + '<label class="sret-field"><span>المورد</span><select id="sret-supplier">' + supOptions + '</select></label>'
      + '<label class="sret-field"><span>السبب</span><select id="sret-reason">' + reasonOptions + '</select></label>'
      + '</div>'
      + '<label class="sret-field" style="margin-bottom:10px;"><span>ملاحظة (اختياري - بحد أقصى 200 حرف)</span><input type="text" id="sret-note" maxlength="200" placeholder="مثلاً: رقم فاتورة أو تفاصيل" /></label>'
      + '<div class="sret-field"><span>ابحث عن الصنف</span><input type="text" id="sret-search" placeholder="اكتب اسم الصنف أو الباركود..." autocomplete="off" /></div>'
      + '<div id="sret-search-res" class="sret-search-res" style="display:none;"></div>'
      + '<div id="sret-lots-box" class="sret-lots-box" style="display:none;"></div>'
      + '<div id="sret-lines" class="sret-lines"><strong>الأصناف المختارة للمرتجع</strong><div id="sret-lines-body" style="margin-top:6px;font-size:13px;color:#8b949e;">لسه مفيش أصناف مضافة.</div></div>'
      + '<div id="sret-msg"></div>'
      + '<div class="sret-foot">'
      + '<div><strong>الإجمالي: </strong><span id="sret-total">0.00 ج.م</span></div>'
      + '<div style="display:flex;gap:8px;">'
      + '<button type="button" id="sret-print-btn" class="btn btn-secondary" style="display:none;">طباعة إذن مرتجع</button>'
      + '<button type="button" id="sret-cancel" class="btn btn-secondary">إغلاق</button>'
      + '<button type="button" id="sret-save" class="btn btn-primary">حفظ المرتجع</button>'
      + '</div></div></div>';

    document.body.appendChild(backdrop);

    var dialog = backdrop.querySelector('.sret-dialog');
    var supEl = backdrop.querySelector('#sret-supplier');
    var reasonEl = backdrop.querySelector('#sret-reason');
    var noteEl = backdrop.querySelector('#sret-note');
    var searchEl = backdrop.querySelector('#sret-search');
    var searchResEl = backdrop.querySelector('#sret-search-res');
    var lotsBoxEl = backdrop.querySelector('#sret-lots-box');
    var linesBodyEl = backdrop.querySelector('#sret-lines-body');
    var totalEl = backdrop.querySelector('#sret-total');
    var msgEl = backdrop.querySelector('#sret-msg');
    var saveBtn = backdrop.querySelector('#sret-save');
    var cancelBtn = backdrop.querySelector('#sret-cancel');
    var printBtn = backdrop.querySelector('#sret-print-btn');

    function showMsg(text, kind) {
      if (!text) { msgEl.innerHTML = ''; return; }
      msgEl.innerHTML = '<div class="sret-msg ' + (kind === 'ok' ? 'ok' : 'err') + '">' + esc(text) + '</div>';
    }

    function close() {
      if (closeActive === close) closeActive = null;
      document.removeEventListener('keydown', onKeyDown, true);
      backdrop.remove();
      if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
    }

    function getFocusable() {
      return Array.prototype.slice.call(dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter(function (el) { return el.offsetParent !== null; });
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === 'Tab') {
        var f = getFocusable();
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    closeActive = close;

    function renderLines() {
      var sum = 0;
      if (!lines.length) {
        linesBodyEl.innerHTML = '<span style="color:#8b949e;">لسه مفيش أصناف مضافة.</span>';
        totalEl.textContent = money(0);
        return;
      }
      var html = '<table class="sret-table"><thead><tr><th>الصنف</th><th>التشغيلة</th><th>الصلاحية</th><th>الكمية</th><th>التكلفة</th><th>الإجمالي</th><th></th></tr></thead><tbody>';
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        var sub = round2(l.qty * l.cost);
        sum = round2(sum + sub);
        html += '<tr>'
          + '<td>' + esc(l.name) + '</td>'
          + '<td>' + esc(l.lot) + '</td>'
          + '<td>' + esc(fmtExpiry(l.expiry)) + '</td>'
          + '<td>' + l.qty + '</td>'
          + '<td>' + money(l.cost) + '</td>'
          + '<td>' + money(sub) + '</td>'
          + '<td><button type="button" class="btn btn-danger" data-sret-rm="' + i + '" style="padding:2px 7px;font-size:12px;">حذف</button></td>'
          + '</tr>';
      }
      html += '</tbody></table>';
      linesBodyEl.innerHTML = html;
      totalEl.textContent = money(sum);
      var rms = linesBodyEl.querySelectorAll('[data-sret-rm]');
      for (var r = 0; r < rms.length; r++) {
        rms[r].addEventListener('click', function (ev) {
          var idx = Number(ev.currentTarget.getAttribute('data-sret-rm'));
          lines.splice(idx, 1);
          renderLines();
        });
      }
    }

    function showProductLots(prod) {
      var key = window.novaStock.keyOf(prod);
      var code = norm(prod.barcode) || key;
      var name = norm(prod.name) || key;
      var lots = window.novaStock.lots(key).filter(function (l) { return l.onHand > 0; });
      lotsBoxEl.style.display = 'block';
      if (!lots.length) {
        lotsBoxEl.innerHTML = '<div style="font-size:13px;color:#8b949e;">مفيش تشغيلات برصيد متاح للصنف: ' + esc(name) + '</div>';
        return;
      }
      var html = '<div style="margin-bottom:6px;font-weight:700;">تشغيلات: ' + esc(name) + '</div>';
      for (var i = 0; i < lots.length; i++) {
        var l = lots[i];
        html += '<div class="sret-lot-row">'
          + '<div><strong>' + esc(l.lot) + '</strong> · صلاحية ' + esc(fmtExpiry(l.expiry))
          + (l.expired ? ' <span class="sret-badge-exp">منتهي</span>' : '')
          + ' · متاح: <strong>' + l.onHand + '</strong> · تكلفة: ' + money(l.cost) + '</div>'
          + '<div style="display:flex;gap:6px;align-items:center;">'
          + '<input type="number" min="1" max="' + l.onHand + '" step="1" value="1" data-sret-qty="' + i + '" style="width:70px;background:#1b2027;color:#e6edf3;border:1px solid #343b44;border-radius:5px;padding:4px 6px;" />'
          + '<button type="button" class="btn btn-primary" data-sret-add="' + i + '" style="padding:4px 10px;font-size:12px;">إضافة</button>'
          + '</div></div>';
      }
      lotsBoxEl.innerHTML = html;
      var addBtns = lotsBoxEl.querySelectorAll('[data-sret-add]');
      for (var b = 0; b < addBtns.length; b++) {
        addBtns[b].addEventListener('click', function (ev) {
          var idx = Number(ev.currentTarget.getAttribute('data-sret-add'));
          var lot = lots[idx];
          var qInput = lotsBoxEl.querySelector('[data-sret-qty="' + idx + '"]');
          var q = Number(qInput ? qInput.value : 0);
          if (!Number.isInteger(q) || q < 1 || q > lot.onHand) {
            showMsg('الكمية لازم تكون رقم صحيح بين 1 و ' + lot.onHand, 'err');
            return;
          }
          showMsg('', '');
          var existingIdx = -1;
          for (var j = 0; j < lines.length; j++) {
            if (lines[j].key === key && lines[j].lot === lot.lot && lines[j].expiry === lot.expiry) {
              existingIdx = j;
              break;
            }
          }
          var entry = { key: key, code: code, name: name, lot: lot.lot, expiry: lot.expiry, qty: q, cost: Number(lot.cost) || 0 };
          if (existingIdx >= 0) lines[existingIdx] = entry;
          else lines.push(entry);
          renderLines();
        });
      }
    }

    searchEl.addEventListener('input', function () {
      var q = norm(searchEl.value);
      if (!q || !window.novaSearch || typeof window.novaSearch.search !== 'function') {
        searchResEl.style.display = 'none';
        searchResEl.innerHTML = '';
        return;
      }
      var results = window.novaSearch.search(q, 6) || [];
      if (!results.length) {
        searchResEl.style.display = 'block';
        searchResEl.innerHTML = '<div class="sret-search-item" style="color:#8b949e;cursor:default;">مفيش نتائج</div>';
        return;
      }
      searchResEl.style.display = 'block';
      searchResEl.innerHTML = results.map(function (p, i) {
        return '<button type="button" class="sret-search-item" data-sret-pick="' + i + '"><span>' + esc(p.name) + '</span><span style="color:#8b949e;">' + esc(p.barcode || '') + '</span></button>';
      }).join('');
      var picks = searchResEl.querySelectorAll('[data-sret-pick]');
      for (var i = 0; i < picks.length; i++) {
        picks[i].addEventListener('click', function (ev) {
          var idx = Number(ev.currentTarget.getAttribute('data-sret-pick'));
          searchResEl.style.display = 'none';
          showProductLots(results[idx]);
        });
      }
    });

    cancelBtn.addEventListener('click', close);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });

    printBtn.addEventListener('click', function () {
      if (lastSaved) printSlip(lastSaved);
    });

    saveBtn.addEventListener('click', function () {
      if (saving) return;
      saving = true;
      saveBtn.disabled = true;
      showMsg('', '');
      Promise.resolve().then(function () {
        return saveReturn({
          id: attemptId,
          supplier: supEl.value,
          reason: reasonEl.value,
          note: noteEl.value,
          lines: lines
        });
      }).then(function (res) {
        lastSaved = res.record;
        attemptId = makeId();
        showMsg(res.message, res.creditStatus === 'credit-failed' ? 'err' : 'ok');
        printBtn.style.display = 'inline-block';
        lines = [];
        renderLines();
      }, function (err) {
        showMsg(err && err.message ? err.message : 'حصل خطأ أثناء حفظ المرتجع.', 'err');
      }).then(function () {
        saving = false;
        saveBtn.disabled = false;
      });
    });

    supEl.focus();
  }

  /* ---- Mount into Receiving Page ---- */
  function mountUI() {
  ensureStyles();
  var rcvRoot = document.querySelector('#novaPageView .rcv');
  if (!rcvRoot) return;
    var actions = document.querySelector('#novaPageView .rcv-head .rcv-actions');
    if (actions && !actions.querySelector('[data-sret-open]')) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rcv-btn';
      btn.setAttribute('data-sret-open', '1');
      btn.textContent = 'مرتجع للمورد';
      btn.addEventListener('click', openReturnDialog);
      actions.appendChild(btn);
  }
  if (!rcvRoot.querySelector('.sret-list-sec')) renderReturnsList();
}

  function initObserver() {
    var root = document.getElementById('novaPageView') || document.body;
    if (!root) return;
    mountUI();
    var obs = new MutationObserver(function () {
    var a = document.querySelector('#novaPageView .rcv-head .rcv-actions');
    if (a && (!a.querySelector('[data-sret-open]') || !document.querySelector('#novaPageView .rcv .sret-list-sec'))) mountUI();
  });
    obs.observe(root, { childList: true, subtree: true });
    window.addEventListener('hashchange', function () { setTimeout(mountUI, 50); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initObserver);
  } else {
    initObserver();
  }

  window.novaSupplierReturns = {
    list: listReturns,
    save: saveReturn
  };
})();
