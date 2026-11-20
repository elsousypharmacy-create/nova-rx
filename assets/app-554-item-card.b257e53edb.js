/* NOVA Rx — ITEM-CARD (#104) «كارت الصنف» + (#105) stock adjustment (damage / internal use).
   Reviewed Gemini Neon draft, integrated by Claude. Loaded lazily (app/548 loader) when the products page opens.
   Click / Enter on a products-page row opens the card. The adjustment write reuses the supplier-returns pattern (journal commit, idempotent id). */
(function () {
  'use strict';

  var LOTS_KEY = 'nova-rx-lots-v1';
  var LEDGER_KEY = 'nova.stock.ledger';
  var TX_KEY = 'nova.receipt-transaction-v1';
  var RECEIPTS_KEY = 'nova-rx-receipts-v1';
  var SUP_RET_KEY = 'nova-rx-supplier-returns-v1';
  var ADJ_KEY = 'nova-rx-stock-adjust-v1';
  var MAX_TIMELINE_ROWS = 200;

  var ADJUST_REASONS = [
    'تالف أو كسر',
    'إعدام منتهي الصلاحية',
    'استخدام داخلي',
    'عينة',
    'فقد / سرقة'
  ];

  var activeState = null;

  /* ---------------- Safe Storage & Helpers ---------------- */

  function safeReadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function safeReadRaw(key) {
    try {
      if (window.NovaReceiptOperations && typeof window.NovaReceiptOperations.readRaw === 'function') {
        return window.NovaReceiptOperations.readRaw(localStorage, key);
      }
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function readRawLotRecords() {
    var raw = safeReadRaw(LOTS_KEY);
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function currentUserInfo() {
    try {
      if (window.novaAuth && typeof window.novaAuth.current === 'function') {
        var u = window.novaAuth.current();
        if (u) return { id: u.id || u.uid || '', name: u.name || u.username || '' };
      }
      if (window.novaUser) {
        return { id: window.novaUser.id || '', name: window.novaUser.name || '' };
      }
    } catch (e) {}
    return null;
  }

  function keyOf(item) {
    if (!item) return '';
    try {
      if (window.novaStock && typeof window.novaStock.keyOf === 'function') {
        return String(window.novaStock.keyOf(item) || '');
      }
    } catch (e) {}
    return String(item.key || item.barcode || item.code || item.id || '');
  }

  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toNumber(v, def) {
    var n = Number(v);
    return isFinite(n) ? n : (def || 0);
  }

  function fmtQty(n) {
    var v = Math.round(toNumber(n, 0) * 100) / 100;
    if (Math.abs(v) < 0.0001) return '0';
    return String(v);
  }

  function fmtSignedQty(n) {
    var v = Math.round(toNumber(n, 0) * 100) / 100;
    if (Math.abs(v) < 0.0001) return '0';
    if (v > 0) return '+' + String(v);
    return '\u2212' + String(Math.abs(v));
  }

  function fmtCost(n) {
    var v = toNumber(n, 0);
    return v.toFixed(2);
  }

  function isAutoLot(lotId) {
    if (!lotId) return true;
    return /^RCV-[^/]+\/\d+$/i.test(String(lotId).trim());
  }

  function fmtLotLabel(lotId) {
    return isAutoLot(lotId) ? 'تلقائي' : String(lotId);
  }

  function fmtExpiry(exp) {
    if (!exp) return '—';
    var s = String(exp).trim();
    var m = /^(\d{4})-(\d{2})/.exec(s);
    if (m) return m[2] + '/' + m[1].slice(2);
    var m2 = /^(\d{2})\/(\d{2,4})$/.exec(s);
    if (m2) return m2[1] + '/' + m2[2].slice(-2);
    return s;
  }

  function parseTimestamp(val) {
    if (val == null || val === '') return 0;
    if (typeof val === 'number') return isFinite(val) ? val : 0;
    var num = Number(val);
    if (/^\d{10,14}$/.test(String(val).trim()) && isFinite(num)) return num;
    var t = Date.parse(String(val));
    return isFinite(t) ? t : 0;
  }

  function fmtDateTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    var y = d.getFullYear();
    var mo = String(d.getMonth() + 1);
    if (mo.length < 2) mo = '0' + mo;
    var da = String(d.getDate());
    if (da.length < 2) da = '0' + da;
    var hh = String(d.getHours());
    if (hh.length < 2) hh = '0' + hh;
    var mm = String(d.getMinutes());
    if (mm.length < 2) mm = '0' + mm;
    return y + '-' + mo + '-' + da + ' ' + hh + ':' + mm;
  }

  function makeAttemptId() {
    var rnd = Math.floor(Math.random() * 9000 + 1000);
    return 'ADJ-' + String(Date.now()) + '-' + String(rnd);
  }

  function hasAdjustPermission() {
    if (!window.novaPerms || typeof window.novaPerms.require !== 'function') {
      return true;
    }
    try {
      var res = window.novaPerms.require('stock.adjust');
      return res !== false;
    } catch (e) {
      return false;
    }
  }

  /* ---------------- Styles ---------------- */

  function ensureStyles() {
    if (document.getElementById('nova-ic-styles')) return;
    var css = ''
      + '.nova-ic-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.68);z-index:9900;display:flex;align-items:center;justify-content:center;padding:16px;direction:rtl;}'
      + '.nova-ic-dialog{background:#14181d;color:#e6edf3;border:1px solid #343b44;border-radius:10px;width:100%;max-width:960px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 18px 48px rgba(0,0,0,0.6);overflow:hidden;}'
      + '.nova-ic-head{background:#1b2027;border-bottom:1px solid #343b44;padding:14px 18px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}'
      + '.nova-ic-title{margin:0;font-size:1.15rem;color:#e6edf3;font-weight:700;}'
      + '.nova-ic-meta{display:flex;flex-wrap:wrap;gap:12px;margin-top:6px;font-size:0.9rem;color:#9aa4b2;}'
      + '.nova-ic-meta strong{color:#79c9eb;}'
      + '.nova-ic-close{background:transparent;border:1px solid #343b44;color:#e6edf3;border-radius:6px;width:32px;height:32px;font-size:1.2rem;cursor:pointer;line-height:1;}'
      + '.nova-ic-close:hover{border-color:#79c9eb;color:#79c9eb;}'
      + '.nova-ic-body{padding:16px 18px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:16px;}'
      + '.nova-ic-sec{background:#1b2027;border:1px solid #343b44;border-radius:8px;padding:12px 14px;}'
      + '.nova-ic-sec h3{margin:0 0 10px 0;font-size:1rem;color:#79c9eb;display:flex;align-items:center;justify-content:space-between;}'
      + '.nova-ic-table-wrap{overflow-x:auto;}'
      + '.nova-ic-table{width:100%;border-collapse:collapse;font-size:0.88rem;}'
      + '.nova-ic-table th,.nova-ic-table td{padding:7px 8px;border-bottom:1px solid #2b313a;text-align:right;white-space:nowrap;}'
      + '.nova-ic-table th{color:#9aa4b2;font-weight:600;background:#14181d;}'
      + '.nova-ic-table td.num,.nova-ic-table th.num{text-align:left;direction:ltr;font-variant-numeric:tabular-nums;}'
      + '.nova-ic-qty-in{color:#4ade80;font-weight:600;}'
      + '.nova-ic-qty-out{color:#f87171;font-weight:600;}'
      + '.nova-ic-badge{display:inline-block;padding:2px 7px;border-radius:999px;font-size:0.75rem;font-weight:600;margin-left:4px;}'
      + '.nova-ic-badge-exp{background:#5c1d1d;color:#fecaca;border:1px solid #ef4444;}'
      + '.nova-ic-badge-near{background:#523b12;color:#fde68a;border:1px solid #f59e0b;}'
      + '.nova-ic-badge-rec{background:#4c1d4f;color:#f5d0fe;border:1px solid #d946ef;}'
      + '.nova-ic-check{margin-top:10px;padding:9px 12px;background:#14181d;border:1px solid #343b44;border-radius:6px;display:flex;flex-wrap:wrap;gap:14px;align-items:center;font-size:0.9rem;}'
      + '.nova-ic-warn{color:#fbbf24;font-weight:700;}'
      + '.nova-ic-note{margin-top:8px;font-size:0.84rem;color:#9aa4b2;}'
      + '.nova-ic-foot{background:#1b2027;border-top:1px solid #343b44;padding:12px 18px;display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center;}'
      + '.nova-ic-actions{display:flex;flex-wrap:wrap;gap:8px;}'
      + '.nova-ic-banner{padding:8px 12px;border-radius:6px;font-size:0.9rem;font-weight:600;}'
      + '.nova-ic-banner-ok{background:#163826;border:1px solid #22c55e;color:#bbf7d0;}'
      + '.nova-ic-banner-err{background:#451a1a;border:1px solid #ef4444;color:#fecaca;}'
      + '.nova-ic-adj-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-top:8px;}'
      + '.nova-ic-field{display:flex;flex-direction:column;gap:4px;}'
      + '.nova-ic-field label{font-size:0.84rem;color:#9aa4b2;}'
      + '.nova-ic-field input,.nova-ic-field select{background:#14181d;color:#e6edf3;border:1px solid #343b44;border-radius:6px;padding:7px 9px;font-size:0.9rem;}'
      + '.nova-ic-field-wide{grid-column:1 / -1;}'
      + '.nova-ic-adj-btns{display:flex;gap:8px;margin-top:10px;}'
      + '#nova-ic-print-host{display:none;}'
      + '@media print{'
      + '  body.nova-ic-printing > *:not(#nova-ic-print-host){display:none !important;}'
      + '  body.nova-ic-printing #nova-ic-print-host{display:block !important;direction:rtl;background:#fff;color:#000;padding:12px;font-family:sans-serif;}'
      + '  body.nova-ic-printing #nova-ic-print-host table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;}'
      + '  body.nova-ic-printing #nova-ic-print-host th,body.nova-ic-printing #nova-ic-print-host td{border:1px solid #999;padding:4px 6px;text-align:right;}'
      + '}';

    var style = document.createElement('style');
    style.id = 'nova-ic-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ---------------- Data Aggregation (Read-Only) ---------------- */

  function getLots(key) {
    try {
      if (window.novaStock && typeof window.novaStock.lots === 'function') {
        var list = window.novaStock.lots(key);
        return Array.isArray(list) ? list : [];
      }
    } catch (e) {}
    return [];
  }

  function buildTimeline(key, lots) {
    var events = [];
    var receiptQtySum = 0;
    var transfersInSum = 0;
    var transfersOutSum = 0;
    var supplierRetSum = 0;
    var adjustSum = 0;

    // a. Receipts
    var receipts = safeReadJSON(RECEIPTS_KEY, []);
    if (Array.isArray(receipts)) {
      for (var i = 0; i < receipts.length; i++) {
        var r = receipts[i];
        if (!r || r.pending) continue;
        var rTs = parseTimestamp(r.at || r.date);
        var rLines = Array.isArray(r.lines) ? r.lines : [];
        var matchedIndices = {};

        for (var j = 0; j < rLines.length; j++) {
          var rl = rLines[j];
          if (!rl) continue;
          var lk = rl.key != null ? String(rl.key) : keyOf(rl);
          if (lk !== key) continue;
          matchedIndices[j] = true;
          var rQty = toNumber(rl.qty, 0);
          receiptQtySum += rQty;
          var refParts = [];
          if (r.supplier) refParts.push(String(r.supplier));
          if (r.invoice) refParts.push(String(r.invoice));
          var bonusNum = toNumber(rl.bonus, 0);
          if (bonusNum > 0) refParts.push('(بونص ' + fmtQty(bonusNum) + ')');
          events.push({
            ts: rTs,
            type: 'استلام',
            ref: refParts.join(' — ') || (r.id || '—'),
            qty: rQty
          });
        }

        var corrs = Array.isArray(r.corrections) ? r.corrections : [];
        for (var c = 0; c < corrs.length; c++) {
          var corr = corrs[c];
          if (!corr || !Array.isArray(corr.changes)) continue;
          var cTs = parseTimestamp(corr.at) || rTs;
          for (var ch = 0; ch < corr.changes.length; ch++) {
            var chg = corr.changes[ch];
            if (!chg || !matchedIndices[chg.index]) continue;
            var delta = toNumber(chg.delta, 0);
            if (delta === 0) continue;
            receiptQtySum += delta;
            events.push({
              ts: cTs,
              type: 'تصحيح استلام',
              ref: corr.reason || r.invoice || corr.id || '—',
              qty: delta
            });
          }
        }
      }
    }

    // b. Sales
    var salesById = {};
    var salesList = [];
    try {
      if (window.novaSales && typeof window.novaSales.list === 'function') {
        var sl = window.novaSales.list();
        if (Array.isArray(sl)) salesList = sl;
      }
    } catch (e) {}

    for (var s = 0; s < salesList.length; s++) {
      var sale = salesList[s];
      if (!sale) continue;
      if (sale.id != null) salesById[String(sale.id)] = sale;
      var sTs = parseTimestamp(sale.at);
      var sLines = Array.isArray(sale.lines) ? sale.lines : [];
      var sRef = sale.no || sale.id || '—';
      for (var slIdx = 0; slIdx < sLines.length; slIdx++) {
        var sLine = sLines[slIdx];
        if (!sLine || keyOf(sLine) !== key) continue;
        var uf = toNumber(sLine.unitFactor, 1);
        var rawQty = toNumber(sLine.qty, 0);
        var boxes = uf > 1 ? (rawQty / uf) : rawQty;
        if (boxes === 0) continue;
        events.push({
          ts: sTs,
          type: 'بيع',
          ref: String(sRef),
          qty: -boxes
        });
      }
    }

    // c. Customer returns / cancellations
    var returnsList = [];
    try {
      if (window.novaSales && typeof window.novaSales.returns === 'function') {
        var rl2 = window.novaSales.returns();
        if (Array.isArray(rl2)) returnsList = rl2;
      }
    } catch (e) {}

    for (var cr = 0; cr < returnsList.length; cr++) {
      var ret = returnsList[cr];
      if (!ret || !Array.isArray(ret.lines)) continue;
      var origSale = ret.saleId != null ? salesById[String(ret.saleId)] : null;
      if (!origSale || !Array.isArray(origSale.lines)) continue;
      var crTs = parseTimestamp(ret.at) || parseTimestamp(origSale.at);
      var crLabel = ret.kind === 'cancel' ? 'إلغاء فاتورة' : 'مرتجع عميل';
      var crRef = ret.reason || origSale.no || ret.saleId || ret.id || '—';
      for (var crl = 0; crl < ret.lines.length; crl++) {
        var rItem = ret.lines[crl];
        if (!rItem) continue;
        var origLine = origSale.lines[rItem.idx];
        if (!origLine || keyOf(origLine) !== key) continue;
        var ruf = toNumber(origLine.unitFactor, 1);
        var rRawQty = toNumber(rItem.qty, 0);
        var rBoxes = ruf > 1 ? (rRawQty / ruf) : rRawQty;
        if (rBoxes === 0) continue;
        events.push({
          ts: crTs,
          type: crLabel,
          ref: String(crRef),
          qty: rBoxes
        });
      }
    }

    // d. Supplier returns
    var supRets = safeReadJSON(SUP_RET_KEY, []);
    if (Array.isArray(supRets)) {
      for (var sr = 0; sr < supRets.length; sr++) {
        var sret = supRets[sr];
        if (!sret || !Array.isArray(sret.lines)) continue;
        var srTs = parseTimestamp(sret.at);
        var srRefParts = [];
        if (sret.supplier) srRefParts.push(String(sret.supplier));
        if (sret.reason) srRefParts.push(String(sret.reason));
        var srRef = srRefParts.join(' — ') || (sret.id || '—');
        for (var srl = 0; srl < sret.lines.length; srl++) {
          var srLine = sret.lines[srl];
          if (!srLine) continue;
          var srKey = srLine.key != null ? String(srLine.key) : keyOf(srLine);
          if (srKey !== key) continue;
          var srQty = toNumber(srLine.qty, 0);
          if (srQty === 0) continue;
          supplierRetSum += srQty;
          events.push({
            ts: srTs,
            type: 'مرتجع للمورد',
            ref: srRef,
            qty: -srQty
          });
        }
      }
    }

    // e. Transfers
    var transfersList = [];
    try {
      if (window.novaTransfers && typeof window.novaTransfers.list === 'function') {
        var tl = window.novaTransfers.list();
        if (Array.isArray(tl)) transfersList = tl;
      }
    } catch (e) {}

    for (var tf = 0; tf < transfersList.length; tf++) {
      var tr = transfersList[tf];
      if (!tr || String(tr.key) !== key) continue;
      var st = tr.status;
      if (st !== 'in-transit' && st !== 'received' && st !== 'received-diff') continue;
      var tTs = parseTimestamp(tr.at);
      if (tr.direction === 'out') {
        var outQ = toNumber(tr.sentQty != null ? tr.sentQty : tr.qty, 0);
        if (outQ !== 0) {
          transfersOutSum += outQ;
          events.push({
            ts: tTs,
            type: 'تحويل صادر',
            ref: tr.branch || tr.id || '—',
            qty: -outQ
          });
        }
      } else if (tr.direction === 'in' && (st === 'received' || st === 'received-diff')) {
        var inQ = toNumber(tr.receivedQty != null ? tr.receivedQty : tr.qty, 0);
        if (inQ !== 0) {
          transfersInSum += inQ;
          events.push({
            ts: tTs,
            type: 'تحويل وارد',
            ref: tr.branch || tr.id || '—',
            qty: inQ
          });
        }
      }
    }

    // f. Adjustments
    var adjs = safeReadJSON(ADJ_KEY, []);
    if (Array.isArray(adjs)) {
      for (var a = 0; a < adjs.length; a++) {
        var adj = adjs[a];
        if (!adj || !Array.isArray(adj.lines)) continue;
        var aTs = parseTimestamp(adj.at);
        for (var al = 0; al < adj.lines.length; al++) {
          var aLine = adj.lines[al];
          if (!aLine) continue;
          var aKey = aLine.key != null ? String(aLine.key) : keyOf(aLine);
          if (aKey !== key) continue;
          var aQty = toNumber(aLine.qty, 0);
          if (aQty === 0) continue;
          adjustSum += aQty;
          events.push({
            ts: aTs,
            type: adj.reason || 'تسوية مخزون',
            ref: adj.note || adj.id || '—',
            qty: -aQty
          });
        }
      }
    }

    // g. Opening stock
    var totalLotReceived = 0;
    for (var l = 0; l < lots.length; l++) {
      var lt = lots[l];
      if (!lt) continue;
      var recVal = lt.receivedQty != null ? lt.receivedQty : (lt.received != null ? lt.received : lt.onHand);
      totalLotReceived += toNumber(recVal, 0);
    }

    var openingQty = totalLotReceived - receiptQtySum - transfersInSum + supplierRetSum + adjustSum + transfersOutSum;

    // Sort oldest -> newest
    for (var idx = 0; idx < events.length; idx++) {
      events[idx]._ord = idx;
    }
    events.sort(function (a, b) {
      if (a.ts !== b.ts) return a.ts - b.ts;
      return a._ord - b._ord;
    });

    if (openingQty > 0.001) {
      events.unshift({
        ts: 0,
        type: 'رصيد افتتاحي/يدوي',
        ref: '—',
        qty: openingQty,
        isOpening: true
      });
    }

    // Compute running balance oldest -> newest
    var bal = 0;
    for (var b = 0; b < events.length; b++) {
      bal = Math.round((bal + events[b].qty) * 10000) / 10000;
      events[b].balance = bal;
    }

    // Reverse for newest first
    var newestFirst = events.slice().reverse();
    return {
      rows: newestFirst,
      finalBalance: bal
    };
  }

  /* ---------------- Stock Adjustment Write (#105) ---------------- */

  function saveAdjustment(payload) {
    if (!hasAdjustPermission()) {
      return Promise.reject(new Error('محتاج صلاحية تعديل المخزون'));
    }

    var adjId = payload.id || makeAttemptId();
    var reason = String(payload.reason || '').trim();
    var note = String(payload.note || '').trim().slice(0, 200);
    var lines = Array.isArray(payload.lines) ? payload.lines : [];

    if (!reason) {
      return Promise.reject(new Error('اختار سبب التسوية.'));
    }
    if (!lines.length) {
      return Promise.reject(new Error('مفيش أصناف للتسوية.'));
    }

    var total = 0;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (!ln.qty || ln.qty <= 0 || Math.floor(ln.qty) !== ln.qty) {
        return Promise.reject(new Error('الكمية لازم تكون رقم صحيح أكبر من صفر.'));
      }
      total += toNumber(ln.cost, 0) * ln.qty;
    }

    var run = function () {
      var txPending = null;
      try {
        txPending = localStorage.getItem(TX_KEY);
      } catch (e) {}
      if (txPending) {
        throw new Error('فيه عملية مخزون مفتوحة حالياً — استنى لحظة وحاول تاني.');
      }

      var existingList = safeReadJSON(ADJ_KEY, []);
      if (!Array.isArray(existingList)) existingList = [];
      for (var ex = 0; ex < existingList.length; ex++) {
        if (existingList[ex] && existingList[ex].id === adjId) {
          return { record: existingList[ex] };
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
      var alreadyDeducted = refs.indexOf(adjId) >= 0;
      var ledgerRaw = safeReadRaw(LEDGER_KEY);
      var movements = JSON.parse(ledgerRaw || '[]');
      if (!Array.isArray(movements)) throw new Error('سجل حركة المخزون فيه مشكلة.');

      if (alreadyDeducted) {
        // an earlier attempt committed the stock part; the lines must not have changed since
        for (var c = 0; c < lines.length; c++) {
          var prior = movements.filter(function (m) {
            return m.kind === 'adjustment' && m.ref === adjId + '/' + c;
          })[0];
          if (!prior || prior.qty !== -lines[c].qty || prior.code !== lines[c].code) {
            throw new Error('التسوية دي اتخصمت قبل كده بكميات مختلفة — افتح التسوية من جديد.');
          }
        }
      } else {
        // Re-read lots and verify onHand >= the total requested per lot (duplicate lines are summed)
        var need = {};
        lines.forEach(function (l) { var k = l.key + '\u0000' + l.lot + '\u0000' + l.expiry; need[k] = (need[k] || 0) + l.qty; });
        for (var v = 0; v < lines.length; v++) {
          var line = lines[v];
          var currentLots = window.novaStock.lots(line.key);
          var match = null;
          for (var j = 0; j < currentLots.length; j++) {
            if (currentLots[j].lot === line.lot && currentLots[j].expiry === line.expiry) {
              match = currentLots[j];
              break;
            }
          }
          var avail = match ? Number(match.onHand) || 0 : 0;
          if (avail < need[line.key + '\u0000' + line.lot + '\u0000' + line.expiry]) {
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
        refs.push(adjId);
        lotRows.push({ receiptRefs: refs });
        var at = new Date().toISOString();
        lines.forEach(function (l, idx) {
          movements.push({
            seq: movements.length + 1,
            at: at,
            kind: 'adjustment',
            code: l.code,
            qty: -l.qty,
            delta: -l.qty,
            ref: adjId + '/' + idx
          });
        });
        var writes = {};
        writes[LOTS_KEY] = JSON.stringify(lotRows);
        writes[LEDGER_KEY] = JSON.stringify(movements);
        localStorage.setItem(TX_KEY, JSON.stringify({ writes: writes }));
        if (window.NovaReceiptOperations && typeof window.NovaReceiptOperations.recover === 'function') {
          window.NovaReceiptOperations.recover(localStorage);
        } else {
          localStorage.setItem(LOTS_KEY, writes[LOTS_KEY]);
          localStorage.setItem(LEDGER_KEY, writes[LEDGER_KEY]);
          localStorage.removeItem(TX_KEY);
        }
      }

      // Last: save the adjustment record
      var recOut = {
        id: adjId,
        at: new Date().toISOString(),
        by: currentUserInfo(),
        reason: reason,
        note: note,
        lines: lines,
        total: Math.round(total * 100) / 100
      };
      existingList.push(recOut);
      localStorage.setItem(ADJ_KEY, JSON.stringify(existingList));
      return { record: recOut };
    };

    if (window.novaStock && typeof window.novaStock.withLock === 'function') {
      return window.novaStock.withLock(run);
    }
    return Promise.resolve().then(run);
  }

  /* ---------------- Printing ---------------- */

  function printItemCard(product, lots, timeline, totalOnHand) {
    var host = document.getElementById('nova-ic-print-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'nova-ic-print-host';
      document.body.appendChild(host);
    }

    var html = ''
      + '<h2>كارت الصنف: ' + esc(product.name || '') + '</h2>'
      + '<p>الباركود: <span dir="ltr">' + esc(product.barcode || product.code || '—') + '</span>'
      + ' | الرصيد الحالي: <strong>' + fmtQty(totalOnHand) + '</strong>'
      + ' | عدد التشغيلات: <strong>' + String(lots.length) + '</strong></p>'
      + '<h3>التشغيلات</h3>'
      + '<table><thead><tr>'
      + '<th>التشغيلة</th><th>الصلاحية</th><th>المستلم</th><th>المتاح</th><th>التكلفة</th>'
      + '</tr></thead><tbody>';

    for (var i = 0; i < lots.length; i++) {
      var lt = lots[i];
      var recVal = lt.receivedQty != null ? lt.receivedQty : (lt.received != null ? lt.received : lt.onHand);
      html += '<tr>'
        + '<td>' + esc(fmtLotLabel(lt.lot)) + '</td>'
        + '<td>' + esc(fmtExpiry(lt.expiry)) + '</td>'
        + '<td>' + fmtQty(recVal) + '</td>'
        + '<td>' + fmtQty(lt.onHand) + '</td>'
        + '<td>' + fmtCost(lt.cost) + '</td>'
        + '</tr>';
    }
    html += '</tbody></table>';

    html += '<h3>حركة الصنف</h3>'
      + '<table><thead><tr>'
      + '<th>التاريخ</th><th>النوع</th><th>المرجع</th><th>الكمية</th><th>الرصيد</th>'
      + '</tr></thead><tbody>';

    var showRows = timeline.rows.slice(0, MAX_TIMELINE_ROWS);
    for (var j = 0; j < showRows.length; j++) {
      var ev = showRows[j];
      html += '<tr>'
        + '<td>' + esc(ev.isOpening ? '—' : fmtDateTime(ev.ts)) + '</td>'
        + '<td>' + esc(ev.type) + '</td>'
        + '<td>' + esc(ev.ref) + '</td>'
        + '<td dir="ltr">' + esc(fmtSignedQty(ev.qty)) + '</td>'
        + '<td dir="ltr">' + esc(fmtQty(ev.balance)) + '</td>'
        + '</tr>';
    }
    html += '</tbody></table>';

    host.innerHTML = html;

    var cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      document.body.classList.remove('nova-ic-printing');
      window.removeEventListener('afterprint', cleanup);
    }

    document.body.classList.add('nova-ic-printing');
    window.addEventListener('afterprint', cleanup);
    try {
      window.print();
    } catch (e) {
      cleanup();
    }
    setTimeout(cleanup, 60000);
  }

  /* ---------------- Dialog Rendering & Focus Trap ---------------- */

  function getFocusable(root) {
    return Array.prototype.slice.call(
      root.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
    );
  }

  function closeDialog() {
    if (!activeState) return;
    document.removeEventListener('keydown', activeState.onKeyDown, true);
    if (activeState.backdrop && activeState.backdrop.parentNode) {
      activeState.backdrop.parentNode.removeChild(activeState.backdrop);
    }
    var prev = activeState.previousFocus;
    activeState = null;
    if (prev && typeof prev.focus === 'function') {
      try { prev.focus(); } catch (e) {}
    }
  }

  function renderDialogContent(state) {
    var product = state.product;
    var key = state.key;
    var lots = getLots(key);
    var totalOnHand = 0;
    for (var i = 0; i < lots.length; i++) {
      totalOnHand += toNumber(lots[i].onHand, 0);
    }
    totalOnHand = Math.round(totalOnHand * 10000) / 10000;

    var timeline = buildTimeline(key, lots);
    var diff = Math.abs(timeline.finalBalance - totalOnHand);
    var hasDiff = lots.length > 0 && diff > 0.01;

    state.lots = lots;
    state.timeline = timeline;
    state.totalOnHand = totalOnHand;

    var lotsHtml = '';
    if (!lots.length) {
      lotsHtml = '<p class="nova-ic-note">مفيش تشغيلات مسجلة للصنف ده.</p>';
    } else {
      lotsHtml = '<div class="nova-ic-table-wrap"><table class="nova-ic-table"><thead><tr>'
        + '<th>التشغيلة</th><th>الصلاحية</th><th class="num">المستلم</th><th class="num">المتاح</th><th class="num">التكلفة</th><th>الحالة</th>'
        + '</tr></thead><tbody>';
      for (var l = 0; l < lots.length; l++) {
        var lt = lots[l];
        var recVal = lt.receivedQty != null ? lt.receivedQty : (lt.received != null ? lt.received : lt.onHand);
        var badges = '';
        if (lt.expired) badges += '<span class="nova-ic-badge nova-ic-badge-exp">منتهي</span>';
        else if (lt.nearExpiry) badges += '<span class="nova-ic-badge nova-ic-badge-near">قرب ينتهي</span>';
        if (lt.recalled) badges += '<span class="nova-ic-badge nova-ic-badge-rec">مسحوب</span>';
        lotsHtml += '<tr>'
          + '<td>' + esc(fmtLotLabel(lt.lot)) + '</td>'
          + '<td dir="ltr">' + esc(fmtExpiry(lt.expiry)) + '</td>'
          + '<td class="num">' + esc(fmtQty(recVal)) + '</td>'
          + '<td class="num">' + esc(fmtQty(lt.onHand)) + '</td>'
          + '<td class="num">' + esc(fmtCost(lt.cost)) + '</td>'
          + '<td>' + (badges || '—') + '</td>'
          + '</tr>';
      }
      lotsHtml += '</tbody></table></div>';
    }

    var tlHtml = '';
    if (!timeline.rows.length) {
      tlHtml = '<p class="nova-ic-note">مفيش حركات مسجلة للصنف ده.</p>';
    } else {
      var visibleRows = timeline.rows.slice(0, MAX_TIMELINE_ROWS);
      tlHtml = '<div class="nova-ic-table-wrap"><table class="nova-ic-table"><thead><tr>'
        + '<th>التاريخ</th><th>النوع</th><th>المرجع</th><th class="num">الكمية</th><th class="num">الرصيد</th>'
        + '</tr></thead><tbody>';
      for (var t = 0; t < visibleRows.length; t++) {
        var ev = visibleRows[t];
        var qtyCls = ev.qty >= 0 ? 'nova-ic-qty-in' : 'nova-ic-qty-out';
        tlHtml += '<tr>'
          + '<td dir="ltr">' + esc(ev.isOpening ? '—' : fmtDateTime(ev.ts)) + '</td>'
          + '<td>' + esc(ev.type) + '</td>'
          + '<td>' + esc(ev.ref) + '</td>'
          + '<td class="num ' + qtyCls + '">' + esc(fmtSignedQty(ev.qty)) + '</td>'
          + '<td class="num">' + esc(fmtQty(ev.balance)) + '</td>'
          + '</tr>';
      }
      tlHtml += '</tbody></table></div>';
      if (timeline.rows.length > MAX_TIMELINE_ROWS) {
        tlHtml += '<p class="nova-ic-note">يتم عرض أحدث ' + String(MAX_TIMELINE_ROWS) + ' حركة من أصل ' + String(timeline.rows.length) + ' حركة.</p>';
      }
    }

    var checkHtml = '<div class="nova-ic-check">'
      + '<span>الرصيد حسب الحركة: <strong dir="ltr">' + esc(fmtQty(timeline.finalBalance)) + '</strong></span>'
      + '<span>الرصيد الحالي: <strong dir="ltr">' + esc(fmtQty(totalOnHand)) + '</strong></span>'
      + (hasDiff ? '<span class="nova-ic-warn">فيه فرق — راجع الجرد</span>' : '')
      + (!lots.length ? '<span class="nova-ic-note">رصيد الصنف ده مش متسجل بالتشغيلات، فالحركة للعلم بس.</span>' : '')
      + '</div>';

    var bannerHtml = '';
    if (state.banner) {
      var bCls = state.banner.type === 'err' ? 'nova-ic-banner nova-ic-banner-err' : 'nova-ic-banner nova-ic-banner-ok';
      bannerHtml = '<div class="' + bCls + '" role="status">' + esc(state.banner.text) + '</div>';
    }

    var adjHtml = '';
    if (state.showAdjust) {
      var availLots = lots.filter(function (x) { return Math.floor(toNumber(x.onHand, 0)) >= 1; });
      if (!availLots.length) {
        adjHtml = '<div class="nova-ic-sec"><h3>تسوية (تالف / استخدام داخلي)</h3>'
          + '<p class="nova-ic-note">مفيش تشغيلات برصيد متاح للتسوية.</p>'
          + '<div class="nova-ic-adj-btns"><button type="button" class="btn btn-secondary" data-ic-act="cancel-adj">إغلاق</button></div></div>';
      } else {
        var lotOpts = '';
        for (var al = 0; al < availLots.length; al++) {
          var aLt = availLots[al];
          var optText = fmtLotLabel(aLt.lot) + ' — صلاحية ' + fmtExpiry(aLt.expiry) + ' — متاح ' + fmtQty(aLt.onHand);
          lotOpts += '<option value="' + String(al) + '">' + esc(optText) + '</option>';
        }
        var reasonOpts = '';
        for (var rIdx = 0; rIdx < ADJUST_REASONS.length; rIdx++) {
          reasonOpts += '<option value="' + esc(ADJUST_REASONS[rIdx]) + '">' + esc(ADJUST_REASONS[rIdx]) + '</option>';
        }
        var firstMax = Math.floor(toNumber(availLots[0].onHand, 1));
        adjHtml = '<div class="nova-ic-sec" id="nova-ic-adj-sec">'
          + '<h3>تسوية (تالف / استخدام داخلي)</h3>'
          + '<form id="nova-ic-adj-form">'
          + '<div class="nova-ic-adj-form">'
          + '<div class="nova-ic-field"><label for="nova-ic-lot">التشغيلة</label>'
          + '<select id="nova-ic-lot" name="lotIdx">' + lotOpts + '</select></div>'
          + '<div class="nova-ic-field"><label for="nova-ic-qty">الكمية</label>'
          + '<input id="nova-ic-qty" name="qty" type="number" min="1" step="1" max="' + String(firstMax) + '" value="1" required /></div>'
          + '<div class="nova-ic-field"><label for="nova-ic-reason">السبب</label>'
          + '<select id="nova-ic-reason" name="reason">' + reasonOpts + '</select></div>'
          + '<div class="nova-ic-field nova-ic-field-wide"><label for="nova-ic-note">ملاحظة (اختياري)</label>'
          + '<input id="nova-ic-note" name="note" type="text" maxlength="200" placeholder="ملاحظة إضافية..." /></div>'
          + '</div>'
          + '<div class="nova-ic-adj-btns">'
          + '<button type="submit" class="btn btn-danger" id="nova-ic-adj-submit">حفظ التسوية</button>'
          + '<button type="button" class="btn btn-secondary" data-ic-act="cancel-adj">إلغاء</button>'
          + '</div></form></div>';
      }
    }

    var dlg = state.dialog;
    dlg.innerHTML = ''
      + '<div class="nova-ic-head">'
      + '  <div>'
      + '    <h2 class="nova-ic-title" id="nova-ic-title">' + esc(product.name || 'كارت الصنف') + '</h2>'
      + '    <div class="nova-ic-meta">'
      + '      <span>الباركود: <strong dir="ltr">' + esc(product.barcode || product.code || '—') + '</strong></span>'
      + '      <span>الرصيد الحالي: <strong dir="ltr" data-ic-onhand>' + esc(fmtQty(totalOnHand)) + '</strong></span>'
      + '      <span>عدد التشغيلات: <strong dir="ltr">' + String(lots.length) + '</strong></span>'
      + '    </div>'
      + '  </div>'
      + '  <button type="button" class="nova-ic-close" aria-label="إغلاق" data-ic-act="close">&times;</button>'
      + '</div>'
      + '<div class="nova-ic-body">'
      + bannerHtml
      + adjHtml
      + '  <div class="nova-ic-sec"><h3>التشغيلات</h3>' + lotsHtml + '</div>'
      + '  <div class="nova-ic-sec"><h3>حركة الصنف</h3>' + tlHtml + checkHtml + '</div>'
      + '</div>'
      + '<div class="nova-ic-foot">'
      + '  <div class="nova-ic-actions">'
      + '    <button type="button" class="btn btn-primary" data-ic-act="open-adj">تسوية (تالف / استخدام داخلي)</button>'
      + '    <button type="button" class="btn btn-secondary" data-ic-act="print">طباعة الكارت</button>'
      + '  </div>'
      + '  <button type="button" class="btn btn-secondary" data-ic-act="close">إغلاق</button>'
      + '</div>';

    bindDialogEvents(state);
    if (!dlg.contains(document.activeElement)) {
      var target = dlg.querySelector('.nova-ic-banner') ? dlg.querySelector('[data-ic-act="open-adj"]') : null;
      var first = target || getFocusable(dlg)[0];
      if (first) { try { first.focus(); } catch (e) {} }
    }
  }

  function bindDialogEvents(state) {
    var dlg = state.dialog;

    var closeBtns = dlg.querySelectorAll('[data-ic-act="close"]');
    for (var i = 0; i < closeBtns.length; i++) {
      closeBtns[i].addEventListener('click', closeDialog);
    }

    var printBtn = dlg.querySelector('[data-ic-act="print"]');
    if (printBtn) {
      printBtn.addEventListener('click', function () {
        printItemCard(state.product, state.lots, state.timeline, state.totalOnHand);
      });
    }

    var openAdjBtn = dlg.querySelector('[data-ic-act="open-adj"]');
    if (openAdjBtn) {
      openAdjBtn.addEventListener('click', function () {
        if (!hasAdjustPermission()) {
          state.banner = { type: 'err', text: 'محتاج صلاحية تعديل المخزون' };
          renderDialogContent(state);
          return;
        }
        state.showAdjust = true;
        state.banner = null;
        if (!state.attemptId) state.attemptId = makeAttemptId();
        renderDialogContent(state);
        var qtyInput = dlg.querySelector('#nova-ic-qty');
        if (qtyInput) qtyInput.focus();
      });
    }

    var cancelAdjBtn = dlg.querySelector('[data-ic-act="cancel-adj"]');
    if (cancelAdjBtn) {
      cancelAdjBtn.addEventListener('click', function () {
        state.showAdjust = false;
        state.banner = null;
        renderDialogContent(state);
      });
    }

    var lotSel = dlg.querySelector('#nova-ic-lot');
    var qtyInputEl = dlg.querySelector('#nova-ic-qty');
    var availLots = state.lots.filter(function (x) { return Math.floor(toNumber(x.onHand, 0)) >= 1; });

    if (lotSel && qtyInputEl) {
      lotSel.addEventListener('change', function () {
        var idx = Number(lotSel.value) || 0;
        var selLot = availLots[idx];
        var maxQ = selLot ? Math.floor(toNumber(selLot.onHand, 1)) : 1;
        qtyInputEl.max = String(maxQ);
        if (Number(qtyInputEl.value) > maxQ) qtyInputEl.value = String(maxQ);
      });
    }

    var form = dlg.querySelector('#nova-ic-adj-form');
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        if (state.saving) return;

        var lotIdx = Number(lotSel ? lotSel.value : 0) || 0;
        var chosen = availLots[lotIdx];
        if (!chosen) {
          state.banner = { type: 'err', text: 'اختار تشغيلة صالحة.' };
          renderDialogContent(state);
          return;
        }

        var qtyVal = Number(qtyInputEl ? qtyInputEl.value : 0);
        var maxAvail = Math.floor(toNumber(chosen.onHand, 0));
        if (!isFinite(qtyVal) || Math.floor(qtyVal) !== qtyVal || qtyVal < 1 || qtyVal > maxAvail) {
          state.banner = { type: 'err', text: 'الكمية لازم تكون رقم صحيح بين 1 و ' + String(maxAvail) + '.' };
          renderDialogContent(state);
          return;
        }

        var reasonEl = dlg.querySelector('#nova-ic-reason');
        var noteEl = dlg.querySelector('#nova-ic-note');
        var reasonVal = reasonEl ? reasonEl.value : ADJUST_REASONS[0];
        var noteVal = noteEl ? noteEl.value.trim().slice(0, 200) : '';

        var submitBtn = dlg.querySelector('#nova-ic-adj-submit');
        if (submitBtn) submitBtn.disabled = true;
        state.saving = true;

        var lineObj = {
          key: state.key,
          code: String(state.product.barcode || state.product.code || state.key),
          name: String(state.product.name || ''),
          lot: chosen.lot,
          expiry: chosen.expiry,
          qty: qtyVal,
          cost: toNumber(chosen.cost, 0)
        };

        saveAdjustment({
          id: state.attemptId,
          reason: reasonVal,
          note: noteVal,
          lines: [lineObj]
        }).then(function () {
          state.saving = false;
          state.showAdjust = false;
          state.attemptId = makeAttemptId();
          state.banner = { type: 'ok', text: 'اتسجلت التسوية' };
          renderDialogContent(state);
        }, function (err) {
          state.saving = false;
          state.banner = { type: 'err', text: (err && err.message) ? err.message : 'حصلت مشكلة أثناء حفظ التسوية.' };
          renderDialogContent(state);
        });
      });
    }
  }

  function openDialogForProduct(product) {
    if (!product) return;
    ensureStyles();
    if (activeState) closeDialog();

    var key = keyOf(product);
    if (!key) return;

    var backdrop = document.createElement('div');
    backdrop.className = 'nova-ic-backdrop';

    var dialog = document.createElement('div');
    dialog.className = 'nova-ic-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'nova-ic-title');

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    var state = {
      product: product,
      key: key,
      backdrop: backdrop,
      dialog: dialog,
      previousFocus: document.activeElement,
      showAdjust: false,
      saving: false,
      attemptId: makeAttemptId(),
      banner: null,
      lots: [],
      timeline: { rows: [], finalBalance: 0 },
      totalOnHand: 0,
      onKeyDown: null
    };

    state.onKeyDown = function (e) {
      if (!activeState) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog();
        return;
      }
      if (e.key === 'Tab') {
        var focusables = getFocusable(dialog);
        if (!focusables.length) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || !dialog.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !dialog.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) closeDialog();
    });

    document.addEventListener('keydown', state.onKeyDown, true);
    activeState = state;
    renderDialogContent(state);

    var focusables = getFocusable(dialog);
    if (focusables.length) focusables[0].focus();
  }

  /* ---------------- Product Lookup & Delegation ---------------- */

  function findProduct(barcodeOrKey) {
    var q = String(barcodeOrKey || '').trim();
    if (!q) return null;
    try {
      if (window.novaSearch && typeof window.novaSearch.search === 'function') {
        var res = window.novaSearch.search(q, 1);
        if (Array.isArray(res) && res.length) {
          var p = res[0];
          if (String(p.barcode || p.code || '').trim() === q || keyOf(p) === q) {
            return p;
          }
        }
        var wider = window.novaSearch.search(q, 10);
        if (Array.isArray(wider)) {
          for (var i = 0; i < wider.length; i++) {
            var item = wider[i];
            if (String(item.barcode || item.code || '').trim() === q || keyOf(item) === q) {
              return item;
            }
          }
        }
      }
    } catch (e) {}
    return null;
  }

  function isInteractiveTarget(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('button, input, select, textarea, a, [role="button"]');
  }

  function handleRowTrigger(row) {
    if (!row) return;
    var barCell = row.querySelector('td.pc-bar');
    if (!barCell) return;
    var barcode = String(barCell.textContent || '').trim();
    if (!barcode) return;
    var product = findProduct(barcode);
    if (product) openDialogForProduct(product);
  }

  document.addEventListener('click', function (e) {
    if (isInteractiveTarget(e.target)) return;
    var row = e.target && e.target.closest ? e.target.closest('.nova-prod-panel tr.nova-row-focus') : null;
    if (!row) return;
    handleRowTrigger(row);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (isInteractiveTarget(e.target)) return;
    var row = e.target && e.target.closest ? e.target.closest('.nova-prod-panel tr.nova-row-focus') : null;
    if (!row) return;
    e.preventDefault();
    handleRowTrigger(row);
  });

  /* ---------------- Public API ---------------- */

  window.novaItemCard = {
    open: function (barcodeOrKey) {
      var prod = findProduct(barcodeOrKey);
      if (prod) {
        openDialogForProduct(prod);
        return true;
      }
      return false;
    },
    adjust: function (payload) {
      return saveAdjustment(payload || {});
    }
  };
})();