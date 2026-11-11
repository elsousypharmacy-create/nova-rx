// CAT-02 unit and pack conversion. Pure module: no I/O.
// Base unit = the smallest thing stocked (tablet, ampoule, bottle...). Levels: unit < strip < box < carton.
// Rule: an unknown unit, a missing packaging definition, a bad number or a fractional base unit is an error
// result, never a silent factor of 1 or a price of 0. All functions return {ok:true,value} or {ok:false,error}.

const UNIT_NAMES = {
  unit: ['unit', 'tablet', 'piece', 'قرص', 'وحدة', 'حبة'],
  strip: ['strip', 'شريط'],
  box: ['box', 'pack', 'علبة'],
  carton: ['carton', 'كرتونة'],
};
const LOOKUP = new Map(Object.entries(UNIT_NAMES).flatMap(([canon, names]) => names.map(n => [n, canon])));
const ORDER = ['carton', 'box', 'strip', 'unit'];
const ok = value => ({ ok: true, value });
const fail = error => ({ ok: false, error });
const EPS = 1e-9;

export function canonicalUnit(name) {
  if (typeof name !== 'string') return null;
  return LOOKUP.get(name.trim().toLowerCase()) ?? null;
}

const toNumber = v => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const first = (def, ...names) => { for (const n of names) if (def[n] !== undefined && def[n] !== null) return def[n]; return undefined; };

// -> {ok, factors:{unit:1, strip?, box?, carton?}} (factor = base units in one of that level) or {ok:false, error:'packaging-invalid:<field>'|'packaging-inconsistent'}.
export function normalizePackaging(def) {
  const d = def && typeof def === 'object' ? def : {};
  const fields = {
    unitsPerStrip: first(d, 'unitsPerStrip', 'tabletsPerStrip'),
    stripsPerBox: first(d, 'stripsPerBox'),
    unitsPerBox: first(d, 'unitsPerBox'),
    boxesPerCarton: first(d, 'boxesPerCarton', 'packsPerCarton'),
  };
  const v = {};
  for (const [name, raw] of Object.entries(fields)) {
    if (raw === undefined) continue;
    const num = toNumber(raw);
    if (!Number.isInteger(num) || num <= 0) return { ok: false, error: `packaging-invalid:${name}` };
    v[name] = num;
  }
  const factors = { unit: 1 };
  if (v.unitsPerStrip) factors.strip = v.unitsPerStrip;
  const fromParts = v.stripsPerBox && v.unitsPerStrip ? v.stripsPerBox * v.unitsPerStrip : undefined;
  if (v.unitsPerBox && fromParts && v.unitsPerBox !== fromParts) return { ok: false, error: 'packaging-inconsistent' };
  const box = v.unitsPerBox ?? fromParts;
  if (box) factors.box = box;
  if (box && v.boxesPerCarton) factors.carton = box * v.boxesPerCarton;
  return { ok: true, factors };
}

function factorFor(unit, def) {
  const canon = canonicalUnit(unit);
  if (!canon) return fail('unit-unknown');
  const p = normalizePackaging(def);
  if (!p.ok) return fail(p.error);
  const f = p.factors[canon];
  return f ? ok(f) : fail('unit-unavailable');
}

function quantityOf(q) {
  const n = toNumber(q);
  return Number.isFinite(n) && n >= 0 ? ok(n) : fail('quantity-invalid');
}

const clean = x => Math.round(x * 1e9) / 1e9;
const isWhole = x => Math.abs(x - Math.round(x)) <= EPS;

export function toBaseUnits(quantity, unit, def, { requireWhole = false } = {}) {
  const f = factorFor(unit, def); if (!f.ok) return f;
  const q = quantityOf(quantity); if (!q.ok) return q;
  const base = clean(q.value * f.value);
  if (requireWhole && !isWhole(base)) return fail('fractional-base-units');
  return ok(base);
}

export function fromBaseUnits(baseQuantity, unit, def) {
  const f = factorFor(unit, def); if (!f.ok) return f;
  const q = quantityOf(baseQuantity); if (!q.ok) return q;
  return ok(clean(q.value / f.value));
}

export function convertQuantity(quantity, fromUnit, toUnit, def, opts) {
  const base = toBaseUnits(quantity, fromUnit, def, opts); if (!base.ok) return base;
  return fromBaseUnits(base.value, toUnit, def);
}

// Whole carton/box/strip/unit breakdown of a base quantity, using only the levels the product has.
export function splitBaseUnits(baseQuantity, def) {
  const q = quantityOf(baseQuantity); if (!q.ok) return q;
  if (!isWhole(q.value)) return fail('fractional-base-units');
  const p = normalizePackaging(def); if (!p.ok) return fail(p.error);
  let rest = Math.round(q.value); const parts = {};
  for (const level of ORDER) {
    const f = p.factors[level]; if (!f) continue;
    parts[level] = Math.floor(rest / f); rest -= parts[level] * f;
  }
  return ok(parts);
}

// ---- money: integer cents, BigInt arithmetic, one rounding (half up) per line --------------------------------------

function centsOf(price) {
  const n = toNumber(price);
  if (!Number.isFinite(n) || n < 0) return fail('price-invalid');
  const c = n * 100;
  if (Math.abs(c - Math.round(c)) > 1e-6) return fail('price-invalid'); // price must be whole cents
  return ok(BigInt(Math.round(c)));
}
const roundHalfUp = (num, den) => (2n * num + den) / (2n * den);

// Exact price of ONE target unit when `price` is the price of one priceUnit (not rounded; for display and comparison).
export function unitPrice(price, priceUnit, targetUnit, def) {
  const c = centsOf(price); if (!c.ok) return c;
  const fp = factorFor(priceUnit, def); if (!fp.ok) return fp;
  const ft = factorFor(targetUnit, def); if (!ft.ok) return ft;
  return ok(Number(c.value) * ft.value / (fp.value * 100));
}

function exactLine(cents, priceFactor, base) { return { num: cents * BigInt(Math.round(base)), den: BigInt(priceFactor) }; }

// Price of `quantity` target units, in EGP rounded once to cents.
export function linePrice(price, priceUnit, targetUnit, quantity, def) {
  const c = centsOf(price); if (!c.ok) return c;
  const fp = factorFor(priceUnit, def); if (!fp.ok) return fp;
  const base = toBaseUnits(quantity, targetUnit, def, { requireWhole: true }); if (!base.ok) return base;
  const { num, den } = exactLine(c.value, fp.value, base.value);
  return ok(Number(roundHalfUp(num, den)) / 100);
}

// Split lines of one priced pack (for example 7 single strips of a box) so the rounded lines add up to exactly
// the rounded total. Largest-remainder method; ties go to the earlier line.
export function allocateLinePrices(price, priceUnit, lines, def) {
  if (!Array.isArray(lines) || lines.length === 0) return fail('lines-empty');
  const c = centsOf(price); if (!c.ok) return c;
  const fp = factorFor(priceUnit, def); if (!fp.ok) return fp;
  const den = BigInt(fp.value);
  const parts = [];
  for (const line of lines) {
    const base = toBaseUnits(line?.qty, line?.unit, def, { requireWhole: true }); if (!base.ok) return base;
    const { num } = exactLine(c.value, fp.value, base.value);
    parts.push({ floor: num / den, rem: num % den, sum: num });
  }
  const totalNum = parts.reduce((s, p) => s + p.sum, 0n);
  const totalCents = roundHalfUp(totalNum, den);
  let extra = Number(totalCents - parts.reduce((s, p) => s + p.floor, 0n));
  const out = parts.map(p => p.floor);
  const order = parts.map((p, i) => i).sort((a, b) => (parts[b].rem === parts[a].rem ? a - b : parts[b].rem > parts[a].rem ? 1 : -1));
  for (const i of order) { if (extra <= 0) break; out[i] += 1n; extra -= 1; }
  return { ok: true, lines: out.map(x => Number(x) / 100), total: Number(totalCents) / 100 };
}
