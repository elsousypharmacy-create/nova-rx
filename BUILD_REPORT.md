# BUILD_REPORT — NOVA Rx

## FND-03 (2026-11-10): ERP domain model document (design draft) — done

- Task (`/tmp/kimi-task.txt`, delegation [Kimi][FND-03][1/5], linked to plan #87): create `docs/erp/FND-03_DOMAIN_MODEL.md` only — entity/key map for tenant/branch/user/product/variant/unit/batch/stockMovement/invoice/payment/return/purchaseOrder/receipt/journal, relationships and constraints, document states, and source ownership, linking FND-01 reality to the proposed model and listing unsettled storage decisions. No migrations, no database implementation, no status change to `verified`.
- Read only: `KIMI_CONTEXT.md`, `HANDOFF.md` (latest checkpoints), the FND-03 section of `docs/ERP_MASTER_PLAN.md` and its `reports/erp-roadmap.json` entry (acceptance: «توثيق … مفاتيح ثابتة وقيود العلاقات وحالات المستندات», status `queued`), plus allowed `docs/erp/FND-01_REALITY_MAP.md` and `docs/erp/FND-02_STORAGE_ADR_DRAFT.md`.
- Changed files:
  - `docs/erp/FND-03_DOMAIN_MODEL.md` (new, Arabic, DRAFT): general principles from FND-02 §6 (mandatory `tenant_id`/`branch_id`, stable keys, UTC, fixed decimal, immutable ledger, idempotency, EGP); entity table with keys, alternate keys/UNIQUE constraints, relationships, current owner per FND-01 vs proposed, and current/proposed marking; document state machines (invoice/payment/return/purchaseOrder/receipt, immutable stockMovement/journal); six integration invariants mirroring FND-02 §4; single-writer source ownership until gate G1; one synthetic JSON example; ten unsettled storage decisions (D1 vs Postgres pending FND-02 measurement, money representation, key shape, unit conversion, batch mandatoriness, branch count, receipt meaning, tax classes, historical sales migration, unified customer key). Explicitly notes `DATABASE_SCHEMA.md` was not read this run (outside allowed files); its group names were taken from FND-02 §7's summary and the entity grouping matches.
- Tests actually run (exact results):
  - `sed -n '/^```json$/,/^```$/p' docs/erp/FND-03_DOMAIN_MODEL.md | sed '1d;$d' > /tmp/fnd03-example.json && python3 -m json.tool /tmp/fnd03-example.json > /dev/null` → exit 0, printed `JSON_VALID` (synthetic example is valid JSON).
  - `node --check`: not applicable — no JS file created in this task.
  - Manual consistency review: keys/relationships/states cross-checked between §2–§4 of the doc and against the FND-03 acceptance text in the plan and roadmap.
- Remaining work: ChatGPT reviews this draft; roadmap status stays `queued` (unchanged per task); FND-02 storage measurement is the open predecessor for the unsettled decisions; tasks 2/5–5/5 of the delegation batch not started.
- Limitations: document-level design only — NOT TESTED against any database or runtime; no `DATABASE_SCHEMA.md` deep-read (out of allowed scope); customer entity deliberately deferred (unified key unresolved, FND-01 gap 5); receipt semantics flagged as an open question. Changes uncommitted per instructions.

## Procurement 10 (2026-11-08): Supplier hub for the Worker — encrypted sessions, search API, compare — done

- Issue: "[Procurement 10] Supplier hub for the Worker: encrypted sessions, search API, compare" (epic #53). Read only: the issue, `worker/procurement/compare.js`, `normalize.js` (exports + `matchOffersToItem`), `connectors/pharmaoverseas.js`, `connectors/aumet.js`, `ui-model.js`, and the `provider()` lines of `supplier-lookup.js`.
- Changed files:
  - `worker/procurement/provider/session-store.js` (new): `createSessionStore({ kv, secret, now })`. AES-GCM via WebCrypto, key = SHA-256(secret) (Worker secret `NOVA_SECRET_ENCRYPTION_KEY`), random 12-byte IV per write, KV value = JSON `{ v:1, iv, ct }` (base64) at `supplier-session:<id>` with `expirationTtl` derived from `expiresAt`. `save` / `load` (null when missing, expired `expiresAt <= now()`, or undecryptable; `{ ignoreExpiry: true }` peeks for `status()`) / `remove`. Only `pharmaoverseas` / `aumet` allowed; other ids throw.
  - `worker/procurement/provider/hub.js` (new): `createSupplierHub({ store, now, fetch, connectors })`. Default connectors: PharmaOverseas with `getAccessToken` reading the session holder (throws `AuthRequiredError` when absent), Aumet with `request(url, params)` doing `fetch(url + '?' + query, { headers: Accept/Authorization/Cookie/X-XSRF-TOKEN/X-Requested-With/x-user-lang: 'ar' })` returning `{ status, headers, text }`; holders refreshed from the store before each search; sessions/headers never logged. `status()` → `[{ id, name, state: ok|expired|off, expiresAt, savedAt }]` (no secrets). `search(query, { requestedQty })`: latin = parenthesized text when it holds Latin letters else whole query; `searchText` = leading letters of first word (`أوجمنتين 1 جم (Augmentin 1g)` → `Augmentin`); both suppliers searched in parallel (`connector.search(searchText, { page: 1, pageSize: 24 })`, 8 s timeout each), `toOffer` conversion skipping + counting `SchemaDriftError` rows; per-supplier state `ok` / `off` (no valid session) / `error` with Arabic message (`AuthRequiredError` → "الجلسة انتهت، سجّل دخول المورد", `RateLimitedError` → "كتير طلبات، جرّب بعد شوية", others → "تعذر الاتصال"); `compareForItem({ name }, offers, { requestedQty, now })`, retried once with `minScore: 0.5` when the 0.8 pass yields no rows; returns `{ fetchedAt, results: [compareResult], suppliers: [{ id, name, state, message? }] }` exactly as `supplier-lookup.js` consumes.
  - `worker/procurement/provider/http.js` (new): `createSupplierApi({ hub, store, env })` → `async handle(request)` returning `null` for foreign paths. JSON only, `Cache-Control: no-store`. `POST /api/suppliers/session` guarded by `X-Ingest-Secret` = `env.NOVA_INGEST_SECRET` (constant-time via SHA-256 digest compare); 400 on bad body/unknown supplier, body never echoed. `GET /api/suppliers/status`, `GET /api/suppliers/list`, `POST /api/suppliers/search` guarded by `X-Nova-Pin` = `env.NOVA_API_PIN`; in-memory fixed-window rate limit 40 searches/min then 429 + `Retry-After`. Missing `NOVA_API_PIN` / `NOVA_INGEST_SECRET` → 503 `not-configured` (never open by default).
  - `worker/procurement/compare.js` (edited): `compareForItem` accepts `minScore` option (default `MIN_SCORE` = 0.8, backward compatible); matcher already emits 0.5 brand-only rows with `needsReview`, so the hub fallback surfaces them flagged.
  - `tests/unit/procurement-hub.check.mjs` (new): `node:assert/strict`, Map-based fake KV and fake connectors only; prints `procurement-hub checks passed`.
- Tests actually run (exact results) on Node v24.22.2:
  - `node tests/unit/procurement-hub.check.mjs` → prints `procurement-hub checks passed`. Covers every acceptance criterion: round trip `save`→`load` returns the same session; raw KV string asserted not to contain the session text; wrong secret → null; expired → null (`ignoreExpiry` peek still returns it); unknown supplier id rejects on save/load/remove; garbage KV value → null; `remove` → null. Hub: two fake connectors return shape `{ fetchedAt, results: [1 compareResult], suppliers: [2 entries] }`, drifted row skipped, best = cheapest comparable unit (Aumet 84 < PharmaOverseas 100 for AUGMENTIN 1G 14 TAB); `AuthRequiredError` → state `error` with the exact Arabic auth message while the other supplier stays `ok`; no session → state `off` and connector never called; query `أوجمنتين 1 جم (Augmentin 1g)` reaches both connectors as `Augmentin` with `{ page: 1, pageSize: 24 }`; brand-only fallback: `AUGMENTIN 600MG 12 TAB` vs item `Augmentin 1g` yields 0 rows at 0.8 then 1 row at 0.5 with `needsReview: true`. `status()`: ok/expired/off correct, JSON contains no token. HTTP: foreign path → null; 401 without/wrong pin and without ingest secret; 503 `not-configured` when env vars missing; ingest 400 on unknown supplier and on malformed JSON, 200 stores the session; search 400 on empty query (without consuming quota); 40 searches pass, 41st → 429 with `Retry-After` ≥ 1; search/status bodies asserted free of token/cookie strings. Static: the three provider modules contain none of `console.`, `eval(`, `password`, `username`.
  - `for f in tests/unit/procurement-*.check.mjs; do node "$f"; done` → all 11 files print their `… checks passed` line, exit 0 each (includes the unchanged `procurement-compare` suite against the edited `compare.js`).
- Remaining work: none within this task. Wiring `handle(request)` into the Worker entry (`worker/live/*`) and the browser-side session ingest job are explicitly out of scope for this run.
- Limitations: Node-only verification (no Worker runtime / Miniflare); rate limiter is per-isolate in-memory (fixed 1-minute window), not durable across Worker isolates; Aumet default `request` builds the query string with `URLSearchParams` (the connector passes the full `baseUrl + path`). Pre-existing `MODULE_TYPELESS_PACKAGE_JSON` warning (package.json out of scope). Changes uncommitted per instructions.

## Procurement 08 (2026-11-08): Supplier lookup in the sale screen (UI model + DOM layer) — done

- Issue: "[Procurement 08] Supplier lookup in the sale screen: row unit, popup, suppliers screen" (epic #53). Read only: the issue, `docs/procurement/ui-reference/` (README + row-unit/popup/suppliers-screen designs), exports of `worker/procurement/compare.js`, and the `suggestion-item` / empty-search / `enExtra` / settings regions of `index.html` via rg/sed.
- Changed files:
  - `worker/procurement/ui-model.js` (new): pure ES module (imports only sibling `normalize.js` for pack-unit words). `buildLookupModel(compareResult, { requestedQty })` accepts a single `compareForItem` result or the provider search payload (`{ fetchedAt, results, suppliers }`); groups rows by `supplierId` keeping compare order; marks exactly one `best` (first eligible row, so an out-of-stock cheaper row is never best and keeps `reasons`); rows carry `key, supplierId, supplierName, sellerName, productName, packPrice, publicPrice, discountPct, stockLabel, stockStatus, unitPriceLabel, best, eligible, reasons`; `unitPriceLabel` uses the pack unit word (e.g. "سعر القرص 11.77 ج.م") with fallback "سعر الوحدة"; `altGroups` + `suggestionsNote` ("بدائل اقترحها المورد…") when extra results exist. `stockUnitState(stock, lowLimit = 30)`. `createDraftStore(storage)` (`add` sums qty on repeat key, `setQty` clamps 1–999, `remove`, `list`, `bySupplier`), persists to storage key `novaSupplierDraft`; sends nothing anywhere.
  - `supplier-lookup.css` (new): CSS lifted from the approved design scripts, palette variables only, 44 px touch targets under `(pointer: coarse)`, plus group-header / state styles.
  - `supplier-lookup.js` (new, classic defer script): reads `window.NOVA_SUPPLIER_PROVIDER` (default `undefined` → buttons show "الموردين غير مربوطين بعد"); MutationObserver decorates product suggestion rows (stock chip + "الموردين" button, icon-only when stock ok, click stopPropagation so Enter/click still sells) and the empty-search box; popup on `.modal-backdrop.active`/`.modal-card` with loading state, per-supplier error lines, "آخر تحديث" from `fetchedAt`, Aumet-style group headers with `sellerName` rows, alternatives section, qty `−`/`+` + "أضف لطلبية المورد" into the draft store, footer "سعر الصيدلية قبل التوصيل" + link to the suppliers screen, Esc/backdrop/close; suppliers screen injected as a card into the settings grid + reachable from the popup footer, with status chips (مربوط/خطأ/قريباً), "فحص", and an add form (only provider-`available` suppliers selectable, email, password `type=password autocomplete=off`, "فحص الاتصال"/"حفظ"); the password is cleared immediately after reading and never stored, logged or displayed. No network calls of its own; stock matched from `window.NOVA_DEMO.products` by barcode.
  - `tests/unit/procurement-ui-model.check.mjs` (new): covers every acceptance point; prints `procurement-ui-model checks passed`.
  - `index.html` (edited): exactly two additions — one `<link rel="stylesheet" href="supplier-lookup.css">` before `</head>`, one `<script defer src="supplier-lookup.js">` on the last line before `</body>`. `git diff --stat`: 2 insertions, 1 deletion (within the 3-line limit).
- Tests actually run (exact results) on Node v24:
  - `node tests/unit/procurement-ui-model.check.mjs` → prints `procurement-ui-model checks passed`. Asserts: two groups (PharmaOverseas 1 row, Aumet 3 rows distinct sellers) with exactly one best; out-of-stock cheapest row not best and keeps `reasons: ['out_of_stock']`; `sellerName` preserved; unique keys; `unitPriceLabel` "سعر القرص 11.77 ج.م"; alternatives payload sets `suggestionsNote`/`altGroups`; `stockUnitState(28)` low / `(120)` ok / `(30)` ok; draft add-twice sums qty, `setQty(key, 0)` → 1, clamp 999, persist+reload from fake storage, `bySupplier()` grouping, removal persists, draft blob contains no "password"; static: `supplier-lookup.js` has no `fetch(`, no `XMLHttpRequest`, no `localStorage.setItem`; no emoji characters in `supplier-lookup.js` / `supplier-lookup.css` / `ui-model.js`.
  - `node --check supplier-lookup.js` → exit 0 (`SYNTAX_OK`).
  - `npm run check` → all existing checks pass, ends with `gemini-batch.check: PASS`.
  - `for f in tests/unit/procurement-*.check.mjs; do node "$f"; done` → all 9 files print their `… checks passed` line, exit 0 each.
- Remaining work: real network provider (`window.NOVA_SUPPLIER_PROVIDER`) is built separately by Claude; Claude also runs the browser checks (row unit, popup, suppliers screen on the live sale screen).
- Limitations: no browser/Playwright verification in this run (Node-only by task scope). i18n: the 3-line `index.html` diff cap forbids touching `enExtra`, so new strings carry their own Arabic→English map inside `supplier-lookup.js` keyed off the `lang-en` body class instead of the app's overlay; a future run may merge them into `enExtra` if the diff budget allows. Pharmacy stock for the row unit comes from `window.NOVA_DEMO.products` matched by barcode (prototype data only).

## Procurement 03b (2026-11-08): Aumet connector (marketplace) + seller fields — done

- Issue: "[Procurement 03b] Aumet connector (marketplace: one offer per distributor) + seller field" (epic #53). Read only: the issue, `docs/procurement/discovery/aumet.md`, `worker/procurement/connectors/pharmaoverseas.js`, `offer-schema.js`, `compare.js` (ranking part).
- Changed files:
  - `worker/procurement/offer-schema.js` (edited): `OFFER_FIELDS` gains optional `sellerId`, `sellerName` (now 19). `validateOffer` accepts them as null or non-empty string without `<`/`>`. Existing fields/validators untouched.
  - `worker/procurement/compare.js` (edited): ranking tie-break now `supplierId` asc then `sellerId` asc, so same-supplier marketplace rows stay distinct offers and order deterministically. Output rows still carry the full offer, so `sellerName` is preserved.
  - `worker/procurement/connectors/aumet.js` (new): `createAumetConnector({ request, baseUrl, sleep, now, lowStockLimit = 100 })`, default `baseUrl = 'https://marketplace.aumet.com'`; the caller-supplied `request(path, params)` carries login headers — the connector never sees credentials. `id: 'aumet'`, `authorization: 'owner-account'`, `capabilities { search: true, getProduct: false, listCatalog: false, stock: 'quantity' }`, `rateLimit 20 req/min` (min-interval throttle via injected `sleep`/`now`). `search(query, { page = 1, pageSize = 24 })` → `GET {baseUrl}/api/products` with params from the isolated, exported `buildSearchParams` (`{ page, result_per_page, sort_by: 'price', show_comparison: 1, in_stock: 1, spell: query }` — `spell` unconfirmed, single place to fix); returns `{ offers: body.data[], page, pageSize, totalPages = ceil((totalResult ?? num_found) / result_per_page) }`. Error mapping mirrors pharmaoverseas: 401 `AuthRequiredError`, 403 `NotAuthorizedError`, 429 `RateLimitedError` (`Retry-After` s→ms, default 60000), non-2xx/5xx/network/invalid-JSON `TransientError`, HTML body (login page) `NotAuthorizedError`, missing `id`/`unit_price`/`product`/`product.label` in `toOffer` → `SchemaDriftError` with `missing`. `getProduct` throws `ConnectorError('...', 'NOT_SUPPORTED')`. `toOffer(raw, { fetchedAt })`: `supplierProductId = String(raw.id)`, `sellerId = String(raw.entity_id)` (null when absent), `sellerName = sanitizeName(raw.entity?.name)` (null when empty), `barcode` only when 8–14 digits else null, `productName = sanitizeName(label?.name ?? label)`, `packSize = null`, `unitPrice = raw.unit_price`, `publicPrice = number(retail_selling_price)` when finite ≥ 0 else null, `netEffectivePrice = null` (price semantics unconfirmed), `discountPct = best_price && unit_price ? round2((1 - best_price/unit_price)*100) : null`, `availableQuantity = number(raw.stock)` else null, `stockStatus` = `out_of_stock` (≤ 0) / `low` (< `lowStockLimit`, default 100) / `in_stock` / `unknown`, `minimumOrderQuantity = null`, `dataSource: 'api'`, `syncStatus: 'fresh'`, `raw` limited to `{ unit_price, best_price, retail_selling_price, vat, discounts, bonuses, stock, delivery_fee, average_distributor_rate }`.
  - `tests/fixtures/aumet/products-panadol.json` (new): 3 synthetic distributor offers for one product (made-up ids/names): stock 655 with barcode; stock 0 without barcode; stock 19 with HTML in a plain-string label.
  - `tests/unit/procurement-aumet.check.mjs` (new): `node:assert/strict`, fake `request` (records url+params), fake `sleep`, fixed `now`; no network. Prints `procurement-aumet checks passed`.
  - `tests/unit/procurement-contract.check.mjs` (edited): `OFFER_FIELDS` expectation 17 → 19.
- Tests actually run (exact results): `for f in tests/unit/procurement-*.check.mjs; do node "$f"; done` on Node v24.22.2 — all 8 files pass, exit 0 each:
  - `procurement-aumet.check.mjs` → prints `procurement-aumet checks passed`. Covers every acceptance criterion: `assertConnector` + registry next to `pharmaoverseas`; request URL `https://marketplace.aumet.com/api/products` with exact `buildSearchParams` params; `totalPages` = 1 (`ceil(3/24)`), 2 (`ceil(3/2)`), 0 (empty); 3 distributors → 3 offers with sellerIds `7001/7002/7003`, all `validateOffer`-ok; stock 0 → `out_of_stock`, 19 → `low`, 655 → `in_stock`; `netEffectivePrice` null on all; `discountPct` 10 / null (no `best_price`) / 5; `publicPrice` coerced from `"65"`; barcode null when missing or invalid (`'12ab'`); HTML stripped from plain-string label; `raw` keys exactly the 9 whitelisted fields; `sellerId`/`sellerName` null when `entity_id`/`entity` absent; `validateOffer` rejects `sellerId` with `<`; `compareForItem` keeps all 3 same-supplier offers, best = seller `7001`, out-of-stock row ineligible, rows keep `sellerName`; price tie broken by `sellerId` asc; errors 401/403/429(`Retry-After: 7` → 7000 ms; default 60000)/500/503/network/HTML-login/invalid-JSON map as specified; missing `unit_price`/`product` → `SchemaDriftError.missing`; `getProduct` rejects `NOT_SUPPORTED`; 25 calls at 20 req/min → fake sleep total 72000 ms ≥ 15000; static check: source has no `console.` and no `password`.
  - `procurement-contract.check.mjs` → `procurement-contract checks passed` (19-field expectation).
  - `procurement-compare.check.mjs` → `compareMany: 200 items x 10,000 offers in 457.8 ms`, `procurement-compare checks passed`.
  - `procurement-discovery.check.mjs`, `procurement-discovery-leaks.check.mjs`, `procurement-normalize.check.mjs` (134/134), `procurement-pharmaoverseas.check.mjs`, `procurement-po-draft.check.mjs` → all print their `... checks passed`, exit 0.
- Remaining work: none within this task. Live-check of the `spell` search parameter name and `unit_price` vs `best_price` semantics (discovery "Unknown") is explicitly deferred to a later run; fix point is the exported `buildSearchParams`.
- Limitations: `spell` as the query parameter name is unconfirmed (documented unknown). `lowStockLimit` defaults to 100 (from `/api/config` discovery) and is injectable, not fetched. `getProduct` is a contract-required stub that throws `NOT_SUPPORTED`. No pageSize upper clamp (Aumet's cap unknown); only `< 1` → 1. Pre-existing `MODULE_TYPELESS_PACKAGE_JSON` warning (package.json out of scope). Changes uncommitted per instructions.

## Procurement 07 (2026-11-08): purchase order drafts — done (drafts-only scope)

- Issue: "[Procurement 07] Purchase order drafts + approved add-to-cart on supplier site" (epic #53). Scope for this run: drafts only (supplier cart comes later, after cart discovery). Read only: the issue and `worker/procurement/compare.js` exports (`compareMany` return shape).
- Changed files (all new):
  - `worker/procurement/po-draft.js`: dependency-free, supplier-agnostic ES module; no network, no `fetch`, no cart/order submission (static-checked). `buildDrafts(shortages, comparisons, { now = Date.now() })` routes each `{ name, qty }` shortage to the first eligible row of the matching `compareMany` result (same order); if that offer's `stockStatus` is `low`, `Math.ceil(qty / 2)` stays there and the rest goes to the next eligible offer from a *different* supplier (full qty stays when none exists). Items with no eligible offer go to `unmatched` with reason `no-match` (no offers), `all-out-of-stock` (every offer has reason `out_of_stock`), `all-stale` (every offer `stale`), else `needs-review`. Groups lines per supplier into `{ createdAt, drafts: [{ id: \`${supplierId}-${now}\`, supplierId, status: 'draft', lines: [{ name, supplierProductId, productName, qty, packPrice, lineTotal }], total }], unmatched }`; line/draft totals rounded to 2 dp (`lineTotal` null when no price). `approveDraft(draft, { approvedBy, now })` returns a copy with `status: 'approved'`, `approvedBy`, `approvedAt`; throws when `approvedBy` is missing/blank or status is not `draft` (so double-approval throws). `draftToText(draft, { lang = 'ar' })` returns WhatsApp-ready Arabic: supplier header, one line per item (`name × qty = lineTotal ج.م`), grand total in EGP; throws for non-`ar` lang.
  - `tests/unit/procurement-po-draft.check.mjs`: `node:assert/strict`, fixed `NOW`, synthetic `compareMany`-shaped rows; prints `procurement-po-draft checks passed`.
- Tests actually run (exact results):
  - `node tests/unit/procurement-po-draft.check.mjs` → prints `procurement-po-draft checks passed`, exit 0. Covers all acceptance criteria: 3 shortages across 2 fake suppliers → 2 drafts with correct lines/totals (a: panadol 2×10=20 + insulin 3×5=15, total 35; b: cefixime 1×20=20, ids `a-${NOW}`/`b-${NOW}`); `low` stock on best with qty 10 → 5 there + 5 on next supplier (plus full-qty fallback when no other supplier); no eligible offer → `unmatched` with each of the 4 reasons, never dropped; `approveDraft` throws on empty/blank/missing `approvedBy` and on approving twice, returns untouched-original copy otherwise; static check asserts the source contains no `fetch(` and no `checkout`; `draftToText` Arabic output with per-item lines and 35.00 EGP total.
  - `node tests/unit/procurement-compare.check.mjs` → `compareMany: 200 items x 10,000 offers in 307.6 ms`, `procurement-compare checks passed`, exit 0.
  - `node tests/unit/procurement-contract.check.mjs` → `procurement-contract checks passed`, exit 0.
  - `node tests/unit/procurement-discovery.check.mjs` → `procurement-discovery checks passed`, exit 0.
  - `node tests/unit/procurement-discovery-leaks.check.mjs` → `procurement-discovery-leaks checks passed`, exit 0.
  - `node tests/unit/procurement-normalize.check.mjs` → `134/134 names`, `procurement-normalize checks passed`, exit 0.
  - `node tests/unit/procurement-pharmaoverseas.check.mjs` → `procurement-pharmaoverseas checks passed`, exit 0.
- Remaining work: the approved add-to-cart on supplier sites (second half of the issue) is explicitly deferred until cart discovery; needs a later issue/run.
- Limitations: `createdAt` is the numeric `now` (so draft `id` embeds epoch ms, matching the spec's `${supplierId}-${createdAt}`). `unmatched` reason precedence is `no-match` → `all-out-of-stock` → `all-stale` → `needs-review` (mixed ineligible reasons default to `needs-review`). `draftToText` supports Arabic only. Tests use hand-built `compareMany`-shaped fixtures, not live connector data. Pre-existing `MODULE_TYPELESS_PACKAGE_JSON` warning (package.json out of scope). Changes uncommitted per instructions.

## Procurement 06 (2026-11-08): price comparison engine on comparable units — done

- Issue: "[Procurement 06] Price comparison engine on comparable units" (epic #53, depends on #57). Read only: the issue, `worker/procurement/normalize.js` exports, `worker/procurement/offer-schema.js` field names.
- Changed files (all new):
  - `worker/procurement/compare.js`: dependency-free, supplier-agnostic ES module (no supplier ids; static-checked). `compareForItem(item, offers, { requestedQty = 1, staleAfterMs = 6h, now = Date.now() })` keeps `matchOffersToItem` matches with score ≥ 0.8; per match computes `unitPriceComparable` (`comparableUnitPrice` = `netEffectivePrice ?? unitPrice` ÷ pack count) and `packPrice` (`netEffectivePrice ?? unitPrice`); flags `stale` (`now - Date.parse(lastUpdated) > staleAfterMs`; unparseable `lastUpdated` treated as not stale), `out_of_stock`, `MOQ` (`minimumOrderQuantity > requestedQty`); eligible = no reasons. Sort: eligible first, `unitPriceComparable` asc (null last), `discountPct` desc (null last), `supplierId` asc. Returns `{ item, best (offer or null), offers: [{ offer, score, unitPriceComparable, packPrice, eligible, reasons }], savingsVsNext, needsReview }`; `savingsVsNext` = (next − best comparable) × best pack count, rounded 2 dp, null when < 2 eligible or price/pack missing; `needsReview` when any kept match is flagged or best/next pack counts differ. `compareMany(items, offers, opts)` maps per item, same order. Adds a 50k-entry parse cache for matched offer names.
  - `tests/unit/procurement-compare.check.mjs`: `node:assert/strict`, fixed `NOW`, synthetic `offer()` helper; prints `procurement-compare checks passed`.
- Tests actually run (exact results):
  - `node tests/unit/procurement-compare.check.mjs` → prints `compareMany: 200 items x 10,000 offers in 313.6 ms` and `procurement-compare checks passed`, exit 0. Covers all acceptance criteria: PANADOL EXTRA 24 (2.000/tab, pack 48) vs 48 (1.875/tab, pack 90) → best is supplier `b` (per-tablet wins over pack price), `savingsVsNext` = 6, `needsReview` true on pack-size difference; cheapest `out_of_stock` → ineligible with reason `out_of_stock`, next in-stock is best, `savingsVsNext` null; MOQ 10 with `requestedQty` 3 → reason `MOQ`; `lastUpdated` 7 h old → reason `stale`; adding supplier `c` changes `best` to `c` with no code edits and the static check asserts the source contains no `pharmaoverseas`; `netEffectivePrice` precedence, `discountPct` desc tie-break, `compareMany` order preserved + unmatched item → `best` null; 10,000 offers × 200 items in 313.6 ms < 1 s (measured in-test).
  - `node tests/unit/procurement-contract.check.mjs` → `procurement-contract checks passed`, exit 0.
  - `node tests/unit/procurement-discovery.check.mjs` → `procurement-discovery checks passed`, exit 0.
  - `node tests/unit/procurement-discovery-leaks.check.mjs` → `procurement-discovery-leaks checks passed`, exit 0.
  - `node tests/unit/procurement-normalize.check.mjs` → `134/134 names`, `procurement-normalize checks passed`, exit 0.
  - `node tests/unit/procurement-pharmaoverseas.check.mjs` → `procurement-pharmaoverseas checks passed`, exit 0.
- Remaining work: none within this task. Wiring the engine into a supplier-compare flow / UI is a later issue.
- Limitations: `best` is the winning offer object (spec leaves its shape open). Unparseable `lastUpdated` is treated as not stale. `needsReview` pack-size check compares pack counts only (unit ignored). First perf attempt with digit-bearing fake brand names (`BRAND3`) collapsed all brands to `BRAND` (brand = text before first digit) and ran 5.3 s; test data now uses digit-free brand names (313.6 ms). Pre-existing `MODULE_TYPELESS_PACKAGE_JSON` warning (package.json out of scope). Changes uncommitted per instructions.

## Procurement 04 (2026-11-08): price normalization — pack size, comparable unit price, dedupe — done

- Issue: "[Procurement 04] Price normalization: pack size, comparable unit price, discount, dedupe" (epic #53). Read only: the issue, `worker/procurement/offer-schema.js`, `tests/fixtures/pharmaoverseas/names-sample.txt`.
- Changed files (all new):
  - `worker/procurement/normalize.js`: dependency-free ES module exporting `parseProductName(name)` → `{ brand, strength, form, pack, raw }`, `comparableUnitPrice(offer, parsed)` (`netEffectivePrice ?? unitPrice` ÷ `pack.count`, null without pack/price), `productKey(parsed)` → `BRAND|strength|form|packcount` lowercase (null when brand or strength missing), `matchOffersToItem(item, offers)` (exact key = 1; same brand+strength different pack = 0.8 `pack-differs`; same brand only or different strength = 0.5 with `needsReview: true`; below 0.5 excluded; never ≥ 0.8 across different strengths). Handles combos (`1GM/125MG` → `1000/125 mg`, `457MG/5ML` → `457 mg/5ml`, `16 MG. /12.5 MG.`), dash combos (`50-1000 MG`), `%`, bare `VIAL`/`1VIAL`/typo `vail` → pack 1 vial, modifier words between count and unit (`EFF. GR. IN SACHETS`, `RECTAL SUPP.`, `EX. REL .F.C TAB`), Arabic-Indic digits and Arabic units (`مجم/جم/مل`, `قرص/كبسولة/شراب/أمبول`). Pack search masks the strength span so `457MG/5ML SUSP. 70 ML` yields pack 70 ml, not 5 ml.
  - `tests/unit/procurement-normalize.check.mjs`: `node:assert/strict`; table-driven pass over all 134 fixture names (prints count + unparsed list), ~60 hand-written assertions, 5 Arabic cases. Prints `procurement-normalize checks passed`.
- Tests actually run (exact results):
  - `node tests/unit/procurement-normalize.check.mjs` → prints `parseProductName: strength-or-pack parsed for 134/134 names` and `procurement-normalize checks passed`, exit 0. Covers the issue's named cases (AUGMENTIN 625MG 10 F.C. TAB., AUGMENTIN 457MG/5ML SUSP. 70 ML, CONCOR 5MG 30 TABLETS, BRUFEN 600 MG 10 EFF. GR. IN SACHETS → pack 10 sachet, DECLOPHEN 25MG 5 INFANTILE SUPP. → pack 5 supp, MERAZODEL 40 MG VIAL. FOR I.V. INF. → pack 1 vial, PANADOL EXTRA 24 F.C. TAB. → strength null, pack 24 tab), Panadol per-tablet price equality (37.5/24 == 75/48), `netEffectivePrice` precedence, CONCOR 5MG vs 10MG never matched ≥ 0.8, unrelated brand excluded.
  - `node tests/unit/procurement-contract.check.mjs` → `procurement-contract checks passed`, exit 0.
  - `node tests/unit/procurement-discovery.check.mjs` → `procurement-discovery checks passed`, exit 0.
  - `node tests/unit/procurement-discovery-leaks.check.mjs` → `procurement-discovery-leaks checks passed`, exit 0.
  - `node tests/unit/procurement-pharmaoverseas.check.mjs` → `procurement-pharmaoverseas checks passed`, exit 0.
- Remaining work: none within this task. Wiring normalization into a supplier-compare flow / dedupe persistence: later issues.
- Limitations: acceptance criterion "`PANADOL EXTRA 24` vs `PANADOL EXTRA 48`: different keys" is unsatisfiable as written — those fixture lines have no strength, and the spec mandates `productKey = null` without strength; the test therefore asserts key difference + equal per-tablet price on the same-product pair `Panadol Extra 500mg Optizorb 24/48 tabs` and asserts the no-strength lines yield null keys per spec. Form enum for `EFF. GR. IN SACHETS` resolves to `sachet` (only pack is acceptance-checked). Pre-existing `MODULE_TYPELESS_PACKAGE_JSON` warning (package.json out of scope). Changes uncommitted per instructions.

## Procurement 03 (2026-11-08): PharmaOverseas connector (owner-account) — done

- Issue: "[Procurement 03] PharmaOverseas connector: website requests with the pharmacy's own account" (epic #53). Read only: `docs/procurement/discovery/pharmaoverseas.md`, `worker/procurement/connector-contract.js`, `offer-schema.js`, `connectors/fixture.js`, and the `products/search` + `products/{id}` entries of capture `pharmaoverseas-42450090854.json`.
- Changed files (all new):
  - `worker/procurement/connectors/pharmaoverseas.js`: `createPharmaOverseasConnector({ fetch, getAccessToken, baseUrl, sleep, now })`, defaults `baseUrl = https://api.pharmaemarket.com/occ/v2/pharma`, global fetch. `id: 'pharmaoverseas'`, `authorization: 'owner-account'`, `capabilities { search, getProduct, listCatalog: false, stock: 'level' }`, `rateLimit 20 req/min`. `search` → `GET /products/search?query&currentPage={page-1}&pageSize&fields=FULL&lang=en&curr=EGP` with `Authorization: Bearer <token>` + `Accept: application/json`, pageSize clamped 1–48, returns `{ offers: raw products, page, pageSize, totalPages }`. `getProduct` → `GET /products/{code}?fields=FULL&lang=en&curr=EGP`, 404 → null. Min-interval throttle via injected `sleep`/`now`. Errors: 401 `AuthRequiredError`, 403 `NotAuthorizedError`, 429 `RateLimitedError` (`Retry-After` s→ms, default 60000), 5xx/network `TransientError`, HTML body (CAPTCHA/login) `NotAuthorizedError('...unexpected HTML')`, missing `code`/`price` in `toOffer` → `SchemaDriftError` with `missing`. `toOffer` per "Price meaning": `unitPrice = netEffectivePrice = price.value`, `discountPct = round2((1 - unit/public)*100)` or null (also null when negative), stock map `inStock/outOfStock/lowStock` → `in_stock/out_of_stock/low`, else `unknown`; `barcode/packSize/availableQuantity/minimumOrderQuantity = null`; `raw` limited to `{ price, publicPrice, pharmacyDiscount, stock, purchasable }`; names sanitized (strips `<em class="search-results-highlight">`). No `console.*`, no credential strings, nothing logged.
  - `tests/fixtures/pharmaoverseas/search-panadol.json`: 3 synthetic products (one `outOfStock`, one without `publicPrice`, one `lowStock`; names with `<em>` tags; made-up codes).
  - `tests/fixtures/pharmaoverseas/product-28851.json`: code `000000000000028851`, price 33.75, publicPrice 51, `pharmacyDiscount { value 25, appliedValue 12.75, absolute false, code "x" }`, `stockLevelStatus inStock`.
  - `tests/unit/procurement-pharmaoverseas.check.mjs`: `node:assert/strict`, fake `fetch` (records URL + headers), fake `sleep`, fixed `now`; no network. Prints `procurement-pharmaoverseas checks passed`.
- Tests actually run (exact results):
  - `node tests/unit/procurement-pharmaoverseas.check.mjs` → prints `procurement-pharmaoverseas checks passed`, exit 0. Covers: `assertConnector` + registry; URL has `currentPage=0` for page 1 (`=1` for page 2), `fields=FULL`, `pageSize` clamp 48/1; `Authorization: Bearer fake-token`; detail fixture → `unitPrice 33.75`, `publicPrice 51`, `discountPct 33.82`, `stockStatus 'in_stock'`, `validateOffer` ok, name `Panadol Megraine 3 Tab` (no `<`); 404 → null; 401/403/429/500/503/network/HTML map to the specified error classes; 429 with `Retry-After: 7` → `retryAfterMs 7000` (default 60000 without header); missing `price`/`code` → `SchemaDriftError.missing` contains them; 25 sequential calls at 20 req/min → fake sleep total 72000 ms ≥ 15000; static check: module source contains no `console.` and no `password`.
  - `node tests/unit/procurement-contract.check.mjs` → prints `procurement-contract checks passed`, exit 0 (no regression).
- Remaining work: none within this task. Token acquisition (OAuth authorization code + PKCE) is explicitly out of scope — Claude builds it separately; connector takes `getAccessToken` as a dependency. Cart, catalog listing, other suppliers, CI wiring of the new check file: later issues.
- Limitations: pre-existing `MODULE_TYPELESS_PACKAGE_JSON` warning (no `"type": "module"` in package.json; out of scope). HTML detection is body-based (`<` first non-space char), not content-type-based. Untested against the real API (no network by policy). Changes uncommitted per instructions.

## Procurement 01 (2026-11-08): offline HAR sanitizer + discovery report skeleton — done

- Task (`/tmp/kimi-task.txt`, epic #53): value-stripping HAR sanitizer so the owner can safely share browser captures (#68 PharmaOverseas, #63 Aumet). No network, no dependencies, no workflow/package.json changes.
- Changed files (all new):
  - `tools/discovery/sanitize-har.mjs`: `node tools/discovery/sanitize-har.mjs input.har > out.json`. Keeps only xhr/fetch or JSON-MIME entries; groups by method + host + path template (all-digit ≥8 chars, UUID, or hex ≥16 segments → `{id}`); per endpoint emits sorted query/header/body field **names** (JSON and urlencoded bodies, nested `a.b.c`), status codes, a response field-name→type tree (arrays described by first element), allowlist-only `sampleValues` (numbers or strings ≤ 40 chars), and `count`. Never emits header/cookie/query/body values or any value under a key matching the secret regex (allowlisted `token_type`/`expires_in` excepted; secret-keyed subtrees are not descended into).
  - `tools/discovery/report-skeleton.mjs`: `node tools/discovery/report-skeleton.mjs out.json "Supplier"` prints Markdown with Summary, Endpoints (rows marked `Observed`), Login flow, Response field map, Pagination, Price fields, Stock fields, Cart, Open questions.
  - `tests/unit/procurement-discovery.check.mjs`: synthetic HAR (form + JSON password logins, `access_token`/`refresh_token` response, `Authorization: Bearer` + `Cookie` headers, `?token=` query, `email`/`phone` response fields, PNG + CSS entries) + CLI end-to-end + 5 MB performance check.
- Tests actually run:
  - `node tests/unit/procurement-discovery.check.mjs` — **PASS** (`procurement-discovery checks passed`): no secret value appears in `JSON.stringify(output)`; names `access_token`/`Authorization`/`username`/`password` do; `/occ/v2/pharma/products/000000000000028851` → `{id}`; PNG/CSS dropped (endpointCount 2); `expires_in: 3600` kept; ≥5 MB synthetic HAR sanitized in < 2 s (measured in-test); both CLIs exit 0 and match the library output.
  - `node tests/unit/procurement-contract.check.mjs` — **not present** in repo (task: "if present"); skipped.
  - `npm run check` — PASS (pre-existing sticker/gemini checks, unrelated regression sweep).
- Limitations: sanitizer assumes standard HAR (`log.entries`); non-JSON response bodies contribute no field tree; arrays described by their first element only (heterogeneous arrays under-described); sample values keep first observation per key. Not tested against a real supplier capture (none shared yet).
- Remaining work: feed a real owner-supplied capture through the pipeline when #68/#63 arrive; `worker/procurement/` contract code does not exist yet, so the contract check referenced by the task is still to be created under its own issue.
- Changes uncommitted; per instructions, no self-commit.
## Procurement Task 02 (2026-11-08): connector contract, offer schema, registry + fixture connector

- Issue: "[Procurement 02] Supplier connector contract, offer schema, registry + fixture connector" (epic #53), per `docs/procurement/ARCHITECTURE.md` sections 3–4 only.
- Files created (all dependency-free ES modules, Workers + Node 22 compatible):
  - `worker/procurement/offer-schema.js`: frozen `OFFER_FIELDS` (17 fields), `validateOffer(offer)` (required fields, enums for stockStatus/dataSource/syncStatus, `currency === 'EGP'`, finite >= 0 numbers or null, `discountPct` 0–100 or null, digits-only 8–14 barcode or null, no `<`/`>` in productName, recursive credential-key scan of `raw` via `/authorization|cookie|token|password|session/i`), `sanitizeName` (strips tags, collapses whitespace).
  - `worker/procurement/connector-contract.js`: `ConnectorError` + `AuthRequiredError`, `RateLimitedError` (`retryAfterMs`), `SchemaDriftError` (`missing`/`unexpected`), `TransientError`, `NotAuthorizedError`; `AUTHORIZATION_KINDS`; `assertConnector` (TypeError with clear messages); registry `registerConnector` / `getConnector` / `listConnectors` / `clearRegistry`, duplicate id throws.
  - `worker/procurement/connectors/fixture.js`: one synthetic supplier, 8 raw records incl. HTML-in-name, unknown discount, out-of-stock, no-barcode cases; case-insensitive paginated `search` (page/pageSize/totalPages), `getProduct`, pure `toOffer` with `netEffectivePrice = round2(unitPrice * (1 - discountPct/100))` only when both known, else null (unknown discount stays null, never 0).
  - `tests/unit/procurement-contract.check.mjs`: `node:assert/strict`, prints `procurement-contract checks passed`.
- Tests actually run (exact output):
  - `node tests/unit/procurement-contract.check.mjs` → `procurement-contract checks passed`, exit=0. Covers: register succeeds / duplicate throws / missing `toOffer` TypeError / `authorization: 'scraping'` throws; all 8 fixture offers pass `validateOffer`; HTML name sanitized; unknown discount → `discountPct === null` and `netEffectivePrice === null`; rejects USD currency, discountPct 120, barcode `'12ab'`, `raw.headers.Authorization`; page 3 of 2 pages → empty `offers`, `totalPages === 2`; case-insensitive search; `RateLimitedError('x', 5000).retryAfterMs === 5000` and `instanceof ConnectorError`.
  - `node tests/unit/supplier-price.check.mjs` → `supplier-price-service checks passed`, exit=0 (no regression).
- Remaining work: none within this task. Later tasks per spec: 03 real supplier adapter (after authorization recorded), 04 normalization, 05 collector, 06 compare, 07 PO drafts, 08 UI.
- Limitations: Node prints a `MODULE_TYPELESS_PACKAGE_JSON` warning because `package.json` has no `"type": "module"`; adding it was out of scope (pre-existing warning also fires for `worker/supplier-price-service.js`). No network, no real supplier data; fixtures are synthetic. `sanitizeName` strips tags but does not decode HTML entities (spec asks only for tags + whitespace). Not committed per instructions.

## UX batch 3 (2026-11-07): tablet/desktop polish — toasts, Arabic totals, touch targets, text floor, walk-in shortcut

- Found by a UX evaluation of `main` (screenshots + measurements, emulator, demo data): three "Added: …" toasts piled up over the totals bar and CHECKOUT; the totals area stayed English in Arabic mode (CHECKOUT, NET TOTAL, SAR, items); 37 controls under 40px (tabs 37, invoice buttons 34, quantity 36); 27 texts at 10-11px; an extra customer step on every sale.
- `index.html` only: one toast at a time (replaces the previous one), top-left under the search bar, 2.2s (errors 4.5s), `role=status/alert`, `dir=auto`; all toast messages translated; `CHECKOUT`/`NET TOTAL`/`F9 / Pay`/`items)` and `SAR` → `ر.س` in Arabic mode; `@media (pointer:coarse)`: 44px tabs, invoice buttons, quantity controls, quick-cash, payment buttons, discount and cash fields; 12px floor for functional text; Enter on an empty customer number skips the customer step (walk-in) with a hint.
- Tests: new `tests/ux-batch3.mjs` passes and FAILS 10 checks on the previous code; `tests/issue-2-acceptance.mjs` now reads `ر.س` as `SAR` (Arabic mode shows ر.س). Regression PASS: `ux-batch1`, `ux-batch2`, `npm run check`, `issue-2-acceptance` 21/21, `issue-4-labels-panel`, `sale-sticker-modal`, Playwright smoke. All three UX test files also PASS on the HTML embedded in the live Worker build.
- Not tested: real tablet/touch hardware, real users, the live Worker. Phone layout is NOT part of this batch (quantity/total columns are off-screen on phones; the owner said tablet/desktop is the main use).
- Deploy build: `worker/live/nova-rx-preview.with-ux-batch1-3.js` (on top of the code deployed at 2026-11-07T08:55Z).

## UX batch 2 (2026-11-07): UX-SEARCH-EMPTY, UX-DISCOUNT-NO-FEEDBACK, UX-PRODUCTS-FILTER-EMPTY, UX-AI-NO-RETRY — fixed on branch

- Verified on the batch-1 code before changing anything (Playwright, Arabic and English): the search empty states existed but stayed English in Arabic mode; discounts of 150%, -5 and a fixed discount larger than the invoice changed the total silently; a products filter with no match showed an empty table; a failed purchase-invoice reading had no retry.
- `index.html` only: `#discountHint` (aria-live) + `aria-invalid` red field with three messages (AR/EN); `.nova-empty` «لا توجد نتائج مطابقة» under any empty table (products, customers, invoices); the purchase-invoice button becomes «إعادة المحاولة» after a failure and calls `/api/ai/purchase` again; AR translations for the search empty states.
- Tests: new `tests/ux-batch2.mjs` — PASS; it FAILS 20 checks on the batch-1 code. Regression PASS: `ux-batch1`, `npm run check`, `issue-2-acceptance` 21/21, `issue-4-labels-panel`, `sale-sticker-modal`, Playwright smoke. Both new test files also PASS on the HTML embedded in the live Worker build (`UX_SKIP_EXTRA='#nlSimple'` for batch 1).
- Not tested: real phones, live Worker (not deployed). The purchase retry was tested with a mocked 500, not the real AI.
- Remaining: batch 3 (P3 + the Impeccable findings) in `docs/UX_BACKLOG.md`.

## UX batch 1 (2026-11-07): UX-MIXED-LANG, UX-LANG-SWITCH-WEAK, UX-FAB-OVERLAP-mobile, UX-FAB-MISLABEL — fixed on branch

- Verified on `main` @ `4e50e19` before changing code (Playwright audit): English mode left ~107 Arabic/mixed UI strings; the settings language buttons did nothing; on 390×844 and 360×640 the sticker button covered `#btnCheckout`; the button text «✦ AI الاستيكرات» did not match its aria-label.
- Causes and fixes (`index.html` only):
  - `arToEn` mixes both directions, so English mode translated English words into Arabic («Start فاتورة جديدة»). Added directional `toEn`, extra EN/AR strings, and an exact-match table `mixedText` for bilingual labels («Cash / نقدي» → `Cash` / `نقدي`). `ر.س` → `SAR` in English. Attributes (`title`, `aria-label`, `placeholder`) are now translated on every element.
  - The settings page renders `.nova-lang-btn` after load, so the per-button listeners never bound. Replaced with one delegated click listener.
  - Sticker button: on ≤780px it sits above the checkout bar and is smaller; visible text is now «✦ استيكرات الأدوية» (EN «✦ Medicine labels»), contained in its aria-label.
- Added during verification: UX-HELD-PANEL-OFFSCREEN. The held-invoices panel was `top:calc(100% + 4px)` of the whole workspace, so it opened below the screen on every viewport (e.g. top=848 on 844px). Now `top:auto` (right under the header). 10 more checks in `tests/ux-batch1.mjs`; they fail on the old CSS (9 fails).
- Tests: new `tests/ux-batch1.mjs` — 39 checks, PASS; it FAILS 24 checks on the previous `index.html`. Regression: `npm run check`, `issue-2-acceptance` 21/21, `issue-4-labels-panel`, `sale-sticker-modal` (desktop/tablet/mobile), Playwright smoke — all PASS.
- Not tested: real phones, tablet hardware, the live Worker (not deployed). Demo customer names keep their bilingual form on purpose (data).
- Remaining: batch 2 (P2) and batch 3 (P3) in `docs/UX_BACKLOG.md`.

## Sale sticker modal premium upgrade (2026-11-06): STICKER-MODAL-PREMIUM — done

- Task (`/tmp/kimi-task.txt`): make the sale-screen sticker modal «استيكرات
  الأدوية» inside `/#sale` match the premium `sticker-studio.html` layout.
  No third page; standalone studio untouched; `NOVA_STICKER_MODAL_PREMIUM_V95`
  not revived.
- Changed files:
  - `index.html`: replaced the old `#novaLabelsPanel` markup/styles/script
    (lines ~3647–EOF) with the studio layout scoped to the modal — stepper,
    compact patient card (age سنة/شهر segment with month→year hint, weight,
    explicit حامل؟/رضاعة؟ radios), med tabs with ONE visible medicine editor,
    large hero preview + selectable thumbnail grid + pager, print settings in a
    collapsed `<details>`, fixed action bar with pharmacist-approval gate and
    طباعة المحدد/الكل. Invoice queue (`nova.label.invoices.v1`) and the
    `nova:invoice-completed` auto-open flow preserved; panel still closes on
    `startNewSale()` (Issue #4 batch-1 fix kept). AI regenerate still calls
    `/api/ai/medication-label`; AI errors/warnings shown as compact chips.
  - `tests/sale-sticker-modal.mjs` (new): Playwright/Chromium desktop run.
  - `reports/sale-sticker-modal.png`: desktop screenshot evidence.
- Acceptance criteria: 1 opens from sale invoice flow (dispatched
  `nova:invoice-completed` opens modal + queues invoice) PASS; 2 compact
  patient block with years/months + pregnancy/breastfeeding PASS; 3 tabs with
  exactly one visible editor, large preview, click-to-select prints PASS;
  4 compact AI status/warning chips, settings collapsed by default PASS;
  5 geometry asserts: sheet fits 1280×860, stage inside sheet above action
  bar, no horizontal clipping PASS; 6 browser verification below.
- Tests actually run:
  - `node tests/sale-sticker-modal.mjs` — **21/21 PASS** (modal opens from
    invoice flow, queue, age-months hint, safety gate, approval gate, single
    active editor + tab switch, hero preview, selection toggle, settings
    collapsed/expand, incomplete-med print block, approved print passes to
    popup, viewport/RTL/Escape/zero-pageerror checks).
  - `npm run check` — PASS (sticker-studio + sticker-six static checks, no
    regression; standalone studio untouched).
  - Print-then-pay and pharmacist approval preserved: print is blocked until
    safety answers + approval + complete meds (verified in test).
- Not tested: tablet, mobile hand-held, real printer hardware, live AI Worker
  responses (fetch path exercised only against the dev server, where the
  endpoint is absent — error chip path), live Worker deploy.
- Note: `npm install` was run to get `@playwright/test`; `node_modules/` is a
  local side effect, not part of the change.
- Remaining IDs: none from this task. Issue #4 queue unchanged (P1:
  UX-MIXED-LANG, UX-LANG-SWITCH-WEAK, UX-FAB-OVERLAP-mobile; P2/P3 as listed
  in KIMI_CONTEXT.md).

## Issue #4 (batch 1, 2026-11-05): UX-LABELS-PANEL-BLOCKS-NEXT-SALE — fixed

- Cause: every completed payment dispatches `nova:invoice-completed`, which
  auto-opens `#novaLabelsPanel` (full-viewport overlay, z-index 9100). Receipt
  close / receipt "New Sale" / F2 all call `startNewSale()`, which never closed
  the panel — so after checkout the labels overlay stayed on top of the POS and
  blocked the next sale.
- Fix (`index.html`, `startNewSale()`): remove the `open` class from
  `#novaLabelsPanel` when a new sale starts. The panel still auto-opens behind
  the receipt after payment (feature preserved), and the invoice queue inside it
  is untouched; it can be reopened via the labels buttons.
- Changed files: `index.html`, new `tests/issue-4-labels-panel.mjs`.
- Tests actually run:
  - `node tests/issue-4-labels-panel.mjs` — **10/10 PASS** (L1–L10: add product,
    gate skip, checkout, receipt opens, panel auto-opens behind receipt, receipt
    × closes, panel closed on new sale, search input visible + topmost via
    `elementFromPoint`, next-sale product add succeeds, zero pageerrors).
  - `node tests/issue-2-acceptance.mjs` — **21/21 PASS** (no regression to the
    five accepted issue #2 fixes).
- Remaining issue #4 IDs: UX-MIXED-LANG, UX-LANG-SWITCH-WEAK,
  UX-FAB-OVERLAP-mobile, UX-CHECKOUT-OVERLAY-LEAK (unverified), UX-SEARCH-EMPTY,
  UX-DISCOUNT-NO-FEEDBACK, UX-AI-NO-RETRY, UX-FAB-MISLABEL,
  UX-PRODUCTS-FILTER-EMPTY, UX-NEW-SALE-MODE, UX-EMPTY-CHECKOUT-NO-HINT,
  UX-TOAST-EN, UX-TOAST-COVERS-CHECKOUT, UX-DISCOUNT-ZERO-FIELD-CLEARED.
- Changes uncommitted; per instructions, no self-commit.

---

## Issue #2: Invoice persistence & blocking POS UX defects (completed earlier)

All changes are confined to `index.html` plus one new test file. No workflow
files touched, no dependencies added, Black Edition styling and Arabic RTL UX
preserved. Changes are uncommitted on branch `kimi/issue-2-42022855182`, ready
for review/PR.

## Root causes and fixes

1. **P0 — Discount persistence / silent total change**
   - Cause: discount inputs called `recalculateFinancials()` only; `state.percentDiscount`
     / `state.fixedDiscount` were never synced on input, and restored draft values were
     never written back into the inputs. After reload, lines came back but discounts were
     silently dropped, so the grand total changed (reproduced: 63.85 → 76.50 SAR).
   - Fix (`index.html`):
     - Input listeners now sync state, persist the draft, then recalculate.
     - On load, exact draft values are written back into both inputs before the first
       `renderInvoice()`, so totals are re-derived identically (calculation clamps are
       unchanged: percent 0–100, fixed ≥ 0, total floored at 0.00 — no negative totals).
     - Restore no longer clamps stored values with `Math.max(0, …)`, so inputs round-trip
       exactly.

2. **P1 — Customer persistence across reload**
   - Cause: the active-invoice draft stored lines/discounts only; `attachCustomer` /
     `detachCustomer` never persisted, and the draft was deleted whenever lines were empty.
   - Fix: draft now includes `customerId`; attach/detach persist; the draft is kept while a
     customer is attached even with zero lines; on load the customer is looked up in
     `DEMO_CUSTOMERS` and re-attached before the first render. Invoice items are untouched.

3. **P1 — Search mode badge not clickable in RTL**
   - Cause: `.search-mode-tag` had `pointer-events: none`, so clicks fell through to the
     input underneath.
   - Fix: `pointer-events: auto` + `cursor: pointer` on `.search-mode-tag`. Existing click
     handler and RTL positioning (`right: 10px`, input padding reserves the space) are
     unchanged.

4. **P1 — Receipt × close intercepted by overlay**
   - Cause: every completed payment dispatches `nova:invoice-completed`, which auto-opens
     `#novaLabelsPanel` — a full-viewport overlay at `z-index: 9100` — on top of the receipt
     modal (`z-index: 100`), covering the × button.
   - Fix: `#receiptModal.modal-backdrop { z-index: 9200; }`. The receipt (and its ×) now
     sit above the labels/AI overlays; the labels panel still opens behind the receipt and
     keeps its own close controls. No feature removed.

5. **P1 — `novaOriginalaria-label` DOMStringMap pageerror**
   - Cause: the i18n pass built the key as `'novaOriginal' + attr` → `novaOriginalaria-label`;
     a DOMStringMap key containing `-` followed by a lowercase letter is invalid and throws
     `SyntaxError` on every `apply()` run.
   - Fix: camelize the suffix → `novaOriginalariaLabel`.

## Tests

`tests/issue-2-acceptance.mjs` — self-contained acceptance suite (no npm deps; drives
headless Chromium via CDP using Node ≥ 22's built-in WebSocket; serves the repo over a
local HTTP server). Run:

```
node tests/issue-2-acceptance.mjs
```

21 checks covering the issue's acceptance list:
- A1–A7: add Augmentin + Panadol, attach demo customer (Tariq), enter 10% + 5 SAR discounts,
  reload → same customer, exact discount inputs, same lines, identical subtotal/grand total.
- B1–B3: excessive fixed discount floors total at 0.00 SAR and restores exactly after reload;
  zero discounts → total equals subtotal, discount row hidden.
- C1–C2: badge is topmost at its center (`elementFromPoint`) and a real mouse click toggles
  Customer/Product mode.
- D1–D4: checkout → receipt opens; × is topmost at its center (no overlay intercept);
  clicking × closes the dialog.
- E1–E2: 1366×768 and 1194×834 — no horizontal overflow, badge still clickable.
- F1: zero pageerrors across the entire run.

Results:
- Fixed code: **21/21 PASS**.
- Pre-fix code (verification run): 9/21 — reproduces each defect, including the exact
  DOMStringMap SyntaxError and the silent total change.

## Limitations / notes

- Persistence is browser-local (`localStorage`) by design of the prototype; there is no
  backend sync. Private-mode/storage-disabled browsers degrade gracefully (checkout stays
  usable, draft just isn't saved).
- After the receipt is closed, the labels panel (auto-opened for the completed invoice)
  remains visible behind it — pre-existing feature behavior, intentionally preserved.
- The receipt × still triggers `startNewSale()` (existing behavior); only its
  clickability/stacking was fixed.
- Screenshots: not captured; the test provides reproducible evidence (run command above).
