# PharmaOverseas — discovery (2026-11-08, Claude, headless browser from the NOVA Rx cloud session)

Builds on PR #25. Method: Playwright, **not logged in**, 3 page loads at human pace, HAR sanitized with `tools/discovery/sanitize-har.mjs`. No account, no cart.

## Observed (anonymous)
| Method | Endpoint (`api.pharmaemarket.com`) | Query names | Status |
|---|---|---|---|
| GET | `/occ/v2/pharma/products/search` | query, pageSize, fields, lang, curr | 200 |
| GET | `/occ/v2/pharma/products/{code}` | fields, lang, curr | 200 (method now verified) |
| GET | `/occ/v2/pharma/products/{code}/references` · `/reviews` | | 200 |
| GET | `/occ/v2/pharma/categories/{Featured_Offers|New_Arrivals}/products` | categoryId, currentPage, pageSize | 200 |
| GET | `/occ/v2/pharma/users/anonymous/cms/pages` · `/cms/components` | | 200 |

- Anonymous search and detail return `publicPrice` (e.g. 51 EGP for 000000000000028851) and `stock.stockLevelStatus` (`inStock`). They do **not** return `price` (pharmacy price) or `pharmacyDiscount`: those need login.
- Platform: SAP Commerce + Spartacus storefront. Request header `X-Anonymous-Consents` is sent; no API key header.
- Login (from the public storefront code): OAuth 2 password grant at `/authorizationserver/oauth/token`, refresh with `grant_type=refresh_token`. Login page fields: `username` (email), `password`, hidden `_csrf`.
- **No CAPTCHA on the login page** (no reCAPTCHA iframe or Google captcha host loaded). The code bundle contains reCAPTCHA support, so it may be switched on later; the connector must stop if it appears.

## Unknown (needs logged-in capture)
Meaning of `pharmacyDiscount` fields vs. the displayed Pharmacy Price; numeric stock; cart endpoints; token lifetime. Run the "Supplier discovery" workflow after the owner adds `PO_USERNAME` / `PO_PASSWORD` secrets.
