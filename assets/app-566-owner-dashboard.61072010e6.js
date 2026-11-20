/* NOVA Rx — ODASH-01 (#55) «لوحة المالك» at the top of the reports page. Reviewed Gemini Neon draft, integrated by Claude; lazy. */
/* NOVA Rx — Owner Dashboard (#55) «لوحة المالك»
 * Vanilla JS, RTL Arabic (Egyptian), Western digits, READ-ONLY, no template literals.
 */
(function () {
  'use strict';

  var SECTION_ID = 'novaOwnerDashboardSection';
  var STYLE_ID = 'novaOwnerDashboardStyles';
  var DAY_MS = 86400000;
  var HOUR_MS = 3600000;
  var NEAR_EXPIRY_DAYS = 90;

  var observer = null;
  var isMounting = false;

  function safeReadJSON(key) {
    try {
      var raw = window.localStorage.getItem(key);
      if (raw === null || raw === undefined || raw === '') return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function toMs(val) {
    if (typeof val === 'number' && isFinite(val)) return val;
    if (typeof val === 'string' && val.trim() !== '') {
      var num = Number(val);
      if (isFinite(num) && num > 100000000000) return num;
      var dm = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(val.trim());
      if (dm) return dm[3] ? new Date(+dm[1], +dm[2] - 1, +dm[3]).getTime() : new Date(+dm[1], +dm[2], 0, 23, 59, 59, 999).getTime();
      var parsed = Date.parse(val);
      if (isFinite(parsed)) return parsed;
    }
    return NaN;
  }

  function toNum(val) {
    if (typeof val === 'number' && isFinite(val)) return val;
    if (typeof val === 'string' && val.trim() !== '') {
      var n = Number(val);
      if (isFinite(n)) return n;
    }
    return NaN;
  }

  function dayRange(nowMs, offsetDays) {
    var d = new Date(nowMs);
    var start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetDays).getTime();
    var end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetDays + 1).getTime();
    return { start: start, end: end };
  }

  function inRange(ms, range) {
    return isFinite(ms) && ms >= range.start && ms < range.end;
  }

  function fmtMoney(val) {
    if (val === null || val === undefined || !isFinite(val)) return '—';
    return Number(val).toFixed(2) + ' ج.م';
  }

  function fmtInt(val) {
    if (val === null || val === undefined || !isFinite(val)) return '—';
    return String(Math.round(val));
  }

  function fmtPct(val) {
    if (val === null || val === undefined || !isFinite(val)) return '—';
    var sign = val > 0 ? '+' : '';
    return sign + Number(val).toFixed(1) + '%';
  }

  function fmtAge(ageMs) {
    if (ageMs === null || ageMs === undefined || !isFinite(ageMs) || ageMs < 0) return '—';
    if (ageMs < HOUR_MS) {
      var mins = Math.max(1, Math.floor(ageMs / 60000));
      return 'منذ ' + mins + ' د';
    }
    if (ageMs < DAY_MS) {
      var hrs = Math.floor(ageMs / HOUR_MS);
      return 'منذ ' + hrs + ' س';
    }
    var days = Math.floor(ageMs / DAY_MS);
    return 'منذ ' + days + ' يوم';
  }

  function getProductsList() {
    try {
      if (window.novaCatalog && Array.isArray(window.novaCatalog.products)) {
        return window.novaCatalog.products;
      }
    } catch (e) {}
    try {
      if (window.NOVA_DEMO && Array.isArray(window.NOVA_DEMO.products)) {
        return window.NOVA_DEMO.products;
      }
    } catch (e) {}
    return null;
  }

  function computeSalesAndCash(nowMs) {
    var today = dayRange(nowMs, 0);
    var lastWeek = dayRange(nowMs, -7);

    var hasSalesApi = !!(window.novaSales && typeof window.novaSales.list === 'function');
    var sales = [];
    var returns = [];

    if (hasSalesApi) {
      try {
        var sList = window.novaSales.list();
        if (Array.isArray(sList)) sales = sList;
      } catch (e) {
        hasSalesApi = false;
      }
    }

    if (window.novaSales && typeof window.novaSales.returns === 'function') {
      try {
        var rList = window.novaSales.returns();
        if (Array.isArray(rList)) returns = rList;
      } catch (e) {}
    }

    var cashOutsRaw = safeReadJSON('nova-rx-cash-out-v1');
    var hasCashOutStore = Array.isArray(cashOutsRaw);
    var cashOuts = hasCashOutStore ? cashOutsRaw : [];

    var salesById = {};
    var i;
    for (i = 0; i < sales.length; i++) {
      var s = sales[i];
      if (s && s.id !== undefined && s.id !== null) {
        salesById[String(s.id)] = s;
      }
    }

    var salesTodayGross = 0;
    var invoicesToday = 0;
    var cashSalesToday = 0;
    var salesLastWeekGross = 0;

    for (i = 0; i < sales.length; i++) {
      var sale = sales[i];
      if (!sale) continue;
      var sAt = toMs(sale.at);
      var sTotal = toNum(sale.total);
      if (!isFinite(sTotal)) sTotal = 0;

      if (inRange(sAt, today)) {
        salesTodayGross += sTotal;
        invoicesToday += 1;
        if (sale.payment === 'cash') {
          cashSalesToday += sTotal;
        }
      } else if (inRange(sAt, lastWeek)) {
        salesLastWeekGross += sTotal;
      }
    }

    var returnsToday = 0;
    var cashRefundsToday = 0;
    var returnsLastWeek = 0;

    for (i = 0; i < returns.length; i++) {
      var ret = returns[i];
      if (!ret) continue;
      var linkedSale = ret.saleId !== undefined && ret.saleId !== null ? salesById[String(ret.saleId)] : null;
      var rAt = toMs(ret.at !== undefined ? ret.at : (linkedSale ? linkedSale.at : NaN));
      var rAmt = toNum(ret.amount);
      if (!isFinite(rAmt)) rAmt = 0;

      if (inRange(rAt, today)) {
        returnsToday += rAmt;
        if (linkedSale && linkedSale.payment === 'cash') {
          cashRefundsToday += rAmt;
        }
      } else if (inRange(rAt, lastWeek)) {
        returnsLastWeek += rAmt;
      }
    }

    var cashOutsToday = 0;
    for (i = 0; i < cashOuts.length; i++) {
      var co = cashOuts[i];
      if (!co) continue;
      var coAt = toMs(co.at);
      var coAmt = toNum(co.amount);
      if (inRange(coAt, today) && isFinite(coAmt)) {
        cashOutsToday += coAmt;
      }
    }

    var netToday = hasSalesApi ? (salesTodayGross - returnsToday) : null;
    var netLastWeek = hasSalesApi ? (salesLastWeekGross - returnsLastWeek) : null;
    var vsLastWeekPct = null;
    if (hasSalesApi && isFinite(netLastWeek) && netLastWeek > 0) {
      vsLastWeekPct = ((netToday - netLastWeek) / netLastWeek) * 100;
    }

    var expectedCash = (hasSalesApi || hasCashOutStore)
      ? (cashSalesToday - cashRefundsToday - cashOutsToday)
      : null;

    return {
      salesToday: {
        available: hasSalesApi,
        net: netToday,
        invoices: hasSalesApi ? invoicesToday : null,
        vsLastWeekPct: vsLastWeekPct
      },
      cashDrawer: {
        available: hasSalesApi || hasCashOutStore,
        expected: expectedCash,
        cashSales: cashSalesToday,
        cashRefunds: cashRefundsToday,
        cashOuts: cashOutsToday
      }
    };
  }

  function computeCredit() {
    if (!(window.NovaCredit && typeof window.NovaCredit.createCreditLedger === 'function')) {
      return { available: false, totalOutstanding: null, overdue: null };
    }
    try {
      var ledger = window.NovaCredit.createCreditLedger(window.localStorage, 'nova.credit');
      if (!ledger) return { available: false, totalOutstanding: null, overdue: null };

      var total = typeof ledger.totalOutstanding === 'function' ? toNum(ledger.totalOutstanding()) : NaN;
      var overdue = 0;
      var customers = typeof ledger.customers === 'function' ? ledger.customers() : [];

      if (Array.isArray(customers) && typeof ledger.aging === 'function') {
        for (var i = 0; i < customers.length; i++) {
          var c = customers[i];
          if (!c || c.customerId === undefined || c.customerId === null) continue;
          var ag = ledger.aging(c.customerId);
          if (!ag) continue;
          overdue += (toNum(ag.d1_30) || 0)
            + (toNum(ag.d31_60) || 0)
            + (toNum(ag.d61_90) || 0)
            + (toNum(ag.d90_plus) || 0);
        }
      }

      return {
        available: isFinite(total),
        totalOutstanding: isFinite(total) ? total : null,
        overdue: isFinite(total) ? overdue : null
      };
    } catch (e) {
      return { available: false, totalOutstanding: null, overdue: null };
    }
  }

  function computeSupplierDues() {
    var data = safeReadJSON('nova.supplierAccounts');
    if (!data || !Array.isArray(data.moves)) {
      return { available: false, total: null };
    }
    var reversed = {}, paid = {}, centsSum = 0, i, m;
    for (i = 0; i < data.moves.length; i++) { m = data.moves[i]; if (m && m.type === 'reversal' && m.target) reversed[m.target] = true; }
    for (i = 0; i < data.moves.length; i++) {
      m = data.moves[i];
      if (!m || reversed[m.id] || (m.type !== 'payment' && m.type !== 'credit') || !Array.isArray(m.allocations)) continue;
      m.allocations.forEach(function (a) { if (a && a.invoiceId) paid[a.invoiceId] = (paid[a.invoiceId] || 0) + (toNum(a.cents) || 0) + (toNum(a.discount) || 0); });
    }
    for (i = 0; i < data.moves.length; i++) {
      m = data.moves[i];
      if (!m || m.type !== 'invoice' || reversed[m.id]) continue;
      var c = toNum(m.cents);
      if (!isFinite(c)) continue;
      centsSum += Math.max(0, c - (paid[m.id] || 0));
    }
    return {
      available: true,
      total: centsSum / 100
    };
  }

  function computeInventory(nowMs) {
    var products = getProductsList();
    var hasStockApi = !!(window.novaStock && typeof window.novaStock.lots === 'function');

    var expCount = 0;
    var expiredCount = 0;
    var expValue = 0;
    var expAvailable = !!(products && hasStockApi);

    var lowCount = 0;
    var outCount = 0;
    var lowAvailable = false;

    if (Array.isArray(products)) {
      var nearThresholdMs = nowMs + (NEAR_EXPIRY_DAYS * DAY_MS);

      for (var i = 0; i < products.length; i++) {
        var p = products[i];
        if (!p) continue;

        var pStock = toNum(p.stock);
        if (isFinite(pStock)) {
          lowAvailable = true;
          if (pStock <= 0) {
            lowCount += 1;
            outCount += 1;
          } else if (pStock < 30) {
            lowCount += 1;
          }
        }

        if (hasStockApi) {
          var key = p.key || p.id || p.code || p.barcode || p.name;
          if (!key) continue;
          var lots = null;
          try {
            lots = window.novaStock.lots(key);
          } catch (e) {
            lots = null;
          }
          if (!Array.isArray(lots)) continue;

          for (var j = 0; j < lots.length; j++) {
            var lot = lots[j];
            if (!lot) continue;
            var onHand = toNum(lot.onHand !== undefined ? lot.onHand : lot.qty);
            if (!isFinite(onHand) || onHand <= 0) continue;

            var expMs = toMs(lot.exp || lot.expiry || lot.expiresAt);
            var isExpired = lot.expired === true || (isFinite(expMs) && expMs <= nowMs);
            var isNear = lot.nearExpiry === true || (!isExpired && isFinite(expMs) && expMs <= nearThresholdMs);

            if (isExpired || isNear) {
              expCount += 1;
              if (isExpired) expiredCount += 1;
              var unitCost = toNum(lot.cost);
              if (!isFinite(unitCost)) unitCost = toNum(p.cost);
              if (!isFinite(unitCost)) unitCost = 0;
              expValue += onHand * unitCost;
            }
          }
        }
      }
    }

    return {
      expiring: {
        available: expAvailable,
        count: expAvailable ? expCount : null,
        expiredCount: expAvailable ? expiredCount : null,
        valueAtCost: expAvailable ? expValue : null
      },
      lowStock: {
        available: lowAvailable,
        count: lowAvailable ? lowCount : null,
        outOfStock: lowAvailable ? outCount : null
      }
    };
  }

  function computeBackup(nowMs) {
    var data = safeReadJSON('nova-rx-last-backup-v1');
    if (!data) {
      return {
        available: false,
        at: null,
        ageMs: null,
        isRed: true,
        label: 'مفيش نسخة'
      };
    }
    var atMs = toMs(data.at);
    if (!isFinite(atMs)) {
      return {
        available: false,
        at: null,
        ageMs: null,
        isRed: true,
        label: 'مفيش نسخة'
      };
    }
    var ageMs = Math.max(0, nowMs - atMs);
    var isRed = ageMs > DAY_MS;
    return {
      available: true,
      at: atMs,
      ageMs: ageMs,
      isRed: isRed,
      label: fmtAge(ageMs)
    };
  }

  function computeShiftDiffToday(nowMs) {
    var closings = safeReadJSON('nova-rx-shift-closings-v1');
    if (!Array.isArray(closings)) return null;
    var today = dayRange(nowMs, 0);
    var totalDiff = 0;
    var found = false;
    for (var i = 0; i < closings.length; i++) {
      var c = closings[i];
      if (!c) continue;
      var atMs = toMs(c.at);
      if (!inRange(atMs, today)) continue;
      var diff = toNum(c.diff);
      if (!isFinite(diff)) {
        var counted = toNum(c.counted);
        var expected = toNum(c.expected);
        if (isFinite(counted) && isFinite(expected)) {
          diff = counted - expected;
        }
      }
      if (isFinite(diff)) {
        totalDiff += diff;
        found = true;
      }
    }
    return found ? totalDiff : null;
  }

  function compute(nowMs) {
    var ts = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
    var sc = computeSalesAndCash(ts);
    var credit = computeCredit();
    var suppliers = computeSupplierDues();
    var inv = computeInventory(ts);
    var backup = computeBackup(ts);
    var shiftDiffToday = computeShiftDiffToday(ts);

    var alerts = [];
    if (credit.available && credit.overdue > 0) {
      alerts.push({
        kind: 'overdue',
        severity: 'danger',
        text: 'مديونيات متأخرة: ' + fmtMoney(credit.overdue)
      });
    }
    if (inv.expiring.available && inv.expiring.expiredCount > 0) {
      alerts.push({
        kind: 'expired',
        severity: 'danger',
        text: 'أصناف منتهية الصلاحية في المخزن: ' + fmtInt(inv.expiring.expiredCount)
      });
    }
    if (shiftDiffToday !== null && Math.abs(shiftDiffToday) >= 0.01) {
      alerts.push({
        kind: 'shift',
        severity: 'warn',
        text: 'فرق تقفيل الشيفت النهارده: ' + fmtMoney(shiftDiffToday)
      });
    }
    if (!backup.available) {
      alerts.push({
        kind: 'backup',
        severity: 'danger',
        text: 'مفيش نسخة احتياطية متسجلة'
      });
    } else if (backup.isRed) {
      alerts.push({
        kind: 'backup',
        severity: 'danger',
        text: 'آخر نسخة احتياطية عدى عليها أكتر من 24 ساعة'
      });
    }
    if (alerts.length < 5 && inv.lowStock.available && inv.lowStock.outOfStock > 0) {
      alerts.push({
        kind: 'outOfStock',
        severity: 'warn',
        text: 'أصناف رصيدها صفر: ' + fmtInt(inv.lowStock.outOfStock)
      });
    }
    if (alerts.length > 5) {
      alerts = alerts.slice(0, 5);
    }

    return {
      nowMs: ts,
      salesToday: sc.salesToday,
      cashDrawer: sc.cashDrawer,
      credit: credit,
      supplierDues: suppliers,
      expiring: inv.expiring,
      lowStock: inv.lowStock,
      backup: backup,
      shiftDiffToday: shiftDiffToday,
      alerts: alerts
    };
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#' + SECTION_ID + ' {',
      '  background: #1b2027;',
      '  border: 1px solid #343b44;',
      '  border-radius: 10px;',
      '  padding: 14px;',
      '  margin-bottom: 16px;',
      '  direction: rtl;',
      '  color: #e6edf3;',
      '}',
      '#' + SECTION_ID + ' .nova-od-head {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  margin-bottom: 12px;',
      '  gap: 8px;',
      '}',
      '#' + SECTION_ID + ' .nova-od-title {',
      '  margin: 0;',
      '  font-size: 16px;',
      '  font-weight: 700;',
      '  color: #79c9eb;',
      '}',
      '#' + SECTION_ID + ' .nova-od-grid {',
      '  display: grid;',
      '  grid-template-columns: repeat(auto-fit, minmax(185px, 1fr));',
      '  gap: 10px;',
      '}',
      '#' + SECTION_ID + ' .nova-od-tile {',
      '  background: #14181d;',
      '  border: 1px solid #343b44;',
      '  border-radius: 8px;',
      '  padding: 10px 12px;',
      '  text-align: right;',
      '  color: inherit;',
      '  cursor: pointer;',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 4px;',
      '  transition: border-color 0.15s ease;',
      '  font-family: inherit;',
      '}',
      '#' + SECTION_ID + ' .nova-od-tile:hover {',
      '  border-color: #79c9eb;',
      '}',
      '#' + SECTION_ID + ' .nova-od-tile.nova-od-danger {',
      '  border-color: #e5534b;',
      '  background: #241618;',
      '}',
      '#' + SECTION_ID + ' .nova-od-label {',
      '  font-size: 12px;',
      '  color: #9aa7b4;',
      '}',
      '#' + SECTION_ID + ' .nova-od-val {',
      '  font-size: 18px;',
      '  font-weight: 700;',
      '  color: #f0f6fc;',
      '}',
      '#' + SECTION_ID + ' .nova-od-tile.nova-od-danger .nova-od-val {',
      '  color: #ff7b72;',
      '}',
      '#' + SECTION_ID + ' .nova-od-sub {',
      '  font-size: 12px;',
      '  color: #8b949e;',
      '}',
      '#' + SECTION_ID + ' .nova-od-actions {',
      '  display: block;',
      '  margin-top: 6px;',
      '}',
      '#' + SECTION_ID + ' .nova-od-alerts {',
      '  grid-column: 1 / -1;',
      '  background: #14181d;',
      '  border: 1px solid #343b44;',
      '  border-radius: 8px;',
      '  padding: 10px 12px;',
      '}',
      '#' + SECTION_ID + ' .nova-od-alert-list {',
      '  margin: 6px 0 0;',
      '  padding: 0 16px 0 0;',
      '  font-size: 13px;',
      '  line-height: 1.6;',
      '}',
      '#' + SECTION_ID + ' .nova-od-alert-danger { color: #ff7b72; }',
      '#' + SECTION_ID + ' .nova-od-alert-warn { color: #e3b341; }'
      ,'@media print { #' + SECTION_ID + ' { display: none !important; } }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function scrollToSelector(selector) {
    if (!selector) return false;
    var el = document.querySelector(selector);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return true;
    }
    return false;
  }

  function openBackupSettings() {
    try {
      window.location.hash = '#settings';
    } catch (e) {}
    var tab = document.querySelector('.nova-tab[data-page="settings"]');
    if (tab && typeof tab.click === 'function') {
      tab.click();
    }
  }

  function createTile(opts) {
    var tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'nova-od-tile' + (opts.danger ? ' nova-od-danger' : '');
    tile.setAttribute('data-od-card', opts.id);

    var lbl = document.createElement('span');
    lbl.className = 'nova-od-label';
    lbl.textContent = opts.label;
    tile.appendChild(lbl);

    var val = document.createElement('span');
    val.className = 'nova-od-val';
    val.textContent = opts.value;
    tile.appendChild(val);

    if (opts.sub) {
      var sub = document.createElement('span');
      sub.className = 'nova-od-sub';
      sub.textContent = opts.sub;
      tile.appendChild(sub);
    }

    if (typeof opts.onClick === 'function') {
      tile.addEventListener('click', opts.onClick);
    }

    return tile;
  }

  function buildSection(data) {
    var section = document.createElement('section');
    section.id = SECTION_ID;
    section.setAttribute('aria-label', 'لوحة المالك');

    var head = document.createElement('div');
    head.className = 'nova-od-head';

    var title = document.createElement('h2');
    title.className = 'nova-od-title';
    title.textContent = 'لوحة المالك';
    head.appendChild(title);

    section.appendChild(head);

    var grid = document.createElement('div');
    grid.className = 'nova-od-grid';

    // 1. مبيعات النهارده
    var salesSub = data.salesToday.available
      ? ('فواتير: ' + fmtInt(data.salesToday.invoices) + ' | مقارنة بالأسبوع اللي فات: ' + fmtPct(data.salesToday.vsLastWeekPct))
      : '—';
    grid.appendChild(createTile({
      id: 'sales-today',
      label: 'مبيعات النهارده',
      value: fmtMoney(data.salesToday.net),
      sub: salesSub,
      onClick: function () {
        scrollToSelector('#novaSensitiveLog') || scrollToSelector('#novaPageView');
      }
    }));

    // 2. كاش الدرج المتوقع
    var cashSub = data.cashDrawer.available
      ? ('مبيعات كاش: ' + fmtMoney(data.cashDrawer.cashSales) + ' | مصروف: ' + fmtMoney(data.cashDrawer.cashOuts))
      : '—';
    grid.appendChild(createTile({
      id: 'cash-drawer',
      label: 'كاش الدرج المتوقع',
      value: fmtMoney(data.cashDrawer.expected),
      sub: cashSub,
      onClick: function () {
        scrollToSelector('#novaSensitiveLog');
      }
    }));

    // 3. الآجل برا
    var creditSub = data.credit.available
      ? ('متأخر: ' + fmtMoney(data.credit.overdue))
      : '—';
    grid.appendChild(createTile({
      id: 'credit-out',
      label: 'الآجل برا',
      value: fmtMoney(data.credit.totalOutstanding),
      sub: creditSub,
      danger: !!(data.credit.available && data.credit.overdue > 0),
      onClick: function () {
        scrollToSelector('#novaCreditSection') || scrollToSelector('#novaSensitiveLog');
      }
    }));

    // 4. مستحقات الموردين
    grid.appendChild(createTile({
      id: 'supplier-dues',
      label: 'مستحقات الموردين',
      value: fmtMoney(data.supplierDues.total),
      sub: data.supplierDues.available ? 'فواتير مفتوحة' : '—',
      onClick: function () {
        scrollToSelector('#novaSupplierAccountsSection');
      }
    }));

    // 5. أصناف قربت تخلص صلاحيتها
    var expSub = data.expiring.available
      ? ('القيمة بالتكلفة: ' + fmtMoney(data.expiring.valueAtCost))
      : '—';
    grid.appendChild(createTile({
      id: 'expiring-lots',
      label: 'أصناف قربت تخلص صلاحيتها',
      value: data.expiring.available ? (fmtInt(data.expiring.count) + ' تشغيلة قربت') : '—',
      sub: expSub,
      danger: !!(data.expiring.available && data.expiring.expiredCount > 0),
      onClick: function () {
        scrollToSelector('#novaExpirySection') || scrollToSelector('#novaSensitiveLog');
      }
    }));

    // 6. نواقص
    var lowSub = data.lowStock.available
      ? ('رصيد صفر: ' + fmtInt(data.lowStock.outOfStock))
      : '—';
    grid.appendChild(createTile({
      id: 'low-stock',
      label: 'نواقص',
      value: data.lowStock.available ? (fmtInt(data.lowStock.count) + ' صنف ناقص') : '—',
      sub: lowSub,
      onClick: function () {
        scrollToSelector('#novaLowStockSection');
      }
    }));

    // 7. آخر نسخة احتياطية
    var backupTile = createTile({
      id: 'last-backup',
      label: 'آخر نسخة احتياطية',
      value: data.backup.label,
      sub: data.backup.isRed ? 'محتاج تاخد نسخة دلوقتي' : 'النسخة محدثة',
      danger: data.backup.isRed,
      onClick: openBackupSettings
    });
    var actWrap = document.createElement('span');
    actWrap.className = 'nova-od-actions';
    var backupBtn = document.createElement('span');
    backupBtn.className = data.backup.isRed ? 'btn btn-danger' : 'btn btn-secondary';
    backupBtn.textContent = 'افتح النسخ الاحتياطي';
    actWrap.appendChild(backupBtn);
    backupTile.appendChild(actWrap);
    grid.appendChild(backupTile);

    // 8. التنبيهات
    var alertsBox = document.createElement('div');
    alertsBox.className = 'nova-od-alerts';
    alertsBox.setAttribute('data-od-card', 'alerts');

    var alertsLbl = document.createElement('div');
    alertsLbl.className = 'nova-od-label';
    alertsLbl.textContent = 'التنبيهات';
    alertsBox.appendChild(alertsLbl);

    var ul = document.createElement('ul');
    ul.className = 'nova-od-alert-list';

    if (data.alerts.length === 0) {
      var okLi = document.createElement('li');
      okLi.textContent = 'مفيش تنبيهات عاجلة دلوقتي';
      ul.appendChild(okLi);
    } else {
      for (var i = 0; i < data.alerts.length; i++) {
        var al = data.alerts[i];
        var li = document.createElement('li');
        li.className = al.severity === 'danger' ? 'nova-od-alert-danger' : 'nova-od-alert-warn';
        li.textContent = al.text;
        ul.appendChild(li);
      }
    }
    alertsBox.appendChild(ul);
    grid.appendChild(alertsBox);

    section.appendChild(grid);
    return section;
  }

  function isReportsActive() {
    return !!document.querySelector('.nova-tab.active[data-page="reports"]');
  }

  function mountIfNeeded() {
    if (isMounting) return;
    if (!isReportsActive()) return;

    var container = document.getElementById('novaPageView');
    if (!container) return;

    var existing = document.getElementById(SECTION_ID);
    if (existing && existing.parentNode === container && container.firstChild === existing) {
      return;
    }

    isMounting = true;
    if (observer) observer.disconnect();
    try {
      injectStyles();
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
      var data = compute(Date.now());
      var section = buildSection(data);
      container.insertBefore(section, container.firstChild);
    } finally {
      isMounting = false;
      if (observer) observer.observe(container, { childList: true });
    }
  }

  function init() {
    window.novaOwnerDash = {
      compute: compute
    };

    var container = document.getElementById('novaPageView');
    if (container && !observer && typeof MutationObserver === 'function') {
      observer = new MutationObserver(function () {
        if (isMounting) return;
        mountIfNeeded();
      });
      observer.observe(container, { childList: true });
    }

    mountIfNeeded();
  }

  init();
})();