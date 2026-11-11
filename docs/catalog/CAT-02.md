# CAT-02 — Units and conversions (module `worker/catalog/unit-conversion.js`)

Status: CODE_PUSHED on branch `claude/cat-02-unit-conversion`. Not accepted, not merged, not deployed, no live data touched. Pure module.

## Model
Base unit = smallest stocked thing. Levels: `unit` < `strip` < `box` < `carton`. A product's packaging is `{unitsPerStrip, stripsPerBox, unitsPerBox, boxesPerCarton}` (legacy `tabletsPerStrip`, `packsPerCarton` accepted); each must be a positive integer. Only levels that can be derived exist: no guessing. A single-unit pack (syrup bottle) must say `unitsPerBox: 1`.

## Rules (all return `{ok,value}` or `{ok:false,error}`)
- Unknown unit name -> `unit-unknown`. A level the product has no packaging for -> `unit-unavailable` (e.g. `box` with no definition). Bad number -> `quantity-invalid` / `price-invalid`. Inconsistent packaging -> `packaging-inconsistent`.
- `requireWhole` (always on for prices): half a tablet is `fractional-base-units`.
- Float noise removed (1e-9); round trip base -> unit -> base is exact for every level.
- Money: integer cents, BigInt, rounded once per line, half up. A price must be whole cents. `allocateLinePrices` splits one priced pack across several lines so the rounded lines add up to the rounded total (7 single strips of a 100 EGP box = 14.29 x4 + 14.28 x3 = 100.00).
- `splitBaseUnits(75)` -> 2 boxes + 1 strip + 5 units.

## Not in this task / open
- Linking packaging to a catalog product (the CAT-01 `packSize` field is a different, single number). Needs a `packaging` field on the product; follow-up.
- Persistence, inventory ledger (INV-01), and use in purchasing/POS screens.
- Price rounding between separate sales is not reconciled across time; only lines allocated together add up exactly.

## Run
`for f in tests/unit/unit-conversion*.check.mjs; do node --no-warnings $f; done`

## Review follow-up (Claude 2, PR #137)
- Numbers are strict decimals (same rule as CAT-01): hex (`0x1A`), exponents, signs, blanks and non-text are refused; Arabic-Indic digits and `٫` are accepted.
- Exact range: packaging fields are integers up to 1,000,000; one quantity or pack level is at most 1,000,000,000 base units; a price at most 10,000,000,000 EGP; one line at most 1,000,000,000,000 EGP. Beyond that the result is `out-of-range` instead of a silently rounded number.
- `linePrice` returns `warning: 'rounded-to-zero'` when a positive price on a positive quantity rounds to 0.00.
- Quantity 0 returns 0 (allowed for counts). Sale lines must reject 0 in the caller. Negative quantity is refused: returns are a movement type in INV-01, not a negative quantity here.
- Independent lines of one pack do not sum to the pack price (3 x one strip of a 100 EGP box = 99.99): POS/purchasing must call `allocateLinePrices` whenever it splits one priced pack across lines (integration test needed when wired).
- `fromBaseUnits` and `convertQuantity` return fractions for display only; stock must be whole base units (`requireWhole`).

