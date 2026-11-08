# Aumet marketplace — discovery (2026-11-08, run 42463602885, pharmacy's own account, no cart)

Source: sanitized capture `captures/2026-11-08-aumet.json` (+ `-steps.json`, `.md`). Only names, number fields and path templates; ids replaced by `{id}`.

## Observed
| Finding | Detail |
|---|---|
| Pharmacy app | `marketplace.aumet.com/pharmacy`; login page `marketplace.aumet.com/user/login` (fields `email`, `password`, `rememberMe`). Other front door: `pulse.aumet.com` (Aumet's pharmacy software). |
| CAPTCHA / OTP | None on login or after login in this run. |
| Login | `POST /user/spa-login` (with `X-XSRF-TOKEN` + cookie). Body includes `confirm_logout_others`: **a login may end the pharmacy's other sessions** (needs checking). |
| API calls | `GET /api/...` with headers `Authorization`, `Cookie`, `X-XSRF-TOKEN`, `X-Requested-With`, `x-user-lang`. |
| Search / list | `GET /api/products` params: `product_id`, `page`, `result_per_page`, `sort`, `sort_by`, `in_stock`, `show_comparison`, `group_by`, `has_special_offer`, `has_flash_sale`, `has_exclusive_offer`, `payment_method_id`, `spell` and others. Response `data[]` = **one entry per distributor offer**. |
| Distributors | `GET /api/entity/{id}/all-distributors` returned 21 distributors with rating (`averageRate`, `countRate`). Offer carries `entity_id`, `entity.name`, `seller_id`, `average_distributor_rate`, `delivery_fee`. |
| Prices | Offer fields: `unit_price` (e.g. 553), `best_price` (e.g. 447.93), `retail_selling_price`, `vat`, `discounts[]`, `bonuses[]`, `loyalty_points`. |
| Stock | `stock` is a **number** (e.g. 19), plus `order_quantities`, `limited_qty`, `has_limited_qty`, `remaining_qty`, `low_stock_limit` 100 (`/api/config`). |
| Matching data | `product.bar_code`, `product.composition`, `product.active_ingredient[]`, `product.strength`, `product.dosage`, `product.manufacturer_name`. **Barcode and active ingredient are available**, which PharmaOverseas lacks. |
| Cart | `/api/cart/{id}/count`, `/products-quantities`. Add/remove not captured. |

## Unknown
- Exact meaning of `unit_price` vs `best_price` (best_price = after discount? to verify on 3 products against the screen).
- How `discounts[]` tiers and `bonuses[]` (free units) combine with quantity.
- Whether a login from our system logs the pharmacy out elsewhere (`confirm_logout_others`).
- Rate limits.

## Design consequences
1. Aumet is a **marketplace**: one site, many sellers. Offers need a seller (`sellerId`, `sellerName`); comparison ranks across sellers.
2. Real numeric stock and barcode make matching and MOQ exact for Aumet.
3. Price semantics must be confirmed before showing "net" (see PharmaOverseas rule).
