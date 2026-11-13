# Automatic gate deploys (staging backend)

Replaces manual Nova deploys for **GATE-14, GATE-15, GATE-16**. **GATE-17** (live store pilot + production enablement) is never automatic: it stays `owner_gate` until Ahmed runs it.

## Flow

1. `.nova/cloud_scheduler.py` (`gate_deploys`) sees an auto gate with status `owner_gate` whose `after` tasks are all `done`/`done_noop`.
2. It dispatches `deploy-backend-staging.yml` on `main` with `gate_id=<GATE>`, `dry_run=false`, `confirm=DEPLOY nova-rx-api-staging`, and sets the gate to `deploying`. One gate deploy at a time.
3. The workflow:
   - refuses anything except GATE-14/15/16 and any ref other than `main`;
   - runs all `tests/unit/backend-*.check.mjs`, the migration linter, the stale-artifact guard and the additive-only SQL guard (any failure aborts);
   - runs `scripts/d1-backup.sh` (Time Travel bookmark + encrypted export, uploaded as artifact `d1-predeploy-nova-rx-staging-<run id>`, 30 days);
   - `.github/scripts/deploy_backend_staging.sh`: records the bookmark and current Worker version id, applies only migrations missing from `schema_migrations`, `wrangler deploy --env staging` (Worker `nova-rx-api-staging` only), sets Worker secrets by name, smokes `/api/v1/health` and `/api/v1/version` with retries;
   - on failure after upload: `wrangler rollback <previous version id>` (fallback: re-upload the downloaded previous script), and **only if this run applied migrations** a D1 Time Travel restore of `nova-rx-staging` to the pre-migrate bookmark;
   - `mark-gate` job writes `done` or `failed` plus `deploy: {sha, version_id, previous_version_id, bookmark, migrated, run_url, at}` into `.nova/cloud-queue.json` on `main`.
4. If the queue write is lost, the scheduler reconciles a gate stuck in `deploying` for 45 minutes from the run's conclusion.

Feature flags stay OFF. `nova-rx-preview` (live frontend) is never touched.

## Permissions

`CLOUDFLARE_API_TOKEN` needs Workers Scripts Edit (deploy/rollback), Account.D1:Read (bookmark, export) and Account.D1:Edit (migrations, Time Travel restore). In gate mode a missing D1 permission fails the run before any upload and names the permission.

## Manual use

Actions → Deploy backend staging → Run workflow. Leave `gate_id` empty; dry run first, then `confirm=DEPLOY nova-rx-api-staging`.
