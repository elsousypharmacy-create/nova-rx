# CAT-05 — Instant search and barcode (`worker/catalog/catalog-search.js`)

Status: CODE_PUSHED on branch `claude/cat-05-search` (stacked on the packaging link, CAT-02 and CAT-01). Pure and local: no Worker route, no UI, no persistence. **Not accepted, not integrated, not deployed.**

## Behaviour
- `createSearchIndex(catalog | products[])` builds a snapshot index (`refresh()` rebuilds; `size`). `search(query, {limit})` returns `[{product, score, reason}]` (`reason`: `barcode`, `code` or `name`); default 20, hard cap 100; non-text, blank or garbage queries return `[]`; queries are capped at 200 characters and 8 distinct words.
- **Arabic folding** from CAT-01 (alef/hamza forms, ta marbuta, ya, diacritics, tatweel, Arabic-Indic digits) plus hamza carriers (`ؤ`, `ئ`). Letters and digits stuck together are split (`500mg` -> `500`, `mg`; `مجم500`).
- **Words:** exact (10), prefix (7; 4 for two-letter words), and **typos** only when a word has no exact or prefix match anywhere: one edit (insert, delete, replace, neighbour swap) for words of 4-7 letters, two for 8+; shorter words are never fuzzy. Every query word must match (AND).
- **Numbers match whole numbers only**: `500` finds `500 mg` but not `1500` or `5000`; a number is never a prefix of another number and never fuzzy.
- **Barcode** (8-14 digits, separators and Arabic digits accepted) and **product code** (case and digit-folded) are exact; a barcode-shaped number that matches nothing returns `[]` (never a name guess).
- **Ranking:** match scores add up; +6 when the phrase is inside a name, +3 when a name starts with it, +3 per number that is in the product's strength, +2 per number that is its pack size or box size (from `packaging`), inactive products last; ties by label then id. Deterministic.

## Measured on the real export (4378 rows, no live data)
`node --no-warnings tests/unit/catalog-search.check.mjs`: index build about 150 ms, **300 mixed queries (exact, two-word, typo, Arabic): p50 0.04 ms, p95 about 3-5 ms, max about 14 ms** (acceptance: local p95 <= 150 ms). Every Panadol row is found by `panadol` and by the typo `panadool`; every Arabic Gaviscon row by `جافيسكون`; every row with a gtin by its barcode; every result of `500` contains 500 as a whole number.

## NOT done / NOT tested
- **API p95 <= 500 ms** (needs a Worker route and the storage decision): NOT TESTED. The local numbers say nothing about network or D1.
- Arabic<->Latin transliteration (`بنادول` finds `PANADOL` only if the product carries both names), spell-suggestions, synonyms, learned ranking, UI, scanner hardware, a real tablet.
- The index is a snapshot: the caller must `refresh()` after catalog changes; no incremental update.
- Equivalent guards kept on purpose (numeric tokens are excluded from prefix and typo buckets in two places).
