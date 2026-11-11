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
