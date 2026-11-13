# D1 backup and restore runbook

Operational backups do **not** use Cloudflare R2 (enabling R2 requires a billing profile / payment card; the owner declined on 2026-11-13, Asia/Riyadh). Two free mechanisms cover rollback and off-platform copies.

This document is for owner/Nova operations. Cloud Claude tasks must not deploy, must not run Time Travel restore, and must not print secret values.

## 1. D1 Time Travel (point-in-time, 30 days)

Built into D1. Any minute in the last 30 days can be restored. Bookmarks older than 30 days are invalid.

Record the current bookmark (read-only). The helper prints one JSON line and exits 2 if the token lacks `Account.D1:Read`:

```bash
scripts/d1-bookmark.sh nova-rx-staging
# {"ok":true,"db":"nova-rx-staging","bookmark":"0000…","recorded_at":"…"}
# raw wrangler equivalent:
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

Workflow: `.github/workflows/d1-backup.yml` (nightly at 01:00 UTC / 04:00 Asia/Riyadh, and `workflow_dispatch`).

It runs `scripts/d1-backup.sh nova-rx-staging`, which:

1. records a Time Travel bookmark (`scripts/d1-bookmark.sh`),
2. `npx wrangler@4 d1 export nova-rx-staging --remote --output=<tmp>.sql --skip-confirmation`,
3. `gzip` + `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE`,
4. writes `manifest.json` (sha256 of the ciphertext and of the plaintext, sizes, per-table INSERT counts, bookmark, git sha — no SQL),
5. shreds the plaintext.

Passphrase: GitHub secret **`BACKUP_PASSPHRASE`** if it exists, otherwise the existing **`NOVA_INGEST_SECRET`** (names only; never print values). Only `*.sql.gz.enc` + `manifest.json` are uploaded, artifact name `d1-backup-nova-rx-staging-<run id>`, retention 30 days. The staging deploy workflow runs the same script before migrations.

Run on demand: Actions → **D1 backup** → Run workflow (or `gh workflow run d1-backup.yml`).

`--skip-confirmation` is required in CI because a remote export can make D1 briefly unavailable; the schedule is set for late night Asia/Riyadh.

### Why the dump is encrypted

The repo is temporarily public. GitHub Actions artifacts on a public repository can be downloaded by anyone with read access (any logged-in GitHub user) and by some third-party mirrors. Treat artifacts as world-readable. Plaintext SQL must never be uploaded.

When `BACKUP_PASSPHRASE` is not set, `NOVA_INGEST_SECRET` (also the ingest/webhook HMAC key) is used (see `SECRETS-MAP.md`). Dual use is a deliberate choice so no new secret is created. When the repo returns to private, keep encrypting.

### Decrypt and restore into a NEW database only

Never import a dump into `nova-rx-staging` or `nova-rx-production` in place. Create a throwaway D1 (owner) or use a local SQLite file.

```bash
# Download the artifact from the workflow run (Actions tab), then:
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE \
  -in nova-rx-staging-YYYYMMDDTHHMMSSZ.sql.gz.enc | gunzip > dump.sql

# Verify it looks like SQL, then import into a NEW empty database:
#   npx wrangler@4 d1 execute nova-rx-restore-drill --remote --file=dump.sql
# or locally:
#   sqlite3 /tmp/restore-drill.sqlite < dump.sql

# Confirm sha256 of the ciphertext against manifest.json (sha256sum file.enc), and of dump.sql against plaintext_sha256, then compare row counts.
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

## 5. Tests

`tests/unit/backend-d1-backup.check.mjs` runs both scripts against a mocked wrangler (no network): bookmark parsing (JSON + text), permission errors (exit 2, names `Account.D1:Read`), manifest sha256/row counts, encrypt → decrypt round-trip, wrong passphrase fails, no plaintext or signed URLs left behind.

## 6. Worker R2 snapshot code (N106)

`backend/src/backup.js` still contains an R2 snapshot adapter behind flag `NOVA_BACKUP` (default OFF). No R2 binding exists in `wrangler.toml`, so it is a no-op (`skipped: 'no-bindings'`). Do not enable it; operational backups are sections 1–2.
