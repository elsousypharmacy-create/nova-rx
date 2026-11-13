# Performance budget — sync / sale endpoints (N127)

Measured by `node tools/backend/load-sim.mjs` (no network): the Worker `handle`
runs in-process over a `node:sqlite` D1 emulation. This checks handler CPU/logic
cost only, not Cloudflare edge or network latency.

| Endpoint | Load shape | p95 budget | Errors |
|---|---|---|---|
| `POST /api/v1/sync/push` | 20 ops per request | 150 ms | 0 |
| `GET /api/v1/sync/pull` | one page | 100 ms | 0 |

The budgets are deliberately loose so shared CI runners don't cause flakes. A
regression of an order of magnitude (for example an N+1 query per op) will still
fail `tests/unit/backend-load-budget.check.mjs`.
