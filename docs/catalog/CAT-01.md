# CAT-01 — Unified catalog (module `worker/catalog/unified-catalog.js`)

Status: CODE_PUSHED. Not accepted, not merged, not deployed, no live data touched. Pure module (no I/O).

## Contract
- Record -> `{ok, product, errors}`. Fields: `id` (from `id` or `code`), `nameAr`, `nameEn` (also `namear`/`nameen`/`name`), `barcodes[]` (from `barcodes`, `barcode`, `gtin`), `activeIngredient`, `strength`, `form`, `packSize`, `category`, `unit`, `price`, `active`. Products are frozen.
- Rejected, never defaulted: missing id, missing name, invalid or negative price, pack size <= 0 or not a number, a barcode that is not 8-14 digits (letters are not stripped). Missing price stays `null`, not 0.
- Barcodes: Arabic-Indic digits are converted; spaces and hyphens removed.
- `add()` refuses a duplicate id or barcode (`reason: duplicate-id | duplicate-barcode`) instead of overwriting. A bulk load lists every refused row in `catalog.rejected`.
- Search folds diacritics, tatweel, alef forms, ya/ta marbuta and Arabic-Indic digits; every token must match; also matches ingredient, strength, form, barcode and id.
- Duplicates: `detectDuplicates()` groups products with the same normalized Arabic or English name, pack size, strength and form. Nothing merges automatically. `merge(keepId, dropId, {reviewedBy})` throws unless a named pharmacist reviewer is given and the pair is a detected candidate; it unions barcodes, keeps an alias (`resolveId`) and appends an entry to `mergeLog`.

## Not in this task
Units and conversions (CAT-02, PR #135), search speed and ranking (CAT-05), persistence, tenant isolation (SEC-03). `units` in the STOCK LIVE export is a quantity, not a catalog field, so it is ignored. No integration with the live STOCK LIVE sheet yet: the real-data check reads the committed read-only export `data/emergency-stock.json`.

## Evidence (real export, read only)
4378 rows -> 4378 loaded, 0 rejected, 9 duplicate-candidate groups for pharmacist review (for example `سرنجة 3سم كبار` / `سرنجه 3سم كبار`), catalog build about 50 ms. Run: `for f in tests/unit/unified-catalog*.check.mjs; do node --no-warnings $f; done`.

## Review follow-up (Claude 2, PR #136) and known limits
- Fixed: whitespace price is "not given" (null), never 0; prices and pack sizes must be strict decimals (Arabic digits and `٫`/`٬` separators accepted; `0x10`, `1e3`, signs and non-text types rejected); `mergeLog` and `rejected` are read-only views; a test now proves that strength/form differences prevent a duplicate group; the merge log records the discarded `price`/`active`/`unit`; import-style inactive flags (`0`, `"false"`, `"no"`, `"inactive"`) deactivate; ids typed with Arabic-Indic digits are found.
- `price` is a JS number for display and comparison. Money arithmetic must use the integer-cent functions of CAT-02 (`unit-conversion.js`).
- `reviewedBy` is a name recorded in the log, not an approval control, until identity exists (SEC-01/02).
- A product with one invalid barcode is rejected as a whole (reported in `rejected`), so a pharmacist must fix the barcode; it is not loaded without it.
- Barcodes must be read as strings (a JS number loses leading zeros).
- Token search is substring based (`500` also matches `1500`); ranking and word boundaries are CAT-05.
- Bounds (re-review): price must be between 0 and 1,000,000,000 EGP; pack size must be a positive integer up to 1,000,000. CAT-02 packaging uses the same integer rule.
