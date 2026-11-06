# PharmaOverseas API discovery for NOVA Rx

**Report status: PARTIAL.** This document is not production integration readiness and is not an official supplier contract.

| Control | Statement |
| --- | --- |
| Historical observation date | 6 November 2026 (Asia/Riyadh). Earlier read-only storefront use plus DevTools. |
| Phase 2 observation date | 6 November 2026 (Asia/Riyadh). Exact capture time was not reliably recorded. A conflicting clock range from the browser worker is omitted on purpose. |
| Evidence | Two separated sets. Historical notes keep their original limits. Phase 2 is normal storefront UI only and supersedes a historical unknown only where the fresh UI proved it. |
| Phase 2 session | An authorized browser session was already signed in on the homepage. No DevTools, no API calls, no cart, order, favorites, or settings changes, and no supplier contact. |
| This change | Documentation only. It does not authorize calls, logins, purchases, cart operations, credential reuse, or supplier contact. |
| Counts | Unchanged by phase 2. Historical confirmed endpoint paths: 3. Historical complete verified method and path: 2. Phase 2 did not verify endpoints or authentication. |
| Readiness | PARTIAL. External integration remains blocked pending supplier-approved documented access. |

Storefront observed: `https://shop.pharmaemarket.com`.

Login page observed: `https://shop.pharmaemarket.com/pharma/en/EGP/login`.

The login page is a storefront URL. It was not observed as the API authentication endpoint.

JSON base described in the historical notes as a SAP Commerce-style REST base: `https://api.pharmaemarket.com/occ/v2/pharma`.

That platform description is the wording of the historical notes. This report does not independently confirm the vendor platform, and it does not import general OCC defaults as this supplier's contract.

## How statements are labeled

| Label | Meaning in this document |
| --- | --- |
| Historical | Retained from the earlier notes (storefront plus DevTools). Phase 2 did not re-read the API. |
| Fresh UI | Seen in the phase 2 normal browser session. No DevTools and no API call. |
| Inferred | A proposal or reading that goes beyond a retained fact. Marked where used. |
| Unknown | Not retained, not tested, or not reconcilable. Phase 2 closes an unknown only where the fresh UI proved it. |
| Company approval | Blocked until the supplier grants permission or issues a documented access contract. |

Any field list below is an observational partial shape. It records names or fragments that were seen. It does not state which fields are required, which types are official, or which values are stable.

In the historical sections, "observed" means a historical observation. It does not mean phase 2 rechecked the API.

## 1. Executive Summary

Discovery remains **PARTIAL**. Historical evidence still accounts for two verified GET paths and one product-detail path whose HTTP method and status were not retained. Phase 2 did not verify endpoints, request shapes, response shapes, or authentication. An `Authorization` header name remains a historical observation only. Its value and scheme were not verified.

Phase 2 fresh UI closed one unknown the historical notes had left open. The search card `Panadol Megraine 30 Tab` at 33.75 EGP is the same item as product `000000000000028851`. That detail page shows the labels `Public Price 51 EGP`, `Taxes 0 %`, and `Pharmacy Price 33.75 EGP`. The card figure matches the displayed Pharmacy Price on that same item. Those labels do not explain the historical API numbers `pharmacyDiscount.value` 25.0 and `pharmacyDiscount.appliedValue` 12.75. They are not a discount formula and they are not a final checkout or net purchase price. Normalized `netPrice` stays null.

Phase 2 inspected the published homepage footer, About, FAQ, and terms 1–13. Those pages showed no developer or API document, no express ERP or API integration permission, and no supplier-approved authentication contract. That inspection does not prove that no official document exists elsewhere. External integration stays blocked until supplier-approved documented access exists. No supplier contact was made or authorized.

NOVA Rx must not treat this note as an implementation specification. The current authorization for this repository change is documentation only.

What this report does not claim:

- It is not an authoritative request or response contract.
- It does not define required fields, error bodies, or rate limits. Those were not observed.
- It does not assert a final net purchase price or a discount formula.
- Phase 2 does not freshly verify endpoints, methods, status codes, or authentication.
- It does not authorize extracting or replaying a browser session.
- It does not record a bulk medicine API, a GraphQL API, or a websocket price feed. Those were not seen in the limited historical observations, and those observations were not an exhaustive audit.

## Phase 2 storefront UI findings

Evidence class: **Fresh UI**. Date: 6 November 2026 (Asia/Riyadh). Exact capture time: not reliably recorded.

This session used the normal storefront in a browser. The session was already signed in on the homepage. It did not open DevTools, did not call the API, and did not change the cart, an order, favorites, or settings. It did not contact the supplier. It does not change the historical endpoint counts or the historical request and response excerpts.

### Same item

| Item | Fresh UI evidence |
| --- | --- |
| Search URL | `https://shop.pharmaemarket.com/pharma/en/EGP/search/Panadol%20Megraine` |
| Card title | `Panadol Megraine 30 Tab` |
| Card price | 33.75 EGP, with no discount label and no stock label |
| Navigation | Clicking the card title opened the product URL below. The card href and the visible detail ID are the same code. |
| Product URL | `https://shop.pharmaemarket.com/pharma/en/EGP/product/000000000000028851/Panadol%20megraine%2030%20tab` |
| Visible ID | `ID 000000000000028851` |
| Detail title | Same title as the card. The pack `30 Tab` is in the title. No barcode was displayed. |

Historical notes had recorded the code `000000000000028851` and a card string `Panadol Megraine30Tab` at 33.75 EGP without proving they were the same item. Phase 2 proves that link. The historical spelling without spaces stays in the historical record. The fresh visible title is `Panadol Megraine 30 Tab`.

### Displayed price labels

These strings were visible on the detail page. They are storefront labels, not a fresh reading of API fields.

| Exact label | What it settles | What it does not settle |
| --- | --- | --- |
| `Public Price 51 EGP` | Displayed public price for this item. The figure matches the historical public-price figure of 51 EGP. | Which API property held 51. Not a checkout total. |
| `Taxes 0 %` | A tax label was displayed as `Taxes 0 %`. | A tax rule, a discount, or a checkout total. |
| `Pharmacy Price 33.75 EGP` | Displayed pharmacy price. It is the same 33.75 EGP as this item's search card. | Historical API `pharmacyDiscount` semantics. Not `netPrice`. |

No label showed 25, 12.75, or a net purchase price. No discount formula is adopted. The historical naïve subtraction `51 - 12.75 = 38.25` remains unequal to 33.75, and phase 2 does not turn that arithmetic into a formula. Normalized `netPrice` stays null.

### Stock labels on this page

No numeric stock, `inStock`, `outOfStock`, or warehouse label was visible. The Quantity stepper is the user-selected order quantity, not a stock figure. Order Now was not clicked. Presence of Order Now is not evidence of availability.

Historical `stock.stockLevelStatus=inStock` on this product code stays historical DevTools evidence. Phase 2 did not freshly verify that value and did not verify a numeric quantity.

### Published pages inspected

| Page | URL | Fresh UI result |
| --- | --- | --- |
| Homepage | `https://shop.pharmaemarket.com/pharma/en/EGP/` | Footer labels included About Us, Find a Store, Help FAQ, Terms And Conditions, and Contact Us. No developer, API, or docs link was in that footer. |
| About | `https://shop.pharmaemarket.com/pharma/en/EGP/about-us` | Company description only. |
| FAQ | `https://shop.pharmaemarket.com/pharma/en/EGP/faq` | Account setup, guest browsing, password reset, language, restock Notify me, and recurring orders. No API, ERP, integration permission, or authentication contract was on this page. |
| Terms | `https://shop.pharmaemarket.com/pharma/en/EGP/termsAndConditions` | Terms 1–13 were inspected. They include lawful-use language, a prohibition on disrupting or interfering with site operation, and an account suspension or cancellation clause. Full clause text is not quoted. |

No express ERP or API integration permission, and no supplier-approved authentication contract, was established on these pages. This is not a finding that documentation is absent everywhere. External integration remains **blocked** pending supplier-approved documented access. No contact was made or authorized.

### Sanitized UI evidence

No customer data, account identifier, or session material is included. Prices below are the labels seen on 6 November 2026 (Asia/Riyadh). They are not a current quote and they are not a checkout total.

| Source URL | What was read | Retained text |
| --- | --- | --- |
| `https://shop.pharmaemarket.com/pharma/en/EGP/search/Panadol%20Megraine` | Search card for the item opened next | Title `Panadol Megraine 30 Tab`; price 33.75 EGP; no discount label; no stock label |
| `https://shop.pharmaemarket.com/pharma/en/EGP/product/000000000000028851/Panadol%20megraine%2030%20tab` | Detail page reached from that card | `ID 000000000000028851`; same title; pack in the title; no barcode |
| Same detail URL | Price labels | `Public Price 51 EGP`; `Taxes 0 %`; `Pharmacy Price 33.75 EGP` |
| Same detail URL | Stock and order controls | No numeric stock, in-stock, out-of-stock, or warehouse label. Quantity stepper is order quantity. Order Now was not clicked. |
| `https://shop.pharmaemarket.com/pharma/en/EGP/` | Footer | About Us, Find a Store, Help FAQ, Terms And Conditions, Contact Us. No developer, API, or docs link in that footer. |
| `https://shop.pharmaemarket.com/pharma/en/EGP/about-us` | About page | Company description only. |
| `https://shop.pharmaemarket.com/pharma/en/EGP/faq` | FAQ page | Account, guest browsing, password reset, language, restock Notify me, recurring orders. No API or integration contract. |
| `https://shop.pharmaemarket.com/pharma/en/EGP/termsAndConditions` | Terms 1–13 | Lawful-use language; do not disrupt or interfere with site operation; account suspension or cancellation. Clauses not quoted. |

## 2. Confirmed Endpoints

Evidence class for this section: **Historical.** Phase 2 did not re-verify methods, paths, parameters, or status codes. Counts remain 3 confirmed paths and 2 verified method-and-path pairs. No request or response change is asserted.

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

Evidence class for this section: **Historical** excerpts. Phase 2 did not add or amend these request or response fragments.

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
| `stock.stockLevelStatus` | `inStock` | Historical only. Phase 2 did not freshly verify this value or any numeric stock. |
| `pharmacyDiscount.value` | `25.0` | Observed number. Meaning unknown. |
| `pharmacyDiscount.appliedValue` | `12.75` | Observed number. Meaning unknown. |
| Public price | `51` EGP | Observed figure. The notes do not split it into `value` versus `formattedValue`. |

The notes do not retain `pharmacyDiscount.absolute`, `pharmacyDiscount.code`, numeric stock quantity, or warehouse identity for this detail.

### 3.5 Historical Panadol figures, and the link phase 2 later proved

The historical notes record a search-card display of `Panadol Megraine30Tab` at 33.75 EGP beside the partial detail for code `000000000000028851`. Those notes did not themselves prove that the card and the detail were the same item. That limit is kept as historical provenance.

The naïve subtraction stated in the notes is `51 - 12.75 = 38.25`. That result is not 33.75. Phase 2 does not adopt that subtraction as a formula.

Phase 2 fresh UI later proved the same item: card title `Panadol Megraine 30 Tab`, card href, and visible `ID 000000000000028851`. On that page, `Pharmacy Price 33.75 EGP` matches the card's 33.75 EGP, and `Public Price 51 EGP` is displayed with `Taxes 0 %`. The historical API numbers 25.0 and 12.75 were not visible as UI labels. Their meaning stays **unknown**. No final checkout price and no net purchase price is asserted. Normalized `netPrice` stays null.

### 3.6 Error and limit examples

No error body was retained. No HTTP 429 body was retained. This section intentionally contains neither. Cancelled searches while a query was still being typed are not recorded as rate-limit errors. Another supplier's error contract is not imported here.

## 4. Authentication Mechanism

Evidence class for this section: **Historical.** Phase 2 did not inspect network headers, cookies, or authentication. Nothing in this section is a fresh verification.

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

API names in this section are historical. Rows that cite a visible storefront label are fresh UI. Phase 2 did not re-read a response body, so those labels are not written back onto API property names.

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

Historical search cards did not show an explicit percent-off label or an explicit availability label. Phase 2 saw the same limitation on the Panadol Megraine card: 33.75 EGP with no discount label and no stock label. Absence of a label is not a value for `stockLevelStatus`.

### 5.2 Detail fields beyond the search hit

Observed detail names: `availableForPickup`, `baseOptions`, `categories`, `code`, `configurable`, `description`, `images`, `manufacturer`, `multidimensional`, `name`, `numberOfReviews`, `pharmacyDiscount`, `price`, `priceRange`, `publicPrice`, `purchasable`, `stock`, `summary`, `url`.

| Observed name | Mapping note | Label |
| --- | --- | --- |
| `publicPrice` | Same money-name shape as `price`: `currencyIso`, `formattedValue`, `priceType`, `value`. One historical public-price figure is 51 EGP on the partial Panadol detail. Phase 2 showed the UI label `Public Price 51 EGP` on the same code and did not identify the API property. | Historical shape names; fresh UI label separate |
| `pharmacyDiscount` | Observed child names: `absolute`, `appliedValue`, `code`, `value`. Historical numbers exist only for `value` 25.0 and `appliedValue` 12.75. Phase 2 did not show either number as a UI label. | API semantics unknown |
| UI Pharmacy Price | Fresh UI label `Pharmacy Price 33.75 EGP` on product `000000000000028851`, matching that item's search card. This is not an API field mapping. | Fresh UI; not `netPrice` |
| UI Taxes | Fresh UI label `Taxes 0 %` on that detail page. | Fresh UI; not a checkout total |
| `purchasable` | `true` on the historical Panadol detail. Never store or display this as a quantity. | Historical boolean |
| `stock.stockLevelStatus` | Historical `inStock` on that Panadol detail. This is the only explicit in-stock value in the historical notes. Phase 2 did not show an in-stock or out-of-stock label and did not freshly verify numeric stock. | Historical only |
| `stock` quantity | No numeric warehouse quantity was confirmed. The phase 2 Quantity stepper is user-selected order quantity, not stock. | Unknown; keep null |
| Warehouse | No warehouse linkage was confirmed. Phase 2 showed no warehouse label. | Unknown; keep null |
| Barcode, dose, pack as API fields | Not retained as response fields. Phase 2 showed no barcode. Pack text `30 Tab` is in the fresh title only. | Unknown as API fields |

`pharmacyDiscount.value = 25.0` and `pharmacyDiscount.appliedValue = 12.75` are historical numbers. They are not a verified percent, a verified currency amount, or a verified net price. Phase 2 did not display them. A formula that combines `publicPrice`, `price`, and `pharmacyDiscount` is not defined here. The fresh UI Pharmacy Price of 33.75 EGP is a displayed label for the proven same item. It is not written into `netPrice`.

### 5.3 Historical storefront prices

These are UI figures from the historical notes, 6 November 2026 (Asia/Riyadh). They are not quotes and are not guaranteed current. The historical notes do not bind each figure to `price.value` versus another display field. Cards had no explicit percent or availability text. Order Now was not clicked. Phase 2 reopened only the Panadol Megraine card and its detail page. Augmentin, Concor, Glucophage, and Nexium were not rechecked.

| Retained card text | Retained figure |
| --- | --- |
| Panadol Megraine30Tab | 33.75 EGP |
| AUGMENTIN625MG10F.C.TAB | 92 EGP |
| CONCOR5MG30TABLETS | 52.8 EGP |
| GLUCOPHAGE1000MG30F.C.TAB | 38.4 EGP |
| NEXIUM10MG28SACHETS | 298.48 EGP |

In the historical notes, only the Panadol detail records `stockLevelStatus=inStock`. Phase 2 did not freshly verify that status. The other four cards were not confirmed in stock by a detail response, and phase 2 did not reopen them.

### 5.4 Proposed NOVA-side record

This table is a proposed internal record for a future approved connector. It is inferred. It is not the supplier schema.

| Proposed internal field | Rule |
| --- | --- |
| Raw money fields | Keep `price`, `publicPrice`, and `pharmacyDiscount` as observed, separate from any normalized amount. |
| Normalized currency | Set only from an observed `currencyIso` or from explicit currency text such as EGP on a retained figure. |
| Observed-at timestamp | Set by the connector when a future approved read occurs. Historical notes and the phase 2 UI share the calendar date 6 November 2026 (Asia/Riyadh). The phase 2 clock time was not reliably recorded. |
| Provenance | Record whether a figure is historical API, fresh UI, or a later approved server call. Keep those sources separate. |
| Confidence | The phase 2 UI match of code `000000000000028851` to `Panadol Megraine 30 Tab` is a proven storefront link. Ambiguous barcode, dose, or pack matches still stay in manual review. |
| `netPrice` | Nullable. Stays null. The displayed Pharmacy Price is not a net price. A formula is allowed only after API monetary semantics are verified. |
| Quantity and warehouse | Nullable. Remain null while those fields are unknown. Do not copy `purchasable`, the order-quantity stepper, or Order Now into quantity or availability. |

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
| `readQuote` | Read retained money fields into the raw columns. Keep the fresh UI Pharmacy Price as a UI observation. Leave `netPrice` null until API semantics are verified. | Treating 33.75 EGP as a checkout total, or computing a net price from historical `pharmacyDiscount` numbers. |
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
| External integration permission | Company approval; blocked | Phase 2 inspected the homepage footer, About, FAQ, and terms 1–13. No express ERP or API integration permission and no supplier-approved auth contract were on those pages. Storefront use is not a grant to run a connector. This is not proof that no document exists elsewhere. No contact was made. |
| Official documentation | Not found on inspected pages | Phase 2 found no developer, API, or docs link in the homepage footer. About is a company description. FAQ has no API, ERP, or auth contract. That inspection is not proof that an official document does not exist elsewhere. |
| Terms | Inspected; no integration grant | Terms 1–13 include lawful-use language, a prohibition on disrupting or interfering with site operation, and account suspension or cancellation. Full clauses are not quoted. Those pages did not grant external API use. |
| Authorization scheme | Unknown | Header name only. Value not retained. Scheme not verified. |
| Session and refresh | Unknown | Expiry and refresh were not tested. |
| Standalone access | Unknown | Not tested outside the browser session. |
| Rate limits | Unknown | No HTTP 429, captcha, or Cloudflare challenge was observed during the earlier limited use. That is not a finding of unlimited access or of no protection. |
| Typing cancellations | Observed distinction | Searches cancelled while typing are not rate-limit errors. |
| Error shapes | Unknown | Not observed. Do not copy an Aumet HTTP 403 body, or any other supplier's error contract, into this integration. |
| Credential handling | Prohibited path | Do not extract, store, or reuse browser tokens, cookies, or session material. |
| Pricing | UI link proved; API semantics unknown | Card 33.75 EGP matches `Pharmacy Price 33.75 EGP` on the same item, with `Public Price 51 EGP` and `Taxes 0 %`. That is not a checkout total. Historical 25.0 and 12.75 stay unexplained. Do not present a calculated net as the purchase price. `netPrice` stays null. |
| Stock | Historical partial; fresh UI unlabeled | Historical detail had `stockLevelStatus=inStock`. Phase 2 showed no numeric stock, in-stock, out-of-stock, or warehouse label. The Quantity stepper is order quantity. Order Now was not clicked and is not an availability signal. |
| Paging | Partial | Do not commit to collecting 100 distinct medicines in three requests. |
| Protocol coverage | Not exhaustive | No GraphQL or websocket pricing was observed. Other channels were not ruled out by a full audit. |
| Orders | Excluded | No purchase and no cart operation is in scope. |
| Data in this file | Constrained | No live secrets, account identifiers, or session material are stored here. |

Secrets for any future approved connector stay in the server secret manager. They are not committed and they are not placed in frontend code.

## 8. Missing Information

The following gaps are explicit. None of them should be closed by guessing.

| Gap | Why it blocks implementation |
| --- | --- |
| Written supplier permission and the applicable terms | Still open. Phase 2 did not find an express grant on the inspected public pages. Company approval is still required. Without it, a connector must not be built or called. |
| Official API document or supplier-issued contract | Still absent from this file. Phase 2 did not find one on the homepage footer, About, FAQ, or terms 1–13. That is not proof none exists elsewhere. Every API shape in this file stays observational and partial. |
| Authentication scheme, token lifetime, refresh, and supported re-auth flow | The header name alone cannot be implemented. |
| Whether the API answers outside a browser session | Standalone access was not tested. |
| HTTP method and HTTP status for `/products/{productCode}` | The detail call is not a verified method-and-path pair. |
| `fields` parameter values | The name was seen. The value was not retained. |
| Suggestions `lang` and `curr` values, and suggestions HTTP status | Not retained. |
| Which search and detail fields are required | Presence in one observation does not make a field required. |
| Full response bodies | Only names and a few scalars were retained. |
| Error response shapes | Unobserved. |
| Measured rate limits, quotas, and bot protections | Unobserved. Limited use without a 429 is not a measurement. |
| Discount semantics for `absolute`, `appliedValue`, `code`, and `value` | Still unknown. Phase 2 proved the storefront item and the displayed Pharmacy Price. It did not show 25.0 or 12.75, and it did not define these API fields. No formula is adopted. |
| Same-product UI link for code `000000000000028851` and `Panadol Megraine 30 Tab` | Resolved by phase 2 fresh UI (card href and visible ID). Historical notes had not proved the link. API monetary semantics remain unknown. |
| Final checkout price and normalized `netPrice` | Not shown. Displayed Pharmacy Price is not a confirmed checkout total. `netPrice` remains null. |
| Numeric stock quantity and warehouse identity | Not confirmed. Phase 2 showed no stock or warehouse label. Historical `inStock` is not numeric stock and was not freshly verified. |
| Barcode and structured dose or pack fields | No barcode on the phase 2 detail page. Pack `30 Tab` is title text only. Not confirmed as API fields. |
| A bulk multi-medicine endpoint | Not confirmed. Suggestions does not fill this gap. |
| Maximum `pageSize` and stable sort | 100 was not tested. `sort` values were not retained. |
| Currency and price-type enums | Names `currencyIso` and `priceType` were seen. Enumerations were not. |
| Image, category, breadcrumb, and `priceRange` shapes | Names only. |

## 9. Exact Implementation Tasks for ChatGPT

These tasks are a staged backlog. **The authorization that produced this document is documentation only.** ChatGPT does not execute task 1 or any later task until a separate approval names that task. Task 5 does not start until tasks 1 through 4 are done and implementation is approved on its own.

Contact with the supplier, live calls, logins, and credential handling stay inside the task that explicitly approves them. This document does not approve them.

### Task 1 — Obtain supplier permission, documentation, and an authentication contract

Company approval is required before this task starts.

- Phase 2 already inspected the public homepage footer, About, FAQ, and terms 1–13. Those pages did not contain an express integration grant or an authentication contract. That inspection does not replace written supplier permission.
- Obtain written permission for the NOVA Rx use that is actually intended.
- Obtain the official API document or a supplier-issued contract.
- Obtain the supported authentication flow, including how a server identifies itself and how a human or service re-authenticates after expiry.
- Record the approved base URL and the approved operations. Do not promote this discovery note to that contract.
- Stop if permission or the auth contract is missing. Do not extract a browser `Authorization` value, cookie, or session to fill the gap.

### Task 2 — Reconcile API monetary semantics for the item phase 2 already linked

Start API reads only with supplier-approved access from task 1. Do not reopen the storefront link as unknown.

- The phase 2 UI link is closed for this item: search card `Panadol Megraine 30 Tab` at 33.75 EGP is product `000000000000028851`, with visible labels `Public Price 51 EGP`, `Taxes 0 %`, and `Pharmacy Price 33.75 EGP`.
- Keep that Pharmacy Price as a UI observation. Do not store it as `netPrice` and do not describe it as a final checkout price.
- Under approved API access, record raw `price`, `publicPrice`, and `pharmacyDiscount` (`absolute`, `appliedValue`, `code`, `value`) without collapsing them.
- Historical `pharmacyDiscount.value` 25.0 and `appliedValue` 12.75 were not visible on the phase 2 page. The naïve `51 - 12.75 = 38.25` is not 33.75. Do not invent a formula that forces those API numbers onto the displayed Pharmacy Price.
- Leave `netPrice` null until the supplier's semantics are verified. Add a formula only after that verification, and store the formula version with the raw fields.

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
