// CAT-05 instant search over a catalog snapshot. Pure and local: no I/O, no Worker route, no UI.
// Matching is token based on CAT-01's Arabic folding: exact, prefix, and bounded edit distance for words of 4+ letters
// (only when a word has no exact or prefix match). NUMBERS MATCH WHOLE NUMBERS ONLY ("500" never finds "1500").
// Barcode (8-14 digits) and product code are exact. Every query word must match (AND). Deterministic ranking.
import { normalizeArabicSearchKey, normalizeBarcode, normalizeDigits } from './unified-catalog.js';
import { normalizePackaging } from './unit-conversion.js';

const MAX_QUERY_CHARS = 200;
const MAX_QUERY_TOKENS = 8;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const NUMERIC = /^\d+$/;

// folds used only for searching (on top of CAT-01): hamza carriers
const fold = text => normalizeArabicSearchKey(text).replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ء/g, '');
// letters and digits stuck together are split: "500mg" -> "500 mg", "مجم500" -> "مجم 500"
const split = text => text.replace(/(\p{L})(\p{N})/gu, '$1 $2').replace(/(\p{N})(\p{L})/gu, '$1 $2');
const tokenize = text => split(fold(text)).split(' ').filter(Boolean);
const foldId = id => normalizeDigits(String(id)).toLowerCase();

// optimal string alignment distance (insert, delete, replace, swap of neighbours), -> max + 1 when it exceeds max
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null; let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[b.length];
}

export function createSearchIndex(source) {
  let products = []; let postings = new Map(); let sorted = []; let byLength = new Map();
  let barcodes = new Map(); let codes = new Map(); let meta = [];

  function build() {
    const list = typeof source.getAll === 'function' ? source.getAll() : Array.isArray(source) ? source : [];
    products = list; postings = new Map(); barcodes = new Map(); codes = new Map(); meta = [];
    list.forEach((p, i) => {
      const text = [p.nameAr, p.nameEn, p.activeIngredient, p.strength, p.form, p.category].filter(Boolean).join(' ');
      const toks = new Set(tokenize(text));
      const strengthNums = new Set(tokenize(p.strength || '').filter(t => NUMERIC.test(t)));
      const packNums = new Set();
      if (Number.isInteger(p.packSize) && p.packSize > 1) packNums.add(String(p.packSize));
      const box = p.packaging ? normalizePackaging(p.packaging).factors?.box : undefined;
      if (box && box > 1) packNums.add(String(box));
      for (const n of packNums) toks.add(n);
      for (const t of toks) { let a = postings.get(t); if (!a) { a = []; postings.set(t, a); } a.push(i); }
      for (const b of p.barcodes || []) barcodes.set(b, i);
      codes.set(foldId(p.id), i);
      meta.push({ strengthNums, packNums, names: [fold(p.nameAr || ''), fold(p.nameEn || '')].filter(Boolean), label: `${p.nameAr || ''} ${p.nameEn || ''}`, active: p.active !== false });
    });
    sorted = [...postings.keys()].sort();
    byLength = new Map();
    for (const t of sorted) if (!NUMERIC.test(t)) { let a = byLength.get(t.length); if (!a) { a = []; byLength.set(t.length, a); } a.push(t); }
  }
  build();

  const lowerBound = t => { let lo = 0, hi = sorted.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < t) lo = mid + 1; else hi = mid; } return lo; };

  // product index -> best score for ONE query word (empty map = the word matches nothing)
  function matchWord(t) {
    const best = new Map(); const give = (token, score) => { for (const i of postings.get(token)) if (!(best.get(i) >= score)) best.set(i, score); };
    if (postings.has(t)) give(t, 10);
    if (NUMERIC.test(t)) return best;                                  // numbers: whole numbers only
    if (t.length >= 2) {
      const score = t.length >= 3 ? 7 : 4;
      for (let k = lowerBound(t); k < sorted.length && sorted[k].startsWith(t); k++) if (sorted[k] !== t && !NUMERIC.test(sorted[k])) give(sorted[k], score);
    }
    if (best.size === 0 && t.length >= 4) {                           // typos only when nothing else matched
      const maxd = t.length >= 8 ? 2 : 1;
      for (let len = t.length - maxd; len <= t.length + maxd; len++) for (const token of byLength.get(len) || []) { const d = distance(t, token, maxd); if (d <= maxd) give(token, 4 - d); }
    }
    return best;
  }

  function search(query, { limit = DEFAULT_LIMIT } = {}) {
    if (typeof query !== 'string') return [];
    const q = query.slice(0, MAX_QUERY_CHARS).trim();
    if (!q) return [];
    const cap = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_LIMIT) : DEFAULT_LIMIT;

    const code = normalizeBarcode(q);
    const exact = [];
    if (code && barcodes.has(code)) exact.push({ product: products[barcodes.get(code)], score: 1000, reason: 'barcode' });
    const byId = codes.get(foldId(q));
    if (byId !== undefined && !exact.some(r => r.product === products[byId])) exact.push({ product: products[byId], score: 900, reason: 'code' });
    if (exact.length) return exact.slice(0, cap);
    if (code) return [];                                              // barcode-shaped but unknown: never a fuzzy guess

    const words = [...new Set(tokenize(q))].slice(0, MAX_QUERY_TOKENS);
    if (words.length === 0) return [];
    let scores = null;
    for (const w of words) {
      const m = matchWord(w);
      if (m.size === 0) return [];
      if (scores === null) { scores = new Map(m); continue; }
      const next = new Map();
      for (const [i, s] of scores) if (m.has(i)) next.set(i, s + m.get(i));
      scores = next;
      if (scores.size === 0) return [];
    }
    const phrase = words.join(' ');
    const out = [];
    for (const [i, base] of scores) {
      const m = meta[i]; let score = base;
      if (m.names.some(n => n.includes(phrase))) score += 6;
      if (m.names.some(n => n.startsWith(phrase))) score += 3;
      for (const w of words) if (NUMERIC.test(w)) { if (m.strengthNums.has(w)) score += 3; if (m.packNums.has(w)) score += 2; }
      if (!m.active) score -= 1000;
      out.push({ product: products[i], score, reason: 'name', label: m.label });
    }
    out.sort((a, b) => b.score - a.score || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0) || (a.product.id < b.product.id ? -1 : 1));
    return out.slice(0, cap).map(({ product, score, reason }) => ({ product, score, reason }));
  }

  return { search, refresh: build, get size() { return products.length; } };
}
