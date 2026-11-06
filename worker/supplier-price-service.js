/**
 * NOVA Rx — supplier price comparison prototype (synthetic fixtures only).
 * Dependency-free; read-only; no network, cart, auth, or persistence of real data.
 * Safe for browser and Node tests.
 */

export const SUPPLIER_OFFER_FIXTURES = Object.freeze([
  { supplier: 'United Pharma', productCode: 'PCM-500', productName: 'Paracetamol 500mg 20 tab', priceEgp: 18.5, discountPct: 5, stock: 240, timestamp: '2026-11-01T09:00:00Z' },
  { supplier: 'El Motawakel', productCode: 'PCM-500', productName: 'Paracetamol 500mg 20 tab', priceEgp: 19.0, discountPct: 8, stock: 90, timestamp: '2026-11-02T10:30:00Z' },
  { supplier: 'Cairo Drug Store', productCode: 'PCM-500', productName: 'Paracetamol 500mg 20 tab', priceEgp: 18.0, stock: 0, timestamp: '2026-11-03T08:15:00Z' },
  { supplier: 'United Pharma', productCode: 'AMX-250', productName: 'Amoxicillin 250mg 12 cap', priceEgp: '32.00', discountPct: 0, stock: 150, timestamp: '2026-11-01T09:00:00Z' },
  { supplier: 'Delta Medical', productCode: 'AMX-250', productName: 'Amoxicillin 250mg 12 cap', priceEgp: 30.75, discountPct: 3, stock: 60, timestamp: '2026-11-04T12:00:00Z' },
  { supplier: 'El Motawakel', productCode: 'AMX-250', productName: 'Amoxicillin 250mg 12 cap', priceEgp: 31.5, discountPct: 6, timestamp: '2026-11-02T10:30:00Z' },
  { supplier: 'Cairo Drug Store', productCode: 'IBU-400', productName: 'Ibuprofen 400mg 20 tab', priceEgp: 24.25, discountPct: 10, stock: 300, timestamp: '2026-11-03T08:15:00Z' },
  { supplier: 'Delta Medical', productCode: 'IBU-400', productName: 'Ibuprofen 400mg 20 tab', discountPct: 4, stock: 120, timestamp: '2026-11-04T12:00:00Z' },
  { supplier: 'United Pharma', productCode: 'IBU-400', productName: 'Ibuprofen 400mg 20 tab', priceEgp: 23.9, discountPct: 2, stock: 75 },
  { supplier: 'El Motawakel', productCode: 'OMZ-20', productName: 'Omeprazole 20mg 14 cap', priceEgp: 27.0, discountPct: 0, stock: 45, timestamp: '2026-11-02T10:30:00Z' }
]);

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toIsoOrNull(value) {
  if (typeof value !== 'string' || !value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function textOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Normalizes one raw offer. Missing/invalid fields become null (0 for discount)
 * and are listed in `missing` so the UI can mark them without guessing values.
 */
export function normalizeOffer(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const supplier = textOrNull(source.supplier);
  const productCode = textOrNull(source.productCode);
  const productName = textOrNull(source.productName);
  const priceEgp = toNumberOrNull(source.priceEgp);
  const stock = toNumberOrNull(source.stock);
  const timestamp = toIsoOrNull(source.timestamp);
  const discountPct = Math.min(Math.max(toNumberOrNull(source.discountPct) ?? 0, 0), 100);
  const missing = [];
  if (!supplier) missing.push('supplier');
  if (!productCode) missing.push('productCode');
  if (!productName) missing.push('productName');
  if (priceEgp === null || priceEgp < 0) missing.push('priceEgp');
  if (stock === null) missing.push('stock');
  if (timestamp === null) missing.push('timestamp');
  const effectivePriceEgp = priceEgp === null || priceEgp < 0
    ? null
    : Math.round(priceEgp * (1 - discountPct / 100) * 100) / 100;
  return { supplier, productCode, productName, priceEgp, discountPct, stock, timestamp, effectivePriceEgp, missing };
}

export function normalizeOffers(rawOffers) {
  return (Array.isArray(rawOffers) ? rawOffers : []).map(normalizeOffer);
}

/**
 * Deterministic comparison: offers with a usable price, sorted by effective
 * price asc, then supplier asc, then product code asc. Index tie-break keeps
 * the order stable across engines. `best` marks the cheapest offer per product.
 */
export function compareOffers(offers) {
  const ranked = normalizeOffers(offers)
    .map((offer, index) => ({ offer, index }))
    .filter(entry => entry.offer.effectivePriceEgp !== null)
    .sort((a, b) =>
      a.offer.effectivePriceEgp - b.offer.effectivePriceEgp ||
      String(a.offer.supplier).localeCompare(String(b.offer.supplier), 'en') ||
      String(a.offer.productCode).localeCompare(String(b.offer.productCode), 'en') ||
      a.index - b.index
    )
    .map(entry => entry.offer);
  const cheapestByProduct = new Map();
  for (const offer of ranked) {
    const key = offer.productCode ?? '';
    if (!cheapestByProduct.has(key)) cheapestByProduct.set(key, offer.effectivePriceEgp);
  }
  return ranked.map(offer => ({
    ...offer,
    best: offer.effectivePriceEgp === cheapestByProduct.get(offer.productCode ?? '')
  }));
}

/**
 * Clamped pagination. Page numbers are 1-based; out-of-range pages clamp to
 * the valid range so the UI can never render an empty "phantom" page.
 */
export function paginate(items, page = 1, pageSize = 5) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Math.floor(toNumberOrNull(pageSize) ?? 5));
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(toNumberOrNull(page) ?? 1)), pages);
  return {
    items: list.slice((current - 1) * size, current * size),
    page: current,
    pages,
    pageSize: size,
    total
  };
}
