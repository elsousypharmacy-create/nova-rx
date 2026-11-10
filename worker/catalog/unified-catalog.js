export function sanitizeCatalogText(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeArabicSearchKey(text) {
  const sanitized = sanitizeCatalogText(text).toLowerCase();
  return sanitized
    .replace(/[\u064B-\u0652\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\w\s\u0600-\u06FF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeBarcode(barcode) {
  if (barcode === null || barcode === undefined) return '';
  const str = String(barcode).trim();
  const cleaned = str.replace(/\D/g, '');
  return cleaned || str;
}

export function normalizeProductRecord(record = {}) {
  if (!record || typeof record !== 'object') {
    return {
      id: '',
      name: '',
      nameAr: '',
      searchKey: '',
      barcode: '',
      price: 0,
      active: true
    };
  }

  const id = record.id !== undefined && record.id !== null ? String(record.id).trim() : '';
  const name = sanitizeCatalogText(record.name || record.title || '');
  const nameAr = sanitizeCatalogText(record.nameAr || record.arabicName || record.name_ar || '');
  const searchKeyText = `${name} ${nameAr} ${record.category || ''}`.trim();
  const searchKey = normalizeArabicSearchKey(searchKeyText);
  const barcode = normalizeBarcode(record.barcode || record.gtin || '');
  const price = typeof record.price === 'number' ? record.price : parseFloat(record.price) || 0;

  return {
    ...record,
    id,
    name,
    nameAr,
    searchKey,
    barcode,
    price,
    category: sanitizeCatalogText(record.category || ''),
    unit: sanitizeCatalogText(record.unit || 'pack'),
    packSize: Number(record.packSize) || 1,
    active: record.active !== false
  };
}

export function createUnifiedCatalog(items = []) {
  const rawList = Array.isArray(items) ? items : [];
  const normalizedItems = rawList.map(record => normalizeProductRecord(record));

  const idMap = new Map();
  const barcodeMap = new Map();

  for (const item of normalizedItems) {
    if (item.id) idMap.set(item.id, item);
    if (item.barcode) barcodeMap.set(item.barcode, item);
  }

  return {
    items: normalizedItems,
    getAll() {
      return [...normalizedItems];
    },
    findById(id) {
      return idMap.get(String(id)) || null;
    },
    findByBarcode(barcode) {
      const cleaned = normalizeBarcode(barcode);
      return barcodeMap.get(cleaned) || null;
    },
    search(query) {
      if (!query) return [...normalizedItems];
      const normalizedQuery = normalizeArabicSearchKey(query);
      const cleanedBarcodeQuery = normalizeBarcode(query);

      return normalizedItems.filter(item => {
        if (cleanedBarcodeQuery && item.barcode.includes(cleanedBarcodeQuery)) {
          return true;
        }
        return item.searchKey.includes(normalizedQuery);
      });
    },
    add(record) {
      const normalized = normalizeProductRecord(record);
      normalizedItems.push(normalized);
      if (normalized.id) idMap.set(normalized.id, normalized);
      if (normalized.barcode) barcodeMap.set(normalized.barcode, normalized);
      return normalized;
    }
  };
}
