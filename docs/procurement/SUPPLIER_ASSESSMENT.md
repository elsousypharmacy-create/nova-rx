# Supplier assessment — authorization and integration path

Last checked: 2026-11-08 by Claude (desk research + existing repo evidence). No supplier login, network capture or API call was made for this document.

| Supplier | What it is | Official API / integration permission | Evidence held | Integration path now | Status |
|---|---|---|---|---|---|
| PharmaOverseas (`shop.pharmaemarket.com`) | B2B distributor storefront, pharmacy prices | **Not found.** FAQ, About and terms 1–13 show no API or integration grant (PR #25). | PR #25 `docs/integrations/PHARMAOVERSEAS_API_DISCOVERY.md`: 2 verified GET paths on `api.pharmaemarket.com/occ/v2/pharma`, `Authorization` header seen, discount semantics unknown, numeric stock unknown. | Blocked for live calls. Allowed now: supplier export / manual CSV import, plus a written permission request by the owner. | **BLOCKED — needs supplier permission** |
| Aumet Marketplace | MENA B2B pharma marketplace + pharmacy ERP | **Not found publicly.** Public profiles say Aumet "integrates with existing ERP systems", but no developer portal or API docs were found. PR #25 notes an Aumet HTTP 403 seen earlier (body not retained). | Desk research only. | Ask Aumet partnerships for ERP/API access (this is their stated business). Grok discovery of the logged-in UI only, to size the data. | **DISCOVERY NEEDED** |
| DrugEye (Drug eye index) | Egyptian drug index app (names, ingredients, **public** prices). Not a distributor. | None found. | App store listing only. | Not a supplier connector: it has no pharmacy discounts or stock. Candidate **reference catalog** (names, actives, public price) for product matching, only under licence or from an open dataset. | **RECLASSIFIED: reference data, not supplier** |

## Decisions
1. No connector makes live calls to a supplier until this table records `official-api`, `written-permission`, or `export-file` for it.
2. First connector target (Task 03): whichever supplier first grants written permission or provides an export. Until then, Task 03 builds an **export-file connector** (CSV/JSON uploaded by the pharmacist) so the full pipeline works on real data without any undocumented endpoint.
3. Discovery (Grok) records request shapes from an authorized session in the browser only, sanitized by the Task 01 tool. Discovery evidence alone is never treated as permission.

## Owner actions needed
- Send a short written request to PharmaOverseas and Aumet asking for API/ERP integration access or a scheduled price-list export for Elsousy pharmacy (template in `DISCOVERY_PROTOCOL.md`).
