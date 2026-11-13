#!/usr/bin/env bash
# Daily (or dispatched) encrypted export of D1 nova-rx-staging.
# Uploads only ciphertext + metadata. Never prints secret values.
# See docs/backend/BACKUP-RESTORE.md.
set -euo pipefail
set +x

OPENSSL_ITER=200000
DB_NAME="nova-rx-staging"
DB_ID="6e128d17-749e-4e44-9dee-1bf125486f4b"
ACC="${CLOUDFLARE_ACCOUNT_ID:-7140d9b8f71fb0854b43e50172a7146c}"

die() { echo "FAILED: $*" >&2; exit 1; }
say() { echo "$*"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$*" >> "$GITHUB_STEP_SUMMARY" || true; }

scrub() {
  # Drop signed URLs and anything that looks like a token/passphrase.
  sed -E 's/https?:\/\/[^[:space:]]+/[redacted-url]/g;s/(Bearer|TOKEN|secret|pass(word|phrase)?)[=: ]+[^[:space:]]+/\1=[redacted]/gi'
}

: "${CLOUDFLARE_API_TOKEN:?missing CLOUDFLARE_API_TOKEN}"
: "${NOVA_INGEST_SECRET:?missing NOVA_INGEST_SECRET}"
[ "${#NOVA_INGEST_SECRET}" -ge 16 ] || die "NOVA_INGEST_SECRET must be at least 16 characters"
export CLOUDFLARE_API_TOKEN
export CLOUDFLARE_ACCOUNT_ID="$ACC"
export WRANGLER_SEND_METRICS=false
# openssl reads the passphrase from this env name; never pass it on the command line.
export BACKUP_PASSPHRASE="$NOVA_INGEST_SECRET"
unset NOVA_INGEST_SECRET

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTDIR="${BACKUP_OUTDIR:-$ROOT/artifacts/d1-backup}"
mkdir -p "$OUTDIR"
PLAIN="$OUTDIR/nova-rx-staging-$STAMP.sql"
CIPHER="$OUTDIR/nova-rx-staging-$STAMP.sql.gz.enc"
META="$OUTDIR/metadata.json"
LOG="$OUTDIR/wrangler.log"

cleanup_plaintext() {
  if [ -f "$PLAIN" ]; then
    shred -u "$PLAIN" 2>/dev/null || rm -f "$PLAIN"
  fi
}
trap cleanup_plaintext EXIT

say "D1 encrypted backup starting: db=$DB_NAME stamp=$STAMP sha=${GITHUB_SHA:-unknown}"

BOOKMARK="unrecorded"
set +e
(cd "$ROOT/backend" && npx --yes wrangler@4 d1 time-travel info "$DB_NAME" --json > "$OUTDIR/tt.json" 2>"$OUTDIR/tt.err")
tt_rc=$?
set -e
if [ "$tt_rc" = 0 ] && [ -s "$OUTDIR/tt.json" ]; then
  BOOKMARK="$(jq -r '.bookmark // empty' "$OUTDIR/tt.json")"
  [ -n "$BOOKMARK" ] || BOOKMARK="unrecorded"
  say "Time Travel bookmark: $BOOKMARK"
else
  if grep -Eq '7403|9106|"code":10000|not authorized|Authentication error' "$OUTDIR/tt.err" 2>/dev/null; then
    say "WARNING: CLOUDFLARE_API_TOKEN lacks Account.D1:Read (needed for time-travel info / export). Do not roll the token here."
  fi
  if [ -s "$OUTDIR/tt.err" ]; then
    say "time-travel info failed (scrubbed):"
    scrub < "$OUTDIR/tt.err" || true
  fi
fi

set +e
(cd "$ROOT/backend" && npx --yes wrangler@4 d1 export "$DB_NAME" --remote --output="$PLAIN" --skip-confirmation > "$LOG" 2>&1)
ex_rc=$?
set -e
if [ "$ex_rc" != 0 ]; then
  say "wrangler d1 export failed (scrubbed):"
  [ -s "$LOG" ] && scrub < "$LOG" || true
  if grep -Eq '7403|9106|"code":10000|not authorized|Authentication error' "$LOG" 2>/dev/null; then
    die "CLOUDFLARE_API_TOKEN lacks Account.D1:Read (or Edit). Export permission name: Account.D1:Read. Do not roll the token here."
  fi
  die "wrangler d1 export failed (see scrubbed log above)"
fi
# Show only scrubbed wrangler output (signed download URLs must not leak).
say "wrangler d1 export finished (urls redacted):"
scrub < "$LOG" || true

[ -s "$PLAIN" ] || die "export produced an empty SQL file"
PLAIN_BYTES="$(wc -c < "$PLAIN")"

gzip -c "$PLAIN" | openssl enc -aes-256-cbc -pbkdf2 -iter "$OPENSSL_ITER" -salt -pass env:BACKUP_PASSPHRASE -out "$CIPHER"
cleanup_plaintext
unset BACKUP_PASSPHRASE

[ -s "$CIPHER" ] || die "encryption produced an empty file"
SHA="$(sha256sum "$CIPHER" | awk '{print $1}')"
CIPHER_BYTES="$(wc -c < "$CIPHER")"

jq -n \
  --arg db "$DB_NAME" \
  --arg db_id "$DB_ID" \
  --arg account_id "$ACC" \
  --arg exported_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg stamp "$STAMP" \
  --arg bookmark "$BOOKMARK" \
  --arg cipher "aes-256-cbc-pbkdf2" \
  --argjson iter "$OPENSSL_ITER" \
  --arg gzip "true" \
  --arg sha256 "$SHA" \
  --argjson plaintext_bytes "$PLAIN_BYTES" \
  --argjson ciphertext_bytes "$CIPHER_BYTES" \
  --arg git_sha "${GITHUB_SHA:-unknown}" \
  '{
    db:$db, database_id:$db_id, account_id:$account_id,
    exported_at:$exported_at, stamp:$stamp, bookmark:$bookmark,
    cipher:$cipher, iter:$iter, gzip:($gzip=="true"),
    sha256:$sha256, plaintext_bytes:$plaintext_bytes, ciphertext_bytes:$ciphertext_bytes,
    git_sha:$git_sha, artifact:"'"$(basename "$CIPHER")"'"
  }' > "$META"

say "encrypted artifact $(basename "$CIPHER") bytes=$CIPHER_BYTES sha256=$SHA plaintext_bytes=$PLAIN_BYTES bookmark=$BOOKMARK"
say "Decrypt: openssl enc -d -aes-256-cbc -pbkdf2 -iter $OPENSSL_ITER -pass env:NOVA_INGEST_SECRET -in $(basename "$CIPHER") | gunzip > dump.sql"
say "Restore only into a NEW database. See docs/backend/BACKUP-RESTORE.md."
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "artifact_dir=$OUTDIR" >> "$GITHUB_OUTPUT"
  echo "cipher_name=$(basename "$CIPHER")" >> "$GITHUB_OUTPUT"
fi
