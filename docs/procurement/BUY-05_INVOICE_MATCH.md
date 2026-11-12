# BUY-05 — three-way match (PO / goods received / supplier invoice)

Status: **merged code is pure and not wired**; not accepted. `worker/procurement/invoice-match.js`, `tests/unit/procurement-invoice-match.check.mjs` (12 cases, run by `procurement-unit.yml`).

`matchInvoice({ po, receipts, invoice, knownInvoiceNumbers, tolerance })` compares, per product (lines of the same product are merged first):
- the PO (`orderedBase`, optional `lineTotalCents`), the goods really received (`qtyBase`, e.g. from the INV-01 `receipt_line` rows), and the invoice (`qtyBase`, `lineTotalCents`, declared total).
- Issues: `not-on-po`, `invoiced-more-than-received`, `received-not-fully-invoiced`, `received-not-invoiced`, `price-variance` (invoice line vs the PO price pro-rated to the invoiced quantity, half-up in BigInt; allowed = max(`tolerance.cents`, `tolerance.bps` of expected), default 0), `total-mismatch` (declared total vs sum of lines), `duplicate-invoice` (case/space-insensitive against `knownInvoiceNumbers`).
- Verdict: `reject` (duplicate invoice or product not on the PO), `hold` (any other issue), `approve` (no issue). Approve is a recommendation to a human: the result always carries `paymentReleased:false`; nothing here pays or books anything.

Not done: supplier returns (credit notes), lot/expiry/cost checks against the invoice, tax and discount lines, currency, wiring to the Orders page or the stock core, persisting the verdict, who may override a hold. The PO price is optional on purpose (INV-01 purchase orders carry none); without it only quantities and totals are checked.
