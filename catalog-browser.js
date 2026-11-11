// U1-0: browser data layer for the sale screen. Loads the read-only STOCK LIVE snapshot, builds the CAT-01 catalog and the
// CAT-05 index, and exposes window.NovaCatalog. No writes, no network other than one GET of the snapshot.
// Stock: the export's `units` is passed through as `stock` only when it is a finite number; otherwise null (unknown).
import { createUnifiedCatalog } from './worker/catalog/unified-catalog.js';
import { createSearchIndex } from './worker/catalog/catalog-search.js';

export const SNAPSHOT_URL = 'data/emergency-stock.json';

// product in the shape the sale screen already uses: {id, barcode, name «عربي (English)», generic, form, price, stock, category}
export function toSaleProduct(p, stockById) {
  const name = p.nameAr && p.nameEn ? `${p.nameAr} (${p.nameEn})` : (p.nameAr || p.nameEn);
  const units = stockById.get(p.id);
  return {
    id: p.id, barcode: p.barcodes[0] ?? '', name, generic: p.activeIngredient || '', form: p.form || '',
    price: p.price, stock: Number.isFinite(units) ? units : null, category: p.category || '', active: p.active, packaging: p.packaging ?? null,
  };
}

export function buildBrowserCatalog(items) {
  const rows = Array.isArray(items) ? items : [];
  const stockById = new Map();
  for (const r of rows) if (r && r.code !== undefined && typeof r.units === 'number') stockById.set(String(r.code), r.units);
  const catalog = createUnifiedCatalog(rows);
  const index = createSearchIndex(catalog);
  const wrap = p => (p ? toSaleProduct(p, stockById) : null);
  return {
    size: index.size,
    rejected: catalog.rejected.length,
    search: (q, opts) => index.search(q, opts).map(r => wrap(r.product)),
    byBarcode: b => wrap(catalog.findByBarcode(b)),
    byId: id => wrap(catalog.findById(id)),
    products: () => catalog.getAll().map(wrap),
  };
}

export async function loadNovaCatalog(fetchImpl = globalThis.fetch, url = SNAPSHOT_URL) {
  const res = await fetchImpl(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`snapshot-http-${res.status}`);
  const data = await res.json();
  return buildBrowserCatalog(data.items);
}

if (typeof window !== 'undefined') {
  const api = { ready: false, error: null, search: () => [], byBarcode: () => null, byId: () => null, products: () => [] };
  window.NovaCatalog = api;
  api.whenReady = loadNovaCatalog().then(c => {
    Object.assign(api, c, { ready: true });
    window.dispatchEvent(new Event('nova-catalog-ready'));
    return api;
  }).catch(e => { api.error = String(e && e.message || e); window.dispatchEvent(new Event('nova-catalog-error')); return api; });
}
