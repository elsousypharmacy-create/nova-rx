# UX-04 load baseline (N81)
Fixture: `tools/load/load-fixture.mjs` (deterministic generator; 10 branches × 3 cashiers, 100k items, 1M movements). Run: `node tools/load/run-load.mjs`.
Measured on a GitHub-hosted Linux runner, Node, single run (ms; error rate 0 everywhere):

| Operation | cold p50 | warm p50 | warm p95 |
|---|---|---|---|
| Catalog search (CAT-05 index, 200 queries) | 6.1 | 2.9 | 17.0 |
| Balances scan over 1M movements | 249.7 | 189.1 | 191.0 |
| Per-item on-hand scan over 1M movements | – | 14.4 | 16.2 |

One-off: catalog build 831 ms, search index build ~1.6 s (100k items).

Profile findings (no optimization applied — measure first): search is already within instant-search budget. The cost centres are full-ledger scans (O(n) per balance/on-hand) and `stock-ledger.js` `append`, which re-parses/re-serializes the whole array and scans for duplicates (O(n) per write, O(n²) to load 1M). Candidate follow-ups: cached per-code balance map, duplicate-key Set. Not done here; needs its own task and tests. Not measured: browser rendering/RTL paint, localStorage quota at 1M rows.
