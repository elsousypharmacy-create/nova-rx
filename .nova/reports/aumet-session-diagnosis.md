# SALE-03 — Aumet session diagnosis (read-only, 2026-11-15)

Result: **a human credential step is required. No code fix is justified.**

Evidence (existing log only; names and fixed booleans, no secret values):
- Supplier sessions run 43686840584 (schedule, 2026-11-15 06:44 UTC): `pharmaoverseas: session saved`; `aumet: login failed: AUMET credentials rejected by server`.
- Login diagnostics: httpStatus 401, stillOnLogin true, apiAuthorizationObserved false, credentialsRejected true, otherSession false, verificationRequired false, rateLimited false.
- The last 5 scheduled runs (2026-11-14 00:54 .. 2026-11-15 06:44) all concluded `failure`.

Meaning: the login path (FIX44/FIX45) runs. No CAPTCHA, other-session prompt or throttling is involved. The Aumet server answers 401 for the stored username/password, so the Worker never gets a session and supplier-health reports `missing_credential`.

Required (owner/human, not done here): verify the Aumet account can log in at marketplace.aumet.com (password changed, account locked or disabled?), then update the `AUMET_USERNAME` / `AUMET_PASSWORD` GitHub secrets and re-run "Supplier sessions" with supplier=aumet.

Not done / not tested: no live call, no secret read or change, no cart/order. Existing unit tests for the login classifier (`tests/unit/aumet-login-signals.check.mjs`) already cover the 401 classification.
