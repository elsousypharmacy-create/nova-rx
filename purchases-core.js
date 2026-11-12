import { normalizeDigits, matchOffersToItem, parseProductName } from './worker/procurement/normalize.js';

const FORM_LABELS = {
  tab: 'أقراص', tablet: 'أقراص', tablets: 'أقراص',
  cap: 'كبسولات', capsule: 'كبسولات', capsules: 'كبسولات',
  sachet: 'أكياس', sachets: 'أكياس',
  supp: 'لبوس', susp: 'معلق', syrup: 'شراب', drops: 'نقط',
  amp: 'أمبول', vial: 'فيال', cream: 'كريم', gel: 'جل', eff: 'فوار',
};
const PACK_UNITS = {
  tab: 'قرص', cap: 'كبسولة', sachet: 'كيس', supp: 'لبوسة',
  amp: 'أمبول', vial: 'فيال', ml: 'مل', drops: 'نقطة',
  bottle: 'زجاجة', strip: 'شريط',
};
const SUPPLIER_NAMES = { aumet: 'أوميت', pharmaoverseas: 'فارما أوفرسيز' };

export function readDays(value) {
  const text = normalizeDigits(String(value ?? '')).trim();
  if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > 3650) throw new Error('اكتب مدة صحيحة من 1 إلى 3650 يوم');
  return Number(text);
}
export function numberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(normalizeDigits(String(value)).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
// Duplicate lines (same id + unit) are merged into one: stock and daily sales add up
// (separate lots/branches), min/max/lead time keep the larger value.
export function mergeDuplicateLines(items) {
  const byKey = new Map();
  for (const item of items || []) {
    const id = String(item.id || item.code || '').trim();
    if (!id) continue;
    const key = `${id}::${item.unit || 'pack'}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, { ...item, key, mergedLines: 1 }); continue; }
    const add = f => { const a = numberOrNull(prev[f]), b = numberOrNull(item[f]); prev[f] = a === null ? b : b === null ? a : a + b; };
    const max = f => { const a = numberOrNull(prev[f]), b = numberOrNull(item[f]); prev[f] = a === null ? b : b === null ? a : Math.max(a, b); };
    ['stock', 'dailySales'].forEach(add);
    ['minStock', 'idealStock', 'leadTimeDays', 'observedDays'].forEach(max);
    prev.mergedLines += 1;
  }
  return [...byKey.values()];
}
// limits: { [key]: { min, max } } pharmacist overrides per item (local only).
// Every suggested quantity starts unselected: the pharmacist must confirm it.
export function buildNeeds(items, { days, level = 'ideal', limits = {} }) {
  days = readDays(days);
  if (!['minimum', 'ideal'].includes(level)) throw new Error('مستوى مخزون غير صحيح');
  return mergeDuplicateLines(items).flatMap(item => {
    const key = item.key;
    const own = limits[key] || {};
    const stock = numberOrNull(item.stock);
    const minimum = numberOrNull(own.min) ?? numberOrNull(item.minStock), maximum = numberOrNull(own.max) ?? numberOrNull(item.idealStock);
    const common = { dailyRate: numberOrNull(item.dailySales), leadTimeDays: numberOrNull(item.leadTimeDays), maxLimit: maximum, minLimit: minimum };
    const savedTarget = level === 'minimum' ? minimum : maximum;
    const daily = numberOrNull(item.dailySales);
    const observation = numberOrNull(item.observedDays);
    const coverage = daily !== null && daily >= 0 && observation > 0 ? Math.ceil(daily * days - 1e-9) : null;
    let target = savedTarget === null && coverage === null ? null : Math.max(savedTarget ?? 0, coverage ?? 0);
    const cap = numberOrNull(own.max); // only the pharmacist's own max is a hard cap
    if (target !== null && cap !== null) target = Math.min(target, cap);
    if (stock === null || target === null) return [{ ...item, ...common, key, qty: 0, target, selected: false, issue: stock === null ? 'الرصيد غير معلوم' : 'مستوى المخزون ومعدل البيع غير متاحين' }];
    const qty = Math.max(0, Math.ceil(target - stock - 1e-9));
    if (qty === 0) return [];
    // Minimum mode means only items currently below their saved minimum (or zero).
    if (level === 'minimum' && !(stock <= 0 || (minimum !== null && stock < minimum))) return [];
    return [{ ...item, ...common, key, target, qty, selected: false, suggested: true, coverage, basis: coverage === null ? 'مستوى المخزون المسجل؛ بيانات التغطية غير متاحة' : `الأكبر من المستوى المسجل وتغطية ${days} يوم`, allocations: [], unallocated: qty }];
  });
}
export function offerKey(o) { return [o.supplierId, o.sellerId ?? '', o.supplierProductId].map(String).join('::'); }
export function offerPrice(o) {
  // best_price and discountPct in Aumet are not yet verified; never treat them as final cost.
  const price = numberOrNull(o.netEffectivePrice ?? o.unitPrice);
  const publicPrice = numberOrNull(o.publicPrice);
  return { price, discount: price !== null && publicPrice > 0 && price >= 0 && price <= publicPrice ? Math.round((1 - price / publicPrice) * 10000) / 100 : null };
}
export function describeOffer(offer = {}) {
  const parsed = parseProductName(offer.productName || '');
  const strength = typeof offer.strength === 'string' && offer.strength.trim()
    ? normalizeDigits(offer.strength.trim())
    : offer.strength && typeof offer.strength === 'object' && offer.strength.value != null
      ? `${offer.strength.value} ${offer.strength.unit || ''}`.trim()
      : parsed.strength ? `${parsed.strength.value} ${parsed.strength.unit}` : null;
  const rawForm = typeof offer.form === 'string' && offer.form.trim()
    ? offer.form.trim().toLowerCase()
    : (parsed.form && parsed.form !== 'other' ? parsed.form : parsed.pack?.unit);
  const form = rawForm && rawForm !== 'other' ? (FORM_LABELS[rawForm] || String(offer.form || rawForm).trim()) : null;
  let packSize = null;
  if (offer.packSize !== null && offer.packSize !== undefined && String(offer.packSize).trim() !== '') {
    const rawPack = normalizeDigits(String(offer.packSize).trim());
    const n = numberOrNull(rawPack);
    const u = parsed.pack?.unit ? (PACK_UNITS[parsed.pack.unit] || parsed.pack.unit) : 'وحدة';
    packSize = n !== null && /^\d+(?:\.\d+)?$/.test(rawPack) ? `${n} ${u}` : rawPack;
  } else if (parsed.pack?.count) {
    const u = PACK_UNITS[parsed.pack.unit] || parsed.pack.unit || 'وحدة';
    packSize = `${parsed.pack.count} ${u}`;
  }
  const quantity = numberOrNull(offer.availableQuantity);
  const { price: cost } = offerPrice(offer);
  const stamp = Date.parse(offer.lastUpdated || '');
  const date = Number.isFinite(stamp) ? new Date(stamp).toISOString().slice(0, 10) : null;
  return { strength, form, packSize, pack: packSize, quantity, cost, date };
}
export function expiredSessionMessage(suppliers = []) {
  const expired = (Array.isArray(suppliers) ? suppliers : []).filter(s =>
    s && (s.state === 'expired' || /الجلسة|انتهت|منتهية|expired|auth/i.test(String(s.message || s.error || '')))
  );
  if (!expired.length) return '';
  const names = expired.map(s => s.name && /[\u0600-\u06FF]/.test(s.name) ? s.name : (SUPPLIER_NAMES[s.id] || s.name || s.id)).join('، ');
  return `الجلسة منتهية عند ${names} — جدّد جلسة المورد لإكمال المقارنة`;
}
export function filterOffers(item, rows, settings, now = Date.now()) {
  const known = new Set(matchOffersToItem({ name: item.nameEn || item.name }, rows.map(r => r.offer || r)).filter(r => r.score === 1 && !r.needsReview).map(r => offerKey(r.offer)));
  const excludedSuppliers = Array.isArray(settings?.excludedSuppliers) ? settings.excludedSuppliers.map(String) : [];
  const excludedSellers = Array.isArray(settings?.excludedSellers) ? settings.excludedSellers.map(String) : [];
  const suppliers = Array.isArray(settings?.suppliers) ? settings.suppliers : [];
  const aumetSellers = Array.isArray(settings?.aumetSellers) ? settings.aumetSellers.map(String) : [];
  return rows.map(row => {
    const offer = row.offer || row;
    const pricing = offerPrice(offer);
    const details = describeOffer(offer);
    const exactBarcode = item.gtin && offer.barcode && String(item.gtin) === String(offer.barcode);
    const selectedSupplier = suppliers.includes(offer.supplierId) && !excludedSuppliers.includes(String(offer.supplierId));
    const sellerIdStr = offer.sellerId != null ? String(offer.sellerId) : '';
    const sellerExplicitlyExcluded = sellerIdStr !== '' && excludedSellers.includes(sellerIdStr);
    const selectedSeller = !sellerExplicitlyExcluded && (offer.supplierId !== 'aumet' || (sellerIdStr !== '' && aumetSellers.includes(sellerIdStr)));
    const stamp = Date.parse(offer.lastUpdated || '');
    const fresh = Number.isFinite(stamp) && now - stamp <= 6 * 3600000 && stamp <= now + 60000;
    const match = exactBarcode || known.has(offerKey(offer));
    const available = numberOrNull(offer.availableQuantity);
    const moq = numberOrNull(offer.minimumOrderQuantity) ?? 1;
    const minOrderValue = numberOrNull(offer.minimumOrderValue ?? offer.minOrderTotal) ?? 0;
    const shippingCost = numberOrNull(offer.shippingCost ?? offer.deliveryFee) ?? 0;
    const freeShippingThreshold = numberOrNull(offer.freeShippingThreshold ?? offer.freeShippingAbove);
    const stockOk = ['in_stock', 'low'].includes(offer.stockStatus) && (available === null || available > 0);
    const moqPossible = available === null || available >= moq;
    const eligible = selectedSupplier && selectedSeller && match && fresh && offer.currency === 'EGP' && pricing.price !== null && pricing.price >= 0 && pricing.discount !== null && stockOk && moqPossible;
    return {
      offer,
      ...pricing,
      ...details,
      available,
      moq,
      minOrderValue,
      shippingCost,
      freeShippingThreshold,
      eligible,
      reason: !selectedSupplier ? 'المورد مستبعد' : sellerExplicitlyExcluded ? 'المخزن مستبعد' : !selectedSeller ? 'المخزن غير محدد' : !match ? 'راجع مطابقة الصنف والعبوة' : !fresh ? 'العرض قديم أو بلا تاريخ' : pricing.discount === null ? 'الخصم غير مؤكد' : !stockOk ? 'التوفر غير مؤكد' : !moqPossible ? 'المتاح أقل من الحد الأدنى للطلب' : ''
    };
  });
}
function evaluateOfferForQty(row, targetQty) {
  const available = numberOrNull(row.offer.availableQuantity);
  const qty = Math.min(targetQty, available === null ? targetQty : Math.floor(available));
  const moq = numberOrNull(row.offer.minimumOrderQuantity) ?? 1;
  const minOrderValue = numberOrNull(row.offer.minimumOrderValue ?? row.offer.minOrderTotal) ?? 0;
  const subtotal = Math.round(qty * row.price * 100) / 100;
  const shippingCost = numberOrNull(row.offer.shippingCost ?? row.offer.deliveryFee) ?? 0;
  const freeThreshold = numberOrNull(row.offer.freeShippingThreshold ?? row.offer.freeShippingAbove);
  const shipping = shippingCost > 0 && !(freeThreshold !== null && subtotal >= freeThreshold) ? shippingCost : 0;
  const totalCost = Math.round((subtotal + shipping) * 100) / 100;
  const effectiveUnitPrice = qty > 0 ? Math.round((totalCost / qty) * 100) / 100 : Infinity;
  const pub = numberOrNull(row.offer.publicPrice);
  const effectiveDiscount = qty > 0 && pub > 0 && effectiveUnitPrice <= pub
    ? Math.round((1 - effectiveUnitPrice / pub) * 10000) / 100
    : row.discount;
  const meetsMoq = qty >= moq && qty >= 1;
  const meetsMinValue = minOrderValue <= 0 || subtotal >= minOrderValue;
  return { available, qty, moq, minOrderValue, subtotal, shippingCost, freeThreshold, shipping, totalCost, effectiveUnitPrice, effectiveDiscount, meetsMoq, meetsMinValue };
}
function offerLabel(offer) {
  return offer.sellerName || (offer.supplierId === 'aumet' ? 'أوميت' : offer.supplierId === 'pharmaoverseas' ? 'فارما أوفرسيز' : offer.supplierId);
}
export function distribute(item, rows, settings, now = Date.now()) {
  let remaining = item.qty;
  const allocations = [], seen = new Set(), skippedReasons = [];
  const eligibleRows = filterOffers(item, rows, settings, now).filter(r => r.eligible);
  const manualSingle = settings?.mode === 'manual' && rows.length > 1;
  while (remaining > 0) {
    const candidates = [];
    for (const row of eligibleRows) {
      const key = offerKey(row.offer);
      if (seen.has(key)) continue;
      const ev = evaluateOfferForQty(row, remaining);
      if (!ev.meetsMoq) {
        if (ev.qty > 0) skippedReasons.push(`الكمية (${ev.qty}) أقل من الحد الأدنى (${ev.moq}) عند ${offerLabel(row.offer)}`);
        seen.add(key);
        continue;
      }
      if (!ev.meetsMinValue) {
        skippedReasons.push(`إجمالي العرض (${ev.subtotal} ج.م) أقل من الحد الأدنى للطلب (${ev.minOrderValue} ج.م) عند ${offerLabel(row.offer)}`);
        seen.add(key);
        continue;
      }
      candidates.push({ row, key, ev });
    }
    if (!candidates.length) break;
    candidates.sort((a, b) => {
      if (manualSingle) {
        const aFull = a.ev.qty >= item.qty ? 1 : 0;
        const bFull = b.ev.qty >= item.qty ? 1 : 0;
        if (aFull !== bFull) return bFull - aFull;
      }
      return (
        b.ev.effectiveDiscount - a.ev.effectiveDiscount ||
        a.ev.effectiveUnitPrice - b.ev.effectiveUnitPrice ||
        b.row.discount - a.row.discount ||
        a.row.price - b.row.price ||
        a.key.localeCompare(b.key)
      );
    });
    const best = candidates[0];
    seen.add(best.key);
    const { row, key, ev } = best;
    const shipText = ev.shipping > 0 ? `شحن ${ev.shipping} ج.م` : ev.shippingCost > 0 ? 'شحن مجاني لتجاوز الحد' : 'شحن مجاني';
    const availText = ev.available === null ? 'توفر غير محدد' : `المتاح ${ev.available}`;
    const why = `${allocations.length === 0 ? 'أفضل صافي سعر' : 'تكملة الكمية'} (${row.price} ج.م · خصم ${row.discount}% · ${shipText} · ${availText} · حد أدنى ${ev.moq})`;
    allocations.push({
      ...row,
      key,
      qty: ev.qty,
      shipping: ev.shipping,
      subtotal: ev.subtotal,
      totalCost: ev.totalCost,
      effectiveUnitPrice: ev.effectiveUnitPrice,
      effectiveDiscount: ev.effectiveDiscount,
      why,
      quantityUnconfirmed: ev.available === null,
      cartState: 'local-draft'
    });
    remaining -= ev.qty;
    if (manualSingle) break;
  }
  const totalCost = Math.round(allocations.reduce((s, a) => s + (a.totalCost ?? a.price * a.qty), 0) * 100) / 100;
  const totalShipping = Math.round(allocations.reduce((s, a) => s + (a.shipping ?? 0), 0) * 100) / 100;
  const parts = allocations.map(a => `${offerLabel(a.offer)} (${a.qty} علبة × ${a.price} ج.م${a.shipping > 0 ? ` + شحن ${a.shipping} ج.م` : ''})`);
  const splitExplanation = allocations.length > 1
    ? `توزيع تلقائي مقسم على ${allocations.length} عروض: ${parts.join(' + ')} = ${totalCost} ج.م (لأن العرض الأقل سعرًا متاح منه ${allocations[0].qty} فقط وتم استكمال الباقي بأفضل صافي تكلفة مع الشحن والحد الأدنى)`
    : allocations.length === 1
      ? `${manualSingle ? 'وضع يدوي (مورد منفرد)' : 'تغطية من عرض واحد'}: ${parts[0]} = ${totalCost} ج.م${skippedReasons.length ? ` · استُبعد: ${skippedReasons.join('؛ ')}` : ''}`
      : `تعذر التوزيع${skippedReasons.length ? `: ${skippedReasons.join('؛ ')}` : ''}`;
  return { allocations, unallocated: remaining, totalCost, totalShipping, splitExplanation };
}
export function compareSplitModes(item, rows, settings, now = Date.now()) {
  const auto = distribute(item, rows, { ...settings, mode: 'auto' }, now);
  const single = distribute(item, rows, { ...settings, mode: 'manual' }, now);
  const autoAllocated = item.qty - auto.unallocated;
  const singleAllocated = item.qty - single.unallocated;
  const savings = autoAllocated === singleAllocated && single.totalCost > auto.totalCost
    ? Math.round((single.totalCost - auto.totalCost) * 100) / 100
    : 0;
  return {
    auto,
    single,
    autoTotal: auto.totalCost,
    singleTotal: single.totalCost,
    savings,
    moreCoverage: autoAllocated > singleAllocated ? autoAllocated - singleAllocated : 0
  };
}
export function applyManualSplit(item, rows, splitEntries, settings, now = Date.now()) {
  const mapped = filterOffers(item, rows, settings, now);
  const byKey = new Map(mapped.map(r => [offerKey(r.offer), r]));
  const allocations = [];
  let sumQty = 0;
  for (const entry of splitEntries || []) {
    const rawQty = numberOrNull(entry.qty);
    if (rawQty === null || rawQty === 0) continue;
    if (!Number.isInteger(rawQty) || rawQty < 0) throw new Error('اكتب كمية صحيحة لكل عرض');
    const row = byKey.get(entry.key);
    if (!row || !row.eligible) throw new Error(row?.reason || 'العرض المختار غير مؤهل للتوزيع');
    const ev = evaluateOfferForQty(row, rawQty);
    if (ev.available !== null && rawQty > Math.floor(ev.available)) {
      throw new Error(`الكمية تتجاوز المتاح (${Math.floor(ev.available)}) عند ${offerLabel(row.offer)}`);
    }
    if (rawQty < ev.moq) {
      throw new Error(`الكمية أقل من الحد الأدنى لطلب المورد (${ev.moq}) عند ${offerLabel(row.offer)}`);
    }
    if (!ev.meetsMinValue) {
      throw new Error(`إجمالي العرض (${ev.subtotal} ج.م) أقل من الحد الأدنى للطلب (${ev.minOrderValue} ج.م) عند ${offerLabel(row.offer)}`);
    }
    sumQty += rawQty;
    if (sumQty > item.qty) {
      throw new Error(`مجموع التوزيع (${sumQty}) يتجاوز الكمية المطلوبة (${item.qty})`);
    }
    allocations.push({
      ...row,
      key: entry.key,
      qty: rawQty,
      shipping: ev.shipping,
      subtotal: ev.subtotal,
      totalCost: ev.totalCost,
      effectiveUnitPrice: ev.effectiveUnitPrice,
      effectiveDiscount: ev.effectiveDiscount,
      why: `تحديد يدوي (${rawQty} علبة × ${row.price} ج.م${ev.shipping > 0 ? ` + شحن ${ev.shipping} ج.م` : ' · شحن مجاني'})`,
      quantityUnconfirmed: ev.available === null,
      cartState: 'local-draft',
      manual: true
    });
  }
  if (!allocations.length) throw new Error('أدخل كمية أكبر من صفر لعرض واحد على الأقل');
  const totalCost = Math.round(allocations.reduce((s, a) => s + a.totalCost, 0) * 100) / 100;
  const totalShipping = Math.round(allocations.reduce((s, a) => s + a.shipping, 0) * 100) / 100;
  const unallocated = Math.max(0, item.qty - sumQty);
  const parts = allocations.map(a => `${offerLabel(a.offer)} (${a.qty} علبة × ${a.price} ج.م${a.shipping > 0 ? ` + شحن ${a.shipping} ج.م` : ''})`);
  const splitExplanation = `توزيع يدوي معدل: ${parts.join(' + ')} = ${totalCost} ج.م${unallocated > 0 ? ` (متبقي ${unallocated} علبة بدون توزيع)` : ''}`;
  return { allocations, unallocated, totalCost, totalShipping, manualSplit: true, splitExplanation };
}
export function groupCart(items) {
  const groups = new Map();
  for (const item of items.filter(i => i.selected)) for (const a of item.allocations || []) {
    const id = `${a.offer.supplierId}::${a.offer.sellerId ?? ''}`;
    if (!groups.has(id)) groups.set(id, { id, supplierId: a.offer.supplierId, sellerId: a.offer.sellerId, sellerName: a.offer.sellerName, lines: [], subtotal: 0, shippingCost: 0, freeShippingThreshold: null, minimumOrderValue: 0, total: 0 });
    const group = groups.get(id);
    group.lines.push({ name: item.name, itemKey: item.key, ...a });
    group.subtotal += a.price * a.qty;
    const sc = numberOrNull(a.offer.shippingCost ?? a.offer.deliveryFee) ?? 0;
    if (sc > group.shippingCost) group.shippingCost = sc;
    const ft = numberOrNull(a.offer.freeShippingThreshold ?? a.offer.freeShippingAbove);
    if (ft !== null && (group.freeShippingThreshold === null || ft < group.freeShippingThreshold)) group.freeShippingThreshold = ft;
    const mov = numberOrNull(a.offer.minimumOrderValue ?? a.offer.minOrderTotal) ?? 0;
    if (mov > group.minimumOrderValue) group.minimumOrderValue = mov;
  }
  return [...groups.values()].map(g => {
    const subtotal = Math.round(g.subtotal * 100) / 100;
    const shipping = g.shippingCost > 0 && !(g.freeShippingThreshold !== null && subtotal >= g.freeShippingThreshold) ? g.shippingCost : 0;
    const total = Math.round((subtotal + shipping) * 100) / 100;
    const belowMinimumOrder = g.minimumOrderValue > 0 && subtotal < g.minimumOrderValue;
    return { ...g, subtotal, shipping, total, belowMinimumOrder };
  });
}
export function createMockPurchasingScenario(now = Date.now()) {
  const stamp = new Date(now).toISOString();
  const sellers = [
    { id: 's-nour', name: 'مخزن النور' },
    { id: 's-shifa', name: 'مخزن الشفاء' },
    { id: 's-delta', name: 'مخزن الدلتا' },
    { id: 's-excl', name: 'مخزن الأمل' }
  ];
  const prefs = {
    days: 21,
    level: 'ideal',
    mode: 'auto',
    suppliers: ['aumet', 'pharmaoverseas'],
    aumetSellers: ['s-nour', 's-shifa', 's-delta'],
    excludedSuppliers: [],
    excludedSellers: ['s-excl']
  };
  const items = [
    { id: 'mock-1', code: '2001', gtin: '6221000002001', name: 'أوميبرازول 20 مجم 14 كبسولة', nameEn: 'Omeprazole 20mg 14 caps', stock: 2, minStock: 5, idealStock: 12, dailySales: null, observedDays: 0 },
    { id: 'mock-2', code: '2002', gtin: '6221000002002', name: 'كونكور 5 مجم 30 قرص', nameEn: 'Concor 5mg 30 tabs', stock: 4, minStock: 6, idealStock: 10, dailySales: null, observedDays: 0 }
  ];
  const offersByQuery = {
    'Omeprazole 20mg 14 caps': [
      { offer: { supplierId: 'aumet', sellerId: 's-excl', sellerName: 'مخزن الأمل', supplierProductId: 'om-excl', barcode: '6221000002001', productName: 'Omeprazole 20mg 14 caps', availableQuantity: 50, minimumOrderQuantity: 1, shippingCost: 0, unitPrice: 35, publicPrice: 100, stockStatus: 'in_stock', currency: 'EGP', lastUpdated: stamp } },
      { offer: { supplierId: 'aumet', sellerId: 's-nour', sellerName: 'مخزن النور', supplierProductId: 'om-nour', barcode: '6221000002001', productName: 'Omeprazole 20mg 14 caps', availableQuantity: 4, minimumOrderQuantity: 2, shippingCost: 0, unitPrice: 45, publicPrice: 100, stockStatus: 'in_stock', currency: 'EGP', lastUpdated: stamp } },
      { offer: { supplierId: 'pharmaoverseas', sellerId: 'po-main', sellerName: 'فرع القاهرة', supplierProductId: 'om-po', barcode: '6221000002001', productName: 'Omeprazole 20mg 14 caps', availableQuantity: 15, minimumOrderQuantity: 3, shippingCost: 15, freeShippingThreshold: 300, unitPrice: 52, publicPrice: 100, stockStatus: 'in_stock', currency: 'EGP', lastUpdated: stamp } },
      { offer: { supplierId: 'aumet', sellerId: 's-delta', sellerName: 'مخزن الدلتا', supplierProductId: 'om-delta', barcode: '6221000002001', productName: 'Omeprazole 20mg 14 caps', availableQuantity: 20, minimumOrderQuantity: 1, shippingCost: 0, unitPrice: 58, publicPrice: 100, stockStatus: 'in_stock', currency: 'EGP', lastUpdated: stamp } }
    ],
    'Concor 5mg 30 tabs': [
      { offer: { supplierId: 'aumet', sellerId: 's-shifa', sellerName: 'مخزن الشفاء', supplierProductId: 'co-shifa', barcode: '6221000002002', productName: 'Concor 5mg 30 tabs', availableQuantity: 10, minimumOrderQuantity: 10, shippingCost: 0, unitPrice: 70, publicPrice: 100, stockStatus: 'in_stock', currency: 'EGP', lastUpdated: stamp } },
      { offer: { supplierId: 'aumet', sellerId: 's-nour', sellerName: 'مخزن النور', supplierProductId: 'co-nour', barcode: '6221000002002', productName: 'Concor 5mg 30 tabs', availableQuantity: 10, minimumOrderQuantity: 1, shippingCost: 45, unitPrice: 72, publicPrice: 100, stockStatus: 'in_stock', currency: 'EGP', lastUpdated: stamp } },
      { offer: { supplierId: 'pharmaoverseas', sellerId: 'po-main', sellerName: 'فرع القاهرة', supplierProductId: 'co-po', barcode: '6221000002002', productName: 'Concor 5mg 30 tabs', availableQuantity: 12, minimumOrderQuantity: 2, shippingCost: 0, unitPrice: 75, publicPrice: 100, stockStatus: 'in_stock', currency: 'EGP', lastUpdated: stamp } }
    ]
  };
  return { stamp, sellers, prefs, items, offersByQuery };
}

// One queue for actual supplier calls. Start spacing includes time already spent
// waiting for the previous response; fresh cached comparisons make no request.
export function createOfferSearch({request,now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),intervalMs=3100,ttlMs=120000,maxEntries=300}) {
  const cache=new Map(),pending=new Map();let queue=Promise.resolve(),lastStart=-Infinity;
  function keyFor(query,opts){return JSON.stringify([String(query).trim().toLocaleLowerCase(),[...(opts.supplierIds||[])].sort()]);}
  function cached(key){const hit=cache.get(key);if(!hit)return null;if(now()-hit.at>=ttlMs){cache.delete(key);return null;}return {value:hit.value,cached:true};}
  function search(query,opts={}){
    const key=keyFor(query,opts),hit=cached(key);if(hit)return Promise.resolve(hit);
    if(pending.has(key))return pending.get(key);
    const task=queue.then(async()=>{
      const other=cached(key);if(other)return other;
      const delay=intervalMs-(now()-lastStart);if(delay>0)await sleep(delay);
      lastStart=now();const value=await request(query,opts);
      if(value.complete===true){cache.delete(key);cache.set(key,{at:now(),value});while(cache.size>maxEntries)cache.delete(cache.keys().next().value);}
      return {value,cached:false};
    });
    const settled=task.finally(()=>pending.delete(key));pending.set(key,settled);queue=settled.catch(()=>{});return settled;
  }
  return {search,clear:()=>cache.clear()};
}
