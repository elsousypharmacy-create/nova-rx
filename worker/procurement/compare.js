// Price comparison engine on comparable units (Epic #53, task 06).
// Supplier-agnostic: no supplier ids are hard-coded anywhere in this module.
// Dependency-free ES module; runs in Cloudflare Workers and Node 22.

import { parseProductName, comparableUnitPrice, matchOffersToItem } from './normalize.js';

const MIN_SCORE = 0.8;

const parsedCache = new Map();
function parseCached(name) {
  let hit = parsedCache.get(name);
  if (!hit) {
    if (parsedCache.size > 50000) parsedCache.clear();
    hit = parseProductName(name);
    parsedCache.set(name, hit);
  }
  return hit;
}

function isStale(offer, now, staleAfterMs) {
  const ts = Date.parse(offer?.lastUpdated ?? '');
  if (Number.isNaN(ts)) return false;
  return now - ts > staleAfterMs;
}

function compareRows(a, b) {
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
  const pa = a.unitPriceComparable;
  const pb = b.unitPriceComparable;
  if (pa === null && pb === null) {
    // fall through to tie-breakers
  } else if (pa === null) return 1;
  else if (pb === null) return -1;
  else if (pa !== pb) return pa - pb;
  const da = a.offer?.discountPct ?? -Infinity;
  const db = b.offer?.discountPct ?? -Infinity;
  if (da !== db) return db - da;
  const sa = String(a.offer?.supplierId ?? '');
  const sb = String(b.offer?.supplierId ?? '');
  if (sa !== sb) return sa < sb ? -1 : 1;
  // Marketplace suppliers (e.g. one row per seller) must stay distinct offers.
  const ea = String(a.offer?.sellerId ?? '');
  const eb = String(b.offer?.sellerId ?? '');
  return ea < eb ? -1 : ea > eb ? 1 : 0;
}

export function compareForItem(item, offers, opts = {}) {
  const { requestedQty = 1, staleAfterMs = 6 * 3600 * 1000, now = Date.now(), minScore = MIN_SCORE } = opts;

  const matches = matchOffersToItem(item, offers).filter((m) => m.score >= minScore);

  const rows = matches.map((m) => {
    const parsed = parseCached(m.offer?.productName ?? '');
    const reasons = [];
    if (isStale(m.offer, now, staleAfterMs)) reasons.push('stale');
    if (m.offer?.stockStatus === 'out_of_stock') reasons.push('out_of_stock');
    const moq = m.offer?.minimumOrderQuantity;
    if (typeof moq === 'number' && moq > requestedQty) reasons.push('MOQ');
    return {
      offer: m.offer,
      score: m.score,
      unitPriceComparable: comparableUnitPrice(m.offer, parsed),
      packPrice: m.offer?.netEffectivePrice ?? m.offer?.unitPrice ?? null,
      eligible: reasons.length === 0,
      reasons,
      packCount: parsed.pack?.count ?? null,
      flagged: m.needsReview === true,
    };
  });

  rows.sort(compareRows);

  const eligibleRows = rows.filter((r) => r.eligible);
  const bestRow = eligibleRows[0] ?? null;
  const nextRow = eligibleRows[1] ?? null;

  let savingsVsNext = null;
  if (
    bestRow &&
    nextRow &&
    bestRow.unitPriceComparable !== null &&
    nextRow.unitPriceComparable !== null &&
    bestRow.packCount !== null
  ) {
    savingsVsNext =
      Math.round((nextRow.unitPriceComparable - bestRow.unitPriceComparable) * bestRow.packCount * 100) / 100;
  }

  let needsReview = rows.some((r) => r.flagged);
  if (
    bestRow &&
    nextRow &&
    bestRow.packCount !== null &&
    nextRow.packCount !== null &&
    bestRow.packCount !== nextRow.packCount
  ) {
    needsReview = true;
  }

  return {
    item,
    best: bestRow ? bestRow.offer : null,
    offers: rows.map(({ offer, score, unitPriceComparable, packPrice, eligible, reasons }) => ({
      offer,
      score,
      unitPriceComparable,
      packPrice,
      eligible,
      reasons,
    })),
    savingsVsNext,
    needsReview,
  };
}

export function compareMany(items, offers, opts) {
  return (items ?? []).map((item) => compareForItem(item, offers, opts));
}
