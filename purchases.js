import { readDays, buildNeeds, distribute, filterOffers, offerKey, groupCart, numberOrNull, createOfferSearch, expiredSessionMessage, compareSplitModes, applyManualSplit, createMockPurchasingScenario } from './purchases-core.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number.isFinite(n) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n) : '—';
const fmtMoney = n => Number.isFinite(n) ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) : '—';

const PREF = 'novaPurchasePrefsV1';
const DRAFT = 'novaPurchaseDraftV1';
const DRAFTS_LIST = 'novaPurchaseDraftsV1';
const WORKING_KEY = 'novaPurchaseNeedsWorkingV1';
const LIMITS = 'novaPurchaseLimitsV1';
const SESSION_PIN_KEY = 'novaNeedsSessionPin';
// Owner 20 Nov 02:4x: preview/staging read the stock source with a server-side PIN (no PIN card), and the
// source takes ~6 s, so wait for the server (same 45 s limit as the Worker) instead of showing the PIN card at 600 ms.
const PINLESS_TIMEOUT_MS = 45000;
// q17 C (owner 22 Nov): opening / viewing / adding / removing items needs no PIN. Without a session PIN the list opens
// from this device's last loaded copy (+ manual items); only loading fresh stock (the source is PIN-protected on the
// server) and SENDING a real order to a supplier ask for the dashboard PIN (sessionStorage, PERF-05 behaviour kept).
const LAST_STOCK_KEY = 'novaNeedsLastStockV1';
let localMode = false;
let pinAsk = false;
function saveLastStock(list, at) {
  try {
    const keep = buildNeeds(list, { ...prefs, limits }).map(i => i.key), set = new Set(keep);
    const rows = list.filter(r => set.has(String(r.id || r.code || '').trim() + '::' + (r.unit || 'pack'))).slice(0, 1500);
    localStorage.setItem(LAST_STOCK_KEY, JSON.stringify({ at: at || Date.now(), items: rows }));
  } catch {}
}
function readLastStock() {
  try { const o = JSON.parse(localStorage.getItem(LAST_STOCK_KEY) || 'null'); return o && Array.isArray(o.items) ? o : null; } catch { return null; }
}
function openLocal(ask) {
  const last = readLastStock();
  rawItems = last ? last.items : [];
  lastUpdatedDate = last ? new Date(last.at) : null;
  needPin = false; loadError = ''; loadingStock = false; localMode = true; pinAsk = !!ask;
  if ($('sourceState')) $('sourceState').textContent = last ? '📋 آخر نسخة محفوظة على الجهاز' : '📋 قائمة يدوية · حدّث من المخزون برقم الداشبورد';
  status('');
  rebuild();
  if (pinAsk) focusUnlock();
}

let prefs = { days: 21, level: 'ideal', mode: 'auto', suppliers: ['aumet', 'pharmaoverseas'], aumetSellers: [], excludedSuppliers: [], excludedSellers: [] };
try { const p = JSON.parse(localStorage.getItem(PREF) || 'null'); if (p && typeof p === 'object') prefs = { ...prefs, ...p }; } catch {}
prefs.mode = prefs.mode === 'manual' ? 'manual' : 'auto';
prefs.suppliers = Array.isArray(prefs.suppliers) ? prefs.suppliers.filter(x => ['aumet', 'pharmaoverseas'].includes(x)) : [];
prefs.aumetSellers = Array.isArray(prefs.aumetSellers) ? prefs.aumetSellers.map(String) : [];
prefs.excludedSuppliers = Array.isArray(prefs.excludedSuppliers) ? prefs.excludedSuppliers.filter(x => ['aumet', 'pharmaoverseas'].includes(x)) : [];
prefs.excludedSellers = Array.isArray(prefs.excludedSellers) ? prefs.excludedSellers.map(String) : [];

let limits = {};
try { const l = JSON.parse(localStorage.getItem(LIMITS) || 'null'); if (l && typeof l === 'object') limits = l; } catch {}

let working = { removedKeys: [], addedItems: [], qtyOverrides: {} };
function loadWorking() {
  try {
    const w = JSON.parse(localStorage.getItem(WORKING_KEY) || 'null');
    if (w && typeof w === 'object') {
      working = {
        removedKeys: Array.isArray(w.removedKeys) ? w.removedKeys.map(String) : [],
        addedItems: Array.isArray(w.addedItems) ? w.addedItems.filter(x => x && x.key) : [],
        qtyOverrides: w.qtyOverrides && typeof w.qtyOverrides === 'object' ? w.qtyOverrides : {}
      };
    }
  } catch {}
}
function saveWorking() {
  try { localStorage.setItem(WORKING_KEY, JSON.stringify(working)); } catch {}
}
loadWorking();

function loadDraftsList() {
  try {
    const arr = JSON.parse(localStorage.getItem(DRAFTS_LIST) || '[]');
    if (Array.isArray(arr) && arr.length) return arr;
    const single = JSON.parse(localStorage.getItem(DRAFT) || 'null');
    if (single && typeof single === 'object' && single.id) return [single];
    return [];
  } catch { return []; }
}
function saveDraftsList(arr) {
  try { localStorage.setItem(DRAFTS_LIST, JSON.stringify(arr.slice(0, 20))); } catch {}
}

let rawItems = [];
let items = [];
let sellers = [];
let offersByItem = new Map();
let dashboardPin = '';
try { dashboardPin = sessionStorage.getItem(SESSION_PIN_KEY) || ''; } catch {}
let busy = false;
let generation = 0;
let lastDraftText = '';
let pendingSellerIds = new Set();
let pendingExcludedSellers = new Set();
let stockChipFilter = 'all'; // 'all' | 'out' | 'low'
let loadingStock = false;
let loadError = '';
let needPin = false;
let wrongPin = false;
let mockScenario = null;
let lastUpdatedDate = null;

// Autocomplete & highlight & undo state
let catalogExtra = [];
let catalogExtraLoaded = false;
let currentSuggestions = [];
let activeSuggIdx = 0;
let newlyAddedKey = '';
let newlyAddedTimer = null;
let highlightKey = '';
let highlightTimer = null;
let lastUndo = null;
let undoTimer = null;

const PINLESS = (() => {
  try {
    const e = String(window.NOVA_ENV || '').toLowerCase();
    if (e === 'staging' || e === 'preview') return true;
    if (e) return false;
    return /^nova-rx-(preview|staging)[.-][a-z0-9.-]*workers\.dev$/i.test(location.hostname);
  } catch { return false; }
})();

const provider = () => window.NOVA_SUPPLIER_PROVIDER;
const offerSearch = createOfferSearch({
  request: async (query, opts) => {
    const r = await provider().search(query, opts);
    return {
      rows: (r.results || []).flatMap(x => x.offers || []),
      suppliers: r.suppliers || [],
      complete: opts.supplierIds.length > 0 && opts.supplierIds.every(id => (r.suppliers || []).some(s => s.id === id && s.state === 'ok'))
    };
  }
});

function setSessionPin(pin) {
  try {
    if (pin) sessionStorage.setItem(SESSION_PIN_KEY, pin);
    else sessionStorage.removeItem(SESSION_PIN_KEY);
  } catch {}
}

function status(text, error = false) {
  const el = $('status');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('warning', !!error);
}

function supplierName(id) {
  return id === 'aumet' ? 'أوميت' : id === 'pharmaoverseas' ? 'فارما أوفرسيز' : String(id || '—');
}

function coverageLabel(days) {
  const d = Number(days);
  if (d === 7) return 'أسبوع';
  if (d === 14) return 'أسبوعين';
  if (d === 21) return '3 أسابيع';
  if (d === 30) return 'شهر';
  return `${fmt(d)} يوم`;
}

function suppliersShortLabel() {
  const a = prefs.suppliers.includes('aumet');
  const p = prefs.suppliers.includes('pharmaoverseas');
  if (a && p) return 'أوميت + فارما';
  if (a) return 'أوميت';
  if (p) return 'فارما أوفرسيز';
  return 'ولا مورد';
}

function suppliersCountLabel() {
  const a = prefs.suppliers.includes('aumet');
  const p = prefs.suppliers.includes('pharmaoverseas');
  if (a && p) return 'موردين';
  if (a) return 'أوميت';
  if (p) return 'فارما';
  return 'بلا موردين';
}

function activeFilterCount() {
  let c = 0;
  if (prefs.suppliers.length) c += prefs.suppliers.length;
  return Math.max(1, c);
}

function relativeTimeLabel(d) {
  if (!d || Number.isNaN(d.getTime())) return 'الآن';
  const diffSec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (diffSec < 45) return 'الآن';
  if (diffSec < 120) return 'من دقيقة';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `من ${fmt(mins)} د`;
  return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}

function syncFilterUI() {
  const supText = suppliersShortLabel();
  const covText = coverageLabel(prefs.days);
  if ($('inlineSupplierText')) $('inlineSupplierText').textContent = supText;
  if ($('tileFilterSummary')) $('tileFilterSummary').textContent = `${suppliersCountLabel()} · ${covText}`;
  if ($('phoneFilterBadge')) $('phoneFilterBadge').textContent = fmt(activeFilterCount());

  const sel = $('coverageSelect');
  if (sel) {
    const val = String(prefs.days);
    const hasOpt = [...sel.options].some(o => o.value === val);
    const customOpt = sel.querySelector('option[data-custom]');
    if (!hasOpt) {
      if (customOpt) { customOpt.value = val; customOpt.textContent = covText; }
      else {
        const o = document.createElement('option');
        o.value = val; o.textContent = covText; o.dataset.custom = '1';
        sel.appendChild(o);
      }
    } else if (customOpt) {
      customOpt.remove();
    }
    sel.value = val;
  }

  if ($('days')) $('days').value = String(prefs.days);
  document.querySelectorAll('[data-filter-supplier]').forEach(btn => {
    const id = btn.dataset.filterSupplier;
    btn.setAttribute('aria-pressed', String(prefs.suppliers.includes(id)));
  });
  document.querySelectorAll('[data-filter-days]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.filterDays) === Number(prefs.days)));
  });
  if ($('ideal')) $('ideal').setAttribute('aria-pressed', String(prefs.level === 'ideal'));
  if ($('minimum')) $('minimum').setAttribute('aria-pressed', String(prefs.level === 'minimum'));
  if ($('modeAuto')) $('modeAuto').setAttribute('aria-pressed', String(prefs.mode === 'auto'));
  if ($('modeManual')) $('modeManual').setAttribute('aria-pressed', String(prefs.mode === 'manual'));
}

function updateDraftsCountUI() {
  const n = loadDraftsList().length;
  if ($('tileDraftsCount')) $('tileDraftsCount').textContent = n ? `${fmt(n)} محفوظة` : '0 محفوظة';
}

function persist() {
  syncFilterUI();
  try { localStorage.setItem(PREF, JSON.stringify(prefs)); } catch { status('تعذر حفظ الاختيارات على الجهاز', true); }
}

function setBusy(value) {
  busy = value;
  ['load', 'days', 'minimum', 'ideal', 'openSettings', 'modeAuto', 'modeManual', 'loadMock', 'coverageSelect'].forEach(id => {
    if ($(id)) $(id).disabled = value;
  });
}

function isOut(i) {
  const s = numberOrNull(i.stock);
  return s !== null && s <= 0;
}

function weeklyRateText(item) {
  let w = numberOrNull(item.weeklySales);
  if (w === null) {
    const d = numberOrNull(item.dailyRate ?? item.dailySales);
    if (d !== null) w = d * 7;
  }
  if (w === null) return '—';
  const rounded = w >= 1 ? Math.round(w) : Math.round(w * 10) / 10;
  return `${fmt(rounded)} / أسبوع`;
}

function weeklyRatePhoneText(item) {
  let w = numberOrNull(item.weeklySales);
  if (w === null) {
    const d = numberOrNull(item.dailyRate ?? item.dailySales);
    if (d !== null) w = d * 7;
  }
  if (w === null) return '';
  const rounded = w >= 1 ? Math.round(w) : Math.round(w * 10) / 10;
  return `بيتباع ${fmt(rounded)} في الأسبوع`;
}

function itemSupplierLabel(item) {
  const alloc = item.allocations?.[0];
  if (alloc?.offer) return alloc.offer.sellerName || supplierName(alloc.offer.supplierId);
  if (item.cheapestSupplier) return String(item.cheapestSupplier);
  if (item.supplierName) return String(item.supplierName);
  if (item.supplierId) return supplierName(item.supplierId);
  return '—';
}

function itemPriceNumber(item) {
  const alloc = item.allocations?.[0];
  if (alloc && numberOrNull(alloc.price) !== null) return numberOrNull(alloc.price);
  return numberOrNull(item.purchasePrice ?? item.cost ?? item.price);
}

function enrichItem(item, rawSource) {
  const src = rawSource || item;
  return {
    ...item,
    selected: true,
    weeklySales: src.weeklySales ?? item.weeklySales ?? null,
    cheapestSupplier: src.cheapestSupplier ?? src.supplierName ?? item.cheapestSupplier ?? null,
    purchasePrice: src.purchasePrice ?? src.cost ?? src.price ?? item.purchasePrice ?? null,
    price: src.price ?? src.purchasePrice ?? item.price ?? null,
    gtin: src.gtin ?? src.barcode ?? item.gtin ?? null
  };
}

function rebuild() {
  try {
    const rawDays = $('days') ? $('days').value : prefs.days;
    prefs.days = readDays(rawDays);
    if ($('days')) $('days').value = String(prefs.days);

    const rawByKey = new Map();
    for (const r of rawItems) {
      const id = String(r.id || r.code || '').trim();
      if (!id) continue;
      rawByKey.set(`${id}::${r.unit || 'pack'}`, r);
    }

    const removedSet = new Set(working.removedKeys);
    const built = buildNeeds(rawItems, { ...prefs, limits })
      .filter(i => !i.issue && !removedSet.has(i.key))
      .map(i => {
        const enriched = enrichItem(i, rawByKey.get(i.key));
        const ov = numberOrNull(working.qtyOverrides[enriched.key]);
        if (ov !== null && ov > 0) {
          enriched.qty = Math.floor(ov);
          enriched.unallocated = enriched.qty;
        }
        return enriched;
      });

    const builtMap = new Map(built.map(i => [i.key, i]));
    const finalList = [];

    // Prepend manually added items (preserved across reload)
    for (const added of working.addedItems) {
      if (removedSet.has(added.key)) continue;
      if (builtMap.has(added.key)) {
        const existing = builtMap.get(added.key);
        const ov = numberOrNull(working.qtyOverrides[added.key]);
        if (ov !== null && ov > 0) existing.qty = Math.floor(ov);
        finalList.push(existing);
        builtMap.delete(added.key);
      } else {
        const ov = numberOrNull(working.qtyOverrides[added.key]);
        const qty = ov !== null && ov > 0 ? Math.floor(ov) : Math.max(1, Number(added.qty) || 1);
        finalList.push({
          ...added,
          qty,
          selected: true,
          allocations: added.allocations || [],
          unallocated: qty
        });
      }
    }
    for (const rest of builtMap.values()) finalList.push(rest);

    items = finalList;
    offersByItem.clear();
    generation++;
    persist();
    render();
  } catch (e) {
    status(e.message, true);
  }
}

function visibleItems() {
  if (stockChipFilter === 'out') return items.filter(isOut);
  if (stockChipFilter === 'low') return items.filter(i => !isOut(i));
  return items;
}

function updatePanelVisibility() {
  const panel = $('panelNeeds');
  const stagePill = $('needsStagePill');
  const lockWrap = $('needsLockWrap');
  const railOpen = $('needsRailOpen');
  const inlineCtrls = $('needsInlineCtrls');
  const phoneSubrow = $('needsPhoneSubrow');
  const searchBox = $('needsSearchBox');
  const emptyLocked = $('needsEmptyLocked');
  const stateBox = $('needsStateBox');
  const tableWrap = $('needsTableWrap');
  const phoneCtaWrap = $('needsPhoneCtaWrap');

  const isLocked = needPin && !loadingStock;
  const isError = !needPin && !loadingStock && !!loadError;
  const isReady = !needPin && !loadingStock && !loadError;
  const showOpenChrome = isReady || (loadingStock && rawItems.length > 0);

  const stateName = isLocked ? 'locked' : loadingStock ? 'loading' : isError ? 'error' : 'ready';
  if (panel) panel.dataset.state = stateName;

  if (stagePill) {
    stagePill.textContent = showOpenChrome ? 'مرحلة 2 من 5 · راجع الكميات' : 'مرحلة 1 من 5 · افتح النواقص';
  }

  if (lockWrap) lockWrap.hidden = !(isLocked || (pinAsk && isReady));
  if (panel) panel.dataset.local = localMode ? '1' : '0';
  if ($('lockNeedsBtn')) $('lockNeedsBtn').hidden = !dashboardPin; // q17 C: nothing to lock without a PIN
  if ($('phoneLockBtn')) $('phoneLockBtn').hidden = !dashboardPin;
  if (localMode && !lastUpdatedDate && $('sourceTime')) $('sourceTime').textContent = '—';
  if (railOpen) railOpen.hidden = !showOpenChrome;
  if (inlineCtrls) inlineCtrls.hidden = !showOpenChrome;
  if (phoneSubrow) phoneSubrow.hidden = !showOpenChrome;
  if (searchBox) searchBox.hidden = !showOpenChrome;
  if (emptyLocked) emptyLocked.hidden = !isLocked;
  if (phoneCtaWrap) phoneCtaWrap.hidden = !isReady;

  const unlockHint = $('unlockHint');
  if (unlockHint) unlockHint.hidden = !wrongPin;

  if (stateBox) {
    stateBox.hidden = isLocked || isReady;
    if (loadingStock) {
      stateBox.innerHTML = '<div class="stock-skeleton" role="status" aria-live="polite"><span class="spin" aria-hidden="true"></span><span>جارٍ تحميل النواقص من مخزون الصيدلية…</span><div class="skel-bar" aria-hidden="true"></div><div class="skel-bar short" aria-hidden="true"></div></div>';
    } else if (isError) {
      stateBox.innerHTML = `<div class="needs-error-card"><span class="load-note load-error">${esc(loadError)}</span><button type="button" class="primary" data-empty-act="retry">أعد المحاولة</button></div>`;
    }
  }

  if (tableWrap) tableWrap.hidden = !isReady;
}

function render() {
  updatePanelVisibility();
  updateDraftsCountUI();
  syncFilterUI();

  const outCount = items.filter(isOut).length;
  const lowCount = items.filter(i => !isOut(i)).length;
  const activeCount = items.filter(i => !i.issue && i.qty > 0).length;

  if ($('countOutOfStock')) $('countOutOfStock').textContent = fmt(outCount);
  if ($('countLowStock')) $('countLowStock').textContent = fmt(lowCount);
  if ($('counterOutBtn')) $('counterOutBtn').setAttribute('aria-pressed', String(stockChipFilter === 'out'));
  if ($('counterLowBtn')) $('counterLowBtn').setAttribute('aria-pressed', String(stockChipFilter === 'low'));

  const ctaText = activeCount ? `جهّز طلبية ${fmt(activeCount)} صنف` : 'جهّز طلبية 0 صنف';
  if ($('prepareOrderLabel')) $('prepareOrderLabel').textContent = ctaText;
  if ($('prepareOrderBtn')) $('prepareOrderBtn').disabled = activeCount === 0 || busy;
  if ($('phonePrepareOrderBtn')) {
    $('phonePrepareOrderBtn').textContent = ctaText;
    $('phonePrepareOrderBtn').disabled = activeCount === 0 || busy;
  }
  if ($('needsPhoneSummary')) {
    $('needsPhoneSummary').textContent = `${fmt(activeCount)} صنف محتاج يتطلب`;
  }
  if ($('sourceTime') && lastUpdatedDate) {
    $('sourceTime').textContent = relativeTimeLabel(lastUpdatedDate);
  }

  if (needPin || loadingStock || loadError) return;

  const view = visibleItems();
  const tbody = $('rows');
  if (!tbody) return;

  if (!view.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="needs-empty-row"><span>${items.length ? 'مفيش أصناف مطابقة للتصفية الحالية.' : 'مفيش نواقص دلوقتي — استخدم خانة البحث فوق لإضافة أي صنف للطلبية.'}</span></td></tr>`;
    return;
  }

  tbody.innerHTML = view.map((item, idx) => {
    const stk = numberOrNull(item.stock);
    const out = stk !== null && stk <= 0;
    const stkCls = out ? 'red' : 'amber';
    const isNew = item.key === newlyAddedKey;
    const isHi = item.key === highlightKey;
    const sup = itemSupplierLabel(item);
    const pr = itemPriceNumber(item);
    const prText = pr !== null ? fmtMoney(pr) : '—';
    const wWide = weeklyRateText(item);
    const wPhone = weeklyRatePhoneText(item);
    const phoneMeta = [
      `<span class="${stkCls}">الرصيد ${stk !== null ? fmt(stk) : '—'}${out ? ' · خلص' : ''}</span>`,
      wPhone ? `<span>${esc(wPhone)}</span>` : '',
      sup !== '—' || pr !== null ? `<span>${esc(sup !== '—' ? sup : '')}${sup !== '—' && pr !== null ? ' ' : ''}${pr !== null ? fmt(pr) + ' ج' : ''}</span>` : ''
    ].filter(Boolean).join(' · ');

    const splitDetail = item.allocations?.length > 1
      ? `<small class="split-note" data-split-explanation="${esc(item.splitExplanation || '')}" title="${esc(item.splitExplanation || '')}">مقسم على ${fmt(item.allocations.length)} عروض (${item.allocations.map(a => `${esc(a.offer.sellerName || supplierName(a.offer.supplierId))}: ${fmt(a.qty)}`).join(' + ')})</small>`
      : '';
    const offerDetail = item.allocations?.[0]
      ? `<small class="needs-offer-meta">${esc([item.allocations[0].strength, item.allocations[0].form, item.allocations[0].packSize, item.allocations[0].quantity != null ? `متاح ${fmt(item.allocations[0].quantity)}` : null, item.allocations[0].date].filter(Boolean).join(' · '))}</small>${splitDetail}`
      : '';
    const expMsg = item.expiredMessage ? `<small class="needs-offer-warn">${esc(item.expiredMessage)}</small>` : '';

    return `<tr data-key="${esc(item.key)}" class="needs-row${isNew ? ' is-new' : ''}${isHi ? ' is-hi' : ''}">`
      + `<td class="col-num">${fmt(idx + 1)}</td>`
      + `<td class="col-name">`
      +   `<div class="needs-name-wrap"><span class="needs-name">${esc(item.name)}</span>${isNew ? '<span class="needs-newtag">جديد</span>' : ''}</div>`
      +   `${offerDetail}${expMsg}`
      + `</td>`
      + `<td class="col-stk ${stkCls}">${stk !== null ? fmt(stk) : '—'}</td>`
      + `<td class="col-rate">${esc(wWide)}</td>`
      + `<td class="col-qty">`
      +   `<div class="needs-stepper" role="group" aria-label="الكمية المطلوبة لصنف ${esc(item.name)}">`
      +     `<button type="button" class="needs-step-btn" data-action="qty-inc" aria-label="زود الكمية لصنف ${esc(item.name)}">+</button>`
      +     `<em class="needs-step-val" data-qty-val>${fmt(item.qty)}</em>`
      +     `<button type="button" class="needs-step-btn" data-action="qty-dec" aria-label="نقص الكمية لصنف ${esc(item.name)}">−</button>`
      +   `</div>`
      + `</td>`
      + `<td class="col-sup"><button type="button" class="needs-sup-btn" data-action="offers" aria-label="العروض لصنف ${esc(item.name)}">${esc(sup)}</button></td>`
      + `<td class="col-price">${esc(prText)}</td>`
      + `<td class="col-del"><button type="button" class="needs-trash" data-action="delete" aria-label="احذف الصنف" title="احذف الصنف"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button></td>`
      + `<td class="col-meta">${phoneMeta}</td>`
      + `</tr>`;
  }).join('');
}

function renderKeep() {
  const wrap = $('needsTableWrap');
  const top = wrap ? wrap.scrollTop : 0;
  render();
  if (wrap) wrap.scrollTop = top;
}

/* ---- Stock fetch & ONE PIN flow (PERF-05 preserved) ---- */
async function fetchStock(pin, useShortTimeout) {
  if (!useShortTimeout) return provider().purchasingStock(pin);
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  let timer, timedOut = false;
  const timeoutP = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      if (ac) try { ac.abort(); } catch {}
      reject(new Error('pinless-timeout'));
    }, PINLESS_TIMEOUT_MS);
  });
  const req = Promise.resolve().then(() => provider().purchasingStock(pin, ac ? { signal: ac.signal } : undefined));
  req.catch(() => {});
  try { return await Promise.race([req, timeoutP]); }
  catch (e) { if (timedOut) throw new Error('pinless-timeout'); throw e; }
  finally { clearTimeout(timer); }
}

function focusUnlock() {
  const f = $('dashboard-style');
  if (f) try { f.focus({ preventScroll: true }); } catch {}
}

async function loadStock(auto = false) {
  if (busy) return;
  if (auto !== true) auto = false;
  /* PERF-05: fail fast when no PIN is stored in this tab session and the env is not PINLESS-auto */
  if (!dashboardPin && !PINLESS) { // q17 C: no PIN -> the list opens anyway; a manual refresh shows the PIN card next to it
    wrongPin = false;
    openLocal(!auto);
    return;
  }
  mockScenario = null;
  try { prefs.days = readDays($('days') ? $('days').value : prefs.days); } catch (e) { status(e.message, true); return; }
  needPin = false;
  loadError = '';
  loadingStock = true;
  setBusy(true);
  render();
  status('جارٍ قراءة النواقص من STOCK LIVE…');
  try {
    const result = await fetchStock(dashboardPin, !dashboardPin && PINLESS);
    if (!result.ok || !Array.isArray(result.items)) throw new Error(result.error || 'source-unavailable');
    // Save PIN to sessionStorage ONLY after a 200 OK stock response!
    if (dashboardPin) setSessionPin(dashboardPin);
    rawItems = result.items;
    localMode = false; pinAsk = false;
    saveLastStock(rawItems, result.sourceUpdatedAt || result.generatedAt);
    const d = new Date(result.sourceUpdatedAt || result.generatedAt || Date.now());
    lastUpdatedDate = Number.isNaN(d.getTime()) ? new Date() : d;
    if ($('sourceState')) $('sourceState').textContent = '🔓 النواقص مفتوحة';
    if ($('sourceTime')) $('sourceTime').textContent = relativeTimeLabel(lastUpdatedDate);
    loadingStock = false;
    rebuild();
    status(`تمت قراءة ${fmt(rawItems.length)} صنف؛ ${fmt(items.length)} محتاج يتطلب.`);
  } catch (e) {
    const code = e.message;
    const hadPin = !!dashboardPin;
    if (code === 'source-auth-required' || code === 'pinless-timeout') {
      dashboardPin = '';
      setSessionPin('');
      wrongPin = code === 'source-auth-required' && hadPin;
      loadingStock = false;
      openLocal(true); // q17 C: the list stays usable; the PIN card asks again for a fresh load
    } else {
      loadError = code === 'pin-required'
        ? 'اكتب رقم موردين نوفا عند طلبه للاتصال'
        : code === 'source-not-ready'
          ? 'مصدر المشتريات يحتاج تحديث السيرفر؛ لم يتم تحميل بيانات قديمة بدلًا منه'
          : 'تعذر الاتصال بمصدر المخزون؛ أعد المحاولة';
      status(loadError, true);
    }
  } finally {
    loadingStock = false;
    setBusy(false);
    render();
    if (needPin) focusUnlock();
  }
}

function unlockStock() {
  const f = $('dashboard-style');
  const v = f ? f.value.trim() : '';
  if (!v) {
    wrongPin = true;
    render();
    focusUnlock();
    return;
  }
  dashboardPin = v;
  if (f) f.value = '';
  needPin = false;
  wrongPin = false;
  loadStock(true);
}

function lockNeeds() {
  dashboardPin = '';
  setSessionPin('');
  offersByItem.clear();
  mockScenario = null;
  wrongPin = false;
  closeDropdown();
  hideUndoToast();
  if ($('needsFilterDialog')?.open) $('needsFilterDialog').close();
  openLocal(false); // q17 C: locking forgets the PIN (sending asks again); the list itself stays open
}

/* ---- Local Catalog Search & Autocomplete ---- */
function normSearch(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0))
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSnapshotCatalog() {
  try {
    const raw = localStorage.getItem('nova-stock-snapshot-v1');
    if (!raw) return [];
    const j = JSON.parse(String(raw).replace(/^\uFEFF/, ''));
    const arr = Array.isArray(j) ? j : j && Array.isArray(j.items) ? j.items : [];
    return arr.map(r => {
      const code = String(r.code ?? '').replace(/[^\d]/g, '');
      const gtin = String(r.gtin ?? r.barcode ?? '').replace(/[^\d]/g, '');
      const nameAr = String(r.namear || r.name || '').trim();
      const nameEn = String(r.nameen || r.nameEn || '').trim();
      const name = nameAr || nameEn;
      if (!name) return null;
      return {
        id: String(r.id || code || gtin || name),
        code: code || gtin,
        gtin: gtin || code,
        name,
        nameEn,
        stock: numberOrNull(r.stock),
        price: numberOrNull(r.purchasePrice ?? r.cost ?? r.price),
        purchasePrice: numberOrNull(r.purchasePrice ?? r.cost ?? r.price),
        dailyRate: numberOrNull(r.dailySales ?? r.dailyRate),
        weeklySales: numberOrNull(r.weeklySales),
        cheapestSupplier: r.cheapestSupplier || r.supplierName || null
      };
    }).filter(Boolean);
  } catch { return []; }
}

function lazyLoadExternalCatalog() {
  if (catalogExtraLoaded) return;
  catalogExtraLoaded = true;
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (loopback && !window.NOVA_STOCK_PROBE) return;
  fetch('/emergency/stock.json', { cache: 'no-cache' })
    .then(r => r.ok ? r.json() : null)
    .then(j => {
      const arr = Array.isArray(j) ? j : j && Array.isArray(j.items) ? j.items : [];
      if (!arr.length) return;
      catalogExtra = arr.map(r => {
        const code = String(r.code ?? '').replace(/[^\d]/g, '');
        const gtin = String(r.gtin ?? r.barcode ?? '').replace(/[^\d]/g, '');
        const name = String(r.namear || r.name || r.nameen || '').trim();
        if (!name) return null;
        return {
          id: String(r.id || code || gtin || name),
          code: code || gtin,
          gtin: gtin || code,
          name,
          nameEn: String(r.nameen || r.nameEn || '').trim(),
          stock: numberOrNull(r.stock),
          price: numberOrNull(r.purchasePrice ?? r.cost ?? r.price),
          purchasePrice: numberOrNull(r.purchasePrice ?? r.cost ?? r.price),
          dailyRate: numberOrNull(r.dailySales ?? r.dailyRate),
          weeklySales: numberOrNull(r.weeklySales),
          cheapestSupplier: r.cheapestSupplier || r.supplierName || null
        };
      }).filter(Boolean);
      const q = $('needsSearchInput')?.value.trim();
      if (q) updateSuggestions(q);
    })
    .catch(() => {});
}

function getCombinedCatalog() {
  const byId = new Map();
  const seenCode = new Set();
  const seenGtin = new Set();
  const seenName = new Set();
  const addEntry = (r) => {
    if (!r) return;
    const name = String(r.name || r.namear || r.nameEn || r.nameen || '').trim();
    if (!name) return;
    const code = String(r.code ?? '').trim();
    const gtin = String(r.gtin ?? r.barcode ?? '').trim();
    const nName = normSearch(name);
    if ((gtin && seenGtin.has(gtin)) || (code && seenCode.has(code)) || (nName && seenName.has(nName))) return;
    const id = String(r.id || code || gtin || nName).trim();
    const key = `${id}::${r.unit || 'pack'}`;
    if (byId.has(key)) return;
    if (gtin) seenGtin.add(gtin);
    if (code) seenCode.add(code);
    if (nName) seenName.add(nName);
    byId.set(key, {
      key,
      id,
      code,
      gtin,
      name,
      nameEn: String(r.nameEn || r.nameen || '').trim(),
      stock: numberOrNull(r.stock),
      dailyRate: numberOrNull(r.dailyRate ?? r.dailySales),
      weeklySales: numberOrNull(r.weeklySales),
      cheapestSupplier: r.cheapestSupplier || r.supplierName || null,
      purchasePrice: numberOrNull(r.purchasePrice ?? r.cost ?? r.price),
      price: numberOrNull(r.price ?? r.purchasePrice ?? r.cost)
    });
  };
  for (const r of rawItems) addEntry(r);
  if (Array.isArray(window.NOVA_NEEDS_CATALOG)) {
    for (const r of window.NOVA_NEEDS_CATALOG) addEntry(r);
  }
  for (const r of parseSnapshotCatalog()) addEntry(r);
  for (const r of catalogExtra) addEntry(r);
  return [...byId.values()];
}

function searchCatalog(query, limit = 6) {
  const q = normSearch(query);
  if (!q) return [];
  const tokens = q.split(' ').filter(Boolean);
  const catalog = getCombinedCatalog();
  const inListKeys = new Set(items.map(i => i.key));
  const inListNames = new Set(items.map(i => normSearch(i.name)));
  const scored = [];
  for (const item of catalog) {
    const codeN = normSearch(item.code);
    const gtinN = normSearch(item.gtin);
    const nameN = normSearch(item.name);
    const enN = normSearch(item.nameEn);
    const hay = `${nameN} ${enN} ${codeN} ${gtinN}`;

    let score = 0;
    if ((gtinN && gtinN === q) || (codeN && codeN === q)) score = 100;
    else if (nameN.startsWith(q) || enN.startsWith(q)) score = 80;
    else if (nameN.includes(q) || enN.includes(q)) score = 65;
    else if (tokens.length > 1 && tokens.every(t => hay.includes(t))) score = 50;
    else if ((codeN && codeN.includes(q)) || (gtinN && gtinN.includes(q))) score = 45;

    if (score > 0) {
      const alreadyInList = inListKeys.has(item.key) || inListNames.has(nameN);
      if (score < 100 && !alreadyInList) score += 2;
      scored.push({ item, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.item);
}

function closeDropdown() {
  const dd = $('needsSearchDropdown');
  const inp = $('needsSearchInput');
  if (dd) dd.hidden = true;
  if (inp) inp.setAttribute('aria-expanded', 'false');
  currentSuggestions = [];
  activeSuggIdx = 0;
}

function renderDropdown() {
  const dd = $('needsSearchDropdown');
  const inp = $('needsSearchInput');
  if (!dd || !inp) return;
  if (!currentSuggestions.length) {
    dd.hidden = true;
    inp.setAttribute('aria-expanded', 'false');
    return;
  }
  if (activeSuggIdx < 0 || activeSuggIdx >= currentSuggestions.length) activeSuggIdx = 0;
  dd.innerHTML = currentSuggestions.map((c, idx) => {
    const on = idx === activeSuggIdx;
    const stk = numberOrNull(c.stock);
    const stkCls = stk !== null && stk <= 0 ? 'red' : stk !== null && stk <= 3 ? 'amber' : '';
    const pr = numberOrNull(c.price ?? c.purchasePrice);
    return `<div class="needs-dd-o${on ? ' on' : ''}" role="option" aria-selected="${on ? 'true' : 'false'}" data-sugg-idx="${idx}">`
      + `<b>${esc(c.name)}</b>`
      + `<small class="needs-dd-stk">الرصيد <span class="${stkCls}">${stk !== null ? fmt(stk) : '—'}</span></small>`
      + `<span class="needs-dd-pr">${pr !== null ? fmtMoney(pr) + ' ج' : '—'}</span>`
      + `${on ? '<small class="needs-dd-enter" aria-hidden="true">↵ Enter</small>' : ''}`
      + `<button type="button" class="needs-dd-add" data-sugg-add="${idx}" tabindex="-1">+ ضيف</button>`
      + `</div>`;
  }).join('')
    + `<div class="needs-dd-hint">↑ ↓ للاختيار · Enter يضيفه بكمية 1 · Esc يقفل</div>`;
  dd.hidden = false;
  inp.setAttribute('aria-expanded', 'true');
}

function updateSuggestions(query) {
  const q = String(query || '').trim();
  if ($('needsSearchClear')) $('needsSearchClear').hidden = !q;
  if (!q) { closeDropdown(); return; }
  lazyLoadExternalCatalog();
  currentSuggestions = searchCatalog(q, 6);
  activeSuggIdx = 0;
  renderDropdown();
}

function addOrIncrementItem(candidate) {
  if (!candidate) return;
  const normName = normSearch(candidate.name);
  const existing = items.find(i =>
    i.key === candidate.key ||
    (candidate.gtin && i.gtin && String(i.gtin) === String(candidate.gtin)) ||
    (candidate.code && i.code && String(i.code) === String(candidate.code)) ||
    normSearch(i.name) === normName
  );

  if (existing) {
    existing.qty = (Number(existing.qty) || 0) + 1;
    existing.unallocated = existing.qty;
    working.qtyOverrides[existing.key] = existing.qty;
    const addRef = working.addedItems.find(a => a.key === existing.key);
    if (addRef) addRef.qty = existing.qty;
    saveWorking();

    highlightKey = existing.key;
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => { highlightKey = ''; renderKeep(); }, 3500);
    if (stockChipFilter !== 'all') stockChipFilter = 'all';
    render();
    const row = $('rows')?.querySelector(`tr[data-key="${CSS.escape(existing.key)}"]`);
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } else {
    const newItem = {
      key: candidate.key || `${candidate.id || Date.now()}::pack`,
      id: candidate.id || candidate.code || String(Date.now()),
      code: candidate.code || '',
      gtin: candidate.gtin || '',
      name: candidate.name,
      nameEn: candidate.nameEn || '',
      stock: numberOrNull(candidate.stock),
      dailyRate: numberOrNull(candidate.dailyRate),
      weeklySales: numberOrNull(candidate.weeklySales),
      cheapestSupplier: candidate.cheapestSupplier || null,
      purchasePrice: numberOrNull(candidate.purchasePrice ?? candidate.price),
      price: numberOrNull(candidate.price ?? candidate.purchasePrice),
      qty: 1,
      selected: true,
      manuallyAdded: true,
      allocations: [],
      unallocated: 1
    };
    items.unshift(newItem);
    working.removedKeys = working.removedKeys.filter(k => k !== newItem.key);
    working.addedItems = [newItem, ...working.addedItems.filter(a => a.key !== newItem.key)];
    working.qtyOverrides[newItem.key] = 1;
    saveWorking();

    newlyAddedKey = newItem.key;
    clearTimeout(newlyAddedTimer);
    newlyAddedTimer = setTimeout(() => { newlyAddedKey = ''; renderKeep(); }, 4500);
    if (stockChipFilter !== 'all') stockChipFilter = 'all';
    render();
    const wrap = $('needsTableWrap');
    if (wrap) wrap.scrollTop = 0;
  }

  const inp = $('needsSearchInput');
  if (inp) {
    inp.value = '';
    if ($('needsSearchClear')) $('needsSearchClear').hidden = true;
    closeDropdown();
    inp.focus();
  }
}

/* ---- Delete & 5s Undo Toast ---- */
function hideUndoToast() {
  clearTimeout(undoTimer);
  undoTimer = null;
  lastUndo = null;
  const toast = $('needsUndoToast');
  if (toast) toast.hidden = true;
}

function removeItemWithUndo(key) {
  const index = items.findIndex(i => i.key === key);
  if (index < 0) return;
  const target = items[index];
  const wasAdded = working.addedItems.some(a => a.key === key);
  const oldQty = Number(target.qty) || 1;
  lastUndo = { item: { ...target, qty: oldQty }, index, oldQty, wasAdded };

  items.splice(index, 1);
  if (!working.removedKeys.includes(key)) working.removedKeys.push(key);
  working.addedItems = working.addedItems.filter(a => a.key !== key);
  delete working.qtyOverrides[key];
  saveWorking();

  if ($('needsUndoText')) $('needsUndoText').textContent = `اتشال صنف «${target.name}»`;
  if ($('needsUndoToast')) $('needsUndoToast').hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => hideUndoToast(), 5000);

  renderKeep();
}

function undoLastRemoval() {
  if (!lastUndo) return;
  const { item, index, oldQty, wasAdded } = lastUndo;
  hideUndoToast();

  const restored = { ...item, qty: oldQty, unallocated: oldQty };
  const pos = Math.max(0, Math.min(index, items.length));
  items.splice(pos, 0, restored);

  working.removedKeys = working.removedKeys.filter(k => k !== restored.key);
  working.qtyOverrides[restored.key] = oldQty;
  if (wasAdded) working.addedItems = [restored, ...working.addedItems.filter(a => a.key !== restored.key)];
  saveWorking();

  renderKeep();
}

/* ---- Primary Action: جهّز طلبية N صنف (LOCAL DRAFT ONLY — NEVER calls supplier write APIs) ---- */
function prepareLocalOrder() {
  const active = items.filter(i => !i.issue && Number(i.qty) > 0);
  if (!active.length) return;
  const groups = groupCart(active);
  const totalQty = active.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const estimatedTotal = Math.round(active.reduce((s, i) => {
    const p = itemPriceNumber(i);
    return s + (p !== null ? p * (Number(i.qty) || 0) : 0);
  }, 0) * 100) / 100;

  const draft = {
    version: 1,
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'draft-' + Date.now(),
    savedAt: new Date().toISOString(),
    state: 'local-draft',
    days: prefs.days,
    level: prefs.level,
    suppliers: [...prefs.suppliers],
    itemCount: active.length,
    totalQty,
    estimatedTotal,
    items: active.map(i => ({
      key: i.key,
      code: i.code || '',
      name: i.name,
      qty: Number(i.qty) || 1,
      stock: numberOrNull(i.stock),
      supplier: itemSupplierLabel(i),
      price: itemPriceNumber(i)
    })),
    groups
  };

  try {
    localStorage.setItem(DRAFT, JSON.stringify(draft));
    const list = loadDraftsList();
    list.unshift(draft);
    saveDraftsList(list);
  } catch {}

  lastDraftText = `مسودة طلبية NOVA Rx (${fmt(active.length)} صنف · ${fmt(totalQty)} علبة)\n`
    + draft.items.map((l, idx) => `${idx + 1}. ${l.name} × ${l.qty}${l.supplier !== '—' ? ' — ' + l.supplier : ''}${l.price !== null ? ' (' + fmtMoney(l.price) + ' ج)' : ''}`).join('\n')
    + (estimatedTotal > 0 ? `\nالإجمالي التقديري: ${fmtMoney(estimatedTotal)} ج.م` : '');

  updateDraftsCountUI();
  if ($('localDraftTitle')) $('localDraftTitle').textContent = `اتجهّزت مسودة الطلبية (${fmt(active.length)} صنف)`;
  if ($('localDraftBody')) {
    $('localDraftBody').innerHTML = `<div class="needs-draft-kpis">`
      + `<div><span>الأصناف</span><b>${fmt(active.length)}</b></div>`
      + `<div><span>إجمالي العلب</span><b>${fmt(totalQty)}</b></div>`
      + `<div><span>التكلفة التقديرية</span><b>${estimatedTotal > 0 ? fmtMoney(estimatedTotal) + ' ج.م' : '—'}</b></div>`
      + `</div>`
      + `<ul class="needs-draft-lines">${draft.items.map(l => `<li><span>${esc(l.name)}</span><b>× ${fmt(l.qty)}</b><small>${esc(l.supplier !== '—' ? l.supplier : '')}${l.price !== null ? ' · ' + fmtMoney(l.price) + ' ج' : ''}</small></li>`).join('')}</ul>`;
  }
  if ($('localDraftStatus')) $('localDraftStatus').textContent = 'اتحفظت المسودة على الجهاز بنجاح.';
  if ($('localDraftDialog') && !$('localDraftDialog').open) $('localDraftDialog').showModal();
}

function renderDraftsDialog() {
  const box = $('draftsList');
  if (!box) return;
  const list = loadDraftsList();
  if (!list.length) {
    box.innerHTML = '<p class="hint">لسه مفيش مسودات محفوظة. اضغط «جهّز طلبية» لحفظ أول مسودة على الجهاز.</p>';
    return;
  }
  box.innerHTML = list.map((d, idx) => {
    const dt = new Date(d.savedAt);
    const when = Number.isNaN(dt.getTime()) ? '' : dt.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
    const cnt = d.itemCount ?? (Array.isArray(d.items) ? d.items.length : 0);
    const qty = d.totalQty ?? (Array.isArray(d.items) ? d.items.reduce((s, x) => s + (Number(x.qty) || 0), 0) : 0);
    const est = numberOrNull(d.estimatedTotal);
    return `<article class="needs-draft-card" data-draft-idx="${idx}">`
      + `<div class="needs-draft-top"><b>مسودة #${fmt(list.length - idx)} · ${fmt(cnt)} صنف</b><small>${esc(when)}</small></div>`
      + `<div class="needs-draft-sub">${fmt(qty)} علبة${est && est > 0 ? ` · ${fmtMoney(est)} ج.م` : ''} · مسودة محلية</div>`
      + `<div class="needs-draft-acts">`
      +   `<button type="button" class="secondary" data-draft-copy="${idx}">نسخ</button>`
      +   `<button type="button" class="secondary needs-draft-del" data-draft-del="${idx}">حذف</button>`
      + `</div>`
      + `</article>`;
  }).join('');
}

/* ---- Offers Comparison Dialog (read-only per item) ---- */
async function searchOffers(item) {
  if (mockScenario) {
    const q = item.nameEn || item.name;
    const rows = (mockScenario.offersByQuery[q] || []).filter(r => prefs.suppliers.includes((r.offer || r).supplierId));
    item.searchComplete = true;
    item.expiredMessage = '';
    offersByItem.set(item.key, rows);
    return rows;
  }
  const result = await offerSearch.search(item.nameEn || item.name, { requestedQty: item.qty, supplierIds: prefs.suppliers });
  const rows = result.value.rows;
  item.searchComplete = result.value.complete === true;
  item.expiredMessage = expiredSessionMessage(result.value.suppliers);
  if (item.expiredMessage) showSessionBanner(item.expiredMessage);
  offersByItem.set(item.key, rows);
  return rows;
}

function renderOffersDialog(item, rows) {
  const mapped = filterOffers(item, rows, prefs);
  const cmp = compareSplitModes(item, rows, prefs);
  const allocByKey = new Map((item.allocations || []).map(a => [a.key, a.qty]));
  const autoByKey = new Map((cmp.auto.allocations || []).map(a => [a.key, a.qty]));
  const expBanner = item.expiredMessage ? `<p class="warning expired-session" role="alert">${esc(item.expiredMessage)}</p>` : '';
  const summaryHtml = mapped.length ? `<div id="splitComparison" class="split-comparison sc2"><div class="sc2-top"><span class="sc2-lbl">${prefs.mode === 'auto' ? 'المقترح' : 'التوزيع اليدوي'} · المطلوب ${fmt(item.qty)} علبة</span>${cmp.savings > 0 ? `<span class="discount sc2-save">التوفير بالتقسيم التلقائي: ${fmt(cmp.savings)} ج.م</span>` : ''}${cmp.moreCoverage > 0 ? `<span class="discount sc2-save">يغطي ${fmt(cmp.moreCoverage)} علبة إضافية</span>` : ''}</div><p id="autoSplitExplain" class="sc2-main">${esc(cmp.auto.splitExplanation)}</p><details class="sc2-more"><summary>تفاصيل المقارنة</summary><p id="singleSplitExplain">أفضل مورد منفرد: ${esc(cmp.single.splitExplanation)}</p><p id="currentSplitExplanation">التوزيع الحالي: ${esc(item.splitExplanation || cmp.auto.splitExplanation)}</p></details></div>` : '';
  const bestIdx = mapped.reduce((b, r, i) => r.eligible && (b < 0 || r.price < mapped[b].price) ? i : b, -1);
  const ofHead = mapped.length ? '<div class="of-head" role="row"><span role="columnheader">المخزن</span><span role="columnheader">الخصم</span><span role="columnheader">السعر</span><span role="columnheader">الصلاحية</span><span role="columnheader">المتاح</span><span role="columnheader">الكمية</span><span role="columnheader"><span class="sr-t">إجراءات</span></span></div>' : '';
  const cardsHtml = mapped.length ? mapped.map((r, index) => {
    const key = offerKey(r.offer);
    const currentQty = allocByKey.has(key) ? allocByKey.get(key) : (autoByKey.get(key) || 0);
    const shipLabel = r.shippingCost > 0 ? `الشحن ${fmt(r.shippingCost)} ج.م${r.freeShippingThreshold ? ` (مجاني فوق ${fmt(r.freeShippingThreshold)} ج.م)` : ''}` : 'شحن مجاني';
    const moqLabel = `الحد الأدنى ${fmt(r.moq)} علبة${r.minOrderValue ? ` (${fmt(r.minOrderValue)} ج.م)` : ''}`;
    const isExcludedSeller = r.offer.sellerId != null && prefs.excludedSellers.includes(String(r.offer.sellerId));
    return `<section class="offer of-row${r.eligible ? '' : ' of-off'}${index === bestIdx ? ' of-best' : ''}" data-offer-card="${index}" role="row"><div class="of-who" role="cell"><b>${esc(r.offer.sellerName || supplierName(r.offer.supplierId))}</b><small>${esc(supplierName(r.offer.supplierId))}${r.packSize ? ` · ${esc(r.packSize)}` : ''} · ${moqLabel} · ${shipLabel}</small>${r.reason ? `<small class="warning">${esc(r.reason)}</small>` : ''}</div><div class="of-c of-disc" role="cell" data-label="الخصم">${fmt(r.discount)}٪</div><div class="of-c of-price" role="cell" data-label="السعر"><b>${fmt(r.price)}</b> ج.م</div><div class="of-c" role="cell" data-label="الصلاحية">${esc(r.date || '—')}</div><div class="of-c" role="cell" data-label="المتاح">${r.offer.availableQuantity == null ? '—' : fmt(r.offer.availableQuantity)}</div><div class="of-c of-qty" role="cell"><label class="split-qty-wrap"><span class="sr-t">كمية التوزيع</span><input type="number" min="0" inputmode="numeric" dir="ltr" class="qty split-qty-input" data-split-input="${index}" aria-label="كمية التوزيع ${esc(r.offer.sellerName || supplierName(r.offer.supplierId))}" value="${esc(r.eligible ? currentQty : 0)}" ${r.eligible ? '' : 'disabled'}></label></div><div class="of-act" role="cell"><button type="button" class="secondary of-pick" data-offer="${index}" ${r.eligible ? '' : 'disabled'} title="اختيار هذا العرض للكمية كلها" aria-label="اختيار عرض ${esc(r.offer.sellerName || supplierName(r.offer.supplierId))} للكمية كلها">اختار</button>${r.offer.sellerId != null ? `<button type="button" class="secondary of-ex" data-exclude-seller="${esc(r.offer.sellerId)}" title="${isExcludedSeller ? 'إلغاء استبعاد المخزن' : 'استبعاد المخزن'}">${isExcludedSeller ? 'رجّعه' : 'استبعد'}</button>` : ''}</div></section>`;
  }).join('') : 'لا توجد عروض مطابقة حاليًا.';
  const actionsHtml = mapped.some(r => r.eligible) ? `<div class="split-editor-actions"><button type="button" id="resetAutoSplit" class="secondary">رجوع للمقترح</button><button type="button" id="applySplitEdit" class="primary">حفظ التوزيع المعدل</button><p id="splitEditStatus" role="status"></p></div>` : '';
  $('offerRows').innerHTML = expBanner + summaryHtml + (mapped.length ? '<div class="of-table" role="table" aria-label="عروض الموردين">' + ofHead + cardsHtml + '</div>' : cardsHtml) + actionsHtml;

  $('offerRows').querySelectorAll('[data-offer]').forEach(button => button.onclick = () => {
    const row = mapped[Number(button.dataset.offer)], offer = row.offer;
    const available = numberOrNull(offer.availableQuantity);
    const qty = Math.min(item.qty, available === null ? item.qty : Math.floor(available));
    if (qty <= 0 || qty < (numberOrNull(offer.minimumOrderQuantity) || 1)) { status('الكمية أقل من الحد الأدنى لطلب المورد', true); return; }
    item.allocations = [{ ...row, key: offerKey(offer), qty, quantityUnconfirmed: available === null, cartState: 'local-draft' }];
    item.unallocated = item.qty - qty;
    item.manualSplit = true;
    item.cheapestSupplier = offer.sellerName || supplierName(offer.supplierId);
    item.purchasePrice = row.price;
    item.splitExplanation = `اختيار يدوي لعرض واحد: ${offer.sellerName || supplierName(offer.supplierId)} (${fmt(qty)} علبة × ${fmt(row.price)} ج.م)`;
    item.selected = true;
    $('offers').close();
    renderKeep();
  });
  $('offerRows').querySelectorAll('[data-exclude-seller]').forEach(btn => btn.onclick = () => {
    const sellerId = String(btn.dataset.excludeSeller);
    if (prefs.excludedSellers.includes(sellerId)) {
      prefs.excludedSellers = prefs.excludedSellers.filter(id => id !== sellerId);
      if (!prefs.aumetSellers.includes(sellerId)) prefs.aumetSellers.push(sellerId);
    } else {
      prefs.excludedSellers.push(sellerId);
      prefs.aumetSellers = prefs.aumetSellers.filter(id => id !== sellerId);
    }
    persist();
    delete item.manualSplit;
    Object.assign(item, distribute(item, rows, prefs));
    renderOffersDialog(item, rows);
    renderKeep();
  });
  if ($('applySplitEdit')) $('applySplitEdit').onclick = () => {
    try {
      const entries = mapped.map((r, idx) => ({ key: offerKey(r.offer), qty: $('offerRows').querySelector(`[data-split-input="${idx}"]`)?.value ?? 0 }));
      const applied = applyManualSplit(item, rows, entries, prefs);
      Object.assign(item, applied);
      item.selected = true;
      status(applied.splitExplanation);
      $('offers').close();
      renderKeep();
    } catch (e) {
      if ($('splitEditStatus')) { $('splitEditStatus').textContent = e.message; $('splitEditStatus').classList.add('warning'); }
    }
  };
  if ($('resetAutoSplit')) $('resetAutoSplit').onclick = () => {
    delete item.manualSplit;
    Object.assign(item, distribute(item, rows, { ...prefs, mode: 'auto' }));
    $('offers').close();
    renderKeep();
  };
}

async function openOffers(item) {
  if (busy || !item) return;
  let dirty = false;
  setBusy(true);
  $('offerTitle').textContent = item.name;
  $('offerRows').textContent = 'جارٍ البحث…';
  $('offers').showModal();
  try {
    const rows = await searchOffers(item);
    const mapped = filterOffers(item, rows, prefs);
    if (!item.allocations?.length) {
      if (mapped.some(r => r.eligible)) delete item.offerState;
      else item.offerState = item.searchComplete ? 'none' : 'incomplete';
      dirty = true;
    }
    renderOffersDialog(item, rows);
  } catch {
    $('offerRows').textContent = 'تعذر قراءة عروض الموردين؛ لم تتغير الكميات.';
    if (!item.allocations?.length) { item.offerState = 'error'; dirty = true; }
  } finally {
    setBusy(false);
    if (dirty) renderKeep();
  }
}

/* ---- Settings Dialog (suppliers & Aumet warehouses; NO duplicate PIN field) ---- */
function updateExcludedSummary() {
  if (!$('excludedSummary')) return;
  const exSellers = pendingExcludedSellers.size;
  $('excludedSummary').textContent = exSellers ? `مستبعد محفوظ: ${fmt(exSellers)} مخزن` : 'لا توجد مخازن مستبعدة محفوظة';
}

function renderSellers() {
  updateExcludedSummary();
  const q = ($('sellerSearch')?.value || '').trim().toLocaleLowerCase();
  $('sellers').innerHTML = sellers.length
    ? sellers.filter(s => s.name.toLocaleLowerCase().includes(q)).map(s => `<label class="check"><input type="checkbox" data-seller="${esc(s.id)}" ${pendingSellerIds.has(String(s.id)) && !pendingExcludedSellers.has(String(s.id)) ? 'checked' : ''} ${s.locked ? 'disabled' : ''}>${esc(s.name)}${pendingExcludedSellers.has(String(s.id)) ? '<small class="warning">مستبعد</small>' : ''}${s.locked ? '<small>غير متاح لحسابك</small>' : ''}</label>`).join('')
    : 'لم تُقرأ مخازن حسابك بعد. جدّد جلسة أوميت ثم اضغط تحديث.';
}

async function refreshSellers() {
  $('refreshSellers').disabled = true;
  try {
    if (mockScenario) { sellers = mockScenario.sellers.map(s => ({ ...s, id: String(s.id) })); renderSellers(); return; }
    const r = await provider().listSellers();
    sellers = (r.sellers || []).map(s => ({ ...s, id: String(s.id) }));
    renderSellers();
  } catch {
    status('تعذر قراءة مخازن أوميت؛ الاختيارات المحفوظة لم تتغير', true);
  } finally {
    $('refreshSellers').disabled = false;
  }
}

function renderSupplierStatus(list) {
  const el = $('supplierStatusPanel'), M = window.NovaSupplierStatus;
  if (!el || !M) return;
  const t = new Date().toLocaleTimeString('ar-EG');
  el.replaceChildren(...list.map(s => {
    const st = M.classify(s), d = document.createElement('div');
    d.dataset.supplierState = st;
    d.textContent = (s.name || s.id) + ': ' + M.label(st, localStorage.getItem('nova-rx-language'));
    if (st === 'auth_failed' || st === 'missing_credential') {
      const a = document.createElement('a');
      a.href = 'https://github.com/elsousypharmacy-create/nova-rx/actions/workflows/supplier-sessions.yml';
      a.target = '_blank'; a.rel = 'noopener'; a.className = 'supplier-renew-link';
      a.textContent = localStorage.getItem('nova-rx-language') === 'en' ? 'Open connection renewal' : 'فتح تجديد الاتصال';
      d.appendChild(a);
    } else if (st === 'unknown' || st === 'down') {
      const n = document.createElement('small');
      n.textContent = localStorage.getItem('nova-rx-language') === 'en' ? ' — Recheck connection in supplier settings; session expiry is not assumed.' : ' — أعد فحص الاتصال من إعدادات الموردين؛ لا نفترض أن الجلسة منتهية.';
      d.appendChild(n);
    }
    return d;
  }), Object.assign(document.createElement('small'), { textContent: 'آخر فحص: ' + t }));
}
// UX06/07: labels only; opening renewal goes to the existing workflow page, never runs it.

function openSettings(checkConnection = true) {
  if ($('needsFilterDialog')?.open) $('needsFilterDialog').close();
  pendingSellerIds = new Set(prefs.aumetSellers);
  pendingExcludedSellers = new Set(prefs.excludedSellers);
  ['aumet', 'pharmaoverseas'].forEach(id => {
    if ($('supplier-' + id)) $('supplier-' + id).checked = prefs.suppliers.includes(id) && !prefs.excludedSuppliers.includes(id);
  });
  renderSellers();
  $('settings').showModal();
  if (checkConnection && !sellers.length && $('supplier-aumet')?.checked) refreshSellers();
  if (checkConnection && !mockScenario && provider()) {
    provider().listSuppliers().then(list => {
      list = ['aumet', 'pharmaoverseas'].map(id => (list || []).find(s => s.id === id) || { id, state: 'unknown' });
      for (const s of list) {
        const el = $(s.id === 'aumet' ? 'aumetState' : 'pharmaState');
        if (el) el.textContent = window.NovaSupplierStatus ? window.NovaSupplierStatus.label(window.NovaSupplierStatus.classify(s), localStorage.getItem('nova-rx-language')) : 'غير معروف';
      }
      renderSupplierStatus(list);
    }).catch(() => {
      ['aumetState', 'pharmaState'].forEach(id => { if ($(id)) $(id).textContent = 'غير معروف'; });
      renderSupplierStatus([{ id: 'aumet', name: 'أوميت', state: 'unknown' }, { id: 'pharmaoverseas', name: 'فارما أوفرسيز', state: 'unknown' }]);
    });
  }
}

async function loadMockData() {
  if (busy) return;
  mockScenario = createMockPurchasingScenario();
  sellers = mockScenario.sellers.map(s => ({ ...s, id: String(s.id) }));
  prefs = { ...prefs, ...mockScenario.prefs, mode: prefs.mode || 'auto' };
  rawItems = mockScenario.items;
  needPin = false;
  wrongPin = false;
  loadError = '';
  loadingStock = false;
  lastUpdatedDate = new Date();
  if ($('sourceState')) $('sourceState').textContent = '🔓 بيانات تجريبية محلية';
  rebuild();
  for (const item of items) {
    const rows = await searchOffers(item);
    Object.assign(item, distribute(item, rows, prefs));
  }
  render();
}

/* ---- Session Banner (read-only, non-shifting) ---- */
function setBannerSlotState(s) {
  const sl = $('sessionBannerSlot');
  if (sl) sl.dataset.state = s;
}
// Owner order 20 Nov 02:36 («بطل اظهر تحذير أوميت»): no supplier session / credentials warning banner on النواقص,
// locked or unlocked, phone or wide. The banner stays in the markup (hidden) for compat; it is never shown.
function showSessionBanner(text) {
  const b = $('sessionBanner');
  if (b) b.hidden = true;
  setBannerSlotState('ok');
}
function hideSessionBanner() {
  const b = $('sessionBanner');
  if (b) b.hidden = true;
  setBannerSlotState('ok');
}
async function checkSessions() {
  if (mockScenario || !provider()) { setBannerSlotState('ok'); return; }
  try {
    const list = await provider().listSuppliers();
    const bad = (list || []).filter(s => prefs.suppliers.includes(s.id) && (s.state === 'error' || s.state === 'off'));
    if (!bad.length) { hideSessionBanner(); return; }
    const exp = bad.filter(s => s.state === 'error').map(s => supplierName(s.id));
    const miss = bad.filter(s => s.state === 'off').map(s => supplierName(s.id));
    showSessionBanner(exp.length ? `جلسة ${exp.join('، ')} منتهية؛ جدّدها قبل البحث عن العروض.` : `بيانات دخول ${miss.join('، ')} ناقصة؛ أضفها من تجديد الجلسة.`);
  } catch { setBannerSlotState('ok'); }
}

/* ---- Tabs (طلب | استلام | سجل الفواتير) ---- */
const TABS = { needs: 'tabNeeds', receive: 'tabReceive', history: 'tabHistory' };
const PANELS = { needs: 'panelNeeds', receive: 'panelReceive', history: 'panelHistory' };
const HASH = { needs: '', receive: '#receive', history: '#history' };
let activeTab = 'needs';
function tabFromHash(h) {
  h = String(h || '').replace(/^#/, '').split('&')[0];
  if (h === 'receive' || h === 'receiving') return 'receive';
  if (h === 'history') return 'history';
  return 'needs';
}
function ensureReceiveFrame() {
  const f = $('receiveFrame');
  if (!f || f.getAttribute('src')) return;
  f.addEventListener('load', () => { const l = $('receiveLoading'); if (l) l.hidden = true; }, { once: true });
  f.setAttribute('src', f.dataset.src);
}
function showTab(name, { push = true, focus = false } = {}) {
  if (!TABS[name]) name = 'needs';
  activeTab = name;
  Object.keys(TABS).forEach(k => {
    const t = $(TABS[k]), pn = $(PANELS[k]), on = k === name;
    if (t) { t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; }
    if (pn) pn.hidden = !on;
  });
  if (name === 'receive') ensureReceiveFrame();
  if (name === 'history' && window.__purHistoryCtrl && typeof window.__purHistoryCtrl.refresh === 'function') window.__purHistoryCtrl.refresh();
  if (push) { try { history.replaceState(null, '', location.pathname + location.search + HASH[name]); } catch {} }
  if (focus && $(TABS[name])) $(TABS[name]).focus();
}

/* ---- Event Wiring ---- */
document.querySelector('.pur-tabs')?.addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b) showTab(b.dataset.tab);
});
document.querySelector('.pur-tabs')?.addEventListener('keydown', e => {
  const order = Object.keys(TABS), i = order.indexOf(activeTab);
  let n = -1;
  if (e.key === 'ArrowLeft') n = (i + 1) % order.length;
  else if (e.key === 'ArrowRight') n = (i + order.length - 1) % order.length;
  if (n >= 0) { e.preventDefault(); showTab(order[n], { focus: true }); }
});
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go-tab]');
  if (g) showTab(g.dataset.goTab);
});
window.addEventListener('hashchange', () => showTab(tabFromHash(location.hash), { push: false }));
window.addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || typeof e.data !== 'object') return;
  if (TABS[e.data.novaPurchasesTab]) showTab(e.data.novaPurchasesTab, { focus: true });
});

// Lock / Unlock
if ($('unlockNeedsBtn')) $('unlockNeedsBtn').onclick = unlockStock;
if ($('dashboard-style')) {
  $('dashboard-style').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); unlockStock(); }
  });
}
if ($('lockNeedsBtn')) $('lockNeedsBtn').onclick = lockNeeds;
if ($('phoneLockBtn')) $('phoneLockBtn').onclick = lockNeeds;
if ($('needsStateBox')) {
  $('needsStateBox').addEventListener('click', e => {
    const b = e.target.closest('[data-empty-act]');
    if (b && b.dataset.emptyAct === 'retry') loadStock(true);
  });
}

// Primary CTA (جهّز طلبية N صنف — local draft only)
if ($('prepareOrderBtn')) $('prepareOrderBtn').onclick = prepareLocalOrder;
if ($('phonePrepareOrderBtn')) $('phonePrepareOrderBtn').onclick = prepareLocalOrder;

// Right Rail Tiles
if ($('tileAddItemBtn')) {
  $('tileAddItemBtn').onclick = () => {
    const inp = $('needsSearchInput');
    if (inp) { inp.focus(); inp.select(); }
  };
}
if ($('tileFilterBtn')) $('tileFilterBtn').onclick = () => { syncFilterUI(); $('needsFilterDialog').showModal(); };
if ($('phoneFilterBtn')) $('phoneFilterBtn').onclick = () => { syncFilterUI(); $('needsFilterDialog').showModal(); };
if ($('inlineSupplierBtn')) $('inlineSupplierBtn').onclick = () => { syncFilterUI(); $('needsFilterDialog').showModal(); };
if ($('load')) $('load').onclick = () => loadStock(false);
if ($('phoneRefreshBtn')) $('phoneRefreshBtn').onclick = () => { if ($('needsFilterDialog')?.open) $('needsFilterDialog').close(); loadStock(false); };
if ($('tileDraftsBtn')) $('tileDraftsBtn').onclick = () => { renderDraftsDialog(); $('draftsDialog').showModal(); };
if ($('phoneDraftsBtn')) $('phoneDraftsBtn').onclick = () => { if ($('needsFilterDialog')?.open) $('needsFilterDialog').close(); renderDraftsDialog(); $('draftsDialog').showModal(); };

// Counters filter toggle
['counterOutBtn', 'counterLowBtn'].forEach(id => {
  const el = $(id);
  if (!el) return;
  el.onclick = () => {
    const kind = el.dataset.stockChip;
    stockChipFilter = stockChipFilter === kind ? 'all' : kind;
    render();
  };
});

// Inline coverage select
if ($('coverageSelect')) {
  $('coverageSelect').addEventListener('change', e => {
    prefs.days = readDays(e.target.value);
    if ($('days')) $('days').value = String(prefs.days);
    rebuild();
  });
}

// Filter dialog controls
if ($('closeFilterDialog')) $('closeFilterDialog').onclick = () => $('needsFilterDialog').close();
if ($('applyFilterDialog')) $('applyFilterDialog').onclick = () => {
  if ($('days')) {
    try { prefs.days = readDays($('days').value); } catch {}
  }
  rebuild();
  $('needsFilterDialog').close();
};
document.querySelectorAll('[data-filter-supplier]').forEach(btn => {
  btn.onclick = () => {
    const id = btn.dataset.filterSupplier;
    if (prefs.suppliers.includes(id)) {
      prefs.suppliers = prefs.suppliers.filter(s => s !== id);
      if (!prefs.excludedSuppliers.includes(id)) prefs.excludedSuppliers.push(id);
    } else {
      prefs.suppliers.push(id);
      prefs.excludedSuppliers = prefs.excludedSuppliers.filter(s => s !== id);
    }
    persist();
    render();
  };
});
document.querySelectorAll('[data-filter-days]').forEach(btn => {
  btn.onclick = () => {
    prefs.days = Number(btn.dataset.filterDays);
    if ($('days')) $('days').value = String(prefs.days);
    rebuild();
  };
});
if ($('days')) $('days').addEventListener('change', rebuild);
if ($('ideal')) $('ideal').onclick = () => { prefs.level = 'ideal'; rebuild(); };
if ($('minimum')) $('minimum').onclick = () => { prefs.level = 'minimum'; rebuild(); };
if ($('modeAuto')) $('modeAuto').onclick = () => {
  prefs.mode = 'auto';
  items.forEach(item => { if (offersByItem.has(item.key)) { delete item.manualSplit; Object.assign(item, distribute(item, offersByItem.get(item.key), prefs)); } });
  persist(); render();
};
if ($('modeManual')) $('modeManual').onclick = () => {
  prefs.mode = 'manual';
  items.forEach(item => { if (offersByItem.has(item.key)) { delete item.manualSplit; Object.assign(item, distribute(item, offersByItem.get(item.key), prefs)); } });
  persist(); render();
};

// Sticky Search & Autocomplete events
if ($('needsSearchInput')) {
  const inp = $('needsSearchInput');
  inp.addEventListener('input', () => updateSuggestions(inp.value));
  inp.addEventListener('focus', () => {
    $('needsSearchField')?.classList.add('is-focused');
    if (inp.value.trim()) updateSuggestions(inp.value);
  });
  inp.addEventListener('blur', () => {
    $('needsSearchField')?.classList.remove('is-focused');
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      if (!currentSuggestions.length && inp.value.trim()) updateSuggestions(inp.value);
      if (currentSuggestions.length) {
        e.preventDefault();
        activeSuggIdx = (activeSuggIdx + 1) % currentSuggestions.length;
        renderDropdown();
      }
    } else if (e.key === 'ArrowUp') {
      if (currentSuggestions.length) {
        e.preventDefault();
        activeSuggIdx = (activeSuggIdx - 1 + currentSuggestions.length) % currentSuggestions.length;
        renderDropdown();
      }
    } else if (e.key === 'Escape') {
      if (!$('needsSearchDropdown').hidden) {
        e.preventDefault();
        e.stopPropagation();
        closeDropdown();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const q = inp.value.trim();
      if (!q) return;
      if (!currentSuggestions.length) currentSuggestions = searchCatalog(q, 6);
      const chosen = currentSuggestions[activeSuggIdx] || currentSuggestions[0];
      if (chosen) addOrIncrementItem(chosen);
    }
  });
}
if ($('needsSearchClear')) {
  $('needsSearchClear').onclick = () => {
    const inp = $('needsSearchInput');
    if (inp) { inp.value = ''; inp.focus(); }
    $('needsSearchClear').hidden = true;
    closeDropdown();
  };
}
if ($('needsSearchDropdown')) {
  $('needsSearchDropdown').addEventListener('mousedown', e => {
    // prevent input blur before click finishes
    e.preventDefault();
  });
  $('needsSearchDropdown').addEventListener('click', e => {
    const addBtn = e.target.closest('[data-sugg-add]');
    if (addBtn) {
      const idx = Number(addBtn.dataset.suggAdd);
      if (currentSuggestions[idx]) addOrIncrementItem(currentSuggestions[idx]);
      return;
    }
    const opt = e.target.closest('[data-sugg-idx]');
    if (opt) {
      const idx = Number(opt.dataset.suggIdx);
      if (currentSuggestions[idx]) addOrIncrementItem(currentSuggestions[idx]);
    }
  });
}
document.addEventListener('click', e => {
  const sbox = $('needsSearchBox');
  if (sbox && !sbox.contains(e.target) && !$('needsSearchDropdown')?.hidden) {
    closeDropdown();
  }
});

// Table / Card row interactions (+, −, delete, offers)
if ($('rows')) {
  $('rows').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const row = btn.closest('tr[data-key]');
    if (!row) return;
    const key = row.dataset.key;
    const item = items.find(i => i.key === key);
    if (!item) return;

    const act = btn.dataset.action;
    if (act === 'qty-inc') {
      item.qty = (Number(item.qty) || 0) + 1;
      item.unallocated = item.qty;
      working.qtyOverrides[key] = item.qty;
      const addRef = working.addedItems.find(a => a.key === key);
      if (addRef) addRef.qty = item.qty;
      saveWorking();
      renderKeep();
    } else if (act === 'qty-dec') {
      const next = (Number(item.qty) || 1) - 1;
      if (next <= 0) {
        removeItemWithUndo(key);
      } else {
        item.qty = next;
        item.unallocated = next;
        working.qtyOverrides[key] = next;
        const addRef = working.addedItems.find(a => a.key === key);
        if (addRef) addRef.qty = next;
        saveWorking();
        renderKeep();
      }
    } else if (act === 'delete') {
      removeItemWithUndo(key);
    } else if (act === 'offers') {
      openOffers(item);
    }
  });
}

// Undo button
if ($('needsUndoBtn')) $('needsUndoBtn').onclick = undoLastRemoval;

// Drafts Dialog events
if ($('closeDraftsDialog')) $('closeDraftsDialog').onclick = () => $('draftsDialog').close();
if ($('closeDraftsOk')) $('closeDraftsOk').onclick = () => $('draftsDialog').close();
if ($('draftsList')) {
  $('draftsList').addEventListener('click', async e => {
    const del = e.target.closest('[data-draft-del]');
    if (del) {
      const idx = Number(del.dataset.draftDel);
      const list = loadDraftsList();
      list.splice(idx, 1);
      saveDraftsList(list);
      updateDraftsCountUI();
      renderDraftsDialog();
      return;
    }
    const cp = e.target.closest('[data-draft-copy]');
    if (cp) {
      const idx = Number(cp.dataset.draftCopy);
      const d = loadDraftsList()[idx];
      if (!d) return;
      const text = (d.items || []).map((l, i) => `${i + 1}. ${l.name} × ${l.qty}`).join('\n');
      try { await navigator.clipboard.writeText(text); cp.textContent = 'اتنسخت ✓'; setTimeout(() => { cp.textContent = 'نسخ'; }, 1500); } catch {}
    }
  });
}

// Local Draft Preview Dialog events
if ($('closeLocalDraft')) $('closeLocalDraft').onclick = () => $('localDraftDialog').close();
if ($('closeLocalDraftOk')) $('closeLocalDraftOk').onclick = () => $('localDraftDialog').close();
if ($('viewAllDrafts')) $('viewAllDrafts').onclick = () => { $('localDraftDialog').close(); renderDraftsDialog(); $('draftsDialog').showModal(); };
if ($('copyLocalDraft')) {
  $('copyLocalDraft').onclick = async () => {
    try {
      await navigator.clipboard.writeText(lastDraftText);
      if ($('localDraftStatus')) $('localDraftStatus').textContent = 'تم نسخ القائمة بنجاح.';
    } catch {
      if ($('localDraftStatus')) $('localDraftStatus').textContent = 'النسخ غير متاح في المتصفح الحالي.';
    }
  };
}

// Settings & Offers & Session Banner
if ($('openSettings')) $('openSettings').onclick = () => openSettings();
if ($('refreshSellers')) $('refreshSellers').onclick = refreshSellers;
if ($('sellerSearch')) $('sellerSearch').oninput = renderSellers;
if ($('sellersAll')) $('sellersAll').onclick = () => { for (const s of sellers) { if (s.locked) continue; pendingSellerIds.add(String(s.id)); pendingExcludedSellers.delete(String(s.id)); } renderSellers(); };
if ($('sellersNone')) $('sellersNone').onclick = () => { for (const s of sellers) { if (s.locked) continue; pendingSellerIds.delete(String(s.id)); pendingExcludedSellers.add(String(s.id)); } renderSellers(); };
if ($('sellers')) {
  $('sellers').addEventListener('change', e => {
    const id = e.target.dataset.seller;
    if (!id) return;
    if (e.target.checked) { pendingSellerIds.add(id); pendingExcludedSellers.delete(id); }
    else { pendingSellerIds.delete(id); pendingExcludedSellers.add(id); }
    updateExcludedSummary();
  });
}
if ($('saveSettings')) {
  $('saveSettings').onclick = () => {
    for (const s of sellers) {
      if (s.locked) continue;
      const id = String(s.id);
      if (pendingSellerIds.has(id)) pendingExcludedSellers.delete(id);
      else pendingExcludedSellers.add(id);
    }
    prefs.aumetSellers = [...pendingSellerIds];
    prefs.excludedSellers = [...pendingExcludedSellers];
    prefs.suppliers = ['aumet', 'pharmaoverseas'].filter(id => $('supplier-' + id)?.checked);
    prefs.excludedSuppliers = ['aumet', 'pharmaoverseas'].filter(id => !$('supplier-' + id)?.checked);
    persist();
    $('settings').close();
    render();
  };
}
if ($('loadMock')) $('loadMock').onclick = () => { if ($('settings').open) $('settings').close(); loadMockData(); };
if ($('closeOffers')) $('closeOffers').onclick = () => $('offers').close();
if ($('renewSession')) $('renewSession').onclick = () => openSettings();
if ($('dismissSessionBanner')) $('dismissSessionBanner').onclick = hideSessionBanner;

// Close open dialogs on backdrop click
['needsFilterDialog', 'draftsDialog', 'localDraftDialog'].forEach(id => {
  const dlg = $(id);
  if (!dlg) return;
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
});

// Existing supplier cart review / fail-closed reconciliation dialogs (separate from Phase 1 local-only «جهّز طلبية»)
let orderPlan = null, orderSupplier = null, orderInFlight = false, orderPending = false, orderLoad = 0;
const orderKey = id => 'novaPendingSupplierOrder:' + id;
const orderError = code => ({
  'order-cart-empty': 'سلة حسابك عند المورد فارغة. أضف الأصناف للسلة أولًا.',
  'order-extra-sellers': 'سلة أوميت فيها مخازن خارج اختيارك؛ راجعها في أوميت أو عدّل اختيارات المخازن.',
  'order-cart-needs-review': 'المورد طلب مراجعة بعض الأصناف؛ راجع سلة حسابك عنده.',
  'order-minimum-not-met': 'إجمالي أحد المخازن أقل من الحد الأدنى للطلب.',
  'order-seller-unavailable': 'أحد المخازن غير متاح للتنفيذ حاليًا.',
  'order-cart-changed': 'السلة أو السعر أو الدفع اتغير بعد المراجعة؛ أغلق النافذة واقرأ السلة من جديد.',
  'cart-plan-expired': 'انتهت مدة المراجعة؛ أغلق النافذة واقرأ السلة من جديد.',
  'cart-session-changed': 'جلسة المورد اتجددت؛ أغلق النافذة واقرأ السلة من جديد.',
  'cart-account-busy': 'هناك عملية سابقة غير محسومة لهذا المورد؛ راجع نتيجتها قبل طلب جديد.',
  'cart-operation-pending': 'هذه العملية سبق إرسالها؛ استخدم التحقق من النتيجة، ولا تنشئ طلبًا جديدًا.',
  'cart-journal-unavailable': 'سجل التنفيذ غير متاح؛ لم يُرسل الطلب.',
  'order-not-started': 'الطلب لم يبدأ؛ يمكنك إغلاق النافذة وقراءة السلة من جديد.'
})[code] || 'تعذّر تأكيد النتيجة. راجع طلبات حسابك عند المورد؛ لن نعيد إرسال طلب الشراء تلقائيًا.';
function orderView(cart) {
  return `<h3>${esc(supplierName(cart.supplierId))}</h3><p>السلة: ${esc(cart.cartId)}</p><ul>${cart.lines.map(l => `<li>${esc(l.name)} — ${fmt(l.quantity)} × ${fmt(l.unitPrice)} = ${fmt(l.total)} ${esc(cart.currency)} ${l.seller ? ' · ' + esc(l.seller) : ''}</li>`).join('')}</ul><p>الإجمالي النهائي: <strong>${fmt(cart.total)} ${esc(cart.currency)}</strong></p><p>الضريبة: ${fmt(cart.tax)} · الخصم: ${fmt(cart.discount)}</p><p>طريقة الدفع المسجلة: ${esc(cart.payment)}</p><p>التوصيل: ${esc(cart.delivery)}</p>`;
}
function orderControls() {
  if (!$('submitSupplierOrder')) return;
  $('submitSupplierOrder').disabled = orderInFlight || orderPending || !orderPlan || !$('orderConfirmed').checked || (orderSupplier === 'pharmaoverseas' && !$('orderTerms').checked);
  $('closeOrder').disabled = orderInFlight;
  $('checkSupplierOrder').disabled = orderInFlight;
  $('orderConfirmed').disabled = orderInFlight || orderPending;
  $('orderTerms').disabled = orderInFlight || orderPending;
}
async function openOrder(supplier) {
  if (busy || orderInFlight || !$('orderDialog')) return;
  const loading = ++orderLoad;
  orderSupplier = supplier; orderPlan = null; orderPending = false;
  $('orderConfirmed').checked = false; $('orderTerms').checked = false;
  $('orderTermsLabel').hidden = supplier !== 'pharmaoverseas';
  $('checkSupplierOrder').hidden = true;
  $('orderCart').textContent = 'جارٍ قراءة السلة الفعلية…';
  $('orderStatus').textContent = '';
  $('orderTitle').textContent = 'مراجعة طلب ' + supplierName(supplier);
  $('orderDialog').showModal();
  orderControls();
  try {
    const saved = JSON.parse(localStorage.getItem(orderKey(supplier)) || 'null');
    if (saved) {
      orderPlan = saved.plan; orderPending = true;
      $('orderCart').innerHTML = orderView(saved.cart);
      $('checkSupplierOrder').hidden = false;
      $('orderStatus').textContent = 'هناك محاولة تنفيذ سابقة. سنقرأ نتيجتها فقط؛ لن نرسل طلب شراء جديدًا.';
    } else {
      const result = await provider().previewSupplierOrder(supplier, prefs.aumetSellers);
      if (loading !== orderLoad) return;
      if (!result.ok) throw new Error(result.error);
      orderPlan = result;
      $('orderCart').innerHTML = orderView(result.cart);
    }
  } catch (e) {
    if (loading !== orderLoad) return;
    $('orderCart').textContent = '';
    $('orderStatus').textContent = orderError(e.message);
  } finally { orderControls(); }
}
function orderReceipt(result) {
  const ids = (result.orderIds || []).map(String).join('، ');
  if (result.ok && result.state === 'verified') {
    localStorage.removeItem(orderKey(orderSupplier));
    orderPlan = null; orderPending = false;
    $('checkSupplierOrder').hidden = true;
    $('orderStatus').textContent = `تم تنفيذ الطلب والتحقق منه عند ${supplierName(orderSupplier)}. رقم الطلب: ${ids}. الإجمالي ${fmt(result.total)} ${result.currency}.`;
  } else {
    $('orderStatus').textContent = `${orderError(result.error)}${ids ? ' أرقام مستلمة تحتاج تحقق: ' + ids : ''}`;
    $('checkSupplierOrder').hidden = false;
  }
}
function fillSupplierCarts() {
  const groups = groupCart(items), lang = localStorage.getItem('nova-rx-language'), S = window.NovaSupplierStatus;
  for (const id of ['aumet', 'pharmaoverseas']) {
    const c = document.querySelector('#scCards [data-sc="' + id + '"]');
    if (!c) continue;
    const gs = groups.filter(g => g.supplierId === id), n = gs.reduce((s, g) => s + g.lines.length, 0), b = gs.reduce((s, g) => s + g.lines.reduce((t, l) => t + (Number(l.qty) || 0), 0), 0), t = gs.reduce((s, g) => s + (Number(g.total) || 0), 0);
    c.querySelector('[data-sc-stats]').innerHTML = n ? `<div><b>${fmt(n)} صنف</b><small>في التوزيع</small></div><div><b>${fmt(b)}</b><small>علبة</small></div><div><b>${fmt(t)}</b><small>ج.م</small></div>` : '<p>مفيش أصناف متوزعة عليه دلوقتي.</p>';
    let pending = false; try { pending = !!localStorage.getItem(orderKey(id)); } catch {}
    const on = prefs.suppliers.includes(id) && !prefs.excludedSuppliers.includes(id), tag = c.querySelector('[data-sc-tag]');
    const tg = pending ? ['pending', 'طلب مستني تحقق'] : on ? ['on', 'مختار'] : ['off', 'مش مختار'];
    tag.hidden = false; tag.dataset.state = tg[0]; tag.textContent = tg[1];
    c.dataset.empty = n ? '0' : '1';
    const cn = c.querySelector('[data-sc-conn]'); cn.dataset.state = ''; cn.textContent = mockScenario ? 'بيانات تجريبية' : 'جارٍ فحص الاتصال…';
  }
  if (mockScenario || !provider()) return;
  provider().listSuppliers().then(list => {
    for (const id of ['aumet', 'pharmaoverseas']) {
      const s = (list || []).find(x => x.id === id) || { id, state: 'unknown' }, k = S ? S.classify(s) : 'unknown', cn = document.querySelector('#scCards [data-sc="' + id + '"] [data-sc-conn]');
      if (cn) { cn.dataset.state = k; cn.textContent = S ? S.label(k, lang) : 'غير معروف'; }
    }
  }).catch(() => { document.querySelectorAll('#scCards [data-sc-conn]').forEach(cn => { cn.dataset.state = 'unknown'; cn.textContent = 'تعذر فحص الاتصال'; }); });
}
if ($('openSupplierCarts')) $('openSupplierCarts').onclick = () => { if ($('draftsDialog')?.open) $('draftsDialog').close(); fillSupplierCarts(); $('supplierCarts').showModal(); };
if ($('closeSupplierCarts')) $('closeSupplierCarts').onclick = () => $('supplierCarts').close();
document.querySelectorAll('[data-review-order]').forEach(b => b.onclick = () => openOrder(b.dataset.reviewOrder));
if ($('closeOrder')) $('closeOrder').onclick = () => { if (!orderInFlight) { orderLoad++; orderPlan = null; $('orderDialog').close(); } };
if ($('orderDialog')) $('orderDialog').addEventListener('cancel', e => { if (orderInFlight) e.preventDefault(); else { orderLoad++; orderPlan = null; } });
if ($('orderConfirmed')) $('orderConfirmed').onchange = orderControls;
if ($('orderTerms')) $('orderTerms').onchange = orderControls;
if ($('submitSupplierOrder')) {
  $('submitSupplierOrder').onclick = async () => {
    if ($('submitSupplierOrder').disabled || !orderPlan || orderPending) return;
    if (!dashboardPin && !PINLESS) { // q17 C: sending a real order is the only step that still needs the dashboard PIN
      orderInFlight = true; orderControls();
      let ok = false; try { ok = await sendPinOk(); } finally { orderInFlight = false; orderControls(); }
      if (!ok) return;
    }
    orderInFlight = true; orderControls();
    try {
      localStorage.setItem(orderKey(orderSupplier), JSON.stringify({ plan: orderPlan, cart: orderPlan.cart }));
      orderPending = true;
      $('orderStatus').textContent = 'جارٍ إرسال الطلب والتحقق من رقم المورد…';
      orderReceipt(await provider().applySupplierOrder({ plan: orderPlan.plan, signature: orderPlan.signature, confirmed: true, termsAccepted: $('orderTerms').checked }));
    } catch (e) {
      if (['cart-plan-expired', 'order-cart-changed', 'cart-session-changed', 'order-confirmation-required', 'order-terms-required', 'order-cart-empty', 'order-minimum-not-met', 'order-extra-sellers'].includes(e.message)) {
        localStorage.removeItem(orderKey(orderSupplier)); orderPending = false; orderPlan = null;
      }
      $('orderStatus').textContent = orderError(e.message);
      $('checkSupplierOrder').hidden = !orderPending;
    } finally { orderInFlight = false; orderControls(); }
  };
}
// q17 C: PIN step inside the order dialog (only for sending). Verified against the stock source (200 = right PIN),
// then kept in sessionStorage like PERF-05.
async function sendPinOk() {
  if (dashboardPin || PINLESS) return true;
  let row = $('orderPinRow');
  const input = () => $('orderPin');
  if (!row) {
    row = document.createElement('div'); row.id = 'orderPinRow'; row.className = 'order-pin-row';
    row.innerHTML = '<label for="orderPin">اكتب رقم الداشبورد علشان ترسل الطلب</label><input id="orderPin" class="needs-pin-input" type="password" inputmode="numeric" autocomplete="off" placeholder="• • • •"><small id="orderPinHint" role="status"></small>';
    const btn = $('submitSupplierOrder'); btn.parentNode.insertBefore(row, btn);
    input().addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('submitSupplierOrder').click(); } });
  }
  const v = (input().value || '').trim();
  if (!v) { $('orderPinHint').textContent = 'محتاج رقم الداشبورد قبل الإرسال.'; input().focus(); return false; }
  $('orderPinHint').textContent = 'جارٍ التأكد من الرقم…';
  try {
    const r = await fetchStock(v, false);
    if (!r || !r.ok) throw new Error((r && r.error) || 'source-auth-required');
    dashboardPin = v; setSessionPin(v); input().value = ''; row.remove();
    return true;
  } catch (e) {
    $('orderPinHint').textContent = e.message === 'source-auth-required' ? 'الرقم غير صحيح، جرّب مرة أخرى.' : 'تعذر التأكد من الرقم؛ أعد المحاولة.';
    input().select(); return false;
  }
}
if ($('checkSupplierOrder')) {
  $('checkSupplierOrder').onclick = async () => {
    if (orderInFlight || !orderPlan) return;
    orderInFlight = true; orderControls();
    try {
      const r = await provider().supplierOrderStatus({ plan: orderPlan.plan, signature: orderPlan.signature });
      if (r.state === 'not-started' || r.state === 'failed') {
        localStorage.removeItem(orderKey(orderSupplier)); orderPending = false; orderPlan = null;
        $('checkSupplierOrder').hidden = true; $('orderStatus').textContent = orderError('order-not-started');
      } else orderReceipt(r);
    } catch (e) { $('orderStatus').textContent = orderError(e.message); }
    finally { orderInFlight = false; orderControls(); }
  };
}

// Page-scoped keyboard shortcuts (ONLY on /purchases, NEVER on the sale screen)
document.addEventListener('keydown', e => {
  if (activeTab !== 'needs') return;
  if (e.key === 'Escape') {
    if ($('needsSearchDropdown') && !$('needsSearchDropdown').hidden) {
      e.preventDefault();
      closeDropdown();
    }
    return;
  }
  if (needPin || loadingStock) return;
  if (document.querySelector('dialog[open]')) return;

  if (e.key === 'F2') {
    e.preventDefault();
    const inp = $('needsSearchInput');
    if (inp) { inp.focus(); inp.select(); }
    return;
  }
  if (e.key === 'Enter') {
    const t = e.target;
    const tag = (t && t.tagName ? t.tagName : '').toLowerCase();
    const inControl = ['input', 'textarea', 'select', 'button', 'a', 'summary'].includes(tag) || Boolean(t && t.isContentEditable);
    if (!inControl && $('needsSearchDropdown')?.hidden) {
      e.preventDefault();
      prepareLocalOrder();
    }
  }
});

// Keep active tab scrolled into view on mobile topbar
(function () {
  try {
    const a = document.querySelector('.nova-topbar nav [aria-current]');
    if (a && a.scrollIntoView) a.scrollIntoView({ inline: 'center', block: 'nearest' });
  } catch {}
})();

// Boot
syncFilterUI();
updateDraftsCountUI();
showTab(tabFromHash(location.hash), { push: false });
loadStock(true);
checkSessions();
