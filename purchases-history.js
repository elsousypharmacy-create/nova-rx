/* NOVA Rx — PUR-03: Self-contained Invoice History (سجل الفواتير) module.
   Reads supplier receipts from the existing localStorage data source (`nova-rx-receipts-v1`
   via NovaReceiptOperations.readRaw when available, plus `nova.purchase.orders` for PO context).
   Read-only: never writes or mutates receipts, orders, lots, or stock ledger.
   Works as a browser script (`window.NovaPurchasesHistory`, `window.mountInvoiceHistory`) and in Node (`module.exports`). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    var api = factory(root);
    root.NovaPurchasesHistory = api;
    root.mountInvoiceHistory = api.mountInvoiceHistory;
  }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  var RECEIPTS_KEY = 'nova-rx-receipts-v1';
  var ORDERS_KEY = 'nova.purchase.orders';

  var AR_MONTHS = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatMoney(n) {
    var num = Math.round((Number(n) || 0) * 100) / 100;
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م';
  }

  function formatArabicDate(dateStr) {
    if (!dateStr) return '—';
    var raw = String(dateStr).trim();
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
    if (m) {
      var year = Number(m[1]);
      var month = Number(m[2]);
      var day = Number(m[3]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return day + ' ' + AR_MONTHS[month - 1] + ' ' + year;
      }
    }
    var parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) {
      return parsed.getUTCDate() + ' ' + AR_MONTHS[parsed.getUTCMonth()] + ' ' + parsed.getUTCFullYear();
    }
    return raw;
  }

  function readStoreArray(storage, key) {
    if (!storage || typeof storage.getItem !== 'function') return [];
    try {
      var ops = root && root.NovaReceiptOperations;
      var raw = ops && typeof ops.readRaw === 'function' ? ops.readRaw(storage, key) : storage.getItem(key);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function getEffectiveLines(receipt) {
    if (!receipt || !Array.isArray(receipt.lines)) return [];
    var ops = root && root.NovaReceiptOperations;
    if (ops && typeof ops.effectiveLines === 'function') {
      try {
        return ops.effectiveLines(receipt);
      } catch (_) {}
    }
    var corrections = Array.isArray(receipt.corrections) ? receipt.corrections : [];
    return receipt.lines.map(function (line, index) {
      var delta = corrections.reduce(function (sum, corr) {
        var changes = Array.isArray(corr && corr.changes) ? corr.changes : [];
        return sum + changes.filter(function (ch) { return ch && ch.index === index; }).reduce(function (n, ch) {
          return n + (Number(ch.delta) || 0);
        }, 0);
      }, 0);
      return Object.assign({}, line, { qty: (Number(line && line.qty) || 0) + delta });
    });
  }

  function computeReceiptTotal(receipt) {
    return getEffectiveLines(receipt).reduce(function (sum, line) {
      return sum + (Number(line.qty) || 0) * (Number(line.cost) || 0);
    }, 0);
  }

  function computeReceiptBoxes(receipt) {
    return getEffectiveLines(receipt).reduce(function (sum, line) {
      return sum + (Number(line.qty) || 0);
    }, 0);
  }

  function classifyReceipt(receipt, ordersById) {
    var isDraft = Boolean(
      receipt && (
        receipt.draft === true ||
        receipt.status === 'draft' ||
        receipt.state === 'draft' ||
        receipt.pending === true
      )
    );

    var corrections = Array.isArray(receipt && receipt.corrections) ? receipt.corrections : [];
    var totalCorrectionDelta = 0;
    var hasCorrectionChange = false;
    corrections.forEach(function (corr) {
      var changes = Array.isArray(corr && corr.changes) ? corr.changes : [];
      changes.forEach(function (ch) {
        var d = Number(ch && ch.delta) || 0;
        if (d !== 0) {
          hasCorrectionChange = true;
          totalCorrectionDelta += d;
        }
      });
    });

    var warnings = Array.isArray(receipt && receipt.warnings) ? receipt.warnings : [];
    var hasDiscrepancyWarning = warnings.some(function (w) {
      var t = typeof w === 'string' ? w : (w && w.type ? w.type : '');
      return t === 'over-receipt' || t === 'unordered' || t === 'cost-differs' || t === 'invoice-vs-grn' || t === 'invoice-vs-po';
    });

    var poShortage = 0;
    var poExcess = 0;
    var hasPoDiff = false;
    var po = receipt && receipt.poId && ordersById ? ordersById[receipt.poId] : null;
    if (po && Array.isArray(po.lines)) {
      var effLines = getEffectiveLines(receipt);
      po.lines.forEach(function (poLine) {
        var matching = effLines.filter(function (l) { return l.code === poLine.code; });
        var got = matching.reduce(function (s, l) { return s + (Number(l.qty) || 0); }, 0);
        if (got < poLine.qty) { poShortage += (poLine.qty - got); hasPoDiff = true; }
        else if (got > poLine.qty) { poExcess += (got - poLine.qty); hasPoDiff = true; }
        if (matching.some(function (l) { return Math.round((Number(l.cost) || 0) * 100) !== Math.round((Number(poLine.cost) || 0) * 100); })) {
          hasPoDiff = true;
        }
      });
      effLines.forEach(function (l) {
        if (!po.lines.some(function (poLine) { return poLine.code === l.code; })) {
          hasPoDiff = true;
        }
      });
    }

    var ExplicitDiff = typeof (receipt && receipt.discrepancyText) === 'string' && receipt.discrepancyText.trim()
      ? receipt.discrepancyText.trim()
      : '';

    var hasDiff = Boolean(!isDraft && (hasCorrectionChange || hasDiscrepancyWarning || hasPoDiff || ExplicitDiff || receipt.poState === 'partial'));

    var statusKind = isDraft ? 'draft' : (hasDiff ? 'diff' : 'ok');
    var statusLabel = 'تم الاستلام';
    if (isDraft) {
      statusLabel = 'مسودة';
    } else if (hasDiff) {
      if (ExplicitDiff) {
        statusLabel = ExplicitDiff;
      } else if (hasCorrectionChange && totalCorrectionDelta < 0) {
        statusLabel = 'فرق: ' + Math.abs(totalCorrectionDelta) + ' ناقص';
      } else if (hasCorrectionChange && totalCorrectionDelta > 0) {
        statusLabel = 'فرق: +' + totalCorrectionDelta + ' زيادة';
      } else if (poShortage > 0 && poExcess === 0) {
        statusLabel = 'فرق: ' + poShortage + ' ناقص';
      } else if (poExcess > 0 && poShortage === 0) {
        statusLabel = 'فرق: +' + poExcess + ' زيادة';
      } else {
        statusLabel = 'فرق';
      }
    }

    return {
      isDraft: isDraft,
      hasDiff: hasDiff,
      statusKind: statusKind,
      statusLabel: statusLabel,
      correctionDelta: totalCorrectionDelta,
      poShortage: poShortage,
      poExcess: poExcess
    };
  }

  function sortTimestamp(r, idx) {
    var raw = (r && (r.at || r.date || r.createdAt)) || '';
    var t = Date.parse(raw);
    if (!isNaN(t)) return t;
    return idx;
  }

  function loadHistoryItems(storage) {
    var st = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    var rawReceipts = readStoreArray(st, RECEIPTS_KEY).filter(function (r) {
      return r && typeof r === 'object' && Array.isArray(r.lines);
    });
    var rawOrders = readStoreArray(st, ORDERS_KEY);
    var ordersById = {};
    rawOrders.forEach(function (o) {
      if (o && o.id) ordersById[o.id] = o;
    });

    // Sort newest first; when timestamps tie or are date-only, later array entries (newest appends) come first.
    var indexed = rawReceipts.map(function (r, idx) {
      var info = classifyReceipt(r, ordersById);
      var effLines = getEffectiveLines(r);
      return {
        raw: r,
        idx: idx,
        ts: sortTimestamp(r, idx),
        id: String(r.id || ('RCV-' + (idx + 1))),
        supplier: String(r.supplier || 'مورد غير محدد'),
        invoice: String(r.invoice || '—'),
        dateRaw: String(r.date || r.at || ''),
        dateFormatted: formatArabicDate(r.date || r.at),
        total: computeReceiptTotal(r),
        totalFormatted: formatMoney(computeReceiptTotal(r)),
        boxes: computeReceiptBoxes(r),
        lines: effLines,
        originalLines: r.lines || [],
        corrections: Array.isArray(r.corrections) ? r.corrections : [],
        poId: r.poId || null,
        isDraft: info.isDraft,
        hasDiff: info.hasDiff,
        statusKind: info.statusKind,
        statusLabel: info.statusLabel
      };
    });

    indexed.sort(function (a, b) {
      if (b.ts !== a.ts) return b.ts - a.ts;
      return b.idx - a.idx;
    });

    return indexed;
  }

  function filterHistoryItems(items, query, activeFilter) {
    var q = String(query || '').trim().toLocaleLowerCase();
    var filter = activeFilter || 'all';
    return (items || []).filter(function (item) {
      if (filter === 'draft' && !item.isDraft) return false;
      if (filter === 'diff' && !item.hasDiff) return false;
      if (q) {
        var hay = (item.invoice + ' ' + item.supplier + ' ' + (item.poId || '')).toLocaleLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function countLabel(n) {
    if (n === 0) return '0 فاتورة';
    if (n === 1) return 'فاتورة واحدة';
    if (n === 2) return 'فاتورتين';
    if (n >= 3 && n <= 10) return n + ' فواتير';
    return n + ' فاتورة';
  }

  function openReadOnlyDetailSheet(item, doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;
    var existing = doc.getElementById('purHistoryDetailOverlay');
    if (existing) existing.remove();

    var previousFocus = doc.activeElement;
    var overlay = doc.createElement('div');
    overlay.id = 'purHistoryDetailOverlay';
    overlay.className = 'pur-hist-ov';
    overlay.dir = 'rtl';

    var stClass = item.statusKind === 'ok' ? 'st-ok' : (item.statusKind === 'diff' ? 'st-diff' : 'st-draft');

    var linesHtml = item.lines.length
      ? '<div class="pur-hist-lines-list" role="list">' +
        item.lines.map(function (l) {
          var qty = Number(l.qty) || 0;
          var cost = Number(l.cost) || 0;
          var lot = l.autoLot ? '—' : (l.lot || '—');
          var exp = String(l.expiry || '—').slice(0, 10);
          return '<div class="pur-hist-line-card" role="listitem">' +
            '<div class="pur-hist-line-top"><b>' + esc(l.name || l.code || '—') + '</b><span class="pur-hist-line-tot" dir="ltr">' + esc(formatMoney(qty * cost)) + '</span></div>' +
            '<div class="pur-hist-line-meta">' +
              '<span>الكمية: <b>' + esc(qty) + ' علبة</b></span>' +
              '<span>سعر العلبة: <b dir="ltr">' + esc(formatMoney(cost)) + '</b></span>' +
              '<span>الصلاحية: <b dir="ltr">' + esc(exp) + '</b></span>' +
              '<span>التشغيلة: <b dir="ltr">' + esc(lot) + '</b></span>' +
            '</div>' +
          '</div>';
        }).join('') +
        '</div>'
      : '<p class="pur-hist-note">لا توجد أصناف مسجلة في هذه الفاتورة.</p>';

    var correctionsHtml = '';
    if (item.corrections && item.corrections.length) {
      correctionsHtml = '<div class="pur-hist-corr-sec"><h3>سجل الفروق والتصحيحات</h3>' +
        item.corrections.map(function (c) {
          var byName = (c.by && c.by.name) || (c.by && c.by.id) || 'مستخدم';
          var changes = Array.isArray(c.changes) ? c.changes : [];
          return '<div class="pur-hist-audit"><div class="pur-hist-audit-head"><b>' + esc(byName) + '</b><time dir="ltr">' + esc(formatArabicDate(c.at)) + '</time></div>' +
            (c.reason ? '<p class="pur-hist-audit-reason">' + esc(c.reason) + '</p>' : '') +
            changes.map(function (ch) {
              var origLine = item.originalLines[ch.index] || {};
              var pName = origLine.name || ch.code || ('سطر ' + (ch.index + 1));
              var d = Number(ch.delta) || 0;
              return '<p class="pur-hist-audit-line">' + esc(pName) + ': ' + esc(ch.before) + ' ← ' + esc(ch.after) + ' (<b dir="ltr">' + (d > 0 ? '+' : '') + esc(d) + '</b>)</p>';
            }).join('') +
            '</div>';
        }).join('') +
        '</div>';
    }

    overlay.innerHTML =
      '<div class="pur-hist-dlg" role="dialog" aria-modal="true" aria-labelledby="purHistDetailTitle">' +
        '<div class="pur-hist-dlg-head">' +
          '<div>' +
            '<h2 id="purHistDetailTitle">فاتورة ' + esc(item.invoice) + ' — ' + esc(item.supplier) + '</h2>' +
            '<p class="pur-hist-dlg-sub">' + esc(item.dateFormatted) + (item.poId ? ' · أمر شراء ' + esc(item.poId) : '') + '</p>' +
          '</div>' +
          '<button type="button" class="pur-hist-close" data-pur-hist-close aria-label="إغلاق تفاصيل الفاتورة">×</button>' +
        '</div>' +
        '<div class="pur-hist-dlg-body">' +
          '<div class="pur-hist-summary-bar">' +
            '<div><small>الحالة</small><span class="st ' + stClass + '">' + esc(item.statusLabel + (item.raw && item.raw.pending ? ' · يحتاج استكمال' : '')) + '</span></div>' +
            '<div><small>عدد الأصناف</small><b>' + esc(item.lines.length) + '</b></div>' +
            '<div><small>إجمالي العلب</small><b>' + esc(item.boxes) + ' علبة</b></div>' +
            '<div><small>إجمالي الفاتورة</small><b dir="ltr">' + esc(item.totalFormatted) + '</b></div>' +
          '</div>' +
          '<h3>الأصناف المستلمة</h3>' +
          linesHtml +
          correctionsHtml +
        '</div>' +
        '<div class="pur-hist-dlg-foot">' +
          '<span class="pur-hist-ro-badge">عرض للقراءة فقط</span>' +
          '<button type="button" class="pur-hist-btn" data-pur-hist-close>إغلاق</button>' +
        '</div>' +
      '</div>';

    doc.body.appendChild(overlay);

    function close() {
      overlay.remove();
      doc.removeEventListener('keydown', onKey, true);
      if (previousFocus && typeof previousFocus.focus === 'function') {
        try { previousFocus.focus(); } catch (_) {}
      }
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    }

    doc.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || (e.target.closest && e.target.closest('[data-pur-hist-close]'))) {
        close();
      }
    });

    var closeBtn = overlay.querySelector('[data-pur-hist-close]');
    if (closeBtn) closeBtn.focus();
    return { overlay: overlay, close: close };
  }

  function startReceiveInvoice(options) {
    options = options || {};
    if (typeof options.onStartReceive === 'function') {
      options.onStartReceive();
      return;
    }
    if (root && root.novaReceiving && typeof root.novaReceiving.open === 'function') {
      root.novaReceiving.open();
      return;
    }
    if (typeof location !== 'undefined') {
      if (location.pathname.indexOf('purchases') !== -1) {
        location.href = '/#receiving';
      } else {
        location.hash = '#receiving';
      }
    }
  }

  function mountInvoiceHistory(containerEl, options) {
    if (!containerEl) throw new Error('mountInvoiceHistory requires a container element');
    options = options || {};
    var storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    var state = {
      query: '',
      filter: 'all'
    };

    containerEl.classList.add('pur-history-root');
    containerEl.setAttribute('dir', 'rtl');

    function render() {
      var allItems = loadHistoryItems(storage);
      var draftCount = allItems.filter(function (i) { return i.isDraft; }).length;
      var diffCount = allItems.filter(function (i) { return i.hasDiff; }).length;

      // Reset filter if the active filter chip is no longer backed by data
      if (state.filter === 'draft' && draftCount === 0) state.filter = 'all';
      if (state.filter === 'diff' && diffCount === 0) state.filter = 'all';

      var filtered = filterHistoryItems(allItems, state.query, state.filter);

      if (!allItems.length) {
        containerEl.innerHTML =
          '<section class="pur-history-view" aria-label="سجل الفواتير">' +
            '<div class="pur-history-empty" data-testid="history-empty">' +
              '<div class="pur-history-empty-ico" aria-hidden="true">' +
                '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
                  '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>' +
                  '<polyline points="14 2 14 8 20 8"></polyline>' +
                  '<line x1="16" y1="13" x2="8" y2="13"></line>' +
                  '<line x1="16" y1="17" x2="8" y2="17"></line>' +
                '</svg>' +
              '</div>' +
              '<span class="sr-t">سجل الفواتير</span>' +
              '<h2>لسه مفيش فواتير</h2>' +
              '<p>لما تستلم فاتورة من المورد وتتحفظ على الجهاز، هتظهر هنا في سجل الفواتير بالتاريخ والإجمالي والحالة.</p>' +
              '<button type="button" class="pur-hist-btn pur-hist-btn-primary" data-pur-hist-start-receive>استلام فاتورة</button>' +
            '</div>' +
          '</section>';
        wireEvents(allItems);
        return;
      }

      // Only render filter chips that are backed by data (الكل always; مسودات only when draftCount > 0; فيها فرق only when diffCount > 0)
      var chipsHtml =
        '<button type="button" class="pur-hist-chip' + (state.filter === 'all' ? ' active' : '') + '" data-pur-hist-filter="all" aria-pressed="' + (state.filter === 'all' ? 'true' : 'false') + '">' +
          '<span class="val">الكل</span>' +
        '</button>';
      if (draftCount > 0) {
        chipsHtml +=
          '<button type="button" class="pur-hist-chip' + (state.filter === 'draft' ? ' active' : '') + '" data-pur-hist-filter="draft" aria-pressed="' + (state.filter === 'draft' ? 'true' : 'false') + '">' +
            'مسودات · ' + draftCount +
          '</button>';
      }
      if (diffCount > 0) {
        chipsHtml +=
          '<button type="button" class="pur-hist-chip warn-chip' + (state.filter === 'diff' ? ' active' : '') + '" data-pur-hist-filter="diff" aria-pressed="' + (state.filter === 'diff' ? 'true' : 'false') + '">' +
            'فيها فرق · ' + diffCount +
          '</button>';
      }

      var listHtml = filtered.length
        ? '<div class="pur-hist-list" role="list">' +
            filtered.map(function (item) {
              var stClass = item.statusKind === 'ok' ? 'st-ok' : (item.statusKind === 'diff' ? 'st-diff' : 'st-draft');
              return (
                '<article class="inv pur-hist-card" role="listitem" tabindex="0" data-pur-hist-id="' + esc(item.id) + '" aria-label="فاتورة ' + esc(item.invoice) + ' من ' + esc(item.supplier) + '">' +
                  '<h3>' + esc(item.supplier) + '</h3>' +
                  '<div class="amt">' + esc(item.totalFormatted) + '</div>' +
                  '<div class="no">فاتورة ' + esc(item.invoice) + '</div>' +
                  '<div class="date">' + esc(item.dateFormatted) + '</div>' +
                  '<span class="st ' + stClass + '">' + esc(item.statusLabel) + '</span>' +
                '</article>'
              );
            }).join('') +
          '</div>'
        : '<div class="pur-history-no-match" role="status">' +
            '<p>لا توجد فواتير مطابقة للبحث الحالي.</p>' +
          '</div>';

      containerEl.innerHTML =
        '<section class="pur-history-view" aria-label="سجل الفواتير">' +
          '<div class="pur-hist-search-wrap">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3-3"/></svg>' +
            '<input type="search" id="purHistorySearch" class="pur-hist-search-input" placeholder="ابحث برقم الفاتورة أو المورد…" aria-label="ابحث برقم الفاتورة أو المورد" value="' + esc(state.query) + '">' +
          '</div>' +
          '<div class="pur-hist-chips" role="group" aria-label="تصفية الفواتير">' +
            chipsHtml +
          '</div>' +
          '<div class="pur-hist-section-label">آخر الفواتير <span>' + esc(countLabel(filtered.length)) + '</span></div>' +
          listHtml +
        '</section>';

      wireEvents(allItems);
    }

    function wireEvents(allItems) {
      var searchInput = containerEl.querySelector('#purHistorySearch');
      if (searchInput) {
        searchInput.oninput = function (e) {
          var pos = e.target.selectionStart;
          state.query = e.target.value;
          render();
          var nextInput = containerEl.querySelector('#purHistorySearch');
          if (nextInput) {
            nextInput.focus();
            try { if (pos != null) nextInput.setSelectionRange(pos, pos); } catch (_) {}
          }
        };
      }

      containerEl.querySelectorAll('[data-pur-hist-filter]').forEach(function (btn) {
        btn.onclick = function () {
          state.filter = btn.getAttribute('data-pur-hist-filter') || 'all';
          render();
        };
      });

      var startBtn = containerEl.querySelector('[data-pur-hist-start-receive]');
      if (startBtn) {
        startBtn.onclick = function () {
          startReceiveInvoice(options);
        };
      }

      containerEl.querySelectorAll('[data-pur-hist-id]').forEach(function (card) {
        function activate() {
          var id = card.getAttribute('data-pur-hist-id');
          var item = (allItems || []).find(function (x) { return x.id === id; });
          if (!item) return;
          if (typeof options.onSelectReceipt === 'function') {
            options.onSelectReceipt(item);
            return;
          }
          // If an existing receipt detail row is rendered on the current page (e.g. #rcv-<id>), open it; otherwise open the read-only detail sheet.
          var doc = containerEl.ownerDocument || (typeof document !== 'undefined' ? document : null);
          var existingRow = doc && doc.getElementById('rcv-' + item.id);
          if (existingRow && existingRow.offsetParent !== null) {
            existingRow.open = true;
            existingRow.scrollIntoView({ block: 'center' });
            var sum = existingRow.querySelector('summary');
            if (sum) sum.focus();
            return;
          }
          openReadOnlyDetailSheet(item, doc);
        }
        card.onclick = activate;
        card.onkeydown = function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate();
          }
        };
      });
    }

    render();

    return {
      refresh: render,
      getState: function () { return Object.assign({}, state); },
      setFilter: function (f) { state.filter = f || 'all'; render(); },
      setQuery: function (q) { state.query = String(q || ''); render(); }
    };
  }

  return {
    RECEIPTS_KEY: RECEIPTS_KEY,
    ORDERS_KEY: ORDERS_KEY,
    formatMoney: formatMoney,
    formatArabicDate: formatArabicDate,
    classifyReceipt: classifyReceipt,
    loadHistoryItems: loadHistoryItems,
    filterHistoryItems: filterHistoryItems,
    openReadOnlyDetailSheet: openReadOnlyDetailSheet,
    mountInvoiceHistory: mountInvoiceHistory
  };
});
