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
NEEDS-OWNER: NOVA_INGEST_SECRET must be set before NOVA_INTEGRATION=1 (flag stays OFF); integration keys are created by the owner via createApiKey (N111)
NEEDS-OWNER: WA_TOKEN, WA_PHONE_ID, WA_APP_SECRET, WA_VERIFY_TOKEN (Meta WhatsApp Cloud API; number migration pending; NOVA_WA_INTAKE flag stays OFF)
NEEDS-OWNER: ZATCA e-invoice onboarding (CSID / compliance certificates) + legal/tax review of SA 15% and EG 14% VAT rules (N113; NOVA_ZATCA_EINVOICE and NOVA_COUNTRY_ADAPTERS flags stay OFF)
NEEDS-OWNER: PHARMACY_BACKEND_URL + PHARMACY_BRIDGE_TOKEN (legacy Sheets/Apps Script backend URL and read-only bridge token, Worker secrets set by owner; NOVA_BRIDGE flag stays OFF)
NEEDS-OWNER: NOVA_RX_BLOB_KEY (base64 32-byte AES key Worker secret for prescription attachments in D1; NOVA_RX_ORDER flag stays OFF) and Gemini API key for prescription extraction (PAID; NOVA_RX_EXTRACT_GEMINI stays OFF, no real adapter wired; Kimi retired)
NEEDS-OWNER: messaging adapters must write msg:token_expires_at / msg:session_expires_at / msg:webhook_expires_at to KV (Meta/WhatsApp account + tokens set by owner); NOVA_MSG_MONITOR flag stays OFF (reuses NOVA_STATUS_TOKEN)
NEEDS-OWNER: WhatsApp/Telegram provider account + webhook secret (real delivery status source for the unified inbox; NOVA_INBOX flag stays OFF, status only from mock source)
NEEDS-OWNER: Hik-Connect/camera report ingestion source (writes camera_reports/camera_source_status; this Worker is read-only; NOVA_CAMERAS flag stays OFF)
NEEDS-OWNER: existing order-system endpoint/credentials for the delivery adapter (OPS-03 uses a mock adapter; NOVA_DELIVERY flag stays OFF)
NEEDS-OWNER: none for N121 (NOVA_ONBOARDING flag stays OFF; owner approval needed before enabling tenant creation in production, and a real session-to-tenant mapping for multi-tenant auth)
NEEDS-OWNER: payment provider account + API key for billing (N122 SAAS-02 uses a mock billing adapter only; NOVA_ENTITLEMENTS flag stays OFF)
