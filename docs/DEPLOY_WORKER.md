# Deploying the NOVA Rx Worker (guarded, one button)

Workflow: `.github/workflows/deploy-worker.yml`, script: `.github/scripts/deploy_worker.sh`.
It deploys ONE file from `worker/live/` to the Worker `nova-rx-preview` and keeps its bindings (`GEMINI_API_KEY`, `NOVA_SECRET_ENCRYPTION_KEY`, `NOVA_SECRETS_KV`). Never deploy this repo's `index.html` by hand: the live HTML is an older lineage with live-only parts.

## One-time setup (owner)
1. Merge the pull request that adds this workflow (a workflow can only be started once it is on `main`).
2. Cloudflare: My Profile > API Tokens > Create Token > template **Edit Cloudflare Workers** > your account > Create. Copy the token.
3. GitHub: repo `nova-rx` > Settings > Secrets and variables > Actions > New repository secret: name `CLOUDFLARE_API_TOKEN`, value = the token. (Optional: `CLOUDFLARE_ACCOUNT_ID` if the token sees more than one account.)

## Each deploy
1. Actions > **Deploy NOVA Worker** > Run workflow. Leave the defaults (they point at the current build and its sha256 from issue #36) and keep `dry_run` = true. The run must end green: it checked the file's sha256, that the live Worker was not changed since the baseline, the bindings, and made a backup of the live code. Nothing is uploaded.
2. Run it again with `dry_run` = false and `confirm` = `DEPLOY nova-rx-preview`.
3. The log ends with `DEPLOYED ...`. If any check fails after the upload, the script puts the backup back and the run is red (`ROLLED BACK`). Manual rollback is always possible: Cloudflare > Workers > nova-rx-preview > Deployments > version `33fe0516-2931-40cb-93a4-808e3c4f7724`.
4. Afterwards: open `/#sale` on a phone, then write the result in issue #36.

## What it refuses
Any Worker other than `nova-rx-preview`; a file outside `worker/live/`; a wrong sha256; a live Worker modified after `expected_modified_on`; a real run without the typed confirmation; a re-run of the same run. It uses one secret and does not run AI or third-party code.

## Tests
`bash tests/deploy-worker/run.sh` runs the script against a fake Cloudflare API (dry run, refusals, real deploy, failed upload, lost bindings, truncated code with rollback). The real Cloudflare API has not been called by this test: do the dry run first.
