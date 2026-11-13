# NEEDS-OWNER — items only the owner can provide or approve

Nothing here is done by an agent. Flags for these stay OFF until the owner acts. Record progress in Issue #87.

NEEDS-OWNER: Cloudflare account + D1 database, KV namespace and R2 bucket creation (real ids replace the placeholders in backend/wrangler.toml)
NEEDS-OWNER: CLOUDFLARE_API_TOKEN (deploy token, GitHub/Worker secret set by owner)
NEEDS-OWNER: approval of the storage product (ADR-001) and any move to a paid Workers plan
NEEDS-OWNER: NOVA_API_PIN (legacy owner bootstrap value)
NEEDS-OWNER: NOVA_INGEST_SECRET (signed ingest / webhooks)
NEEDS-OWNER: KIMI_MODEL_API_KEY (optional AI, paid; flag stays OFF)
NEEDS-OWNER: AUMET_* / PO_* supplier connector credentials (server-side only; real cart/order writes need specific approval)
NEEDS-OWNER: production deploy and production migration apply
NEEDS-OWNER: unlocking any unknown (fail-closed) supplier operation, via the reconciliation design only
NEEDS-OWNER: NOVA_API_PIN is the one-time owner bootstrap password (NOVA_AUTH flag stays OFF until set; owner must change it after first login)
NEEDS-OWNER: NOVA_STATUS_TOKEN (bearer secret for GET /api/v1/status; set as Worker secret by owner; NOVA_OBSERVABILITY flag stays OFF)
NEEDS-OWNER: enable R2 + create backup bucket and cron trigger (wrangler [triggers] crons) before setting NOVA_BACKUP=1
