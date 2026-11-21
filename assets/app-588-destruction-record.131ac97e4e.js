/* app/588-destruction-record.js — NOVA Rx Expired Drugs Destruction Record (ES5 IIFE) */
(function () {
  'use strict';

  var STORAGE_KEY = 'nova-rx-destruction-v1';
  var CARD_ID = 'novaDestruction';
  var PAGE_NAME = 'products';
  var MAX_RECORDS = 500;
  var inFlight = {};
  var idSeq = 0;
  var observerAttached = false;

  function isEn() {
    try {
      return localStorage.getItem('nova-rx-language') === 'en';
    } catch (e) {
      return false;
    }
  }

  function t(key) {
    var en = isEn();
    var dict = {
      title: en ? 'Expired Drugs Destruction Record' : 'محضر إعدام الأدوية المنتهية',
      expiredTitle: en ? 'Expired Lots in Stock' : 'التشغيلات المنتهية الصلاحية',
      noExpired: en ? 'No expired lots with available stock.' : 'لا توجد تشغيلات منتهية الصلاحية برصيد متاح.',
      select: en ? 'Select' : 'اختيار',
      item: en ? 'Item' : 'الصنف',
      barcode: en ? 'Barcode' : 'الباركود',
      lot: en ? 'Lot' : 'التشغيلة',
      expiry: en ? 'Expiry' : 'الصلاحية',
      onHand: en ? 'On Hand' : 'المتاح',
      qty: en ? 'Qty' : 'الكمية',
      cost: en ? 'Cost' : 'التكلفة',
      subtotal: en ? 'Subtotal' : 'الإجمالي',
      witnessesTitle: en ? 'Witnesses (1 to 3 names)' : 'الشهود (من ١ إلى ٣ أسماء)',
      w1: en ? 'Witness 1 (required)' : 'اسم الشاهد الأول (إلزامي)',
      w2: en ? 'Witness 2 (optional)' : 'اسم الشاهد الثاني',
      w3: en ? 'Witness 3 (optional)' : 'اسم الشاهد الثالث',
      noteLabel: en ? 'Notes' : 'ملاحظات',
      notePlaceholder: en ? 'Optional destruction notes' : 'ملاحظات إضافية للمحضر',
      createBtn: en ? 'Create Record' : 'اعمل المحضر',
      refreshBtn: en ? 'Refresh' : 'تحديث',
      historyTitle: en ? 'Destruction History' : 'سجل محاضر الإعدام',
      noHistory: en ? 'No destruction records yet.' : 'لا توجد محاضر مسجلة بعد.',
      recId: en ? 'Record' : 'رقم المحضر',
      date: en ? 'Date' : 'التاريخ',
      itemsCount: en ? 'Items' : 'الأصناف',
      totalCost: en ? 'Total Cost' : 'إجمالي التكلفة',
      witnesses: en ? 'Witnesses' : 'الشهود',
      action: en ? 'Action' : 'إجراء',
      printBtn: en ? 'Print Record' : 'طباعة المحضر',
      currency: en ? 'EGP' : 'ج.م',
      byLabel: en ? 'Prepared by' : 'بواسطة',
      signature: en ? 'Signature' : 'التوقيع',
      pharmacyFallback: en ? 'Pharmacy' : 'الصيدلية',
      errPerm: en ? 'Permission denied: stock.adjust required' : 'ليس لديك صلاحية تنفيذ هذا الإجراء',
      errWitnessMin: en ? 'At least 1 witness name is required' : 'يجب إدخال اسم شاهد واحد على الأقل',
      errWitnessMax: en ? 'Maximum 3 witnesses allowed' : 'الحد الأقصى للشهود ثلاثة أسماء',
      errLines: en ? 'Select at least one expired lot' : 'اختر تشغيلة واحدة على الأقل',
      errQty: en ? 'Invalid quantity for one of the lots' : 'الكمية غير صالحة لإحدى التشغيلات',
      errAdjust: en ? 'Failed to adjust stock; record not saved' : 'تعذر تعديل المخزون وحفظ المحضر',
      errPopup: en ? 'Unable to open print window' : 'تعذر فتح نافذة الطباعة',
      okSaved: en ? 'Destruction record created' : 'تم إنشاء محضر الإعدام بنجاح'
    };
    return dict[key] || key;
  }

  function toast(msg, type) {
    try {
      if (typeof window.showToast === 'function') {
        window.showToast(msg, type || 'success');
      }
    } catch (e) {}
  }

  function normalizeDigits(val) {
    var s = String(val == null ? '' : val);
    var out = '';
    var i, code;
    for (i = 0; i < s.length; i++) {
      code = s.charCodeAt(i);
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

  function parsePositiveInt(val) {
    var s = normalizeDigits(val).trim();
    if (!/^\d+$/.test(s)) {
      return NaN;
    }
    return parseInt(s, 10);
  }

  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function currentUserName() {
    try {
      if (window.novaAuth && typeof window.novaAuth.current === 'function') {
        var u = window.novaAuth.current();
        return u && u.name ? String(u.name) : '';
      }
    } catch (e) {}
    return '';
  }

  function checkAdjustPerm() {
    try {
      if (!window.novaPerms || typeof window.novaPerms.require !== 'function') {
        return false;
      }
      return !!window.novaPerms.require('stock.adjust');
    } catch (e) {
      return false;
    }
  }

  function readRecords() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function writeRecords(records) {
    var arr = Array.isArray(records) ? records.slice(-MAX_RECORDS) : [];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch (e) {}
    return arr;
  }

  function list() {
    return readRecords();
  }

  function expiredLots() {
    var out = [];
    var products = (window.NOVA_DEMO && Array.isArray(window.NOVA_DEMO.products)) ? window.NOVA_DEMO.products : [];
    var stock = window.novaStock;
    if (!stock || typeof stock.keyOf !== 'function' || typeof stock.hasLots !== 'function' || typeof stock.lots !== 'function') {
      return out;
    }
    var today = todayISO();
    var seenKeys = {};
    var i, j, p, key, lots, l, onHand, expiry, cost;
    for (i = 0; i < products.length; i++) {
      p = products[i];
      if (!p) {
        continue;
      }
      key = stock.keyOf(p);
      if (!key || seenKeys[key]) {
        continue;
      }
      seenKeys[key] = true;
      lots = stock.hasLots(key) ? stock.lots(key) : [];
      if (!Array.isArray(lots)) {
        continue;
      }
      for (j = 0; j < lots.length; j++) {
        l = lots[j];
        if (!l) {
          continue;
        }
        onHand = Number(l.onHand != null ? l.onHand : 0);
        expiry = l.expiry ? String(l.expiry).trim().slice(0, 10) : '';
        if (onHand > 0 && /^\d{4}-\d{2}-\d{2}$/.test(expiry) && expiry < today) {
          cost = Number(l.cost != null ? l.cost : (p.cost != null ? p.cost : 0));
          if (isNaN(cost)) {
            cost = 0;
          }
          out.push({
            key: key,
            code: p.barcode != null ? String(p.barcode) : '',
            name: p.name != null ? String(p.name) : '',
            lot: l.lot != null ? String(l.lot) : '',
            expiry: expiry,
            onHand: onHand,
            cost: cost
          });
        }
      }
    }
    return out;
  }

  function findRecordById(id) {
    var records = readRecords();
    var i;
    for (i = 0; i < records.length; i++) {
      if (records[i] && records[i].id === id) {
        return records[i];
      }
    }
    return null;
  }

  function create(opts) {
    opts = opts || {};
    if (!checkAdjustPerm()) {
      toast(t('errPerm'), 'error');
      return Promise.reject(new Error(t('errPerm')));
    }

    var hasExplicitId = !!(opts.id && String(opts.id).trim());
    var recordId = hasExplicitId ? String(opts.id).trim() : ('DST-' + Date.now());
    if (hasExplicitId) {
      var existing = findRecordById(recordId);
      if (existing) {
        return Promise.resolve(existing);
      }
      if (inFlight[recordId]) {
        return inFlight[recordId];
      }
    } else {
      while (inFlight[recordId] || findRecordById(recordId)) {
        idSeq += 1;
        recordId = 'DST-' + Date.now() + '-' + idSeq;
      }
    }

    var rawWitnesses = Array.isArray(opts.witnesses) ? opts.witnesses : [];
    var witnesses = [];
    var i, w;
    for (i = 0; i < rawWitnesses.length; i++) {
      w = String(rawWitnesses[i] == null ? '' : rawWitnesses[i]).trim();
      if (w) {
        witnesses.push(w);
      }
    }
    if (witnesses.length < 1) {
      toast(t('errWitnessMin'), 'error');
      return Promise.reject(new Error(t('errWitnessMin')));
    }
    if (witnesses.length > 3) {
      toast(t('errWitnessMax'), 'error');
      return Promise.reject(new Error(t('errWitnessMax')));
    }

    var rawLines = Array.isArray(opts.lines) ? opts.lines : [];
    if (rawLines.length === 0) {
      toast(t('errLines'), 'error');
      return Promise.reject(new Error(t('errLines')));
    }

    var available = expiredLots();
    var cleanLines = [];
    var usedByLot = {};
    var totalCost = 0;
    var j, req, match, qty, cost, lotKey, prevUsed;

    for (i = 0; i < rawLines.length; i++) {
      req = rawLines[i];
      if (!req) {
        toast(t('errQty'), 'error');
        return Promise.reject(new Error(t('errQty')));
      }
      match = null;
      for (j = 0; j < available.length; j++) {
        if (available[j].key === req.key &&
            String(available[j].lot) === String(req.lot != null ? req.lot : '') &&
            (!req.expiry || available[j].expiry === String(req.expiry).trim().slice(0, 10))) {
          match = available[j];
          break;
        }
      }
      if (!match) {
        toast(t('errQty'), 'error');
        return Promise.reject(new Error(t('errQty')));
      }
      qty = parsePositiveInt(req.qty);
      lotKey = match.key + '|' + match.lot + '|' + match.expiry;
      prevUsed = usedByLot[lotKey] || 0;
      if (isNaN(qty) || qty < 1 || (prevUsed + qty) > match.onHand) {
        toast(t('errQty'), 'error');
        return Promise.reject(new Error(t('errQty')));
      }
      usedByLot[lotKey] = prevUsed + qty;
      cost = Number(req.cost != null ? req.cost : match.cost);
      if (isNaN(cost) || cost < 0) {
        cost = match.cost;
      }
      cleanLines.push({
        key: match.key,
        code: req.code != null ? String(req.code) : match.code,
        name: req.name != null ? String(req.name) : match.name,
        lot: match.lot,
        expiry: match.expiry,
        qty: qty,
        cost: cost
      });
      totalCost += qty * cost;
    }

    totalCost = Math.round(totalCost * 100) / 100;
    var note = String(opts.note == null ? '' : opts.note).trim();

    var p = Promise.resolve().then(function () {
      if (window.novaLazy && typeof window.novaLazy.load === 'function') {
        return window.novaLazy.load();
      }
      return null;
    }).then(function () {
      if (!window.novaItemCard || typeof window.novaItemCard.adjust !== 'function') {
        throw new Error(t('errAdjust'));
      }
      return window.novaItemCard.adjust({
        id: recordId + '-out',
        reason: 'إعدام منتهي الصلاحية',
        note: 'محضر ' + recordId,
        lines: cleanLines
      });
    }).then(function () {
      delete inFlight[recordId];
      var rec = {
        id: recordId,
        at: new Date().toISOString(),
        by: currentUserName(),
        witnesses: witnesses,
        note: note,
        lines: cleanLines,
        totalCost: totalCost
      };
      var records = readRecords();
      records.push(rec);
      writeRecords(records);
      toast(t('okSaved'), 'success');
      renderIntoCard();
      return rec;
    }, function (err) {
      delete inFlight[recordId];
      var msg = (err && err.message) ? err.message : t('errAdjust');
      toast(msg, 'error');
      return Promise.reject(err || new Error(msg));
    });

    inFlight[recordId] = p;
    return p;
  }

  function getPharmacyName() {
    var el = document.querySelector('.pharmacy-banner-copy strong');
    var name = el && el.textContent ? el.textContent.trim() : '';
    return name || 'الصيدلية';
  }

  function formatDate(iso) {
    if (!iso) {
      return '';
    }
    var d = new Date(iso);
    if (isNaN(d.getTime())) {
      return String(iso).slice(0, 16).replace('T', ' ');
    }
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function printRecord(rec) {
    if (!rec) {
      return;
    }
    var win = window.open('', '_blank', 'width=820,height=700');
    if (!win || !win.document) {
      toast(t('errPopup'), 'error');
      return;
    }
    var doc = win.document;
    doc.open();
    doc.close();
    doc.documentElement.setAttribute('dir', 'rtl');
    doc.documentElement.setAttribute('lang', 'ar');
    doc.title = 'محضر إعدام الأدوية المنتهية';

    var style = doc.createElement('style');
    style.textContent =
      'body{font-family:Tahoma,Arial,sans-serif;direction:rtl;color:#111;margin:24px;line-height:1.6;}' +
      'h1,h2{margin:0 0 8px;text-align:center;}' +
      '.meta{display:flex;flex-wrap:wrap;justify-content:space-between;border:1px solid #333;padding:10px 14px;margin:14px 0;}' +
      'table{width:100%;border-collapse:collapse;margin:14px 0;}' +
      'th,td{border:1px solid #333;padding:8px;text-align:right;font-size:13px;}' +
      'th{background:#eee;}' +
      '.total{font-weight:bold;font-size:15px;margin:12px 0;}' +
      '.sigs{display:flex;flex-wrap:wrap;gap:24px;margin-top:32px;}' +
      '.sig-box{flex:1 1 200px;border-top:1px dashed #333;padding-top:8px;text-align:center;}';
    doc.head.appendChild(style);

    var h1 = doc.createElement('h1');
    h1.textContent = getPharmacyName();
    doc.body.appendChild(h1);

    var h2 = doc.createElement('h2');
    h2.textContent = 'محضر إعدام الأدوية المنتهية الصلاحية';
    doc.body.appendChild(h2);

    var meta = doc.createElement('div');
    meta.className = 'meta';
    var m1 = doc.createElement('div');
    m1.textContent = 'رقم المحضر: ' + rec.id;
    var m2 = doc.createElement('div');
    m2.textContent = 'التاريخ: ' + formatDate(rec.at);
    var m3 = doc.createElement('div');
    m3.textContent = 'بواسطة: ' + (rec.by || '—');
    meta.appendChild(m1);
    meta.appendChild(m2);
    meta.appendChild(m3);
    doc.body.appendChild(meta);

    if (rec.note) {
      var noteEl = doc.createElement('p');
      noteEl.textContent = 'ملاحظات: ' + rec.note;
      doc.body.appendChild(noteEl);
    }

    var table = doc.createElement('table');
    var thead = doc.createElement('thead');
    var hr = doc.createElement('tr');
    var headers = ['الصنف', 'الباركود', 'التشغيلة', 'الصلاحية', 'الكمية', 'التكلفة', 'الإجمالي'];
    var i, th, tr, line, cells, j, td;
    for (i = 0; i < headers.length; i++) {
      th = doc.createElement('th');
      th.textContent = headers[i];
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = doc.createElement('tbody');
    var lines = Array.isArray(rec.lines) ? rec.lines : [];
    for (i = 0; i < lines.length; i++) {
      line = lines[i];
      tr = doc.createElement('tr');
      cells = [
        line.name || '',
        line.code || '',
        line.lot || '',
        line.expiry || '',
        String(line.qty),
        String(line.cost),
        String(Math.round(line.qty * line.cost * 100) / 100)
      ];
      for (j = 0; j < cells.length; j++) {
        td = doc.createElement('td');
        td.textContent = cells[j];
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    doc.body.appendChild(table);

    var totalEl = doc.createElement('div');
    totalEl.className = 'total';
    totalEl.textContent = 'إجمالي التكلفة: ' + String(rec.totalCost) + ' ج.م';
    doc.body.appendChild(totalEl);

    var sigs = doc.createElement('div');
    sigs.className = 'sigs';
    var witnesses = Array.isArray(rec.witnesses) ? rec.witnesses : [];
    for (i = 0; i < witnesses.length; i++) {
      var box = doc.createElement('div');
      box.className = 'sig-box';
      var wName = doc.createElement('div');
      wName.textContent = 'الشاهد: ' + witnesses[i];
      var wLine = doc.createElement('div');
      wLine.textContent = 'التوقيع: __________________';
      box.appendChild(wName);
      box.appendChild(wLine);
      sigs.appendChild(box);
    }
    doc.body.appendChild(sigs);

    win.focus();
    win.print();
  }

  function ensureStyles() {
    if (document.getElementById('novaDestructionStyle')) {
      return;
    }
    var st = document.createElement('style');
    st.id = 'novaDestructionStyle';
    st.textContent =
      '#novaDestruction{box-sizing:border-box;width:100%;max-width:100%;min-width:0;overflow:hidden;background:#14181d;border:1px solid #343b44;border-radius:12px;padding:16px;margin-top:16px;color:#e6edf3;}' +
      '#novaDestruction *{box-sizing:border-box;}' +
      '#novaDestruction .nd-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;border-bottom:1px solid #343b44;padding-bottom:10px;}' +
      '#novaDestruction .nd-title{margin:0;font-size:17px;color:#79c9eb;}' +
      '#novaDestruction .nd-sub{margin:14px 0 8px;font-size:14px;color:#79c9eb;}' +
      '#novaDestruction .nd-wrap{width:100%;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid #343b44;border-radius:8px;}' +
      '#novaDestruction table{width:100%;border-collapse:collapse;min-width:320px;font-size:13px;}' +
      '#novaDestruction th,#novaDestruction td{padding:8px;border-bottom:1px solid #343b44;text-align:start;vertical-align:middle;}' +
      '#novaDestruction th{color:#79c9eb;font-weight:600;white-space:nowrap;}' +
      '#novaDestruction .nd-input{width:100%;min-height:44px;padding:8px 10px;background:#0d1117;color:#e6edf3;border:1px solid #343b44;border-radius:8px;font-size:14px;}' +
      '#novaDestruction .nd-qty{width:76px;min-height:44px;padding:6px 8px;background:#0d1117;color:#e6edf3;border:1px solid #343b44;border-radius:8px;text-align:center;}' +
      '#novaDestruction .nd-check{width:22px;height:22px;accent-color:#79c9eb;cursor:pointer;}' +
      '#novaDestruction .nd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:10px;}' +
      '#novaDestruction .nd-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;}' +
      '#novaDestruction .btn{min-height:44px;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:14px;}' +
      '#novaDestruction .nd-empty{padding:12px;color:#9da7b3;font-size:13px;}';
    document.head.appendChild(st);
  }

  function renderIntoCard() {
    var card = document.getElementById(CARD_ID);
    if (!card) {
      return;
    }
    card.setAttribute('dir', isEn() ? 'ltr' : 'rtl');
    while (card.firstChild) {
      card.removeChild(card.firstChild);
    }

    var head = document.createElement('div');
    head.className = 'nd-head';
    var h3 = document.createElement('h3');
    h3.className = 'nd-title';
    h3.textContent = t('title');
    var refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'btn btn-secondary';
    refreshBtn.textContent = t('refreshBtn');
    refreshBtn.addEventListener('click', function () {
      renderIntoCard();
    });
    head.appendChild(h3);
    head.appendChild(refreshBtn);
    card.appendChild(head);

    var lots = expiredLots();
    var rowControls = [];

    var sec1 = document.createElement('div');
    sec1.className = 'nd-sub';
    sec1.textContent = t('expiredTitle');
    card.appendChild(sec1);

    if (lots.length === 0) {
      var emptyLots = document.createElement('div');
      emptyLots.className = 'nd-empty';
      emptyLots.textContent = t('noExpired');
      card.appendChild(emptyLots);
    } else {
      var wrap = document.createElement('div');
      wrap.className = 'nd-wrap';
      var table = document.createElement('table');
      var thead = document.createElement('thead');
      var htr = document.createElement('tr');
      var cols = [t('select'), t('item'), t('lot'), t('expiry'), t('onHand'), t('qty'), t('cost')];
      var i, th;
      for (i = 0; i < cols.length; i++) {
        th = document.createElement('th');
        th.textContent = cols[i];
        htr.appendChild(th);
      }
      thead.appendChild(htr);
      table.appendChild(thead);

      var tbody = document.createElement('tbody');
      for (i = 0; i < lots.length; i++) {
        (function (lotItem) {
          var tr = document.createElement('tr');
          var tdCheck = document.createElement('td');
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.className = 'nd-check';
          cb.checked = true;
          tdCheck.appendChild(cb);

          var tdName = document.createElement('td');
          tdName.textContent = lotItem.name;

          var tdLot = document.createElement('td');
          tdLot.textContent = lotItem.lot;

          var tdExp = document.createElement('td');
          tdExp.textContent = lotItem.expiry;

          var tdOnHand = document.createElement('td');
          tdOnHand.textContent = String(lotItem.onHand);

          var tdQty = document.createElement('td');
          var qtyIn = document.createElement('input');
          qtyIn.type = 'text';
          qtyIn.setAttribute('inputmode', 'numeric');
          qtyIn.className = 'nd-qty';
          qtyIn.value = String(lotItem.onHand);
          tdQty.appendChild(qtyIn);

          var tdCost = document.createElement('td');
          tdCost.textContent = String(lotItem.cost);

          tr.appendChild(tdCheck);
          tr.appendChild(tdName);
          tr.appendChild(tdLot);
          tr.appendChild(tdExp);
          tr.appendChild(tdOnHand);
          tr.appendChild(tdQty);
          tr.appendChild(tdCost);
          tbody.appendChild(tr);

          rowControls.push({ lot: lotItem, cb: cb, qtyIn: qtyIn });
        })(lots[i]);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      card.appendChild(wrap);
    }

    var secW = document.createElement('div');
    secW.className = 'nd-sub';
    secW.textContent = t('witnessesTitle');
    card.appendChild(secW);

    var grid = document.createElement('div');
    grid.className = 'nd-grid';
    var wInputs = [];
    var wPlaceholders = [t('w1'), t('w2'), t('w3')];
    var wi, inp;
    for (wi = 0; wi < 3; wi++) {
      inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'nd-input';
      inp.placeholder = wPlaceholders[wi];
      grid.appendChild(inp);
      wInputs.push(inp);
    }
    card.appendChild(grid);

    var noteWrap = document.createElement('div');
    noteWrap.style.marginTop = '10px';
    var noteIn = document.createElement('input');
    noteIn.type = 'text';
    noteIn.className = 'nd-input';
    noteIn.placeholder = t('notePlaceholder');
    noteWrap.appendChild(noteIn);
    card.appendChild(noteWrap);

    var actions = document.createElement('div');
    actions.className = 'nd-actions';
    var createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'btn btn-primary';
    createBtn.textContent = t('createBtn');
    createBtn.addEventListener('click', function () {
      var selected = [];
      var k, rc;
      for (k = 0; k < rowControls.length; k++) {
        rc = rowControls[k];
        if (rc.cb.checked) {
          selected.push({
            key: rc.lot.key,
            code: rc.lot.code,
            name: rc.lot.name,
            lot: rc.lot.lot,
            expiry: rc.lot.expiry,
            qty: rc.qtyIn.value,
            cost: rc.lot.cost
          });
        }
      }
      var wList = [];
      for (k = 0; k < wInputs.length; k++) {
        if (wInputs[k].value.trim()) {
          wList.push(wInputs[k].value.trim());
        }
      }
      createBtn.disabled = true;
      create({
        lines: selected,
        witnesses: wList,
        note: noteIn.value
      }).then(function () {
        createBtn.disabled = false;
      }, function () {
        createBtn.disabled = false;
      });
    });
    actions.appendChild(createBtn);
    card.appendChild(actions);

    var secH = document.createElement('div');
    secH.className = 'nd-sub';
    secH.textContent = t('historyTitle');
    card.appendChild(secH);

    var history = readRecords().slice().reverse();
    if (history.length === 0) {
      var emptyHist = document.createElement('div');
      emptyHist.className = 'nd-empty';
      emptyHist.textContent = t('noHistory');
      card.appendChild(emptyHist);
    } else {
      var hWrap = document.createElement('div');
      hWrap.className = 'nd-wrap';
      var hTable = document.createElement('table');
      var hHead = document.createElement('thead');
      var hRow = document.createElement('tr');
      var hCols = [t('recId'), t('date'), t('itemsCount'), t('totalCost'), t('witnesses'), t('action')];
      var hi, hth;
      for (hi = 0; hi < hCols.length; hi++) {
        hth = document.createElement('th');
        hth.textContent = hCols[hi];
        hRow.appendChild(hth);
      }
      hHead.appendChild(hRow);
      hTable.appendChild(hHead);

      var hBody = document.createElement('tbody');
      for (hi = 0; hi < history.length; hi++) {
        (function (rec) {
          var tr = document.createElement('tr');
          var tdId = document.createElement('td');
          tdId.textContent = rec.id;

          var tdDate = document.createElement('td');
          tdDate.textContent = formatDate(rec.at);

          var tdCount = document.createElement('td');
          tdCount.textContent = String(Array.isArray(rec.lines) ? rec.lines.length : 0);

          var tdTotal = document.createElement('td');
          tdTotal.textContent = String(rec.totalCost) + ' ' + t('currency');

          var tdWit = document.createElement('td');
          tdWit.textContent = Array.isArray(rec.witnesses) ? rec.witnesses.join('، ') : '';

          var tdAct = document.createElement('td');
          var pBtn = document.createElement('button');
          pBtn.type = 'button';
          pBtn.className = 'btn btn-secondary';
          pBtn.textContent = t('printBtn');
          pBtn.addEventListener('click', function () {
            printRecord(rec);
          });
          tdAct.appendChild(pBtn);

          tr.appendChild(tdId);
          tr.appendChild(tdDate);
          tr.appendChild(tdCount);
          tr.appendChild(tdTotal);
          tr.appendChild(tdWit);
          tr.appendChild(tdAct);
          hBody.appendChild(tr);
        })(history[hi]);
      }
      hTable.appendChild(hBody);
      hWrap.appendChild(hTable);
      card.appendChild(hWrap);
    }
  }

  function isProductsActive() {
    if (document.body && document.body.dataset && document.body.dataset.activePage === PAGE_NAME) {
      return true;
    }
    return !!document.querySelector('.nova-tab.active[data-page="' + PAGE_NAME + '"]');
  }

  function mountIfNeeded() {
    var view = document.getElementById('novaPageView');
    if (!view || !isProductsActive()) {
      return;
    }
    if (document.getElementById(CARD_ID)) {
      return;
    }
    ensureStyles();
    var card = document.createElement('section');
    card.id = CARD_ID;
    view.appendChild(card);
    renderIntoCard();
  }

  function initObserver() {
    if (observerAttached) {
      return;
    }
    var view = document.getElementById('novaPageView');
    if (!view) {
      return;
    }
    observerAttached = true;
    var obs = new MutationObserver(function () {
      mountIfNeeded();
    });
    obs.observe(view, { childList: true });
    mountIfNeeded();
  }

  window.novaDestruction = {
    expiredLots: expiredLots,
    create: create,
    list: list
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initObserver);
  } else {
    initObserver();
  }
})();