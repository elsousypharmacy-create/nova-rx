/* app/578-profit-slow.js — #125 Profit per item/day & #126 Slow-moving stock */
(function () {
  'use strict';

  var CARD_ID = 'novaProfitSlow';
  var STYLE_ID = 'novaProfitSlowStyle';
  var state = {
    tab: 'profit',
    period: 'month',
    fromDate: '',
    toDate: '',
    showAll: false,
    slowDays: 60
  };
  var observer = null;
  var ensuring = false;

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

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function fmtMoney(n) {
    var val = round2(n).toFixed(2);
    return isEn() ? (val + ' EGP') : (val + ' ج.م');
  }

  function fmtPct(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return round2(n).toFixed(1) + '%';
  }

  function pad2(n) {
    return n < 10 ? ('0' + n) : String(n);
  }

  function toDayStr(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseLocalDayStart(str) {
    var p = String(str || '').split('-');
    if (p.length !== 3) return NaN;
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 0, 0, 0, 0).getTime();
  }

  function parseLocalDayEnd(str) {
    var p = String(str || '').split('-');
    if (p.length !== 3) return NaN;
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 23, 59, 59, 999).getTime();
  }

  function getPeriodRange() {
    var now = new Date();
    var end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
    var start;
    if (state.period === 'today') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    } else if (state.period === '7d') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0).getTime();
    } else if (state.period === 'custom') {
      var s = parseLocalDayStart(state.fromDate);
      var e = parseLocalDayEnd(state.toDate);
      start = isNaN(s) ? new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime() : s;
      end = isNaN(e) ? end : e;
    } else {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
    }
    if (start > end) { var tmp = start; start = new Date(new Date(end).setHours(0, 0, 0, 0)).getTime(); end = new Date(new Date(tmp).setHours(23, 59, 59, 999)).getTime(); }
    return { fromMs: start, toMs: end };
  }

  function getSalesList() {
    var list = (window.novaSales && typeof window.novaSales.list === 'function')
      ? window.novaSales.list()
      : null;
    if (Array.isArray(list) && list.length > 0) return list;
    try {
      var raw = window.localStorage && window.localStorage.getItem('nova-rx-sales-v1');
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function isSaleCancelled(id) {
    if (!window.novaSales || typeof window.novaSales.isCancelled !== 'function') return false;
    return !!window.novaSales.isCancelled(id);
  }

  function getReturnedMap(saleId) {
    if (!window.novaSales || typeof window.novaSales.returnedQty !== 'function') return {};
    var m = window.novaSales.returnedQty(saleId);
    return (m && typeof m === 'object') ? m : {};
  }

  function computeLineCost(line) {
    if (!line || !Array.isArray(line.lots) || line.lots.length === 0) {
      return { known: false, cost: 0 };
    }
    var sum = 0;
    var i, l, q, c;
    for (i = 0; i < line.lots.length; i++) {
      l = line.lots[i];
      if (!l || l.cost === undefined || l.cost === null || isNaN(Number(l.cost)) || Number(l.cost) <= 0) { // cost 0 = not entered at receiving
        return { known: false, cost: 0 };
      }
      q = Number(l.qty) || 0;
      c = Number(l.cost) || 0;
      sum += q * c;
    }
    return { known: true, cost: sum };
  }

  function profit(fromMs, toMs) {
    var sales = getSalesList();
    var totalRev = 0;
    var totalCost = 0;
    var knownRev = 0;
    var knownCost = 0;
    var itemMap = {};
    var dayMap = {};
    var sIdx, sale, atMs, lines, rawRevs, saleRawRev, invDisc, retMap;
    var lIdx, line, origQty, rawRev, discShare, netRev, retQty, ratio, effQty, effRev, costInfo, effCost;
    var itemKey, it, dayStr, dObj;

    for (sIdx = 0; sIdx < sales.length; sIdx++) {
      sale = sales[sIdx];
      if (!sale || isSaleCancelled(sale.id)) continue;
      atMs = typeof sale.at === 'number' ? sale.at : Date.parse(sale.at || sale.createdAt || sale.date);
      if (isNaN(atMs)) continue;
      if (typeof fromMs === 'number' && !isNaN(fromMs) && atMs < fromMs) continue;
      if (typeof toMs === 'number' && !isNaN(toMs) && atMs > toMs) continue;

      lines = Array.isArray(sale.lines) ? sale.lines : [];
      rawRevs = [];
      saleRawRev = 0;
      for (lIdx = 0; lIdx < lines.length; lIdx++) {
        line = lines[lIdx] || {};
        rawRev = Math.max(0, (Number(line.qty) || 0) * (Number(line.price) || 0) - (Number(line.discount) || 0));
        rawRevs.push(rawRev);
        saleRawRev += rawRev;
      }

      invDisc = Math.max(0, Number(sale.discount) || 0);
      retMap = getReturnedMap(sale.id);
      dayStr = toDayStr(new Date(atMs));
      if (!dayMap[dayStr]) {
        dayMap[dayStr] = { day: dayStr, revenue: 0, profit: 0 };
      }
      dObj = dayMap[dayStr];

      for (lIdx = 0; lIdx < lines.length; lIdx++) {
        line = lines[lIdx] || {};
        origQty = Number(line.qty) || 0;
        rawRev = rawRevs[lIdx];
        discShare = (invDisc > 0 && saleRawRev > 0) ? (rawRev / saleRawRev) * invDisc : 0;
        netRev = Math.max(0, rawRev - discShare);
        retQty = Number(retMap[lIdx]) || 0;
        ratio = origQty > 0 ? Math.max(0, (origQty - retQty) / origQty) : 0;
        effQty = Math.max(0, origQty - retQty);
        if (effQty <= 0) continue;

        effRev = netRev * ratio;
        costInfo = computeLineCost(line);
        effCost = costInfo.known ? (costInfo.cost * ratio) : 0;

        totalRev += effRev;
        totalCost += effCost;
        if (costInfo.known) {
          knownRev += effRev;
          knownCost += effCost;
        }

        itemKey = (line.barcode && String(line.barcode).trim())
          ? ('bc:' + String(line.barcode).trim())
          : ('nm:' + String(line.name || '').trim());
        if (!itemMap[itemKey]) {
          itemMap[itemKey] = {
            name: String(line.name || line.barcode || '—'),
            qty: 0,
            revenue: 0,
            cost: 0,
            knownRev: 0,
            knownCost: 0,
            costMissing: false
          };
        }
        it = itemMap[itemKey];
        it.qty += line.unit === 'strip' && Number(line.unitFactor) > 1 ? effQty / Number(line.unitFactor) : effQty;
        it.revenue += effRev;
        it.cost += effCost;
        if (costInfo.known) {
          it.knownRev += effRev;
          it.knownCost += effCost;
        } else {
          it.costMissing = true;
        }

        dObj.revenue += effRev;
        if (costInfo.known) dObj.profit += (effRev - effCost);
      }
    }

    var items = [];
    var k;
    for (k in itemMap) {
      if (!Object.prototype.hasOwnProperty.call(itemMap, k)) continue;
      it = itemMap[k];
      var iProfit = it.knownRev - it.knownCost;
      var iMargin = it.costMissing ? null : (it.knownRev > 0 ? round2(((it.knownRev - it.knownCost) / it.knownRev) * 100) : 0);
      items.push({
        name: it.name,
        qty: round2(it.qty),
        revenue: round2(it.revenue),
        cost: round2(it.cost),
        profit: round2(iProfit),
        marginPct: iMargin,
        costMissing: it.costMissing
      });
    }
    items.sort(function (a, b) {
      return b.profit - a.profit;
    });

    var days = [];
    for (k in dayMap) {
      if (!Object.prototype.hasOwnProperty.call(dayMap, k)) continue;
      days.push({
        day: dayMap[k].day,
        revenue: round2(dayMap[k].revenue),
        profit: round2(dayMap[k].profit)
      });
    }
    days.sort(function (a, b) {
      return a.day < b.day ? 1 : (a.day > b.day ? -1 : 0);
    });

    var totalProfit = knownRev - knownCost;
    var marginPct = knownRev > 0 ? round2(((knownRev - knownCost) / knownRev) * 100) : null;

    return {
      revenue: round2(totalRev),
      cost: round2(totalCost),
      profit: round2(totalProfit),
      marginPct: marginPct,
      items: items,
      days: days
    };
  }

  function slow(days) {
    var winDays = Number(days) || 60;
    var nowMs = Date.now();
    var cutoffMs = nowMs - winDays * 86400000;
    var sales = getSalesList();
    var lastByBc = {};
    var lastByName = {};
    var sIdx, sale, atMs, lines, retMap, lIdx, line, origQty, retQty, bc, nm;

    for (sIdx = 0; sIdx < sales.length; sIdx++) {
      sale = sales[sIdx];
      if (!sale || isSaleCancelled(sale.id)) continue;
      atMs = Date.parse(sale.at);
      if (isNaN(atMs)) continue;
      lines = Array.isArray(sale.lines) ? sale.lines : [];
      retMap = getReturnedMap(sale.id);
      for (lIdx = 0; lIdx < lines.length; lIdx++) {
        line = lines[lIdx] || {};
        origQty = Number(line.qty) || 0;
        retQty = Number(retMap[lIdx]) || 0;
        if (origQty - retQty <= 0) continue;
        bc = line.barcode ? String(line.barcode).trim() : '';
        nm = line.name ? String(line.name).trim().toLowerCase() : '';
        if (bc && (!lastByBc[bc] || atMs > lastByBc[bc])) {
          lastByBc[bc] = atMs;
        }
        if (nm && (!lastByName[nm] || atMs > lastByName[nm])) {
          lastByName[nm] = atMs;
        }
      }
    }

    var products = (window.NOVA_DEMO && Array.isArray(window.NOVA_DEMO.products)) ? window.NOVA_DEMO.products : [];
    var stock = window.novaStock;
    var items = [];
    var totalCostValue = 0;
    var pIdx, prod, key, lots, onHand, costVal, nearestExp, i, l, oh, c, exp, lastMs;

    if (stock && typeof stock.keyOf === 'function' && typeof stock.lots === 'function') {
      for (pIdx = 0; pIdx < products.length; pIdx++) {
        prod = products[pIdx];
        if (!prod) continue;
        key = stock.keyOf(prod);
        if (typeof stock.hasLots === 'function' && !stock.hasLots(key)) continue;
        lots = stock.lots(key);
        if (!Array.isArray(lots) || lots.length === 0) continue;

        onHand = 0;
        costVal = 0;
        nearestExp = null;
        for (i = 0; i < lots.length; i++) {
          l = lots[i];
          if (!l) continue;
          oh = Number(l.onHand) || 0;
          if (oh <= 0) continue;
          c = Number(l.cost) || 0;
          onHand += oh;
          costVal += oh * c;
          exp = l.expiry ? String(l.expiry) : '';
          if (exp && (!nearestExp || exp < nearestExp)) {
            nearestExp = exp;
          }
        }
        if (onHand <= 0) continue;

        bc = prod.barcode ? String(prod.barcode).trim() : '';
        nm = prod.name ? String(prod.name).trim().toLowerCase() : '';
        lastMs = (bc && lastByBc[bc]) ? lastByBc[bc] : (nm && lastByName[nm] ? lastByName[nm] : null);

        if (lastMs !== null && lastMs >= cutoffMs) continue;

        totalCostValue += costVal;
        items.push({
          name: String(prod.name || prod.barcode || '—'),
          onHand: round2(onHand),
          costValue: round2(costVal),
          lastSale: lastMs !== null ? toDayStr(new Date(lastMs)) : null,
          nearestExpiry: nearestExp
        });
      }
    }

    items.sort(function (a, b) {
      return b.costValue - a.costValue;
    });

    return {
      items: items,
      totalCostValue: round2(totalCostValue)
    };
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '#novaProfitSlow{background:#14181d;border:1px solid #343b44;border-radius:10px;padding:16px;margin-top:16px;color:#e6edf3;box-sizing:border-box;max-width:100%;}' +
      '#novaProfitSlow .nps-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;border-bottom:1px solid #343b44;padding-bottom:10px;}' +
      '#novaProfitSlow .nps-title{font-size:16px;font-weight:700;margin:0;color:#e6edf3;}' +
      '#novaProfitSlow .nps-tabs{display:flex;gap:8px;}' +
      '#novaProfitSlow .nps-tab-active{border-color:#79c9eb!important;color:#79c9eb!important;}' +
      '#novaProfitSlow .nps-controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:14px;}' +
      '#novaProfitSlow select,#novaProfitSlow input[type="date"]{background:#14181d;color:#e6edf3;border:1px solid #343b44;border-radius:6px;padding:6px 10px;font-size:13px;}' +
      '#novaProfitSlow .nps-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px;}' +
      '#novaProfitSlow .nps-kpi{background:#14181d;border:1px solid #343b44;border-radius:8px;padding:10px 12px;}' +
      '#novaProfitSlow .nps-kpi-lbl{font-size:12px;color:#9aa7b4;margin-bottom:4px;}' +
      '#novaProfitSlow .nps-kpi-val{font-size:16px;font-weight:700;color:#79c9eb;}' +
      '#novaProfitSlow .nps-sub{font-size:14px;font-weight:600;margin:14px 0 8px;color:#e6edf3;}' +
      '#novaProfitSlow .nps-wrap{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid #343b44;border-radius:8px;}' +
      '#novaProfitSlow table{width:100%;border-collapse:collapse;min-width:520px;font-size:13px;}' +
      '#novaProfitSlow th,#novaProfitSlow td{padding:8px 10px;border-bottom:1px solid #343b44;text-align:start;white-space:nowrap;}' +
      '#novaProfitSlow th{color:#79c9eb;font-weight:600;background:#14181d;}' +
      '#novaProfitSlow tr:last-child td{border-bottom:none;}' +
      '#novaProfitSlow .nps-badge{display:inline-block;margin-inline-start:6px;padding:2px 6px;font-size:11px;border-radius:4px;border:1px solid #79c9eb;color:#79c9eb;}' +
      '#novaProfitSlow .nps-total-row td{font-weight:700;color:#79c9eb;border-top:2px solid #343b44;}' +
      '#novaProfitSlow .nps-empty{padding:14px;text-align:center;color:#9aa7b4;}' +
      '#novaProfitSlow .nps-more{margin-top:10px;}';
    document.head.appendChild(style);
  }

  function renderProfitTab(body) {
    var controls = el('div', 'nps-controls');
    var sel = el('select');
    var opts = [
      { v: 'today', ar: 'اليوم', en: 'Today' },
      { v: '7d', ar: 'آخر 7 أيام', en: 'Last 7 days' },
      { v: 'month', ar: 'الشهر ده', en: 'This month' },
      { v: 'custom', ar: 'من…إلى', en: 'Custom range' }
    ];
    var i, o;
    for (i = 0; i < opts.length; i++) {
      o = el('option', '', t(opts[i].ar, opts[i].en));
      o.value = opts[i].v;
      if (state.period === opts[i].v) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', function () {
      state.period = sel.value;
      state.showAll = false;
      renderCard();
    });
    controls.appendChild(sel);

    if (state.period === 'custom') {
      var todayStr = toDayStr(new Date());
      if (!state.fromDate) state.fromDate = todayStr;
      if (!state.toDate) state.toDate = todayStr;

      var fromIn = el('input');
      fromIn.type = 'date';
      fromIn.value = state.fromDate;
      fromIn.addEventListener('change', function () {
        state.fromDate = fromIn.value;
        state.showAll = false;
        renderCard();
      });

      var toIn = el('input');
      toIn.type = 'date';
      toIn.value = state.toDate;
      toIn.addEventListener('change', function () {
        state.toDate = toIn.value;
        state.showAll = false;
        renderCard();
      });

      controls.appendChild(fromIn);
      controls.appendChild(toIn);
    }
    body.appendChild(controls);

    var range = getPeriodRange();
    var data = profit(range.fromMs, range.toMs);

    var kpis = el('div', 'nps-kpis');
    var kpiList = [
      { l: t('إجمالي المبيعات', 'Total Sales'), v: fmtMoney(data.revenue) },
      { l: t('التكلفة', 'Cost'), v: fmtMoney(data.cost) },
      { l: t('مجمل الربح', 'Gross Profit'), v: fmtMoney(data.profit) },
      { l: t('هامش الربح %', 'Profit Margin %'), v: fmtPct(data.marginPct) }
    ];
    for (i = 0; i < kpiList.length; i++) {
      var kBox = el('div', 'nps-kpi');
      kBox.appendChild(el('div', 'nps-kpi-lbl', kpiList[i].l));
      kBox.appendChild(el('div', 'nps-kpi-val', kpiList[i].v));
      kpis.appendChild(kBox);
    }
    body.appendChild(kpis);

    body.appendChild(el('div', 'nps-sub', t('الربح لكل صنف', 'Profit by Item')));
    var wrap1 = el('div', 'nps-wrap');
    var tbl1 = el('table');
    var thead1 = el('thead');
    var hr1 = el('tr');
    var h1 = [
      t('الصنف', 'Item'),
      t('الكمية', 'Qty'),
      t('المبيعات', 'Sales'),
      t('التكلفة', 'Cost'),
      t('الربح', 'Profit'),
      t('الهامش %', 'Margin %')
    ];
    for (i = 0; i < h1.length; i++) hr1.appendChild(el('th', '', h1[i]));
    thead1.appendChild(hr1);
    tbl1.appendChild(thead1);

    var tbody1 = el('tbody');
    var limit = state.showAll ? data.items.length : Math.min(50, data.items.length);
    if (limit === 0) {
      var er1 = el('tr');
      var ec1 = el('td', 'nps-empty', t('لا توجد مبيعات في هذه الفترة', 'No sales in this period'));
      ec1.colSpan = 6;
      er1.appendChild(ec1);
      tbody1.appendChild(er1);
    } else {
      for (i = 0; i < limit; i++) {
        var it = data.items[i];
        var tr = el('tr');
        var nameTd = el('td', '', it.name);
        if (it.costMissing) {
          nameTd.appendChild(el('span', 'nps-badge', t('تكلفة ناقصة', 'Missing cost')));
        }
        tr.appendChild(nameTd);
        tr.appendChild(el('td', '', it.qty));
        tr.appendChild(el('td', '', fmtMoney(it.revenue)));
        tr.appendChild(el('td', '', fmtMoney(it.cost)));
        tr.appendChild(el('td', '', fmtMoney(it.profit)));
        tr.appendChild(el('td', '', fmtPct(it.marginPct)));
        tbody1.appendChild(tr);
      }
    }
    tbl1.appendChild(tbody1);
    wrap1.appendChild(tbl1);
    body.appendChild(wrap1);

    if (!state.showAll && data.items.length > 50) {
      var moreBtn = el('button', 'btn btn-secondary nps-more', t('عرض الكل', 'Show all'));
      moreBtn.type = 'button';
      moreBtn.addEventListener('click', function () {
        state.showAll = true;
        renderCard();
      });
      body.appendChild(moreBtn);
    }

    body.appendChild(el('div', 'nps-sub', t('الربح لكل يوم', 'Profit by Day')));
    var wrap2 = el('div', 'nps-wrap');
    var tbl2 = el('table');
    var thead2 = el('thead');
    var hr2 = el('tr');
    var h2 = [t('التاريخ', 'Date'), t('المبيعات', 'Sales'), t('الربح', 'Profit')];
    for (i = 0; i < h2.length; i++) hr2.appendChild(el('th', '', h2[i]));
    thead2.appendChild(hr2);
    tbl2.appendChild(thead2);

    var tbody2 = el('tbody');
    if (data.days.length === 0) {
      var er2 = el('tr');
      var ec2 = el('td', 'nps-empty', t('لا توجد بيانات يومية', 'No daily data'));
      ec2.colSpan = 3;
      er2.appendChild(ec2);
      tbody2.appendChild(er2);
    } else {
      for (i = 0; i < data.days.length; i++) {
        var d = data.days[i];
        var dtr = el('tr');
        dtr.appendChild(el('td', '', d.day));
        dtr.appendChild(el('td', '', fmtMoney(d.revenue)));
        dtr.appendChild(el('td', '', fmtMoney(d.profit)));
        tbody2.appendChild(dtr);
      }
    }
    tbl2.appendChild(tbody2);
    wrap2.appendChild(tbl2);
    body.appendChild(wrap2);
  }

  function renderSlowTab(body) {
    var controls = el('div', 'nps-controls');
    controls.appendChild(el('span', '', t('مالهوش بيع من', 'No sales for')));
    var sel = el('select');
    var dayOpts = [30, 60, 90, 180];
    var i, o;
    for (i = 0; i < dayOpts.length; i++) {
      o = el('option', '', dayOpts[i] + ' ' + t('يوم', 'days'));
      o.value = String(dayOpts[i]);
      if (state.slowDays === dayOpts[i]) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', function () {
      state.slowDays = Number(sel.value) || 60;
      renderCard();
    });
    controls.appendChild(sel);
    body.appendChild(controls);

    var data = slow(state.slowDays);
    var wrap = el('div', 'nps-wrap');
    var tbl = el('table');
    var thead = el('thead');
    var hr = el('tr');
    var headers = [
      t('الصنف', 'Item'),
      t('الكمية في المخزن', 'In Stock'),
      t('قيمة التكلفة', 'Cost Value'),
      t('آخر بيع', 'Last Sale'),
      t('أقرب صلاحية', 'Nearest Expiry')
    ];
    for (i = 0; i < headers.length; i++) hr.appendChild(el('th', '', headers[i]));
    thead.appendChild(hr);
    tbl.appendChild(thead);

    var tbody = el('tbody');
    if (data.items.length === 0) {
      var er = el('tr');
      var ec = el('td', 'nps-empty', t('لا توجد أصناف راكدة', 'No slow-moving items'));
      ec.colSpan = 5;
      er.appendChild(ec);
      tbody.appendChild(er);
    } else {
      for (i = 0; i < data.items.length; i++) {
        var it = data.items[i];
        var tr = el('tr');
        tr.appendChild(el('td', '', it.name));
        tr.appendChild(el('td', '', it.onHand));
        tr.appendChild(el('td', '', fmtMoney(it.costValue)));
        tr.appendChild(el('td', '', it.lastSale ? it.lastSale : t('ما اتباعش', 'Never sold')));
        tr.appendChild(el('td', '', it.nearestExpiry ? it.nearestExpiry : '—'));
        tbody.appendChild(tr);
      }
    }

    var totTr = el('tr', 'nps-total-row');
    totTr.appendChild(el('td', '', t('فلوس نايمة على الرف', 'Idle shelf value')));
    totTr.appendChild(el('td', '', ''));
    totTr.appendChild(el('td', '', fmtMoney(data.totalCostValue)));
    totTr.appendChild(el('td', '', ''));
    totTr.appendChild(el('td', '', ''));
    tbody.appendChild(totTr);

    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    body.appendChild(wrap);
  }

  function renderCard() {
    var card = document.getElementById(CARD_ID);
    if (!card) return;
    while (card.firstChild) card.removeChild(card.firstChild);

    var head = el('div', 'nps-head');
    head.appendChild(el('h3', 'nps-title', t('تقرير الربح والأصناف الراكدة', 'Profit & Slow-Moving Stock')));

    var tabs = el('div', 'nps-tabs');
    var bProfit = el('button', 'btn btn-secondary' + (state.tab === 'profit' ? ' nps-tab-active' : ''), t('الربح', 'Profit'));
    bProfit.type = 'button';
    bProfit.setAttribute('data-nps-tab', 'profit');
    bProfit.addEventListener('click', function () {
      state.tab = 'profit';
      renderCard();
    });

    var bSlow = el('button', 'btn btn-secondary' + (state.tab === 'slow' ? ' nps-tab-active' : ''), t('الراكد', 'Slow-Moving'));
    bSlow.type = 'button';
    bSlow.setAttribute('data-nps-tab', 'slow');
    bSlow.addEventListener('click', function () {
      state.tab = 'slow';
      renderCard();
    });

    tabs.appendChild(bProfit);
    tabs.appendChild(bSlow);
    head.appendChild(tabs);
    card.appendChild(head);

    var body = el('div', 'nps-body');
    if (state.tab === 'slow') {
      renderSlowTab(body);
    } else {
      renderProfitTab(body);
    }
    card.appendChild(body);
  }

  function ensure() {
    if (ensuring) return;
    var activeReports = document.querySelector('.nova-tab.active[data-page="reports"],.nova-hostmark.active[data-page="reports"]');
    if (!activeReports) return;
    var pageView = document.getElementById('novaPageView');
    if (!pageView) return;
    if (document.getElementById(CARD_ID)) return;

    ensuring = true;
    try {
      injectStyles();
      var card = el('section');
      card.id = CARD_ID;
      pageView.appendChild(card);
      renderCard();
    } finally {
      ensuring = false;
    }
  }

  function initObserver() {
    var pageView = document.getElementById('novaPageView');
    if (!pageView || observer) return;
    observer = new MutationObserver(function () {
      ensure();
    });
    observer.observe(pageView, { childList: true });
    ensure();
  }

  window.novaProfitSlow = {
    profit: profit,
    slow: slow
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initObserver);
  } else {
    initObserver();
  }
})();
