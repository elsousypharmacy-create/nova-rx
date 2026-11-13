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

## Data rollback (D1 Time Travel)
Worker code rollback (above) does not undo a bad migration's data. Migrations are additive and are not rolled back with DROP/TRUNCATE/DELETE.
- Before each migrate/deploy, record `wrangler d1 time-travel info <db> --json` (the staging deploy script does this).
- Owner-approved in-place restore: `wrangler d1 time-travel restore <db> --bookmark=...` (staging first). This overwrites the database. See `docs/backend/BACKUP-RESTORE.md`.
- Off-platform copy: decrypt the latest GitHub Actions artifact into a **new** database only, never in place.
R2 is not used.
