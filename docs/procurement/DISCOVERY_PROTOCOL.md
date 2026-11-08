# Discovery protocol (Grok / any discovery agent)

Purpose: document how a supplier site exchanges data, without collecting secrets and without bypassing protections. Output is evidence for an authorization decision, not an implementation spec.

## Allowed
- A session the pharmacy owner is already entitled to, in a normal browser, at human speed.
- Search a product, open its detail page, change page, and (for order discovery) add ONE item to the cart and remove it again. Never press checkout/confirm order. Max ~30 requests per session.
- Record the login request too: URL, method, parameter **names** and response field **names** only (e.g. a token endpoint returning `access_token`, `expires_in`), never values.
- Chrome DevTools Network (Fetch/XHR) or Playwright `page.on('response')` to record: URL path, method, query parameter **names**, status, response field **names**, pagination fields, product id format, price/discount/stock field names, error/rate-limit behaviour.

## Forbidden
- Copying cookies, `Authorization` values, tokens, passwords, phone numbers, account ids, addresses, order history.
- Confirming/submitting an order, changing favourites or settings.
- CAPTCHA solving, bot-protection bypass, replaying requests outside the browser, load testing.

## Output
One file per supplier: `docs/procurement/discovery/<supplier>.md`, with sections: Summary, Authorization evidence (terms/API docs found or not), Endpoints (method, path template, param names), Response field map, Pagination, Price semantics (what each label/field means, and what is unknown), Stock semantics, Auth mechanism (header **name** only), Errors/limits seen, Open questions. Every statement labelled Observed / Inferred / Unknown. If a HAR is used, run it through the Task 01 sanitizer first and commit only the sanitized summary.

