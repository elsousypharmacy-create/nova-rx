# NOVA Rx — Supplier Integration & Procurement Intelligence: Architecture

Status: **approved scope for Phase P1 (foundation)**. Nothing here is deployed. Owner: Claude (technical director). Implementation: Kimi via GitHub issues. Discovery: Grok.

## 1. Pipeline

```
Supplier website / authorized API / supplier export file
  -> Supplier connector (one adapter per supplier, worker/procurement/connectors/<id>.js)
  -> Price collector (scheduled, plain code, zero AI tokens)
  -> Normalization (pack/unit, discount, net price, dedupe)
  -> Supplier price store (append-only snapshots + latest view)
  -> Comparison engine (per comparable unit, never per raw pack)
  -> Purchase order drafts (per supplier, human approval required)
  -> NOVA Rx ERP / Procurement UI
```

Rules that every task must keep:
- Runtime collection never calls an LLM. AI is used only for discovery, analysis and repair.
- Suppliers have no official APIs. Connectors reproduce the supplier website's own requests using the pharmacy's own account (`owner-account`, decided by the owner 2026-11-08). Every connector is listed in `SUPPLIER_ASSESSMENT.md` with a per-supplier kill switch.
- No credentials, cookies, tokens or session values in code, fixtures, reports, logs or GitHub. Secrets live in Worker secrets only.
- No CAPTCHA or block bypass: on CAPTCHA/403/unexpected login page the connector stops (`AuthRequiredError`/`NotAuthorizedError`) and alerts. Login uses the owner's credentials from Worker secrets, never a copied browser cookie.
- Supplier cart is filled only after the owner approves a draft in NOVA Rx; final checkout stays a human action.
- The existing prototype `worker/supplier-price-service.js` + `supplier-compare.html` keeps working until the new engine replaces it in a reviewed PR.

## 2. Module layout (target)

| Path | Responsibility | Task |
|---|---|---|
| `tools/discovery/` | HAR / network-log sanitizer and discovery report generator (offline, no network) | 01 |
| `worker/procurement/connector-contract.js` | Connector interface, capability flags, error classes, registry | 02 |
| `worker/procurement/offer-schema.js` | Unified offer record + validator | 02 |
| `worker/procurement/connectors/fixture.js` | Reference connector on synthetic data (used by all tests) | 02 |
| `worker/procurement/connectors/pharmaoverseas.js` | First real supplier adapter (website requests, owner account) | 03 |
| `worker/procurement/normalize.js` | Pack/unit parsing, comparable unit price, discount/net, dedupe | 04 |
| `worker/procurement/collector.js` | Scheduler-agnostic collector: rate limit, retry+backoff, change detection, schema-drift, sync log | 05 |
| `worker/procurement/compare.js` | Comparison engine | 06 |
| `worker/procurement/po-draft.js` | Purchase order drafts | 07 |
| `procurement.html` (or a NOVA screen) | Arabic RTL mobile-first UI | 08 |
| `tests/unit/procurement-*.check.mjs` | Dependency-free Node checks, run by `.github/workflows/procurement-unit.yml` | all |

All modules are ES modules, dependency-free, runnable in Cloudflare Workers and in Node 22 for tests.

## 3. Connector contract (Task 02 implements exactly this)

```js
// A connector is a plain object. No class inheritance required.
{
  id: 'fixture',                 // stable supplier id, [a-z0-9-]
  displayName: 'Fixture Supplier',
  authorization: 'owner-account' | 'official-api' | 'written-permission' | 'export-file' | 'fixture',
  capabilities: { search: true, getProduct: true, listCatalog: false, stock: 'level' | 'quantity' | 'none' },
  rateLimit: { requestsPerMinute: 30 },
  async search(query, { page, pageSize, signal }) -> { offers: RawOffer[], page, pageSize, totalPages|null },
  async getProduct(supplierProductId, { signal }) -> RawOffer | null,
  async login(credentials, { signal }) -> session   // owner-account only; session kept in memory/KV, never logged
  async addToCart(lines, { session, approvedDraftId }) -> result   // optional; refuses without approvedDraftId
  toOffer(raw, { fetchedAt }) -> Offer   // pure mapping into the unified schema, no I/O
}
```

Error classes (exported): `AuthRequiredError` (stop, never auto-refresh), `RateLimitedError` (retryAfterMs), `SchemaDriftError` (unexpected/missing fields), `TransientError` (retryable), `NotAuthorizedError` (connector disabled by policy).

Registry: `registerConnector(c)`, `getConnector(id)`, `listConnectors()`. Registration validates the shape and refuses `authorization` values outside the list above. Adding a supplier must not require editing the comparison engine.

## 4. Unified offer schema

| Field | Type | Rule |
|---|---|---|
| `supplierId` | string | connector id |
| `supplierProductId` | string | supplier's own code, required |
| `barcode` | string\|null | GTIN/EAN digits only, null if unknown |
| `productName` | string | sanitized plain text (strip HTML) |
| `packSize` | `{ count, unit, raw }`\|null | e.g. `{count:30, unit:'tab', raw:'30 Tab'}`; null if not parseable |
| `currency` | `'EGP'` | from source; reject others until multi-currency is approved |
| `unitPrice` | number\|null | supplier list/pharmacy price per pack, as shown |
| `publicPrice` | number\|null | consumer price per pack if the source shows it |
| `discountPct` | number\|null | 0–100, null if unknown (never default to 0 silently) |
| `netEffectivePrice` | number\|null | **null unless the price semantics are verified** for that supplier |
| `availableQuantity` | number\|null | numeric only; never derived from `purchasable` or an order stepper |
| `stockStatus` | `'in_stock'\|'out_of_stock'\|'low'\|'unknown'` | |
| `minimumOrderQuantity` | number\|null | |
| `lastUpdated` | ISO string | time the supplier data was read |
| `dataSource` | `'api'\|'export'\|'manual'\|'fixture'` | provenance |
| `syncStatus` | `'fresh'\|'stale'\|'error'` | stale after the configured window |
| `raw` | object | original money/stock fields kept for audit (never credentials) |

Comparison is only allowed on a **comparable unit price** (price per tablet/ml/g etc.) computed in Task 04. Offers whose pack cannot be parsed are shown but excluded from "best supplier".

## 5. Delivery order

Phase P1 (now): 01 discovery framework, 02 connector contract, PharmaOverseas login + cart discovery (owner/Grok browser capture), Aumet discovery.
Phase P2: 03 PharmaOverseas connector (read: search/product/price/stock), 04 normalization, 06 comparison.
Phase P3: 05 collector + schedule, 07 PO drafts + approved add-to-cart, 08 UI, 09 QA. Then Aumet connector.
