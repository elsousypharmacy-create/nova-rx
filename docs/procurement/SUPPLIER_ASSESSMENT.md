# Supplier assessment — authorization and integration path

Last checked: 2026-11-08 by Claude (desk research + existing repo evidence). No supplier login, network capture or API call was made for this document.

| Supplier | What it is | Official API / integration permission | Evidence held | Integration path now | Status |
|---|---|---|---|---|---|
| PharmaOverseas (`shop.pharmaemarket.com`) | B2B distributor storefront, pharmacy prices | **Not found.** FAQ, About and terms 1–13 show no API or integration grant (PR #25). | PR #25 `docs/integrations/PHARMAOVERSEAS_API_DISCOVERY.md`: 2 verified GET paths on `api.pharmaemarket.com/occ/v2/pharma`, `Authorization` header seen, discount semantics unknown, numeric stock unknown. | Website connector with the pharmacy's own account. Missing: login flow, cart endpoints, discount meaning. | **NEXT: login + cart discovery, then connector (#56)** |
| Aumet Marketplace | MENA B2B pharma marketplace + pharmacy ERP | **Not found publicly.** Public profiles say Aumet "integrates with existing ERP systems", but no developer portal or API docs were found. PR #25 notes an Aumet HTTP 403 seen earlier (body not retained). | Desk research only. | Website connector with the pharmacy's own account, after discovery. | **DISCOVERY NEEDED (#63)** |
| DrugEye (Drug eye index) | Egyptian drug index app (names, ingredients, **public** prices). Not a distributor. | None found. | App store listing only. | Not a supplier connector: it has no pharmacy discounts or stock. Candidate **reference catalog** (names, actives, public price) for product matching, only under licence or from an open dataset. | **RECLASSIFIED: reference data, not supplier** |

## Decisions (updated 2026-11-08 by owner)
The owner confirmed that none of these suppliers offers an official API, and asked NOVA Rx to build its own integration on top of each supplier's **website**, using the pharmacy's **own account**, so that ordering becomes easier.

1. Integration method: reproduce the same requests the supplier's website makes from a logged-in browser (search, product detail, price, stock, cart). Authorization kind `owner-account`.
2. Credentials: the pharmacy's own username/password for each supplier, stored only as Cloudflare Worker secrets. The connector logs in using the same login flow as the website. Nothing goes in GitHub, logs or reports.
3. Limits that stay in force: one account (ours), human-like request rate, no CAPTCHA or block bypass. If the site shows a CAPTCHA or blocks us, the connector stops and alerts.
4. Orders: the connector may fill the supplier's cart only after the owner approves a draft order in NOVA Rx. Final checkout stays a deliberate human action until the owner decides otherwise.
5. Risk accepted by owner: these websites' terms do not grant automated access. The account could be warned or suspended. Mitigation: low rate, read-mostly, easy kill switch per supplier.
6. Order of work: PharmaOverseas first (search/product endpoints already documented in PR #25), then Aumet (discovery #63). DrugEye stays reference data only.
