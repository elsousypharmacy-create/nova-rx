// Price normalization for procurement offers (Epic #53, task 04):
// product-name parsing, comparable unit prices, product keys, offer matching.
// Dependency-free ES module; runs in Cloudflare Workers and Node 22.

const AR_DIGITS = /[٠-٩۰-۹]/g;

export function normalizeDigits(text) {
  return String(text ?? '').replace(AR_DIGITS, (ch) => {
    const code = ch.codePointAt(0);
    return String(code >= 0x660 && code <= 0x669 ? code - 0x660 : code - 0x6f0);
  });
}

const NUM = '\\d+(?:\\.\\d+)?';
const EDGE = '(?![\\p{L}\\p{N}])';
const WEIGHT = '(?:MCG|MG|GM|G|مجم|غرام|جم)';
const VOLUME = '(?:ML|مل)';

const COMBO_RE = new RegExp(
  `(${NUM})\\s*(${WEIGHT})\\s*\\.?\\s*\\/\\s*(${NUM})?\\s*(${WEIGHT}|${VOLUME})${EDGE}`,
  'iu',
);
const SLASH_RE = new RegExp(`(${NUM})\\s*\\/\\s*(${NUM})\\s*(MCG|MG|GM|G)${EDGE}`, 'iu');
const DASH_RE = new RegExp(`(${NUM})\\s*-\\s*(${NUM})\\s*(MCG|MG|GM|G)${EDGE}`, 'iu');
const PERCENT_RE = /(\d+(?:\.\d+)?)\s*%/;
const SIMPLE_RE = new RegExp(`(${NUM})\\s*(${WEIGHT}|IU)${EDGE}`, 'iu');

const G_UNITS = new Set(['gm', 'g', 'جم', 'غرام']);
const MG_UNITS = new Set(['mg', 'مجم']);

function toMg(value, unit) {
  const u = unit.toLowerCase();
  if (G_UNITS.has(u)) return String(Number(value) * 1000);
  return value;
}

function normalizeSimpleUnit(unit) {
  const u = unit.toLowerCase();
  if (G_UNITS.has(u)) return 'g';
  if (MG_UNITS.has(u)) return 'mg';
  return u;
}

function comboStrength(m) {
  const [, n1, u1, n2, u2] = m;
  const u2Lower = u2.toLowerCase();
  if (u2Lower === 'ml' || u2Lower === 'مل') {
    return { value: toMg(n1, u1), unit: n2 ? `mg/${n2}ml` : 'mg/ml' };
  }
  return { value: `${toMg(n1, u1)}/${toMg(n2, u2)}`, unit: 'mg' };
}

function findStrength(s) {
  let m = COMBO_RE.exec(s);
  if (m) return { strength: comboStrength(m), index: m.index, length: m[0].length };
  m = SLASH_RE.exec(s);
  if (m) {
    const factor = G_UNITS.has(m[3].toLowerCase()) ? 1000 : 1;
    const a = factor === 1 ? m[1] : String(Number(m[1]) * factor);
    const b = factor === 1 ? m[2] : String(Number(m[2]) * factor);
    return { strength: { value: `${a}/${b}`, unit: 'mg' }, index: m.index, length: m[0].length };
  }
  m = DASH_RE.exec(s);
  if (m) {
    const factor = G_UNITS.has(m[3].toLowerCase()) ? 1000 : 1;
    const a = factor === 1 ? m[1] : String(Number(m[1]) * factor);
    const b = factor === 1 ? m[2] : String(Number(m[2]) * factor);
    return { strength: { value: `${a}/${b}`, unit: 'mg' }, index: m.index, length: m[0].length };
  }
  m = PERCENT_RE.exec(s);
  if (m) return { strength: { value: m[1], unit: '%' }, index: m.index, length: m[0].length };
  m = SIMPLE_RE.exec(s);
  if (m) {
    return {
      strength: { value: m[1], unit: normalizeSimpleUnit(m[2]) },
      index: m.index,
      length: m[0].length,
    };
  }
  return null;
}

const PACK_UNIT_RE =
  /(QUICKETABS?|LACTABS?|TABLETS?|TABS?|CAPSULES?|CAPS?|SACHETS?|SACHE|SUPPS?|AMPS?|VIALS?|VAIL|ML|DROPS|BOTTLE|أقراص|قرص|شرائط|شريط|كبسول[ةات]|أمبول|امبول|مل)(?![\p{L}\p{N}])/giu;

const BARE_VIAL_RE = /(?:^|[^\p{L}\p{N}])(VIALS?|VAIL)(?![\p{L}\p{N}])/iu;

function packUnit(text) {
  const t = text.toLowerCase();
  if (t.includes('tab') || t === 'قرص' || t === 'أقراص') return 'tab';
  if (t.includes('cap') || t.startsWith('كبسول')) return 'cap';
  if (t.includes('sache')) return 'sachet';
  if (t.includes('supp')) return 'supp';
  if (t.includes('amp') || t === 'أمبول' || t === 'امبول') return 'amp';
  if (t === 'vial' || t === 'vials' || t === 'vail') return 'vial';
  if (t === 'ml' || t === 'مل') return 'ml';
  if (t.includes('drop')) return 'drops';
  if (t.includes('bottle')) return 'bottle';
  if (t === 'شريط' || t === 'شرائط') return 'strip';
  return 'other';
}

function findPack(masked) {
  PACK_UNIT_RE.lastIndex = 0;
  let m;
  while ((m = PACK_UNIT_RE.exec(masked)) !== null) {
    const window = masked.slice(Math.max(0, m.index - 30), m.index);
    const nums = window.match(/\d+/g);
    if (nums) return { count: Number(nums[nums.length - 1]), unit: packUnit(m[1]) };
  }
  if (BARE_VIAL_RE.test(masked)) return { count: 1, unit: 'vial' };
  return null;
}

const FORM_PATTERNS = [
  [/SUPP/iu, 'supp'],
  [/SACHE/iu, 'sachet'],
  [/SUSP/iu, 'susp'],
  [/(?:^|[^\p{L}\p{N}])(?:SYP|SYRUP)(?![\p{L}\p{N}])|شراب/iu, 'syrup'],
  [/(?:^|[^\p{L}\p{N}])(?:DROPS?|DPS)(?![\p{L}\p{N}])|OPHTHALMIC|نقط/iu, 'drops'],
  [/(?:^|[^\p{L}\p{N}])AMPS?(?![\p{L}\p{N}])|أمبول|امبول/iu, 'amp'],
  [/(?:^|[^\p{L}\p{N}])VIALS?(?![\p{L}\p{N}])|(?:^|[^\p{L}\p{N}])VAIL(?![\p{L}\p{N}])/iu, 'vial'],
  [/(?:^|[^\p{L}\p{N}])CAPS(?:ULES?)?(?![\p{L}\p{N}])|كبسول/iu, 'cap'],
  [/TAB|قرص|أقراص|شريط/iu, 'tab'],
  [/CREAM|كريم/iu, 'cream'],
  [/(?:^|[^\p{L}\p{N}])GEL(?![\p{L}\p{N}])|جل/iu, 'gel'],
  [/(?:^|[^\p{L}\p{N}])EFF(?![\p{L}\p{N}])/iu, 'eff'],
];

function findForm(s) {
  for (const [re, form] of FORM_PATTERNS) {
    if (re.test(s)) return form;
  }
  return 'other';
}

function maskRange(s, index, length) {
  return s.slice(0, index) + ' '.repeat(length) + s.slice(index + length);
}

export function parseProductName(name) {
  const raw = String(name ?? '');
  const s = normalizeDigits(raw).replace(/\s+/g, ' ').trim();
  const strengthMatch = findStrength(s);
  const strength = strengthMatch ? strengthMatch.strength : null;
  const masked = strengthMatch ? maskRange(s, strengthMatch.index, strengthMatch.length) : s;
  const pack = findPack(masked);
  const form = findForm(s);
  const firstDigit = s.search(/\d/);
  const brand = (firstDigit === -1 ? s : s.slice(0, firstDigit))
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  return { brand, strength, form, pack, raw };
}

export function comparableUnitPrice(offer, parsed) {
  const price = offer?.netEffectivePrice ?? offer?.unitPrice;
  const count = parsed?.pack?.count;
  if (typeof price !== 'number' || !Number.isFinite(price)) return null;
  if (typeof count !== 'number' || !(count > 0)) return null;
  return price / count;
}

export function productKey(parsed) {
  if (!parsed || !parsed.brand) return null;
  // Many supplier names carry no strength ("PANADOL EXTRA 24 F.C. TAB.").
  // Those still get a key when the pack is known; "-" marks the missing strength.
  if (!parsed.strength && !parsed.pack) return null;
  const strength = parsed.strength ? `${parsed.strength.value}${parsed.strength.unit}` : '-';
  const packCount = parsed.pack ? String(parsed.pack.count) : '';
  return `${parsed.brand}|${strength}|${parsed.form}|${packCount}`.toLowerCase();
}

function strengthId(strength) {
  return strength ? `${strength.value}|${strength.unit}` : null;
}

const parseCache = new Map();
function parseCached(name) {
  let hit = parseCache.get(name);
  if (!hit) {
    if (parseCache.size > 50000) parseCache.clear();
    hit = parseProductName(name);
    parseCache.set(name, hit);
  }
  return hit;
}

export function matchOffersToItem(item, offers) {
  const parsedItem = parseProductName(item?.name ?? '');
  const itemKey = productKey(parsedItem);
  const itemStrength = strengthId(parsedItem.strength);
  const results = [];
  for (const offer of offers ?? []) {
    const parsedOffer = parseCached(offer?.productName ?? '');
    const offerKey = productKey(parsedOffer);
    const offerStrength = strengthId(parsedOffer.strength);
    let score = 0;
    const reasons = [];
    let needsReview = false;
    if (itemKey && offerKey && itemKey === offerKey) {
      score = 1;
      reasons.push('exact-product-key');
    } else if (parsedItem.brand && parsedItem.brand === parsedOffer.brand) {
      if (itemStrength && offerStrength && itemStrength === offerStrength) {
        score = 0.8;
        reasons.push(
          parsedItem.pack?.count !== parsedOffer.pack?.count ? 'pack-differs' : 'form-differs',
        );
      } else if (!itemStrength && !offerStrength && parsedItem.form === parsedOffer.form) {
        // Neither name states a strength: same brand and form, only the pack differs.
        score = 0.8;
        reasons.push('pack-differs');
      } else if (itemStrength && offerStrength) {
        score = 0.5;
        reasons.push('strength-differs');
        needsReview = true;
      } else {
        score = 0.5;
        reasons.push('brand-only');
        needsReview = true;
      }
    }
    if (score < 0.5) continue;
    const entry = { offer, score, reasons };
    if (needsReview) entry.needsReview = true;
    results.push(entry);
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}
