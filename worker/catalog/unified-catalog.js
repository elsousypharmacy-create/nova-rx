// CAT-01 unified product catalog. Pure module: no I/O, no network, no writes to any live sheet.
// Rule: bad data is rejected with a reason, never defaulted; a duplicate is never merged without a named pharmacist reviewer.

const ARABIC = /[؀-ۿ]/;
const DIGIT_MAP = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };

export function normalizeDigits(text) {
  return String(text ?? '').replace(/[٠-٩۰-۹]/g, ch => DIGIT_MAP[ch]);
}

export function sanitizeCatalogText(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/\s+/g, ' ').trim();
}

export function normalizeArabicSearchKey(text) {
  return normalizeDigits(sanitizeCatalogText(text)).toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns the digits of a barcode (8-14 digits) or null. Letters are never stripped: a code with letters is not a barcode.
export function normalizeBarcode(barcode) {
  if (barcode === null || barcode === undefined) return null;
  const s = normalizeDigits(barcode).replace(/[\s-]/g, '');
  return /^\d{8,14}$/.test(s) ? s : null;
}

const pick = (r, ...names) => { for (const n of names) if (r[n] !== undefined && r[n] !== null && r[n] !== '') return r[n]; return undefined; };
const freeze = p => { Object.freeze(p.barcodes); return Object.freeze(p); };

// -> { ok, product, errors }. Error codes: record-invalid, id-missing, name-missing, price-invalid, packSize-invalid, barcode-invalid.
export function normalizeProductRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok: false, product: null, errors: ['record-invalid'] };
  const errors = [];
  const rawId = pick(record, 'id', 'code');
  const id = rawId === undefined ? '' : sanitizeCatalogText(rawId);
  if (!id) errors.push('id-missing');

  let nameAr = sanitizeCatalogText(pick(record, 'nameAr', 'namear', 'name_ar', 'arabicName'));
  let nameEn = sanitizeCatalogText(pick(record, 'nameEn', 'nameen', 'name_en', 'englishName'));
  const generic = sanitizeCatalogText(pick(record, 'name', 'title'));
  if (generic) { if (ARABIC.test(generic)) nameAr = nameAr || generic; else nameEn = nameEn || generic; }
  if (!nameAr && !nameEn) errors.push('name-missing');

  const rawCodes = [];
  for (const v of [pick(record, 'barcodes'), pick(record, 'barcode'), pick(record, 'gtin')]) {
    if (Array.isArray(v)) rawCodes.push(...v); else if (v !== undefined) rawCodes.push(v);
  }
  const barcodes = [];
  for (const raw of rawCodes) {
    if (sanitizeCatalogText(raw) === '') continue;
    const b = normalizeBarcode(raw);
    if (b === null) { if (!errors.includes('barcode-invalid')) errors.push('barcode-invalid'); continue; }
    if (!barcodes.includes(b)) barcodes.push(b);
  }

  let price = null;
  const rawPrice = pick(record, 'price');
  if (rawPrice !== undefined) {
    const p = typeof rawPrice === 'number' ? rawPrice : Number(normalizeDigits(rawPrice));
    if (Number.isFinite(p) && p >= 0) price = p; else errors.push('price-invalid');
  }

  let packSize = 1;
  const rawPack = pick(record, 'packSize');
  if (rawPack !== undefined) {
    const n = typeof rawPack === 'number' ? rawPack : Number(normalizeDigits(rawPack));
    if (Number.isFinite(n) && n > 0) packSize = n; else errors.push('packSize-invalid');
  }

  if (errors.length) return { ok: false, product: null, errors };
  return {
    ok: true, errors: [],
    product: freeze({
      id, nameAr, nameEn, barcodes, price, packSize,
      activeIngredient: sanitizeCatalogText(pick(record, 'activeIngredient', 'active_ingredient')),
      strength: sanitizeCatalogText(record.strength),
      form: sanitizeCatalogText(record.form),
      category: sanitizeCatalogText(record.category),
      unit: sanitizeCatalogText(record.unit) || 'pack',
      active: record.active !== false,
    }),
  };
}

const searchKeyOf = p => normalizeArabicSearchKey([p.nameAr, p.nameEn, p.activeIngredient, p.strength, p.form, p.category].join(' '));
const same = (a, b) => (a.strength ? normalizeArabicSearchKey(a.strength) : '') === (b.strength ? normalizeArabicSearchKey(b.strength) : '')
  && (a.form ? normalizeArabicSearchKey(a.form) : '') === (b.form ? normalizeArabicSearchKey(b.form) : '');

export function createUnifiedCatalog(items = []) {
  const products = new Map();     // id -> product
  const byBarcode = new Map();    // barcode -> id
  const keys = new Map();         // id -> search key
  const alias = new Map();        // merged-away id -> kept id
  const rejected = [];
  const mergeLog = [];

  function add(record) {
    const r = normalizeProductRecord(record);
    if (!r.ok) return { ok: false, reason: 'invalid', errors: r.errors };
    const p = r.product;
    if (products.has(p.id) || alias.has(p.id)) return { ok: false, reason: 'duplicate-id', errors: ['duplicate-id'], existing: products.get(alias.get(p.id) ?? p.id) };
    const clash = p.barcodes.find(b => byBarcode.has(b));
    if (clash) return { ok: false, reason: 'duplicate-barcode', errors: ['duplicate-barcode'], existing: products.get(byBarcode.get(clash)) };
    products.set(p.id, p); keys.set(p.id, searchKeyOf(p));
    for (const b of p.barcodes) byBarcode.set(b, p.id);
    return { ok: true, product: p };
  }

  (Array.isArray(items) ? items : []).forEach((record, index) => {
    const r = add(record);
    if (!r.ok) rejected.push({ index, id: record && typeof record === 'object' ? String(record.id ?? record.code ?? '') : '', errors: r.errors, existingId: r.existing?.id });
  });

  const resolveId = id => { let k = String(id); const seen = new Set(); while (alias.has(k) && !seen.has(k)) { seen.add(k); k = alias.get(k); } return k; };

  function detectDuplicates() {
    const buckets = new Map();
    const put = (key, id) => { if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(id); };
    for (const p of products.values()) {
      const pack = String(p.packSize);
      if (p.nameAr) put(`ar:${normalizeArabicSearchKey(p.nameAr)}|${pack}`, p.id);
      if (p.nameEn) put(`en:${normalizeArabicSearchKey(p.nameEn)}|${pack}`, p.id);
    }
    const seen = new Set(); const groups = [];
    for (const [key, ids] of buckets) {
      const unique = [...new Set(ids)];
      if (unique.length < 2) continue;
      const first = products.get(unique[0]);
      const ok = unique.filter(id => same(first, products.get(id)));
      if (ok.length < 2) continue;
      const sig = [...ok].sort().join('|');
      if (seen.has(sig)) continue;
      seen.add(sig);
      groups.push({ key, reason: 'name', ids: ok });
    }
    return groups;
  }

  function merge(keepId, dropId, review = {}) {
    const reviewer = sanitizeCatalogText(review && review.reviewedBy);
    if (!reviewer) throw new Error('pharmacist reviewer required before a merge (reviewedBy)');
    const keep = products.get(resolveId(keepId)); const drop = products.get(resolveId(dropId));
    const group = keep && drop && keep.id !== drop.id ? detectDuplicates().find(g => g.ids.includes(keep.id) && g.ids.includes(drop.id)) : null;
    if (!group) throw new Error(`${keepId} and ${dropId} are not a duplicate candidate`);
    const merged = normalizeProductRecord({
      ...keep,
      nameAr: keep.nameAr || drop.nameAr, nameEn: keep.nameEn || drop.nameEn,
      activeIngredient: keep.activeIngredient || drop.activeIngredient, strength: keep.strength || drop.strength,
      form: keep.form || drop.form, category: keep.category || drop.category,
      price: keep.price ?? drop.price, barcodes: [...keep.barcodes, ...drop.barcodes],
    });
    if (!merged.ok) throw new Error(`merge produced an invalid record: ${merged.errors.join(',')}`);
    products.delete(drop.id); keys.delete(drop.id);
    products.set(keep.id, merged.product); keys.set(keep.id, searchKeyOf(merged.product));
    for (const b of merged.product.barcodes) byBarcode.set(b, keep.id);
    alias.set(drop.id, keep.id);
    const entry = Object.freeze({ at: new Date().toISOString(), keptId: keep.id, droppedId: drop.id, reviewedBy: reviewer, reason: group.reason, key: group.key });
    mergeLog.push(entry);
    return { ok: true, product: merged.product, log: entry };
  }

  return {
    rejected, mergeLog, add, merge, detectDuplicates, resolveId,
    getAll: () => [...products.values()],
    findById: id => products.get(resolveId(id)) || null,
    findByBarcode: barcode => { const b = normalizeBarcode(barcode); return b && byBarcode.has(b) ? products.get(byBarcode.get(b)) : null; },
    search(query) {
      const q = sanitizeCatalogText(query);
      if (!q) return [...products.values()];
      const tokens = normalizeArabicSearchKey(q).split(' ').filter(Boolean);
      const code = normalizeBarcode(q);
      return [...products.values()].filter(p =>
        p.id === q || (code && p.barcodes.includes(code)) || (tokens.length > 0 && tokens.every(t => keys.get(p.id).includes(t))));
    },
  };
}
