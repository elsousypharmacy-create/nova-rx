# NEEDS-OWNER — items only the owner can provide or approve

Nothing here is done by an agent. Flags for these stay OFF until the owner acts. Record progress in Issue #87.

NEEDS-OWNER: Cloudflare account + D1 database and KV namespace (real ids replace the placeholders in backend/wrangler.toml). R2 is not used (card required; owner declined 2026-11-13).
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
NEEDS-OWNER: D1 Time Travel bookmark + encrypted GitHub artifact backups are the operational path (docs/ops/backup-restore.md). Do not enable R2 or set NOVA_BACKUP=1. If CLOUDFLARE_API_TOKEN lacks Account · D1 · Read (export / time-travel info) or Edit (restore / future migration apply), the owner adds that permission to the existing token — do not roll the token.
NEEDS-OWNER: PHARMACY_BACKEND_URL + PHARMACY_BRIDGE_TOKEN (legacy Sheets/Apps Script backend URL and read-only bridge token, Worker secrets set by owner; NOVA_BRIDGE flag stays OFF)
NEEDS-OWNER: NOVA_RX_BLOB_KEY (base64 32-byte AES key Worker secret for prescription attachments in D1; NOVA_RX_ORDER flag stays OFF) and Gemini API key for prescription extraction (PAID; NOVA_RX_EXTRACT_GEMINI stays OFF, no real adapter wired; Kimi retired)
