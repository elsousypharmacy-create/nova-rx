import { normalizeDigits, matchOffersToItem } from './worker/procurement/normalize.js';

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
export function filterOffers(item, rows, settings, now = Date.now()) {
  const known = new Set(matchOffersToItem({ name: item.nameEn || item.name }, rows.map(r => r.offer || r)).filter(r => r.score === 1 && !r.needsReview).map(r => offerKey(r.offer)));
  return rows.map(row => {
    const offer = row.offer || row;
    const pricing = offerPrice(offer);
    const exactBarcode = item.gtin && offer.barcode && String(item.gtin) === String(offer.barcode);
    const selectedSupplier = settings.suppliers.includes(offer.supplierId);
    const selectedSeller = offer.supplierId !== 'aumet' || (offer.sellerId != null && settings.aumetSellers.includes(String(offer.sellerId)));
    const stamp = Date.parse(offer.lastUpdated || '');
    const fresh = Number.isFinite(stamp) && now - stamp <= 6 * 3600000 && stamp <= now + 60000;
    const match = exactBarcode || known.has(offerKey(offer));
    const eligible = selectedSupplier && selectedSeller && match && fresh && offer.currency === 'EGP' && pricing.price !== null && pricing.price >= 0 && pricing.discount !== null && ['in_stock', 'low'].includes(offer.stockStatus) && (numberOrNull(offer.availableQuantity) === null || offer.availableQuantity > 0);
    return { offer, ...pricing, eligible, reason: !selectedSupplier ? 'المورد مستبعد' : !selectedSeller ? 'المخزن غير محدد' : !match ? 'راجع مطابقة الصنف والعبوة' : !fresh ? 'العرض قديم أو بلا تاريخ' : pricing.discount === null ? 'الخصم غير مؤكد' : !['in_stock', 'low'].includes(offer.stockStatus) ? 'التوفر غير مؤكد' : '' };
  });
}
export function distribute(item, rows, settings, now = Date.now()) {
  let remaining = item.qty;
  const allocations = [], seen = new Set();
  const ranked = filterOffers(item, rows, settings, now).filter(r => r.eligible).sort((a,b) => b.discount - a.discount || a.price - b.price || offerKey(a.offer).localeCompare(offerKey(b.offer)));
  for (const row of ranked) {
    const key = offerKey(row.offer);
    if (seen.has(key)) continue;
    seen.add(key);
    const available = numberOrNull(row.offer.availableQuantity);
    const qty = Math.min(remaining, available === null ? remaining : Math.floor(available));
    const moq = numberOrNull(row.offer.minimumOrderQuantity) ?? 1;
    if (qty < moq || qty < 1) continue;
    allocations.push({ ...row, key, qty, quantityUnconfirmed: available === null, cartState: 'local-draft' });
    remaining -= qty;
    if (remaining === 0) break;
  }
  return { allocations, unallocated: remaining };
}
export function groupCart(items) {
  const groups = new Map();
  for (const item of items.filter(i => i.selected)) for (const a of item.allocations || []) {
    const id = `${a.offer.supplierId}::${a.offer.sellerId ?? ''}`;
    if (!groups.has(id)) groups.set(id, { id, supplierId: a.offer.supplierId, sellerId: a.offer.sellerId, sellerName: a.offer.sellerName, lines: [], total: 0 });
    const group = groups.get(id);
    group.lines.push({ name: item.name, itemKey: item.key, ...a });
    group.total += a.price * a.qty;
  }
  return [...groups.values()].map(g => ({ ...g, total: Math.round(g.total * 100) / 100 }));
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
