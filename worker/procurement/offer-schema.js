// Unified offer schema + validator (docs/procurement/ARCHITECTURE.md section 4).
// Dependency-free ES module; runs in Cloudflare Workers and Node 22.

export const OFFER_FIELDS = Object.freeze([
  'supplierId',
  'supplierProductId',
  'barcode',
  'productName',
  'packSize',
  'currency',
  'unitPrice',
  'publicPrice',
  'discountPct',
  'netEffectivePrice',
  'availableQuantity',
  'stockStatus',
  'minimumOrderQuantity',
  'lastUpdated',
  'dataSource',
  'syncStatus',
  'raw',
]);

export const STOCK_STATUSES = Object.freeze(['in_stock', 'out_of_stock', 'low', 'unknown']);
export const DATA_SOURCES = Object.freeze(['api', 'export', 'manual', 'fixture']);
export const SYNC_STATUSES = Object.freeze(['fresh', 'stale', 'error']);

const NUMBER_FIELDS = [
  'unitPrice',
  'publicPrice',
  'discountPct',
  'netEffectivePrice',
  'availableQuantity',
  'minimumOrderQuantity',
];

const SECRET_KEY_RE = /authorization|cookie|token|password|session/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

export function sanitizeName(text) {
  return String(text ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findSecretKey(value, path) {
  if (!value || typeof value !== 'object') return null;
  for (const key of Object.keys(value)) {
    const here = path ? `${path}.${key}` : key;
    if (SECRET_KEY_RE.test(key)) return here;
    const hit = findSecretKey(value[key], here);
    if (hit) return hit;
  }
  return null;
}

function isValidIso(value) {
  return typeof value === 'string' && ISO_RE.test(value) && !Number.isNaN(Date.parse(value));
}

export function validateOffer(offer) {
  const errors = [];
  if (!offer || typeof offer !== 'object' || Array.isArray(offer)) {
    return { ok: false, errors: ['offer must be a plain object'] };
  }

  if (typeof offer.supplierId !== 'string' || offer.supplierId === '') {
    errors.push('supplierId must be a non-empty string');
  }
  if (typeof offer.supplierProductId !== 'string' || offer.supplierProductId === '') {
    errors.push('supplierProductId must be a non-empty string');
  }
  if (typeof offer.productName !== 'string' || offer.productName === '') {
    errors.push('productName must be a non-empty string');
  } else if (offer.productName.includes('<') || offer.productName.includes('>')) {
    errors.push('productName must contain no HTML angle brackets');
  }

  if (!isValidIso(offer.lastUpdated)) {
    errors.push('lastUpdated must be a valid ISO 8601 string');
  }

  if (!DATA_SOURCES.includes(offer.dataSource)) {
    errors.push(`dataSource must be one of: ${DATA_SOURCES.join(', ')}`);
  }
  if (!SYNC_STATUSES.includes(offer.syncStatus)) {
    errors.push(`syncStatus must be one of: ${SYNC_STATUSES.join(', ')}`);
  }
  if (!STOCK_STATUSES.includes(offer.stockStatus)) {
    errors.push(`stockStatus must be one of: ${STOCK_STATUSES.join(', ')}`);
  }

  if (offer.currency !== 'EGP') {
    errors.push("currency must be 'EGP'");
  }

  for (const field of NUMBER_FIELDS) {
    const value = offer[field];
    if (value === null || value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${field} must be a finite number or null`);
    } else if (value < 0) {
      errors.push(`${field} must be >= 0`);
    }
  }

  if (offer.discountPct !== null && offer.discountPct !== undefined) {
    if (typeof offer.discountPct === 'number' && (offer.discountPct < 0 || offer.discountPct > 100)) {
      errors.push('discountPct must be between 0 and 100 or null');
    }
  }

  if (offer.barcode !== null && offer.barcode !== undefined) {
    if (typeof offer.barcode !== 'string' || !/^\d{8,14}$/.test(offer.barcode)) {
      errors.push('barcode must be digits only (8-14 chars) or null');
    }
  }

  if (!offer.raw || typeof offer.raw !== 'object' || Array.isArray(offer.raw)) {
    errors.push('raw must be an object');
  } else {
    const secretPath = findSecretKey(offer.raw, 'raw');
    if (secretPath) {
      errors.push(`raw must not contain credential-like keys (found ${secretPath})`);
    }
  }

  return { ok: errors.length === 0, errors };
}
