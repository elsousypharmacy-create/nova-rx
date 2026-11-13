# Local data export / import (N105)
Flag `NOVA_IMPORT` (default OFF → 404 `IMPORT_DISABLED`). Frontend `data-export.js` builds the bundle `{format:'nova-rx-export',version:1,master:{entity:[{id,..}]},ledger:{...}}` locally (no network).
- `POST /api/v1/import/dry-run` — owner session; returns per-entity new/identical/different report; never writes.
- `POST /api/v1/import` — owner + fresh re-auth + `confirm:"IMPORT"`; only into a tenant with no sync_master/sync_ledger rows (409 `IMPORT_TENANT_NOT_EMPTY`). Audited.
