#!/usr/bin/env bash
# Encrypted export of a D1 database (free path; no R2).
#   BACKUP_PASSPHRASE=... scripts/d1-backup.sh [db-name]   (default nova-rx-staging)
# Writes to $BACKUP_OUTDIR (default ./artifacts/d1-backup):
#   <db>-<stamp>.sql.gz.enc   gzip + openssl AES-256-CBC, PBKDF2 200000 iters, salted
#   manifest.json             sha256 of ciphertext + plaintext, sizes, per-table INSERT counts,
#                             Time Travel bookmark. No SQL, no secrets.
# Plaintext SQL is deleted before exit (repo is public; only ciphertext may be uploaded).
# Exit 2 = token lacks a Cloudflare permission (name printed). WRANGLER overrides the CLI.
set -euo pipefail
set +x
DB="${1:-${DB_NAME:-nova-rx-staging}}"
WRANGLER="${WRANGLER:-npx --yes wrangler@4}"
ITER=200000
HERE="$(cd "$(dirname "$0")" && pwd)"
OUTDIR="${BACKUP_OUTDIR:-$PWD/artifacts/d1-backup}"
export WRANGLER_SEND_METRICS=false

say(){ echo "$*"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$*" >> "$GITHUB_STEP_SUMMARY" || true; }
die(){ say "FAILED: $2"; exit "$1"; }
scrub(){ sed -E 's#https?://[^[:space:]"]+#[redacted-url]#g;s/(Bearer|token|secret|pass(word|phrase)?)[=: ]+[^[:space:]"]+/\1=[redacted]/gi'; }

[ -n "${BACKUP_PASSPHRASE:-}" ] || die 1 "MISSING SECRET: BACKUP_PASSPHRASE (or NOVA_INGEST_SECRET in CI)"
[ "${#BACKUP_PASSPHRASE}" -ge 16 ] || die 1 "backup passphrase must be at least 16 characters"
export BACKUP_PASSPHRASE

mkdir -p "$OUTDIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PLAIN="$(mktemp "${TMPDIR:-/tmp}/d1-export.XXXXXX.sql")"
LOG="$(mktemp)"
CIPHER="$OUTDIR/$DB-$STAMP.sql.gz.enc"
MANIFEST="$OUTDIR/manifest.json"
cleanup(){ [ -f "$PLAIN" ] && { shred -u "$PLAIN" 2>/dev/null || rm -f "$PLAIN"; }; rm -f "$LOG"; }
trap cleanup EXIT

BMJSON="$("$HERE/d1-bookmark.sh" "$DB" || true)"
BOOKMARK="$(printf '%s' "$BMJSON" | jq -r '.bookmark // "unrecorded"' 2>/dev/null || echo unrecorded)"
say "Time Travel bookmark: $BOOKMARK"

set +e
$WRANGLER d1 export "$DB" --remote --output="$PLAIN" --skip-confirmation >"$LOG" 2>&1
rc=$?
set -e
if [ "$rc" != 0 ]; then
  scrub < "$LOG" | tail -20 || true
  if grep -Eqi '7403|9106|"code": ?10000|not authorized|Authentication error' "$LOG"; then
    die 2 "missing Cloudflare token permission: Account.D1:Read (d1 export). Token not changed."
  fi
  die 1 "wrangler d1 export failed"
fi
[ -s "$PLAIN" ] || die 1 "export produced an empty SQL file"

PLAIN_SHA="$(sha256sum "$PLAIN" | cut -d' ' -f1)"
PLAIN_BYTES="$(wc -c < "$PLAIN")"
# Row estimate per table from INSERT statements (wrangler emits one INSERT per row).
COUNTS="$({ grep -Eo '^INSERT INTO [`"]?[A-Za-z0-9_]+' "$PLAIN" || true; } | sed -E 's/^INSERT INTO [`"]?//' | sort | uniq -c \
  | awk 'BEGIN{printf "{"} {printf "%s\"%s\":%d", (NR>1?",":""), $2, $1} END{printf "}"}')"
TABLES="$({ grep -Eio '^CREATE TABLE (IF NOT EXISTS )?[`"]?[A-Za-z0-9_]+' "$PLAIN" || true; } | wc -l)"

gzip -c "$PLAIN" | openssl enc -aes-256-cbc -pbkdf2 -iter "$ITER" -salt -pass env:BACKUP_PASSPHRASE -out "$CIPHER"
cleanup; unset BACKUP_PASSPHRASE
[ -s "$CIPHER" ] || die 1 "encryption produced an empty file"

jq -n --arg db "$DB" --arg stamp "$STAMP" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg bookmark "$BOOKMARK" --arg file "$(basename "$CIPHER")" \
  --arg sha "$(sha256sum "$CIPHER" | cut -d' ' -f1)" --argjson bytes "$(wc -c < "$CIPHER")" \
  --arg psha "$PLAIN_SHA" --argjson pbytes "$PLAIN_BYTES" --argjson rows "$COUNTS" --argjson tables "$TABLES" \
  --argjson iter "$ITER" --arg git "${GITHUB_SHA:-unknown}" \
  '{version:1,db:$db,stamp:$stamp,exported_at:$at,bookmark:$bookmark,
    file:$file,cipher:"aes-256-cbc+pbkdf2",iter:$iter,gzip:true,
    sha256:$sha,bytes:$bytes,plaintext_sha256:$psha,plaintext_bytes:$pbytes,
    tables:$tables,rows:$rows,git_sha:$git}' > "$MANIFEST"

say "encrypted backup $(basename "$CIPHER") bytes=$(jq .bytes "$MANIFEST") sha256=$(jq -r .sha256 "$MANIFEST") tables=$TABLES"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  { echo "file=$CIPHER"; echo "manifest=$MANIFEST"; echo "bookmark=$BOOKMARK"; } >> "$GITHUB_OUTPUT"
fi
