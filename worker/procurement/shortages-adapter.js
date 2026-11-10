import crypto from 'node:crypto';

export function stripSecrets(input) {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    return input
      .replace(/(bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED]')
      .replace(/(api[_-]?key|secret|password|token)\s*=\s*['"]?[^'"\s]+['"]?/gi, '$1=[REDACTED]');
  }
  if (typeof input === 'object') {
    if (Array.isArray(input)) {
      return input.map(item => stripSecrets(item));
    }
    const sanitized = {};
    for (const [key, val] of Object.entries(input)) {
      if (/secret|token|password|key|auth|bearer/i.test(key)) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof val === 'object' && val !== null) {
        sanitized[key] = stripSecrets(val);
      } else if (typeof val === 'string') {
        sanitized[key] = stripSecrets(val);
      } else {
        sanitized[key] = val;
      }
    }
    return sanitized;
  }
  return input;
}

export function sanitizeShortageText(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parsePositiveNumber(val) {
  if (val === null || val === undefined) return 0;
  let str = String(val).trim();
  const arabicDigits = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  for (let i = 0; i < 10; i++) {
    str = str.split(arabicDigits[i]).join(String(i));
  }
  const num = parseFloat(str);
  if (isNaN(num) || num <= 0) return 0;
  return num;
}

export function normalizeOrdersPageShortages(ordersData = {}) {
  const zeroList = Array.isArray(ordersData.zero) ? ordersData.zero : (ordersData.DATA && Array.isArray(ordersData.DATA.zero) ? ordersData.DATA.zero : []);
  const lowList = Array.isArray(ordersData.low) ? ordersData.low : (ordersData.DATA && Array.isArray(ordersData.DATA.low) ? ordersData.DATA.low : []);

  const map = new Map();

  const processItem = (item, source) => {
    if (!item) return;
    const sanitizedCo = sanitizeShortageText(item.co || '');
    const sanitizedN = sanitizeShortageText(item.n || '');
    const code = String(item.code || item.c || '').trim();
    const key = code || `${sanitizedCo}_${sanitizedN}`;
    if (!key) return;

    const qty = parsePositiveNumber(item.q);
    const supplier = sanitizeShortageText(item.s || '');
    const vendor = sanitizeShortageText(item.v || '');
    const warehouse = sanitizeShortageText(item.h || '');
    const mk = item.mk !== undefined ? Boolean(item.mk) : false;

    if (map.has(key)) {
      const existing = map.get(key);
      existing.q += qty;
      existing.sources.add(source);
      if (!existing.mk && mk) existing.mk = mk;
      if (!existing.c && code) existing.c = code;
      if (!existing.h && warehouse) existing.h = warehouse;
    } else {
      map.set(key, {
        co: sanitizedCo,
        n: sanitizedN,
        q: qty,
        c: code,
        code: code,
        s: supplier,
        v: vendor,
        h: warehouse,
        mk: mk,
        sources: new Set([source])
      });
    }
  };

  zeroList.forEach(it => processItem(it, 'zero'));
  lowList.forEach(it => processItem(it, 'low'));

  return Array.from(map.values()).map(it => ({
    ...it,
    sources: Array.from(it.sources)
  }));
}

export function filterEligibleOffersForNeed(offers = [], options = {}) {
  const { mode = 'auto', selectedSupplierId, selectedWarehouseIds = [], selectedOmetWarehouses = [] } = options;
  const allowedWarehouses = new Set([
    ...selectedWarehouseIds.map(String),
    ...selectedOmetWarehouses.map(String)
  ]);

  return offers.filter(offer => {
    if (selectedSupplierId && String(offer.supplierId || offer.s || '') !== String(selectedSupplierId)) {
      return false;
    }

    const offerWarehouse = String(offer.warehouseId || offer.h || offer.warehouse || '');

    if (mode === 'auto') {
      if (allowedWarehouses.size > 0 && !allowedWarehouses.has(offerWarehouse)) {
        return false;
      }
    } else if (mode === 'manual') {
      if (allowedWarehouses.size > 0 && !allowedWarehouses.has(offerWarehouse) && !offer.mk) {
        return false;
      }
    }

    return true;
  });
}

export function buildShortagesProcurementPlan(options = {}) {
  const {
    ordersData = {},
    offers = [],
    mode = 'auto',
    selectedSupplierId = '',
    selectedWarehouseIds = [],
    selectedOmetWarehouses = []
  } = options;

  const normalizedShortages = normalizeOrdersPageShortages(ordersData);
  const eligibleOffers = filterEligibleOffersForNeed(offers, {
    mode,
    selectedSupplierId,
    selectedWarehouseIds,
    selectedOmetWarehouses
  });

  const cartMap = new Map();
  const items = [];

  for (const shortage of normalizedShortages) {
    const key = shortage.c || shortage.code || shortage.n;
    const matchingOffer = eligibleOffers.find(o => (o.code || o.c || o.name) === key);

    if (matchingOffer) {
      if (!cartMap.has(key)) {
        const itemObj = {
          code: shortage.code || shortage.c,
          name: shortage.n || shortage.co,
          quantity: shortage.q,
          warehouseId: matchingOffer.warehouseId || matchingOffer.h,
          supplierId: matchingOffer.supplierId || matchingOffer.s || selectedSupplierId,
          price: parsePositiveNumber(matchingOffer.price),
          mk: shortage.mk || false
        };
        cartMap.set(key, itemObj);
        items.push(itemObj);
      }
    } else if (mode === 'manual' && shortage.mk) {
      if (!cartMap.has(key)) {
        const itemObj = {
          code: shortage.code || shortage.c,
          name: shortage.n || shortage.co,
          quantity: shortage.q,
          warehouseId: shortage.h,
          supplierId: selectedSupplierId,
          price: parsePositiveNumber(shortage.v),
          mk: shortage.mk
        };
        cartMap.set(key, itemObj);
        items.push(itemObj);
      }
    }
  }

  const sanitizedItems = stripSecrets(items);
  const totalCost = sanitizedItems.reduce((acc, cur) => acc + (cur.quantity * (cur.price || 0)), 0);

  const draftPayload = {
    mode,
    selectedSupplierId,
    selectedWarehouses: Array.from(new Set([...selectedWarehouseIds, ...selectedOmetWarehouses])),
    items: sanitizedItems,
    totalCost,
    status: 'draft-preview-only'
  };

  const signature = computeDraftSignature(draftPayload);

  return {
    ...draftPayload,
    signature
  };
}

export function computeDraftSignature(draft) {
  const sanitized = stripSecrets(draft);
  const payloadStr = JSON.stringify({
    mode: sanitized.mode,
    selectedSupplierId: sanitized.selectedSupplierId,
    selectedWarehouses: sanitized.selectedWarehouses,
    items: sanitized.items,
    totalCost: sanitized.totalCost
  });
  return crypto.createHash('sha256').update(payloadStr).digest('hex');
}

export function verifyOwnerConfirmationGate(draftPayload, options = {}) {
  if (!draftPayload || typeof draftPayload !== 'object') {
    throw new Error('Invalid draft payload');
  }

  const { ownerConfirmed = false, providedSignature } = options;

  if (!ownerConfirmed) {
    return {
      valid: false,
      status: 'draft-preview-only',
      reason: 'Owner confirmation required'
    };
  }

  const expectedSignature = computeDraftSignature(draftPayload);
  const signatureToCheck = providedSignature || draftPayload.signature;

  if (!signatureToCheck || signatureToCheck !== expectedSignature) {
    return {
      valid: false,
      status: 'draft-preview-only',
      reason: 'Signature verification failed (external modification detected)'
    };
  }

  return {
    valid: true,
    status: 'owner-confirmed-preview-ready',
    signature: expectedSignature
  };
}
