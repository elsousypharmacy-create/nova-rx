// BUY-05: return of received goods to a supplier and matching of the supplier's credit note.
// Pure, no I/O, integers only. It plans and compares; it never books a credit or changes stock.
const MAX_QTY = 1e9, MAX_CENTS = 1e14;
const fail = (error, detail) => Object.freeze({ ok: false, error, detail });
const isInt = (v, max) => Number.isSafeInteger(v) && v >= 0 && v <= max;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = d => typeof d === 'string' && DATE.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const prorate = (total, whole, qty) => Number((BigInt(total) * BigInt(qty) * 2n + BigInt(whole)) / (BigInt(whole) * 2n));

// lots: [{productId, lot, expiry, receivedBase, onHandBase, lineCostCents|null}] (what the stock core holds for this branch)
// request: {supplierRef, reason, lines:[{productId, lot, qtyBase}]}
export function planSupplierReturn({ lots, request, today } = {}) {
  if (!validDate(today)) return fail('today-invalid');
  if (!request || !ID.test(String(request.supplierRef ?? '')) || !Array.isArray(request.lines) || request.lines.length === 0 || request.lines.length > 500) return fail('request-invalid');
  if (typeof request.reason !== 'string' || request.reason.trim().length < 3) return fail('reason-required');
  if (!Array.isArray(lots)) return fail('lots-invalid');
  const byKey = new Map();
  for (const [i, l] of lots.entries()) {
    if (!l || !ID.test(String(l.productId ?? '')) || !ID.test(String(l.lot ?? '')) || !validDate(l.expiry) || !isInt(l.onHandBase, MAX_QTY) || !isInt(l.receivedBase, MAX_QTY) || l.receivedBase < 1 || l.onHandBase > l.receivedBase || (l.lineCostCents != null && !isInt(l.lineCostCents, MAX_CENTS))) return fail('lot-invalid', { index: i });
    byKey.set(`${l.productId}\u0000${l.lot}`, l);
  }
  const want = new Map();
  for (const [i, l] of request.lines.entries()) {
    if (!l || !ID.test(String(l.productId ?? '')) || !ID.test(String(l.lot ?? '')) || !Number.isSafeInteger(l.qtyBase) || l.qtyBase < 1 || l.qtyBase > MAX_QTY) return fail('request-line-invalid', { index: i });
    const k = `${l.productId}\u0000${l.lot}`; want.set(k, (want.get(k) ?? 0) + l.qtyBase);
  }
  const lines = [], warnings = []; let credit = 0, needsCost = false;
  for (const [k, qty] of want) {
    const lot = byKey.get(k);
    const [productId, lotId] = k.split('\u0000');
    if (!lot) return fail('lot-not-found', { productId, lot: lotId });
    if (qty > lot.onHandBase) return fail('return-exceeds-on-hand', { productId, lot: lotId, requestedBase: qty, onHandBase: lot.onHandBase });
    const expired = lot.expiry < today;
    if (!expired) warnings.push(`not-expired:${productId}:${lotId}`);
    let creditCents = null;
    if (lot.lineCostCents == null) needsCost = true; else { creditCents = prorate(lot.lineCostCents, lot.receivedBase, qty); credit += creditCents; }
    lines.push(Object.freeze({ productId, lot: lotId, qtyBase: qty, expiry: lot.expiry, expired, creditCents }));
  }
  return Object.freeze({ ok: true, supplierRef: request.supplierRef, reason: request.reason.trim(), status: needsCost ? 'needs-cost' : 'ready', expectedCreditCents: needsCost ? null : credit, lines: Object.freeze(lines), warnings: Object.freeze(warnings), creditBooked: false });
}

export function matchCreditNote({ plan, note, knownCreditNotes = [], tolerance = {} } = {}) {
  if (!plan || plan.ok !== true || !Array.isArray(plan.lines)) return fail('plan-invalid');
  if (!note || typeof note.number !== 'string' || note.number.trim() === '' || note.number.length > 64 || !isInt(note.totalCents, MAX_CENTS)) return fail('note-invalid');
  const tol = tolerance.cents ?? 0; if (!isInt(tol, MAX_CENTS)) return fail('tolerance-invalid');
  if (!Array.isArray(knownCreditNotes)) return fail('known-notes-invalid');
  const issues = [];
  let differenceCents = null;
  if (plan.expectedCreditCents == null) issues.push('plan-needs-cost');
  else { differenceCents = note.totalCents - plan.expectedCreditCents; if (Math.abs(differenceCents) > tol) issues.push(differenceCents < 0 ? 'credit-short' : 'credit-over'); }
  const dup = knownCreditNotes.some(k => String(k).trim().toLowerCase() === note.number.trim().toLowerCase());
  if (dup) issues.push('duplicate-credit-note');
  const verdict = dup ? 'reject' : issues.length ? 'hold' : 'approve';
  return Object.freeze({ ok: true, verdict, issues: Object.freeze(issues), expectedCreditCents: plan.expectedCreditCents, noteTotalCents: note.totalCents, differenceCents, creditBooked: false });
}
