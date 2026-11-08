// UI model for the supplier lookup on the sale screen (Epic #53, task 08).
// Pure logic, dependency-free ES module; runs in the browser and Node 22.
// Nothing in this module sends anything anywhere.

import { parseProductName } from './normalize.js';

const UNIT_WORDS = {
  tab: 'القرص',
  cap: 'الكبسولة',
  sachet: 'الكيس',
  supp: 'التحميلة',
  amp: 'الأمبول',
  vial: 'الفيال',
  ml: 'المل',
  drops: 'النقطة',
  bottle: 'الزجاجة',
  strip: 'الشريط',
};

export const SUGGESTIONS_NOTE = 'بدائل اقترحها المورد (غالباً نفس المادة الفعالة، راجعها)';

const parsedCache = new Map();
function parseCached(name) {
  let hit = parsedCache.get(name);
  if (!hit) {
    if (parsedCache.size > 10000) parsedCache.clear();
    hit = parseProductName(name);
    parsedCache.set(name, hit);
  }
  return hit;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

export function stockUnitState(stock, lowLimit = 30) {
  const n = Number.isFinite(Number(stock)) ? Number(stock) : 0;
  const low = n < lowLimit;
  return { tone: low ? 'low' : 'ok', label: low ? `الرصيد ${n} · منخفض` : `الرصيد ${n}` };
}

function stockLabelFor(offer) {
  if (offer?.stockStatus === 'out_of_stock') return 'غير متوفر';
  if (Number.isFinite(offer?.availableQuantity)) return `الرصيد ${offer.availableQuantity}`;
  return 'متوفر';
}

function discountPctFor(offer, packPrice) {
  if (Number.isFinite(offer?.discountPct)) return round2(offer.discountPct);
  const pub = offer?.publicPrice;
  if (Number.isFinite(pub) && pub > 0 && Number.isFinite(packPrice)) {
    return round2((1 - packPrice / pub) * 100);
  }
  return null;
}

function unitPriceLabelFor(row) {
  const up = row.unitPriceComparable;
  if (!Number.isFinite(up)) return '';
  const word = UNIT_WORDS[parseCached(row.offer?.productName ?? '').pack?.unit] ?? null;
  const price = round2(up).toFixed(2);
  return word ? `سعر ${word} ${price} ج.م` : `سعر الوحدة ${price} ج.م`;
}

function toRow(row) {
  const offer = row.offer ?? {};
  const supplierId = String(offer.supplierId ?? '');
  return {
    key: `${supplierId}::${offer.sellerId ?? ''}::${offer.productName ?? ''}`,
    supplierId,
    supplierName: offer.supplierName ?? supplierId,
    sellerName: offer.sellerName ?? offer.sellerId ?? null,
    productName: offer.productName ?? '',
    packPrice: Number.isFinite(row.packPrice) ? round2(row.packPrice) : null,
    publicPrice: Number.isFinite(offer.publicPrice) ? round2(offer.publicPrice) : null,
    discountPct: discountPctFor(offer, row.packPrice),
    stockLabel: stockLabelFor(offer),
    stockStatus: offer.stockStatus ?? 'unknown',
    unitPriceLabel: unitPriceLabelFor(row),
    best: false,
    eligible: row.eligible === true,
    reasons: Array.isArray(row.reasons) ? [...row.reasons] : [],
  };
}

function groupRows(offers) {
  const groups = [];
  const byId = new Map();
  for (const raw of offers ?? []) {
    const row = toRow(raw);
    let g = byId.get(row.supplierId);
    if (!g) {
      g = { supplierId: row.supplierId, supplierName: row.supplierName, rows: [] };
      byId.set(row.supplierId, g);
      groups.push(g);
    }
    g.rows.push(row);
  }
  return groups;
}

// Accepts a single compareForItem result or the provider search payload
// ({ fetchedAt, results: [compareForItem, ...alternatives], suppliers }).
export function buildLookupModel(compareResult, { requestedQty = 1 } = {}) {
  void requestedQty;
  const results = Array.isArray(compareResult?.results) ? compareResult.results : [compareResult];
  const primary = results[0] ?? { item: null, offers: [] };
  const altResults = results.slice(1);

  const groups = groupRows(primary.offers);
  const altGroups = altResults.map((r) => ({
    itemName: r?.item?.name ?? r?.item?.productName ?? '',
    groups: groupRows(r?.offers),
  })).filter((a) => a.groups.length > 0);

  let best = null;
  for (const g of groups) {
    for (const row of g.rows) {
      if (!best && row.eligible) {
        row.best = true;
        best = row;
      }
    }
  }

  return {
    title: primary.item?.name ?? primary.item?.productName ?? '',
    best,
    groups,
    altGroups,
    suggestionsNote: altGroups.length > 0 ? SUGGESTIONS_NOTE : null,
  };
}

const DRAFT_KEY = 'novaSupplierDraft';

function clampQty(qty) {
  const n = Math.floor(Number(qty));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(999, n);
}

export function createDraftStore(storage) {
  const entries = new Map();
  try {
    const raw = storage?.getItem?.(DRAFT_KEY);
    if (raw) {
      for (const e of JSON.parse(raw)) {
        if (e && typeof e.key === 'string') entries.set(e.key, { ...e, qty: clampQty(e.qty) });
      }
    }
  } catch {
    entries.clear();
  }

  const persist = () => {
    try {
      storage?.setItem?.(DRAFT_KEY, JSON.stringify([...entries.values()]));
    } catch {
      /* storage full or unavailable: keep the in-memory draft */
    }
  };

  return {
    add(row, qty = 1) {
      const existing = entries.get(row.key);
      if (existing) {
        existing.qty = clampQty(existing.qty + clampQty(qty));
      } else {
        entries.set(row.key, {
          key: row.key,
          row,
          qty: clampQty(qty),
          supplierId: row.supplierId ?? '',
          supplierName: row.supplierName ?? row.supplierId ?? '',
        });
      }
      persist();
    },
    setQty(key, qty) {
      const e = entries.get(key);
      if (!e) return;
      e.qty = clampQty(qty);
      persist();
    },
    remove(key) {
      entries.delete(key);
      persist();
    },
    list() {
      return [...entries.values()];
    },
    bySupplier() {
      const out = new Map();
      for (const e of entries.values()) {
        let g = out.get(e.supplierId);
        if (!g) {
          g = { supplierId: e.supplierId, supplierName: e.supplierName, items: [] };
          out.set(e.supplierId, g);
        }
        g.items.push(e);
      }
      return [...out.values()];
    },
  };
}
