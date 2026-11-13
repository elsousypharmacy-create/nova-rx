# D1 backup and restore runbook

Operational backups do **not** use Cloudflare R2 (enabling R2 requires a billing profile / payment card; the owner declined on 2026-11-13, Asia/Riyadh). Two free mechanisms cover rollback and off-platform copies.

This document is for owner/Nova operations. Cloud Claude tasks must not deploy, must not run Time Travel restore, and must not print secret values.

## 1. D1 Time Travel (point-in-time, 30 days)

Built into D1. Any minute in the last 30 days can be restored. Bookmarks older than 30 days are invalid.

Record the current bookmark (read-only):

```bash
cd backend
npx wrangler@4 d1 time-travel info nova-rx-staging --json
# optional: bookmark at a past timestamp
npx wrangler@4 d1 time-travel info nova-rx-staging --timestamp="2026-11-13T00:00:00Z" --json
```

The JSON includes a `bookmark` field. Save it in the deploy log / step summary (the bookmark is not a secret).

### Pre-deploy / pre-migration (required)

Before applying migrations to staging or production, record a bookmark. The staging deploy script (`.github/scripts/deploy_backend_staging.sh`) does this automatically. Rollback of **data** after a bad migration is a Time Travel restore to that bookmark, not a schema DOWN migration (migrations stay additive; no DROP / TRUNCATE / DELETE FROM).

### Restore to a bookmark (owner-approved only)

Time Travel restore **overwrites the database in place**, cancels in-flight queries, and is destructive. Never run it from CI. Never point it at production without an explicit owner approval naming the database and bookmark. Prefer staging first.

```bash
# 1. Record the *current* bookmark first, so the restore itself can be undone.
npx wrangler@4 d1 time-travel info nova-rx-staging --json

# 2. Restore (interactive confirm). Use exactly one of --bookmark or --timestamp.
npx wrangler@4 d1 time-travel restore nova-rx-staging --bookmark=BOOKMARK_FROM_STEP_1_OR_PRE_DEPLOY

# 3. The command prints a "previous bookmark" after a successful restore.
#    Save it. To undo the restore:
# npx wrangler@4 d1 time-travel restore nova-rx-staging --bookmark=PREVIOUS_BOOKMARK_RETURNED
```

Do not pass a skip-confirmation flag. If wrangler asks `OK to proceed (y/N)`, stop unless the owner has approved this exact database and bookmark.

## 2. Daily encrypted GitHub Actions export (30-day artifact)

Workflow: `.github/workflows/d1-backup-staging.yml` (nightly at 01:00 UTC / 04:00 Asia/Riyadh, and `workflow_dispatch`).

It runs:

```bash
npx wrangler@4 d1 export nova-rx-staging --remote --output=dump.sql --skip-confirmation
```

then `gzip` + `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt` with the existing GitHub / Worker secret **`NOVA_INGEST_SECRET`** as the passphrase (name only; never print the value). Only the ciphertext (`.sql.gz.enc`) and a metadata JSON (bookmark, sha256, sizes, timestamp — no SQL) are uploaded. Artifact retention is 30 days.

`--skip-confirmation` is required in CI because a remote export can make D1 briefly unavailable; the schedule is set for late night Asia/Riyadh.

### Why the dump is encrypted

The repo is temporarily public. GitHub Actions artifacts on a public repository can be downloaded by anyone with read access (any logged-in GitHub user) and by some third-party mirrors. Treat artifacts as world-readable. Plaintext SQL must never be uploaded.

`NOVA_INGEST_SECRET` is also the ingest/webhook HMAC key (see `SECRETS-MAP.md`). Dual use is a deliberate choice so no new secret is created. When the repo returns to private, keep encrypting.

### Decrypt and restore into a NEW database only

Never import a dump into `nova-rx-staging` or `nova-rx-production` in place. Create a throwaway D1 (owner) or use a local SQLite file.

```bash
# Download the artifact from the workflow run (Actions tab), then:
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:NOVA_INGEST_SECRET \
  -in nova-rx-staging-YYYYMMDDTHHMMSSZ.sql.gz.enc | gunzip > dump.sql

# Verify it looks like SQL, then import into a NEW empty database:
#   npx wrangler@4 d1 execute nova-rx-restore-drill --remote --file=dump.sql
# or locally:
#   sqlite3 /tmp/restore-drill.sqlite < dump.sql

# Confirm sha256 of the ciphertext against metadata.json, then compare row counts.
# Delete the throwaway database and the plaintext dump when finished.
```

The local snapshot drill `node tools/backend/restore-drill.mjs` still applies to N106/N107 JSON snapshots (in-process, no network). It is not the GitHub artifact path.

## 3. Token permissions

The workflow and the deploy bookmark step use existing secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. They are not rotated here.

| Action | Minimum Cloudflare token permission |
|---|---|
| `d1 time-travel info`, `d1 export` | Account · D1 · **Read** |
| `d1 time-travel restore`, `d1 execute` / migrations | Account · D1 · **Edit** |

If a command fails with Cloudflare error 7403, 9106, or 10000, the token is missing the permission in the table. Report the name; do not change or roll the token.

## 4. What this does not cover

- Large private files (prescription images). R2 is unavailable; N117 must use a size-capped D1/local blob until a card-free object store exists.
- Worker code rollback (that is still the previous Worker version — see `ROLLBACK.md`).
- Retention of financial data in D1 itself (see `RETENTION.md`). Artifacts and Time Travel only cover 30 days.
