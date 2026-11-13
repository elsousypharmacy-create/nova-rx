# Backend rollback and deploy record (N108)

Deploys and rollbacks are **owner-approved** actions. Nothing here deploys automatically.

## Record
- Source of truth in git: `docs/backend/releases.json` (`live` + `history`, oldest to newest).
- Runtime mirror: table `deploy_records` (migration `0008`), read through `GET /api/v1/deploys?env=&limit=`
  (flag `NOVA_DEPLOYS=1`, default OFF; needs auth, DB and KV bindings; returns `previousGood`).
- A history entry that must never be a rollback target is marked `"bad": true` or `status` `failed`/`rolled_back`.

## Before a deploy
`node tools/backend/stale-artifact-guard.mjs <version>` refuses a version older than live.

## Find the rollback target
`node tools/backend/previous-good-version.mjs` prints `<version> <sha>` of the newest earlier, non-bad entry
for the same env, or exits 1 (`NONE`) when there is none (e.g. first deploy).

## Rolling back (owner approval required)
1. Compute the target as above; if `NONE`, stop (the frontend runs local/offline, so the app is unaffected).
2. Owner redeploys that sha (or uses the Cloudflare Workers versions rollback for `cf_version_id`).
3. Migrations are additive only and are NOT rolled back; the older Worker must tolerate newer schema.
4. Record the rollback in `releases.json` in a reviewed PR (mark the bad entry, update `live`).
Rollback is the one case where deploying an older version is intended; the stale-artifact guard is skipped for it.
