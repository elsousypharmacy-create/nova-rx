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

## Logged in (2026-11-08, run 42450090854, pharmacy's own account, no cart)
Capture: `captures/pharmaoverseas-42450090854.json` (sanitized on the GitHub runner; raw HAR deleted there; checked for emails, ids and tokens: none).

| Finding | Evidence |
|---|---|
| Login = OAuth 2 **authorization code + PKCE**: `GET /authorizationserver/csrf`, login form on the storefront, then `POST /authorizationserver/oauth/token` with `client_id, code, code_verifier, grant_type, redirect_uri`. | Observed |
| Token response: `access_token`, `refresh_token`, `token_type: Bearer`, `expires_in: 43199` (12 h). | Observed |
| **Search returns the pharmacy price per product** (`products[].price.value`, e.g. 33.75 for Panadol Megraine): one search page prices up to `pageSize` products. | Observed |
| Detail: `price` 33.75 (Pharmacy Price), `publicPrice` 51, `pharmacyDiscount` {`value` 25, `appliedValue` 12.75, `absolute`, `code`}, `stock.stockLevelStatus` inStock, `purchasable`. | Observed |
| Stock: status only (`inStock`…), **no quantity**. | Observed |
| Cart: `GET /users/current/carts`, `GET /users/current/carts/{id}` (add/remove not captured yet). | Observed |

### Price meaning (decision for the connector)
- `unitPrice` = `netEffectivePrice` = `price.value`: the Pharmacy Price the site shows and charges before checkout (taxes shown 0 %).
- `publicPrice` = `publicPrice.value`.
- `discountPct` = `1 - price/publicPrice`: **discount off the public price**, the way Egyptian pharmacies compare suppliers (33.82 % for Panadol Megraine). Computed only from those two observed fields.
- `pharmacyDiscount` (25 % = 12.75 EGP) looks like the standard pharmacy margin; the extra 4.50 EGP (51 − 12.75 − 33.75) is the distributor's own discount. Kept in `raw`; not used for ranking until confirmed on more products.
