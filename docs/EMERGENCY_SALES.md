# Emergency mobile sales (Issue #84)

Status: MVP, read-only prices + local temporary invoices. Nothing deployed, merged, or written to any production system.

## Phase 0 — source of truth (evidence, no credentials)

| Question | Finding | Evidence |
|---|---|---|
| Live product catalog | Google Sheet **STOCK LIVE** (first sheet), columns `code, gtin, namear, nameen, price, stock, units, expire, multistock, category…` | `pharmacy` repo, `server/src/72_scan.js` `scanIndex_()`, `74_orders.js` `ordLiveStock_()` (read only) |
| Selling price | Column `price` = **public (retail) price**; the same file computes "total retail value" from it (`totprice` = سعر الجمهور) and the customer bot quotes it | `server/src/70_inventory_aging.js`, `30_stock.js` |
| Stock | Column `stock`, in packs (`units` = parts per pack) — a sheet value, not a POS ledger | `72_scan.js` |
| Live API | Apps Script web app actions `scanSearch?q=` / `scanLookup?code=` return name, price, stock | `server/src/05_routing.js` lines 59–60 |
| API authentication | **None for these two actions.** They are not in `LOCKED_GET`, so anyone with the web-app URL can read prices/stock. | `05_routing.js` `LOCKED_GET` |
| Write capability | `scan*` are read only; no write path was used or added | — |
| NOVA Rx's own catalog | Demo products (`DEMO_PRODUCTS` in `index.html`, 12 fake rows). **Must not be used for prices.** | `docs/IMPLEMENTATION_STATUS.md` "Demo product data" |
| Supplier prices | Purchase prices (PharmaOverseas/Aumet). **Not used.** | — |

**Not verified:** a live call to the Apps Script endpoint. This session's network blocks `script.google.com` (proxy 403), so freshness and the real response shape were NOT tested. The code reads the documented column names only.

**Blocker / finding to report:** the unauthenticated `scanSearch/scanLookup` actions expose the pharmacy's stock and prices to anyone holding the URL. Owner should decide whether to lock them. This repo cannot change that (the `pharmacy` repo is out of scope).

## What was built (Phase 1 MVP, `emergency-sales.html` + `emergency-core.js`)
- Standalone Arabic RTL mobile page; 52 px touch targets; no network calls at all (static test enforces it).
- Prices come from a **read-only snapshot** the staff loads while online (CSV export of STOCK LIVE, or JSON `{exportedAt, items}`), stored on the device. Items without a valid price cannot be added.
- Export time is **never guessed**: it comes from JSON `exportedAt` or a field the staff fills in. Unknown time → warning banner; > 6 h → "stale"; > 24 h → "old". Banner always says stock is approximate, not real-time.
- Basket with quantity, unit price, subtotal, total; discount only with the approver's name; staff name required.
- Draft autosaved on every change and restored after refresh; marked "pending / not sent".
- Temporary invoice: UUID + readable ref (`EMG-YYMMDD-XXXXX`), frozen line-price snapshot, saved to the queue **before** the PDF is built.
- Arabic PDF with pharmacy name and the banner **«فاتورة مؤقتة — لم تُرحّل للنظام»**, plus "not a tax invoice". Font is Cairo, bundled at `fonts/cairo.woff` (works offline); text is shaped by the browser canvas and packed into a PDF. Native share (WhatsApp) with automatic download fallback.

## Phase 2 (safe reconciliation) — what exists / what does not
Exists: local queue `pending / needs-review / synced`; audit trail (who/when); review needs a name; `synced` is terminal and idempotent (second mark is a no-op, one audit entry); `detectConflicts()` (price changed, stock too low, item missing); export of non-synced invoices as `nova-emergency-v1` JSON keyed by stable `externalId`.
Does **not** exist (needs owner approval, see below): the import into the main POS, durable server storage, multi-device queue. The UI has no "mark synced" button on purpose: it must follow a real, reviewed import.

## Proposed architecture for the next step (approval required before any implementation)
1. **Read API**: Worker route `GET /api/emergency/search?q=` behind `X-Nova-Pin` (same pattern as `/api/suppliers/*`), calling the Apps Script `scanSearch` server-side with the URL kept as a Worker secret, returning `{price, stock, fetchedAt}`. Removes the need to hand the sheet URL to phones and gives a real timestamp. Needs: owner approval + Worker deploy.
2. **Durable invoices**: Worker KV (or D1) store keyed by invoice `id`, written with `PUT` idempotent on `id`; audit entries append-only. Needs a new backend write → approval.
3. **Import to POS**: a human-reviewed batch that sends `externalId` and lets the POS reject duplicates. Which POS and its API are unknown to this repo; ask the owner.

## QA matrix
| Check | Result |
|---|---|
| Core logic (parse, search, totals, discount rule, immutable snapshot, queue idempotency, conflicts, draft recovery, PDF structure, no-network/no-credential static check) | PASS — `tests/unit/emergency-core.check.mjs` |
| Browser, 390x844 Chromium: load snapshot, search, add, refresh recovery, discount needs approver, create invoice, queue, export | PASS — `tests/emergency-sales-browser.mjs`, `reports/emergency-sales-results.txt` |
| Connectivity lost while creating invoice + PDF | PASS (browser set offline; PDF still produced) |
| PDF with 1 / 6 / 20 items (1 / 1 / 3 pages), long item name wrapped and ellipsised | PASS; visually checked 2-item and 20-item page 1 (`reports/emergency-sample-*.pdf`) |
| Arabic PDF font | PASS on Chromium with bundled Cairo. **NOT TESTED** on iPhone/Android |
| Native share / WhatsApp file share | **NOT TESTED** (headless Chromium has no share sheet); download fallback tested |
| Same invoice imported twice → one sale | PASS for the local queue (`synced` idempotent). The POS import itself **does not exist yet** — NOT TESTED |
| Catalog / price freshness against the real STOCK LIVE | **NOT TESTED** (network blocked; see Phase 0) |
| Cellular network on a real phone | **NOT TESTED** |
| Unauthorized access to sensitive data | The page ships no data and no secrets; prices exist only on devices that loaded the file. Source endpoint exposure: see finding above |
| Existing tests | `npm run check` and all `tests/unit/procurement-*.check.mjs` PASS |

## Daily use
1. While online: in the Google Sheet download STOCK LIVE as CSV (columns `code,gtin,namear,nameen,price,stock,units`).
2. Open `emergency-sales.html` on the phone → «الأسعار» → fill export time → choose the file.
3. After the outage: «الفواتير» → export JSON → owner reviews before any import.
