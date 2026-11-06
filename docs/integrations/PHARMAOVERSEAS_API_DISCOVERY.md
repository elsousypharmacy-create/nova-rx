# PharmaOverseas API discovery for NOVA Rx

**Report status: PARTIAL.** This document is not production integration readiness and is not an official supplier contract.

| Control | Statement |
| --- | --- |
| Observation date | 6 November 2026 (Asia/Riyadh) |
| Evidence | Historical observations supplied for this report. No new live testing was performed to write it. |
| Session context | A prior authorized browser session was already signed in. Observations are from normal read-only search, product detail, and paging in the storefront UI, plus DevTools. |
| This change | Documentation only. It does not authorize calls, logins, purchases, cart operations, credential reuse, or supplier contact. |
| Counts | Confirmed endpoint paths: 3. Complete verified method and path: 2. Authentication, pricing semantics, and external permission remain open. |

Storefront observed: `https://shop.pharmaemarket.com`.

Login page observed: `https://shop.pharmaemarket.com/pharma/en/EGP/login`.

The login page is a storefront URL. It was not observed as the API authentication endpoint.

JSON base described in the historical notes as a SAP Commerce-style REST base: `https://api.pharmaemarket.com/occ/v2/pharma`.

That platform description is the wording of the historical notes. This report does not independently confirm the vendor platform, and it does not import general OCC defaults as this supplier's contract.

## How statements are labeled

| Label | Meaning in this document |
| --- | --- |
| Observed | Retained from the supplied historical notes. |
| Inferred | A proposal or reading that goes beyond a retained fact. Marked where used. |
| Unknown | Not retained, not tested, or not reconcilable. |
| Company approval | Blocked until the supplier grants permission or issues a documented access contract. |

Any field list below is an observational partial shape. It records names or fragments that were seen. It does not state which fields are required, which types are official, or which values are stable.

## 1. Executive Summary

Discovery is **PARTIAL**. Two GET paths and one product-detail path template were retained. The detail method and status were not retained. An `Authorization` header name was seen; its value and scheme were not. Price and discount figures for one Panadol observation do not reconcile with a search-card figure, and the notes do not define discount semantics. No official API document was found on the pages that were inspected, which does not prove that no official API exists. Permission to integrate from outside the supplier's own storefront is unknown.

NOVA Rx must not treat this note as an implementation specification. A connector is conditional on supplier-approved, documented access. The current authorization for this repository change is documentation only.

What this report does not claim:

- It is not an authoritative request or response contract.
- It does not define required fields, error bodies, or rate limits. Those were not observed.
- It does not assert a final net purchase price.
- It does not authorize extracting or replaying a browser session.
- It does not record a bulk medicine API, a GraphQL API, or a websocket price feed. Those were not seen in the limited observations, and the observations were not an exhaustive audit.

## 2. Confirmed Endpoints

Base (observed): `https://api.pharmaemarket.com/occ/v2/pharma`.

| # | Method | Path template | Verification | Status retained |
| --- | --- | --- | --- | --- |
| 1 | GET | `/products/search` | Method and path observed | HTTP 200 on search responses |
| 2 | GET | `/products/suggestions` | Method and path observed | Not retained |
| 3 | Unverified | `/products/{productCode}` | Path template observed for product detail. The HTTP method was not retained and is not assumed to be GET | Not retained |

Confirmed endpoint paths: 3. Complete verified method and path: 2.

### 2.1 `GET /products/search`

Observed query-parameter names: `fields`, `query`, `pageSize`, `lang`, `curr`, `currentPage`.

Retained examples: `query` values `Panadol` and `Nexium`; `pageSize` values 12 and 48; `lang=en`; `curr=EGP`.

The `fields` parameter name was observed. Its value was not retained. This report does not invent one.

No request body was observed on these GETs.

Search responses were HTTP 200. No search response body is reproduced below, because a full body was not retained. Section 3 lists retained field names only.

### 2.2 `GET /products/suggestions`

Observed query-parameter names: `term`, `max`, `lang`, `curr`.

Retained values: `term=Nexium`, `max=5`.

`lang` and `curr` were observed as parameter names on suggestions. The notes retain `lang=en` and `curr=EGP` for search. They do not separately retain the suggestions values for those two parameters. Those suggestions values are unknown.

No request body was observed.

One observed response excerpt was `{"suggestions":[]}`. HTTP status for that response was not retained. Suggestions is not a bulk medicine search. An empty `suggestions` array in that one response does not establish the usual contents of the array.

### 2.3 `/products/{productCode}`

Observed product code: `000000000000028851`.

Observed query-parameter names: `fields`, `lang`, `curr`.

The values of those parameters on the detail request were not retained. The HTTP method was not retained. The HTTP status was not retained. Both stay unverified.

### 2.4 Paths that were not confirmed

| Topic | Label | Statement |
| --- | --- | --- |
| Bulk multi-medicine endpoint | Unknown | No such endpoint was confirmed. |
| Suggestions as bulk search | Observed negative | The suggestions call is not bulk search. |
| GraphQL or websocket pricing | Not seen | None was observed. The session was not an exhaustive protocol audit. |
| Order or cart API | Out of scope | Order Now was not clicked. No order capability is described or proposed. |
| Maximum `pageSize` | Unknown | 12 and 48 were observed. A 100-item page was not tested. |

Paging observations (historical, 6 November 2026, Asia/Riyadh):

| Query context | What was retained |
| --- | --- |
| Panadol | `currentPage` 0, `pageSize` 12, 1 page, 12 results |
| Augmentin | 4 pages. Page size for that count was not retained |
| Glucophage | 3 pages. Page 1 loaded different items from the page that preceded it. Page size was not retained |
| Nexium | 2 pages at the default size used for that search. A separate request with `pageSize` 48 returned 23 results on one page |

Observed pagination field names on search: `currentPage`, `pageSize`, `sort`, `totalPages`, `totalResults`. The `sort` value was not retained.

These counts do not support a promise that 100 distinct medicines can be collected in three requests. Maximum page size is unknown, and no bulk endpoint was confirmed.

## 3. Sanitized Request/Response Examples

The blocks in this section are excerpts of retained fragments. They are not captured exports, not full responses, and not an official schema. No customer data, account identifier, session token, cookie, or header value is included. Query values that were not retained are omitted rather than filled in.

### 3.1 Search request excerpt (observed parameter names and retained examples)

```text
GET /occ/v2/pharma/products/search
Host: api.pharmaemarket.com

Parameter names observed: fields, query, pageSize, lang, curr, currentPage
Retained examples: query=Panadol | query=Nexium | pageSize=12 | pageSize=48 | lang=en | curr=EGP
Request body: none observed
Response status observed for search: 200
```

`fields` is listed because the name was seen. The value is omitted because it was not retained. This reconstruction is not a cURL export and is not a replay instruction.

### 3.2 Search response shape excerpt (field names only)

A full search body was not retained. The names below are the observed root and nested names, not a sample payload and not a list of required fields.

Observed root names: `type`, `breadcrumbs`, `currentQuery`, `facets`, `freeTextSearch`, `pagination`, `products`.

Observed under `currentQuery`: `currentQuery.query.value`, `currentQuery.url`.

Observed facet names: `category`, `multiSelect`, `name`, `priority`, `values`, `visible`.

Observed facet-value names: `count`, `name`, `query`, `selected`.

Observed product names on search hits: `code`, `configurable`, `configuratorType`, `images`, `multidimensional`, `name`, `price`, `priceRange`, `stock`.

Observed money names on price: `currencyIso`, `formattedValue`, `priceType`, `value`.

Observed stock names: `isValueRounded`, `stockLevelStatus`.

No search-hit scalar values were retained in a form that can be reprinted as a JSON object. UI prices are listed separately in section 5 and are labeled as storefront display figures.

### 3.3 Suggestions response excerpt (one observed fragment)

Request side, retained only:

```text
GET /occ/v2/pharma/products/suggestions
Host: api.pharmaemarket.com

Parameter names observed: term, max, lang, curr
Retained values: term=Nexium | max=5
lang and curr values on this call: not retained
Request body: none observed
Response status: not retained
```

Response excerpt actually observed (not a statement that the array is always empty):

```json
{"suggestions":[]}
```

### 3.4 Product detail excerpt (partial Panadol observation)

```text
Path template: /occ/v2/pharma/products/{productCode}
Product code observed: 000000000000028851
Parameter names observed: fields, lang, curr
Parameter values: not retained
HTTP method: not retained (unverified; not recorded as GET)
HTTP status: not retained
```

Scalar fragments retained from the partial Panadol detail:

| Field | Retained fragment | Label |
| --- | --- | --- |
| `purchasable` | `true` | Observed. This is not a quantity. |
| `stock.stockLevelStatus` | `inStock` | Observed on this detail only. |
| `pharmacyDiscount.value` | `25.0` | Observed number. Meaning unknown. |
| `pharmacyDiscount.appliedValue` | `12.75` | Observed number. Meaning unknown. |
| Public price | `51` EGP | Observed figure. The notes do not split it into `value` versus `formattedValue`. |

The notes do not retain `pharmacyDiscount.absolute`, `pharmacyDiscount.code`, numeric stock quantity, or warehouse identity for this detail.

### 3.5 Unreconciled Panadol figures

The same historical notes also record a search-card display of `Panadol Megraine30Tab` at 33.75 EGP.

The naïve subtraction stated in the notes is `51 - 12.75 = 38.25`. That result is not 33.75. The mismatch and its context are **unknown**. This report does not assert that the card and the detail are the same pack or the same product code, does not assert what `pharmacyDiscount.value` means, and does not assert a final net purchase price.

### 3.6 Error and limit examples

No error body was retained. No HTTP 429 body was retained. This section intentionally contains neither. Cancelled searches while a query was still being typed are not recorded as rate-limit errors. Another supplier's error contract is not imported here.

## 4. Authentication Mechanism

| Item | Label | What was retained |
| --- | --- | --- |
| Header name | Observed | A header named `Authorization` was seen. |
| Header value | Not recorded | The value was redacted and was not retained. It is not recoverable from this document. |
| Scheme | Unknown | The scheme was not verified. |
| Bearer or OAuth | Not established | Do not read the header name as Bearer, OAuth, or any other scheme. |
| Cookie dependence | Not established | Cookie use was not verified. Do not assert that the API depends on cookies, or that it does not. |
| Session expiry | Unknown | Not tested. |
| Token refresh | Unknown | Not tested. No refresh endpoint was observed, and none should be invented. |
| Standalone access | Unknown | Calls outside the signed-in browser session were not tested. |
| Browser credential reuse | Prohibited | Extracting or replaying the browser session is not an integration method. |

When an approved integration later receives an authentication or session failure, the connector must stop and require re-authentication through a flow the supplier supports. An undocumented refresh call is not part of this design.

Company approval is required before any credential is requested, stored, or sent.

## 5. Product, Price, Discount, and Stock Field Mapping

Field names are observational. Types, cardinality, and requiredness are unknown unless a retained fragment is shown. `priceRange`, `images`, `categories`, `baseOptions`, and facet `query` were seen as names; their internal shapes were not retained.

### 5.1 Search hit

| Observed name | Mapping note | Label |
| --- | --- | --- |
| `code` | Supplier product code. Use for matching only when the code is actually present on that hit. | Observed name |
| `name` | Display name. The notes state that a name can contain highlight HTML. No sample markup was retained. Sanitize before any render. | Observed name; markup sample unknown |
| `price` | Money object. Observed child names: `currencyIso`, `formattedValue`, `priceType`, `value`. | Observed names; child values not retained on search hits |
| `priceRange` | Name only. | Shape unknown |
| `stock` | Observed child names: `isValueRounded`, `stockLevelStatus`. Search-hit values were not retained. | Observed names |
| `configurable` | Name only. | Value unknown |
| `configuratorType` | Name only. | Value unknown |
| `images` | Name only. | Shape unknown |
| `multidimensional` | Name only. | Value unknown |

Search cards in the UI did not show an explicit percent-off label or an explicit availability label. Absence of a label on the card is not a value for `stockLevelStatus`.

### 5.2 Detail fields beyond the search hit

Observed detail names: `availableForPickup`, `baseOptions`, `categories`, `code`, `configurable`, `description`, `images`, `manufacturer`, `multidimensional`, `name`, `numberOfReviews`, `pharmacyDiscount`, `price`, `priceRange`, `publicPrice`, `purchasable`, `stock`, `summary`, `url`.

| Observed name | Mapping note | Label |
| --- | --- | --- |
| `publicPrice` | Same money-name shape as `price`: `currencyIso`, `formattedValue`, `priceType`, `value`. One retained public-price figure is 51 EGP on the partial Panadol detail. | Shape names observed; one figure retained |
| `pharmacyDiscount` | Observed child names: `absolute`, `appliedValue`, `code`, `value`. Retained numbers exist only for `value` and `appliedValue` on that Panadol detail. | Semantics unknown |
| `purchasable` | `true` on that Panadol detail. Never store or display this as a quantity. | Observed boolean |
| `stock.stockLevelStatus` | `inStock` on that Panadol detail. This is the only explicit in-stock confirmation in the notes. | Observed on one detail |
| `stock` quantity | No numeric warehouse quantity was confirmed. | Unknown; keep null |
| Warehouse | No warehouse linkage was confirmed. | Unknown; keep null |
| Barcode, dose, pack as API fields | Not retained as response fields. Pack text appears inside some UI titles only. | Unknown as API fields |

`pharmacyDiscount.value = 25.0` and `pharmacyDiscount.appliedValue = 12.75` are retained numbers. They are not a verified percent, a verified currency amount, or a verified net price. A formula that combines `publicPrice`, `price`, and `pharmacyDiscount` is not defined here.

### 5.3 Historical storefront prices

These are UI figures from 6 November 2026 (Asia/Riyadh). They are not quotes and are not guaranteed current. The notes do not bind each figure to `price.value` versus another display field. Cards had no explicit percent or availability text. Order Now was not clicked.

| Retained card text | Retained figure |
| --- | --- |
| Panadol Megraine30Tab | 33.75 EGP |
| AUGMENTIN625MG10F.C.TAB | 92 EGP |
| CONCOR5MG30TABLETS | 52.8 EGP |
| GLUCOPHAGE1000MG30F.C.TAB | 38.4 EGP |
| NEXIUM10MG28SACHETS | 298.48 EGP |

Only the Panadol detail records `stockLevelStatus=inStock`. The other four cards were not confirmed in stock by a detail response.

### 5.4 Proposed NOVA-side record

This table is a proposed internal record for a future approved connector. It is inferred. It is not the supplier schema.

| Proposed internal field | Rule |
| --- | --- |
| Raw money fields | Keep `price`, `publicPrice`, and `pharmacyDiscount` as observed, separate from any normalized amount. |
| Normalized currency | Set only from an observed `currencyIso` or from explicit currency text such as EGP on a retained figure. |
| Observed-at timestamp | Set by the connector when a future approved read occurs. The observations in this document are dated 6 November 2026 (Asia/Riyadh) and are already historical. |
| Provenance | Record endpoint, method when known, and whether the read was an approved server call. |
| Confidence | Record how the row was matched. Ambiguous code, barcode, dose, or pack matches stay in manual review. |
| `netPrice` | Nullable. Remains null until discount semantics are verified on the same product. A formula is allowed only after that verification. |
| Quantity and warehouse | Nullable. Remain null while those fields are unknown. Do not copy `purchasable` into quantity. |

## 6. Integration Architecture

**This section is a conditional proposal. It is inferred. It is not implemented, and it is not approved.**

Build a connector only after the supplier has approved documented access and issued the authentication contract. Until that approval exists, NOVA Rx has documentation only.

Proposed boundary:

- The connector runs on the server. The browser does not call the supplier API for this integration.
- Secrets live only in the approved server secret manager.
- The frontend bundle, the Git repository, and a captured browser session are not credential stores and are not credential sources.
- There is no order method. Search and read do not place an order or change a cart.

Proposed operations, once access is approved:

| Proposed method | Allowed use | Not allowed |
| --- | --- | --- |
| `searchProduct` | Call the approved search endpoint with bounded paging. | Treating suggestions as bulk search, or promising a 100-item fetch in three calls. |
| `readQuote` | Read retained money fields into the raw columns. Leave `netPrice` null until semantics are verified. | Computing a net price from the unreconciled Panadol figures. |
| `readAvailability` | Read `stockLevelStatus` and `purchasable` when present. | Writing a quantity or warehouse id that the payload does not contain. |
| `updateOnDemand` | Refresh one previously read product through the approved read path. | Ordering, cart mutation, or an undocumented session refresh. |

Proposed operational controls (design targets, not measurements):

- Throttling and backoff are configurable and conservative. No limit was measured, so the configuration must not be described as a known supplier quota.
- Paging stays inside a configured maximum page count and page size. Unknown maximum `pageSize` stays unknown.
- Cached rows carry an observed-at time and are stale when that age exceeds the configured window. There is no 100-item freshness SLA.
- Matching requires supplier `code` and, when those identifiers are later verified, barcode, dose, and pack. Ambiguous matches stop for manual review.
- Product names are HTML-sanitized before display.
- A drift check compares observed field names with the names this document lists and surfaces unexpected additions or disappearances. Drift does not rewrite the official contract, because no official contract is held.
- Authentication or session failure stops the connector. The next step is a supplier-supported re-authentication. No undocumented refresh endpoint is called.

## 7. Security and Operational Limitations

| Limitation | Label | Consequence |
| --- | --- | --- |
| External integration permission | Company approval | Unknown. Storefront use in one authorized browser session is not a grant to run a NOVA Rx connector. |
| Official documentation | Unknown | None was found on the inspected homepage, footer, About, or FAQ. That inspection is not proof that an official document does not exist elsewhere. |
| Terms | Unknown | Terms for external use were not established. |
| Authorization scheme | Unknown | Header name only. Value not retained. Scheme not verified. |
| Session and refresh | Unknown | Expiry and refresh were not tested. |
| Standalone access | Unknown | Not tested outside the browser session. |
| Rate limits | Unknown | No HTTP 429, captcha, or Cloudflare challenge was observed during the earlier limited use. That is not a finding of unlimited access or of no protection. |
| Typing cancellations | Observed distinction | Searches cancelled while typing are not rate-limit errors. |
| Error shapes | Unknown | Not observed. Do not copy an Aumet HTTP 403 body, or any other supplier's error contract, into this integration. |
| Credential handling | Prohibited path | Do not extract, store, or reuse browser tokens, cookies, or session material. |
| Pricing | Unknown semantics | Do not present a calculated net as the purchase price. |
| Stock | Partial | One detail was `inStock`. No numeric quantity and no warehouse link were confirmed. |
| Paging | Partial | Do not commit to collecting 100 distinct medicines in three requests. |
| Protocol coverage | Not exhaustive | No GraphQL or websocket pricing was observed. Other channels were not ruled out by a full audit. |
| Orders | Excluded | No purchase and no cart operation is in scope. |
| Data in this file | Constrained | No live secrets, account identifiers, or session material are stored here. |

Secrets for any future approved connector stay in the server secret manager. They are not committed and they are not placed in frontend code.

## 8. Missing Information

The following gaps are explicit. None of them should be closed by guessing.

| Gap | Why it blocks implementation |
| --- | --- |
| Written supplier permission and the applicable terms | Company approval. Without it, a connector must not be built or called. |
| Official API document or supplier-issued contract | Every shape in this file is observational and partial. |
| Authentication scheme, token lifetime, refresh, and supported re-auth flow | The header name alone cannot be implemented. |
| Whether the API answers outside a browser session | Standalone access was not tested. |
| HTTP method and HTTP status for `/products/{productCode}` | The detail call is not a verified method-and-path pair. |
| `fields` parameter values | The name was seen. The value was not retained. |
| Suggestions `lang` and `curr` values, and suggestions HTTP status | Not retained. |
| Which search and detail fields are required | Presence in one observation does not make a field required. |
| Full response bodies | Only names and a few scalars were retained. |
| Error response shapes | Unobserved. |
| Measured rate limits, quotas, and bot protections | Unobserved. Limited use without a 429 is not a measurement. |
| Discount semantics for `absolute`, `appliedValue`, `code`, and `value` | The Panadol figures do not reconcile, and the context of that mismatch is unknown. |
| Same-product proof linking product code `000000000000028851` to the `Panadol Megraine30Tab` card | Not retained. |
| Numeric stock quantity and warehouse identity | Not confirmed. |
| Barcode and structured dose or pack fields | Not confirmed as API fields. |
| A bulk multi-medicine endpoint | Not confirmed. Suggestions does not fill this gap. |
| Maximum `pageSize` and stable sort | 100 was not tested. `sort` values were not retained. |
| Currency and price-type enums | Names `currencyIso` and `priceType` were seen. Enumerations were not. |
| Image, category, breadcrumb, and `priceRange` shapes | Names only. |

## 9. Exact Implementation Tasks for ChatGPT

These tasks are a staged backlog. **The authorization that produced this document is documentation only.** ChatGPT does not execute task 1 or any later task until a separate approval names that task. Task 5 does not start until tasks 1 through 4 are done and implementation is approved on its own.

Contact with the supplier, live calls, logins, and credential handling stay inside the task that explicitly approves them. This document does not approve them.

### Task 1 — Obtain supplier permission, documentation, and an authentication contract

Company approval is required before this task starts.

- Obtain written permission for the NOVA Rx use that is actually intended.
- Obtain the official API document or a supplier-issued contract.
- Obtain the supported authentication flow, including how a server identifies itself and how a human or service re-authenticates after expiry.
- Record the approved base URL and the approved operations. Do not promote this discovery note to that contract.
- Stop if permission or the auth contract is missing. Do not extract a browser `Authorization` value, cookie, or session to fill the gap.

### Task 2 — Reconcile same-product pricing and discounts

Start only with supplier-approved access from task 1.

- Select samples where search and detail are proven to be the same product code and the same pack.
- Record raw `price`, `publicPrice`, and `pharmacyDiscount` (`absolute`, `appliedValue`, `code`, `value`) without collapsing them.
- Resolve the known mismatch context: public price 51 EGP, `pharmacyDiscount.value` 25.0, `pharmacyDiscount.appliedValue` 12.75, naïve `51 - 12.75 = 38.25`, and search-card 33.75 EGP for `Panadol Megraine30Tab`. Do not assume those rows are the same SKU until the sample proves it.
- Leave `netPrice` null until the supplier's semantics are verified.
- Add a formula only after that verification, and store the formula version with the raw fields.

### Task 3 — Verify stock, warehouses, barcode, and bulk retrieval

- Confirm whether any numeric on-hand quantity exists, and on which operation.
- Confirm whether a warehouse identifier exists and how it maps to NOVA Rx locations.
- Confirm barcode and structured dose and pack identifiers for matching.
- Confirm whether any bulk multi-medicine read exists. Do not substitute `/products/suggestions`.
- Confirm maximum page size with an approved test plan. Do not promise that three requests return 100 distinct medicines. No such test is recorded in this discovery.

### Task 4 — Establish limits, errors, and the authentication lifecycle

- With the supplier's documentation or an approved test window, record real limit behavior. Do not treat the absence of HTTP 429, captcha, and Cloudflare challenge on 6 November 2026 as a quota.
- Record observed error bodies only after they are actually returned under the approved test. Do not import an Aumet 403 shape or any other supplier's errors.
- Record session expiry and the supported re-auth steps. If the supplier does not document a refresh call, do not add one.
- Distinguish user-cancelled typeahead searches from throttling responses.

### Task 5 — Implement and test only after a separate implementation approval

Preconditions: tasks 1 through 4 are complete, and a new approval authorizes application code.

- Add a server-side connector with `searchProduct`, `readQuote`, `readAvailability`, and `updateOnDemand`.
- Read secrets only from the approved server secret manager.
- Persist raw money fields, normalized currency, timestamp, provenance, and confidence.
- Keep `netPrice`, quantity, and warehouse null when the verified contract does not define them.
- Sanitize HTML in names.
- Bound paging, apply the approved throttle and backoff, detect field-name drift, and mark cache staleness.
- Do not add order placement or cart mutation.
- Test the connector against the approved contract and the reconciled fixtures, including the case where discount semantics are still unknown and `netPrice` must stay null.

Until task 5 is separately approved, the repository state for this discovery remains one document, status **PARTIAL**.
