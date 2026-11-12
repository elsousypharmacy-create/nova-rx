// BUY-05: three-way match of a supplier invoice against the purchase order and the goods actually received.
// Pure, no I/O, integers only (base units and cents). It produces a verdict for a human; it never releases payment.
const MAX_QTY = 1e9, MAX_CENTS = 1e14;
const fail = (error, detail) => Object.freeze({ ok: false, error, detail });
const isInt = (v, max) => Number.isSafeInteger(v) && v >= 0 && v <= max;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function merge(lines, field, label) {
  if (!Array.isArray(lines)) return fail(`${label}-invalid`);
  const m = new Map();
  for (const [i, l] of lines.entries()) {
    if (!l || typeof l !== 'object' || !ID.test(String(l.productId ?? ''))) return fail(`${label}-line-invalid`, { index: i });
    if (!isInt(l[field.qty], MAX_QTY) || (field.cents && !isInt(l[field.cents], MAX_CENTS))) return fail(`${label}-line-invalid`, { index: i });
    const cur = m.get(l.productId) ?? { qty: 0, cents: 0 };
    cur.qty += l[field.qty]; if (field.cents) cur.cents += l[field.cents];
    if (cur.qty > MAX_QTY || cur.cents > MAX_CENTS) return fail(`${label}-line-invalid`, { index: i });
    m.set(l.productId, cur);
  }
  return { ok: true, map: m };
}

// PO price pro-rated to a quantity, rounded half up, exact in BigInt.
const prorate = (totalCents, ordered, qty) => Number((BigInt(totalCents) * BigInt(qty) * 2n + BigInt(ordered)) / (BigInt(ordered) * 2n));

export function matchInvoice({ po, receipts, invoice, knownInvoiceNumbers = [], tolerance = {} } = {}) {
  if (!po || !ID.test(String(po.poRef ?? ''))) return fail('po-invalid');
  if (!Array.isArray(po.lines) || po.lines.length === 0) return fail('po-invalid');
  if (!invoice || typeof invoice.number !== 'string' || invoice.number.trim() === '' || invoice.number.length > 64) return fail('invoice-number-invalid');
  if (!isInt(invoice.declaredTotalCents, MAX_CENTS)) return fail('invoice-total-invalid');
  const tolCents = tolerance.cents ?? 0, tolBps = tolerance.bps ?? 0;
  if (!isInt(tolCents, MAX_CENTS) || !isInt(tolBps, 10000)) return fail('tolerance-invalid');
  if (!Array.isArray(knownInvoiceNumbers)) return fail('known-invoices-invalid');

  const poM = new Map();
  for (const [i, l] of po.lines.entries()) {
    if (!l || !ID.test(String(l.productId ?? '')) || !isInt(l.orderedBase, MAX_QTY) || l.orderedBase < 1 || (l.lineTotalCents != null && !isInt(l.lineTotalCents, MAX_CENTS))) return fail('po-line-invalid', { index: i });
    if (poM.has(l.productId)) return fail('po-line-duplicate', { index: i });
    poM.set(l.productId, l);
  }
  const rc = merge(receipts, { qty: 'qtyBase' }, 'receipt'); if (!rc.ok) return rc;
  const iv = merge(invoice.lines, { qty: 'qtyBase', cents: 'lineTotalCents' }, 'invoice'); if (!iv.ok) return iv;

  const lines = [];
  let sum = 0;
  for (const id of new Set([...poM.keys(), ...rc.map.keys(), ...iv.map.keys()])) {
    const p = poM.get(id), got = rc.map.get(id)?.qty ?? 0, bill = iv.map.get(id);
    const issues = []; let qtyGapBase = 0, varianceCents = 0, expectedCents = null;
    if (!p) issues.push('not-on-po');
    if (bill) {
      sum += bill.cents;
      if (bill.qty > got) { issues.push('invoiced-more-than-received'); qtyGapBase = bill.qty - got; }
      else if (bill.qty < got) { issues.push('received-not-fully-invoiced'); qtyGapBase = got - bill.qty; }
      if (p && p.lineTotalCents != null) {
        expectedCents = prorate(p.lineTotalCents, p.orderedBase, bill.qty);
        varianceCents = bill.cents - expectedCents;
        const allowed = Math.max(tolCents, Number((BigInt(expectedCents) * BigInt(tolBps)) / 10000n));
        if (Math.abs(varianceCents) > allowed) issues.push('price-variance');
      }
    } else if (got > 0) { issues.push('received-not-invoiced'); qtyGapBase = got; }
    lines.push(Object.freeze({ productId: id, orderedBase: p?.orderedBase ?? 0, receivedBase: got, invoicedBase: bill?.qty ?? 0, invoiceLineCents: bill?.cents ?? 0, expectedCents, varianceCents, qtyGapBase, issues: Object.freeze(issues) }));
  }
  const issues = [];
  if (sum !== invoice.declaredTotalCents) issues.push('total-mismatch');
  const dup = knownInvoiceNumbers.some(k => String(k).trim().toLowerCase() === invoice.number.trim().toLowerCase());
  if (dup) issues.push('duplicate-invoice');
  const all = new Set([...issues, ...lines.flatMap(l => l.issues)]);
  const verdict = (all.has('duplicate-invoice') || all.has('not-on-po')) ? 'reject' : all.size ? 'hold' : 'approve';
  return Object.freeze({ ok: true, poRef: po.poRef, invoiceNumber: invoice.number, verdict, invoiceTotalCents: sum, issues: Object.freeze(issues), lines: Object.freeze(lines), paymentReleased: false });
}
