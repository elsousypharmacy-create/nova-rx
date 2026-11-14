# Suppliers status (UX201)

Inventory of suppliers known to the system (worker/procurement/provider/hub.js `SUPPLIERS`, connectors in worker/procurement/connectors):

| Supplier | Connector | Credential secret names | Live check result |
|---|---|---|---|
| Aumet (`aumet`) | worker/procurement/connectors/aumet.js | AUMET_USERNAME, AUMET_PASSWORD | NOT RUN in this cloud session (no network/secrets). Runs in `tools/suppliers/supplier-health.workflow.yml` (must be copied to .github/workflows by a maintainer; the bot token lacks the `workflows` permission) every 30 min. |
| PharmaOverseas (`pharmaoverseas`) | worker/procurement/connectors/pharmaoverseas.js | PHARMAOVERSEAS_USERNAME, PHARMAOVERSEAS_PASSWORD | NOT RUN here; same workflow. |
| fixture | connectors/fixture.js (test-only, not a real supplier) | none | n/a |

No other suppliers exist in config/connectors; any other supplier has no connector and cannot be connected until one is written.

Missing credentials: none can be confirmed from here (secret values are not readable). The health check reports `missing_credential` when the worker has no saved session for a supplier, and `NOVA_API_PIN` / `NOVA_WORKER_URL` are required by the workflow.

Check is read-only: GET /api/suppliers/status + one search probe. No carts, orders or POs.
