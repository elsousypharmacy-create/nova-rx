// app/574-excel-export.js — #130 تصدير البيانات لـ Excel
(function () {
  'use strict';

  var PAY_LABELS = {
    cash: 'نقدي',
    card: 'بطاقة',
    credit: 'آجل',
    wallet: 'محفظة موبايل',
    instapay: 'إنستاباي',
    fawry: 'فوري'
  };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function round2(v) { return Math.round(num(v) * 100) / 100; }

  function isEn() {
    try { return localStorage.getItem('nova-rx-language') === 'en'; }
    catch (e) { return false; }
  }

  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function firstOfMonthIso() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-01';
  }

  function fmtLocalDateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function parseDayBound(ymd, endOfDay) {
    if (!ymd || typeof ymd !== 'string') return null;
    var p = ymd.split('-');
    if (p.length !== 3) return null;
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]),
      endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    if (isNaN(d.getTime()) || d.getFullYear() !== Number(p[0]) || d.getMonth() !== Number(p[1]) - 1 || d.getDate() !== Number(p[2])) return null;
    return d.getTime();
  }

  function filterSales(from, to) {
    var list = (window.novaSales && typeof window.novaSales.list === 'function')
      ? window.novaSales.list() : [];
    var minMs = parseDayBound(from, false);
    var maxMs = parseDayBound(to, true);
    if (minMs !== null && maxMs !== null && minMs > maxMs) { minMs = parseDayBound(to, false); maxMs = parseDayBound(from, true); }
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s) continue;
      var t = new Date(s.at).getTime();
      if (isNaN(t)) continue;
      if (minMs !== null && t < minMs) continue;
      if (maxMs !== null && t > maxMs) continue;
      out.push(s);
    }
    return out;
  }

  function isCancelled(id) {
    return !!(window.novaSales && typeof window.novaSales.isCancelled === 'function' &&
      window.novaSales.isCancelled(id));
  }

  function returnedAmount(id) {
    if (window.novaSales && typeof window.novaSales.returnedAmount === 'function') {
      return round2(window.novaSales.returnedAmount(id));
    }
    return 0;
  }

  function payLabel(method) {
    return PAY_LABELS[method] || (method ? String(method) : '');
  }

  function paymentText(sale) {
    if (sale.tenders && sale.tenders.length) {
      var parts = [];
      for (var i = 0; i < sale.tenders.length; i++) {
        var lbl = payLabel(sale.tenders[i] && sale.tenders[i].method);
        if (lbl && parts.indexOf(lbl) === -1) parts.push(lbl);
      }
      if (parts.length) return parts.join(' + ');
    }
    return payLabel(sale.payment);
  }

  function unitLabel(unit) {
    if (unit === 'box') return 'علبة';
    if (unit === 'strip') return 'شريط';
    return unit ? String(unit) : '';
  }

  function salesRows(from, to) {
    var rows = [[
      'التاريخ', 'رقم الفاتورة', 'العميل', 'الصنف', 'الباركود', 'الوحدة',
      'الكمية', 'السعر', 'خصم السطر', 'إجمالي السطر', 'التشغيلة', 'طريقة الدفع', 'حالة الفاتورة'
    ]];
    var sales = filterSales(from, to);
    for (var i = 0; i < sales.length; i++) {
      var s = sales[i];
      var lines = s.lines || [];
      var dt = fmtLocalDateTime(s.at);
      var numStr = s.number || s.id || '';
      var cust = s.customer || '';
      var pay = paymentText(s);
      var status = isCancelled(s.id) ? 'ملغاة' : 'نهائية';
      for (var j = 0; j < lines.length; j++) {
        var ln = lines[j] || {};
        var qty = round2(ln.qty);
        var price = round2(ln.price);
        var disc = round2(ln.discount);
        var lineTotal = round2(num(ln.qty) * num(ln.price) - num(ln.discount));
        rows.push([
          dt, numStr, cust, ln.name || '', code(ln.barcode), unitLabel(ln.unit),
          qty, price, disc, lineTotal, ln.lot || '', pay, status
        ]);
      }
    }
    return rows;
  }

  function invoiceRows(from, to) {
    var rows = [[
      'التاريخ', 'رقم الفاتورة', 'العميل', 'الهاتف', 'قبل الخصم', 'الخصم',
      'الضريبة', 'الإجمالي', 'نقدي', 'بطاقة', 'آجل', 'محفظة/إنستاباي/فوري', 'المرتجع', 'الحالة'
    ]];
    var sales = filterSales(from, to);
    var sums = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (var i = 0; i < sales.length; i++) {
      var s = sales[i];
      var cancelled = isCancelled(s.id);
      var tCash = 0, tCard = 0, tCredit = 0, tDigital = 0;
      if (s.tenders && s.tenders.length) {
        for (var j = 0; j < s.tenders.length; j++) {
          var td = s.tenders[j] || {};
          var amt = num(td.amount);
          if (td.method === 'cash') tCash += amt;
          else if (td.method === 'card') tCard += amt;
          else if (td.method === 'credit') tCredit += amt;
          else if (td.method === 'wallet' || td.method === 'instapay' || td.method === 'fawry') tDigital += amt;
        }
      } else {
        var tot = num(s.total);
        if (s.payment === 'cash') tCash = tot;
        else if (s.payment === 'card') tCard = tot;
        else if (s.payment === 'credit') tCredit = tot;
        else if (s.payment === 'wallet' || s.payment === 'instapay' || s.payment === 'fawry') tDigital = tot;
      }
      var vals = [
        round2(s.subtotal), round2(s.discount), round2(s.vat), round2(s.total),
        round2(tCash), round2(tCard), round2(tCredit), round2(tDigital), returnedAmount(s.id)
      ];
      if (!cancelled) {
        for (var k = 0; k < vals.length; k++) sums[k] += vals[k];
      }
      rows.push([
        fmtLocalDateTime(s.at), s.number || s.id || '', s.customer || '', code(s.phone),
        vals[0], vals[1], vals[2], vals[3], vals[4], vals[5], vals[6], vals[7], vals[8],
        cancelled ? 'ملغاة' : 'نهائية'
      ]);
    }
    rows.push([
      'الإجمالي', '', '', '',
      round2(sums[0]), round2(sums[1]), round2(sums[2]), round2(sums[3]),
      round2(sums[4]), round2(sums[5]), round2(sums[6]), round2(sums[7]),
      round2(sums[8]), ''
    ]);
    return rows;
  }

  function stockRows() {
    var rows = [[
      'الصنف', 'الباركود', 'التشغيلة', 'الصلاحية', 'الكمية', 'تكلفة العلبة', 'قيمة التكلفة', 'سعر البيع'
    ]];
    var products = (window.NOVA_DEMO && window.NOVA_DEMO.products) || [];
    var stock = window.novaStock;
    var totalQty = 0;
    var totalCost = 0;
    if (stock && typeof stock.keyOf === 'function' && typeof stock.hasLots === 'function' && typeof stock.lots === 'function') {
      for (var i = 0; i < products.length; i++) {
        var p = products[i];
        if (!p) continue;
        var key = stock.keyOf(p);
        if (!stock.hasLots(key)) continue;
        var lots = stock.lots(key) || [];
        for (var j = 0; j < lots.length; j++) {
          var lot = lots[j];
          if (!lot) continue;
          var onHand = num(lot.onHand);
          if (onHand <= 0) continue;
          var cost = round2(lot.cost);
          var costVal = round2(onHand * num(lot.cost));
          var sellPrice = round2(num(lot.price) > 0 ? lot.price : p.price);
          totalQty += onHand;
          totalCost += costVal;
          rows.push([
            p.name || '', code(p.barcode), lot.lot || '', lot.expiry || '',
            round2(onHand), cost, costVal, sellPrice
          ]);
        }
      }
    }
    rows.push(['الإجمالي', '', '', '', round2(totalQty), '', round2(totalCost), '']);
    return rows;
  }

  function code(v) { return { code: v == null ? '' : String(v) }; }

  function formatCell(val) {
    var s;
    if (val && typeof val === 'object' && 'code' in val) {
      s = /^\d+$/.test(val.code) ? '\t' + val.code : val.code;
      if (!/^\t\d+$/.test(s) && /^\s*[=+\-@]|^[\t\r\n]/.test(s)) s = "'" + s;
    } else if (val === null || val === undefined) {
      s = '';
    } else if (typeof val === 'number') {
      s = isFinite(val) ? String(val) : '';
    } else {
      s = String(val);
      if (/^\s*[=+\-@]|^[\t\r\n]/.test(s)) s = "'" + s;
    }
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function toCsv(rows) {
    var lines = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || [];
      var cells = [];
      for (var j = 0; j < row.length; j++) cells.push(formatCell(row[j]));
      lines.push(cells.join(','));
    }
    return '\uFEFF' + lines.join('\r\n');
  }

  function downloadCsv(filename, csv) {
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function runGuarded(fn) {
    if (!window.novaAuthUI || typeof window.novaAuthUI.allow !== 'function' || !window.novaAuthUI.allow('data.export')) return;
    if (window.novaAuthUI && typeof window.novaAuthUI.guard === 'function') {
      window.novaAuthUI.guard(fn);
    } else {
      fn();
    }
  }

  function makeDateField(labelText, defaultVal) {
    var wrap = document.createElement('label');
    wrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#e6edf3;';
    var span = document.createElement('span');
    span.textContent = labelText;
    var input = document.createElement('input');
    input.type = 'date';
    input.value = defaultVal;
    input.style.cssText = 'background:#0d1117;color:#e6edf3;border:1px solid #343b44;border-radius:6px;padding:4px 8px;font-size:13px;';
    wrap.appendChild(span);
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  }

  function buildCard() {
    var en = isEn();
    var card = document.createElement('section');
    card.id = 'novaExcelExport';
    card.dir = en ? 'ltr' : 'rtl';
    card.style.cssText = 'margin-top:16px;padding:14px 16px;background:#14181d;border:1px solid #343b44;border-radius:10px;color:#e6edf3;';

    var title = document.createElement('h3');
    title.textContent = en ? 'Export to Excel' : 'تصدير لإكسل';
    title.style.cssText = 'margin:0 0 12px 0;font-size:15px;color:#79c9eb;';
    card.appendChild(title);

    var controls = document.createElement('div');
    controls.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:10px;';

    var fromField = makeDateField(en ? 'From' : 'من', firstOfMonthIso());
    var toField = makeDateField(en ? 'To' : 'إلى', todayIso());
    controls.appendChild(fromField.wrap);
    controls.appendChild(toField.wrap);

    var btns = document.createElement('div');
    btns.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';

    function addBtn(label, key, handler) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-secondary';
      b.setAttribute('data-export', key);
      b.textContent = label;
      b.addEventListener('click', function () { runGuarded(handler); });
      btns.appendChild(b);
    }

    addBtn(en ? 'Sales lines' : 'المبيعات', 'sales', function () {
      downloadCsv('nova-rx-sales-' + todayIso() + '.csv',
        toCsv(salesRows(fromField.input.value, toField.input.value)));
    });
    addBtn(en ? 'Invoices summary' : 'ملخص الفواتير', 'invoices', function () {
      downloadCsv('nova-rx-invoices-' + todayIso() + '.csv',
        toCsv(invoiceRows(fromField.input.value, toField.input.value)));
    });
    addBtn(en ? 'Stock' : 'المخزون', 'stock', function () {
      downloadCsv('nova-rx-stock-' + todayIso() + '.csv', toCsv(stockRows()));
    });

    controls.appendChild(btns);
    card.appendChild(controls);
    return card;
  }

  function ensure() {
    var view = document.getElementById('novaPageView');
    if (!view) return;
    if (!document.querySelector('.nova-tab.active[data-page="reports"],.nova-hostmark.active[data-page="reports"]')) return;
    if (document.getElementById('novaExcelExport')) return;
    view.appendChild(buildCard());
  }

  function init() {
    var view = document.getElementById('novaPageView');
    if (view && typeof MutationObserver === 'function') {
      new MutationObserver(ensure).observe(view, { childList: true });
    }
    ensure();
  }

  window.novaExcelExport = {
    salesRows: salesRows,
    invoiceRows: invoiceRows,
    stockRows: stockRows,
    toCsv: toCsv
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
