// Glue between the modules, so the integration is real code and not a test-only trick:
//   CAT-01 catalog + CAT-02 conversion  ->  POS sale lines for the stock core
//   stock core shortages                ->  purchase quantities (in purchase packs) for worker/procurement/po-draft.js
//   approved PO draft                   ->  purchase order lines in base units for goods receipt
// Pure, no I/O. Packaging comes from `packagingOf(productId)` (CAT-02 shape); the catalog product has no packaging field yet.
import { toBaseUnits, fromBaseUnits, allocateLinePrices, normalizePackaging } from '../catalog/unit-conversion.js';

const ok = value => ({ ok: true, ...value });
const fail = (error, detail) => ({ ok: false, error, detail });

// items = [{ code | barcode, lines: [{ qty, unit }] }]. The catalog price is the price of ONE priceUnit (default 'box').
export function buildSaleLines(catalog, packagingOf, items, { priceUnit = 'box' } = {}) {
  if (!Array.isArray(items) || items.length === 0) return fail('items-empty');
  const out = [];
  for (const [i, item] of items.entries()) {
    const product = (item.barcode ? catalog.findByBarcode(item.barcode) : null) ?? (item.code ? catalog.findById(item.code) : null);
    if (!product) return fail('product-not-found', { index: i });
    if (product.active === false) return fail('product-inactive', { productId: product.id });
    if (product.price === null || product.price === undefined) return fail('price-missing', { productId: product.id });
    const def = packagingOf(product.id);
    if (!def) return fail('packaging-missing', { productId: product.id });
    if (!Array.isArray(item.lines) || item.lines.length === 0) return fail('lines-empty', { productId: product.id });
    const priced = allocateLinePrices(product.price, priceUnit, item.lines.map(l => ({ qty: l.qty, unit: l.unit })), def);
    if (!priced.ok) return fail(priced.error, { productId: product.id });
    for (const [j, l] of item.lines.entries()) {
      const base = toBaseUnits(l.qty, l.unit, def, { requireWhole: true });
      if (!base.ok) return fail(base.error, { productId: product.id, line: j });
      out.push({ productId: product.id, qtyBase: base.value, lineTotalCents: Math.round(priced.lines[j] * 100) });
    }
  }
  return ok({ lines: out, totalCents: out.reduce((n, l) => n + l.lineTotalCents, 0) });
}

// shortages from the stock core -> what to ask suppliers for, in whole purchase packs (boxes), rounding UP so the max is reached.
export function planReplenishment(shortages, catalog, packagingOf, { purchaseUnit = 'box' } = {}) {
  const plan = [], skipped = [];
  for (const sh of shortages) {
    const product = catalog.findById(sh.productId); const def = packagingOf(sh.productId);
    const pack = def ? normalizePackaging(def) : null;
    const factor = pack && pack.ok ? pack.factors[purchaseUnit] : null;
    if (!product || !factor) { skipped.push({ productId: sh.productId, reason: !product ? 'product-not-found' : 'packaging-missing' }); continue; }
    plan.push({ productId: sh.productId, name: product.nameAr || product.nameEn, qty: Math.ceil(sh.needBase / factor), needBase: sh.needBase });
  }
  return { plan, skipped };
}

// an approved draft (po-draft.js) -> PO lines in base units. `nameToProductId` maps the names we sent to suppliers.
export function poLinesFromDraft(draft, nameToProductId, packagingOf, { purchaseUnit = 'box' } = {}) {
  if (!draft || draft.status !== 'approved') return fail('draft-not-approved');
  const lines = new Map();
  for (const l of draft.lines) {
    const productId = nameToProductId.get(l.name);
    if (!productId) return fail('line-unmapped', { name: l.name });
    const def = packagingOf(productId);
    const base = def ? toBaseUnits(l.qty, purchaseUnit, def, { requireWhole: true }) : null;
    if (!base || !base.ok) return fail('line-not-convertible', { name: l.name });
    lines.set(productId, (lines.get(productId) ?? 0) + base.value);
  }
  return ok({ lines: [...lines].map(([productId, orderedBase]) => ({ productId, orderedBase })) });
}

export { fromBaseUnits };
