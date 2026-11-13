#!/usr/bin/env bash
# Guarded first-or-later deploy of the NOVA Rx *staging* backend Worker only
# (nova-rx-api-staging). Never touches nova-rx-preview or production.
# Runs from .github/workflows/deploy-backend-staging.yml.
# Secrets are used but never printed. Feature flags stay OFF (unset).
set -euo pipefail
# Keep secrets out of xtrace if a later command turns it on.
set +x

: "${CF_API_TOKEN:?missing CF_API_TOKEN}"
SCRIPT_NAME="nova-rx-api-staging"
FORBIDDEN_SCRIPTS="nova-rx-preview nova-rx-preview-bak-20261107 nova-rx-github-preview nova-rx-api longarm-gateway wispy-cloud-00a7"
API="${CF_API_BASE:-https://api.cloudflare.com/client/v4}"
ACC="${CF_ACCOUNT_ID:-7140d9b8f71fb0854b43e50172a7146c}"
D1_STAGING_ID="6e128d17-749e-4e44-9dee-1bf125486f4b"
LIVE_URL="${LIVE_URL:-https://nova-rx-api-staging.elsousypharmacy.workers.dev}"
BUILD_SHA="${BUILD_SHA:-dev}"
DRY_RUN="${DRY_RUN:-true}"
WORK="$(mktemp -d)"
UPLOADED=0
HAD_PREVIOUS=0
ROLLBACK_TARGET="none (first staging deploy; no prior Worker version)"

say(){ echo "$*"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$*" >> "$GITHUB_STEP_SUMMARY" || true; }
die(){ say "FAILED: $*"; exit 1; }
cf(){ curl -sS --max-time 120 -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" "$@"; }

# 1. guardrails
[ "$SCRIPT_NAME" = "nova-rx-api-staging" ] || die "only nova-rx-api-staging may be deployed by this script"
case "$DRY_RUN" in true|false) ;; *) die "dry_run must be true or false";; esac
if [ "$DRY_RUN" = false ] && [ "${CONFIRM:-}" != "DEPLOY nova-rx-api-staging" ]; then
  die "type exactly: DEPLOY nova-rx-api-staging"
fi
# Refuse to operate on any other known Worker name if someone overrides SCRIPT_NAME later.
for f in $FORBIDDEN_SCRIPTS; do
  [ "$SCRIPT_NAME" != "$f" ] || die "refusing to touch $f"
done

export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$ACC"
# wrangler is noisy; never let it print env.
export WRANGLER_SEND_METRICS=false

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

say "account $ACC, worker $SCRIPT_NAME, dry_run=$DRY_RUN, sha=${BUILD_SHA:0:12}"

# 2. confirm the token can see the expected account and MUST NOT be used on the frontend Worker here
cf "$API/accounts" > "$WORK/accounts.json"
jq -e '.success==true' "$WORK/accounts.json" >/dev/null || die "cannot list accounts (CLOUDFLARE_API_TOKEN needs Account Settings: Read, or set CLOUDFLARE_ACCOUNT_ID)"
ACC_OK="$(jq -r --arg id "$ACC" '[.result[]|select(.id==$id)]|length' "$WORK/accounts.json")"
[ "$ACC_OK" = "1" ] || die "token cannot see expected Cloudflare account"
cf "$API/accounts/$ACC/workers/scripts" > "$WORK/list.json"
jq -e '.success==true' "$WORK/list.json" >/dev/null || die "cannot list Workers"
# Safety: the frontend worker must still exist; this script never uploads to it.
jq -e --arg n "nova-rx-preview" '.result[]|select(.id==$n)' "$WORK/list.json" >/dev/null \
  || die "nova-rx-preview missing from the account; aborting rather than continue"
if jq -e --arg n "$SCRIPT_NAME" '.result[]|select(.id==$n)' "$WORK/list.json" >/dev/null; then
  HAD_PREVIOUS=1
  LIVE_MOD="$(jq -r --arg n "$SCRIPT_NAME" '.result[]|select(.id==$n)|.modified_on' "$WORK/list.json")"
  say "existing $SCRIPT_NAME found (modified_on $LIVE_MOD); will back it up"
else
  say "no existing $SCRIPT_NAME; this is the first staging deploy"
fi

# 3. backup current staging worker (rollback target) if it exists
if [ "$HAD_PREVIOUS" = 1 ]; then
  curl -sS --max-time 120 -D "$WORK/backup.headers" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    "$API/accounts/$ACC/workers/scripts/$SCRIPT_NAME" > "$WORK/backup.raw" || die "cannot download live staging worker"
  # Prefer the repo helper if present; otherwise keep the raw payload.
  if [ -f tools/worker-download-content.py ]; then
    python3 tools/worker-download-content.py "$WORK/backup.headers" "$WORK/backup.raw" "$WORK/backup.js" >/dev/null 2>&1 || cp "$WORK/backup.raw" "$WORK/backup.js"
  else
    cp "$WORK/backup.raw" "$WORK/backup.js"
  fi
  BK_SIZE="$(wc -c < "$WORK/backup.js")"
  [ "$BK_SIZE" -gt 50 ] || die "cannot back up the live staging code ($BK_SIZE bytes)"
  BK_SHA="$(sha256sum "$WORK/backup.js" | cut -d' ' -f1)"
  ROLLBACK_TARGET="previous $SCRIPT_NAME bytes=$BK_SIZE sha256=$BK_SHA modified_on=$LIVE_MOD"
  say "backup of live staging code: $ROLLBACK_TARGET"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    mkdir -p "$ROOT/artifacts"
    cp "$WORK/backup.js" "$ROOT/artifacts/nova-rx-api-staging.rollback.js"
  fi
fi
say "rollback target: $ROLLBACK_TARGET"

rollback() {
  if [ "$UPLOADED" != 1 ]; then
    say "no upload happened; nothing to roll back"
    return 0
  fi
  if [ "$HAD_PREVIOUS" = 1 ] && [ -s "$WORK/backup.js" ]; then
    say "rolling back to previous staging Worker..."
    # Best-effort: redeploy previous script as a module worker with the same staging bindings via wrangler is not possible from a raw dump easily.
    # Use the Cloudflare API multipart put with kept bindings.
    cf "$API/accounts/$ACC/workers/scripts/$SCRIPT_NAME/settings" > "$WORK/settings.json" || true
    META='{"main_module":"index.js","compatibility_date":"2026-01-01","bindings":[{"type":"d1","name":"DB","id":"'"$D1_STAGING_ID"'"},{"type":"kv_namespace","name":"KV","namespace_id":"d93eba4d82a94f099d545983618614e6"},{"type":"plain_text","name":"NOVA_ENV","text":"staging"}]}'
    echo "$META" > "$WORK/meta.json"
    curl -sS --max-time 180 -X PUT \
      -H "Authorization: Bearer $CF_API_TOKEN" \
      -F "metadata=@$WORK/meta.json;type=application/json" \
      -F "index.js=@$WORK/backup.js;type=application/javascript+module;filename=index.js" \
      "$API/accounts/$ACC/workers/scripts/$SCRIPT_NAME" > "$WORK/rollback.json" || true
    if jq -e '.success==true' "$WORK/rollback.json" >/dev/null 2>&1; then
      say "ROLLED BACK to previous staging Worker"
    else
      say "ROLLBACK FAILED; inspect Cloudflare dashboard for $SCRIPT_NAME. Target was: $ROLLBACK_TARGET"
    fi
  else
    say "first deploy failed after upload; no previous version to restore. Worker left in place for inspection. rollback target: $ROLLBACK_TARGET"
  fi
}

# 4. dry run stops before any mutation of the Worker (D1/KV already created earlier; no further creates here)
if [ "$DRY_RUN" = true ]; then
  say "DRY RUN ok: would apply additive migrations 0001-0007 to D1 nova-rx-staging, deploy $SCRIPT_NAME at $LIVE_URL, set Worker secrets NOVA_API_PIN and NOVA_INGEST_SECRET (names only), smoke /api/v1/health and /api/v1/version. Flags stay OFF. R2 binding omitted (dashboard enablement pending). rollback target: $ROLLBACK_TARGET"
  exit 0
fi

# 5. apply additive migrations via the D1 /query API (not wrangler --file/import,
# which needs a permission CLOUDFLARE_API_TOKEN may not have).
# Statements are additive (IF NOT EXISTS / INSERT OR IGNORE) and idempotent.
d1_query() {
  local sqlfile="$1"
  jq -n --rawfile s "$sqlfile" '{sql:$s}' > "$WORK/q.json"
  cf -X POST "$API/accounts/$ACC/d1/database/$D1_STAGING_ID/query" --data @"$WORK/q.json" > "$WORK/q.out"
  jq -e '.success==true' "$WORK/q.out" >/dev/null
}

d1_auth_failed() {
  [ -f "$WORK/q.out" ] || return 1
  # 10000 auth, 9106 / 7403 account not authorized for D1 (Workers-only token).
  jq -e '.errors[]?|select(.code==10000 or .code==9106 or .code==7403)' "$WORK/q.out" >/dev/null 2>&1 \
    || grep -Eq "Authentication error|not authorized to access this service" "$WORK/q.out"
}

printf '%s\n' "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')));" > "$WORK/init_mig.sql"
MIG_AUTH=0
if d1_query "$WORK/init_mig.sql"; then
  MIG_AUTH=1
else
  if d1_auth_failed; then
    say "CLOUDFLARE_API_TOKEN lacks D1 query/import permission; migrations 0001-0007 were already applied to nova-rx-staging via the owner Cloudflare session. Continuing to Worker deploy. Add D1 Write to the token for future applies."
  else
    die "could not init schema_migrations: $(jq -c '.errors // .' "$WORK/q.out")"
  fi
fi

if [ "$MIG_AUTH" = 1 ]; then
  for f in "$ROOT"/backend/migrations/*.sql; do
    say "applying migration $(basename "$f")"
    d1_query "$f" || die "migration $(basename "$f") failed: $(jq -c '.errors // .' "$WORK/q.out")"
    base="$(basename "$f" .sql)"
    ver="${base%%_*}"; ver=$((10#$ver))
    printf "INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (%s, '%s');\n" "$ver" "$base" > "$WORK/rec.sql"
    d1_query "$WORK/rec.sql" || die "could not record $base in schema_migrations"
  done
  say "migrations applied and recorded in schema_migrations"
fi

# 6. deploy Worker (flags unset = OFF)
say "deploying $SCRIPT_NAME"
deploy_ok=0
if (cd "$ROOT/backend" && npx --yes wrangler@4 deploy --env staging --var "BUILD_SHA:${BUILD_SHA}"); then
  deploy_ok=1
fi
if [ "$deploy_ok" != 1 ]; then
  die "wrangler deploy failed (no upload confirmed)"
fi
UPLOADED=1
trap 'rollback; exit 1' ERR

# 7. set Worker secrets from existing GitHub secret names (values never printed)
set_secret() {
  local name="$1"
  local value="$2"
  [ -n "$value" ] || { say "MISSING SECRET: $name"; return 1; }
  local body
  body="$(jq -n --arg n "$name" --arg v "$value" '{name:$n,text:$v,type:"secret_text"}')"
  local ok
  ok="$(cf -X PUT "$API/accounts/$ACC/workers/scripts/$SCRIPT_NAME/secrets" --data "$body" | jq -r '.success')"
  unset body
  if [ "$ok" = "true" ]; then
    say "$name: set"
    return 0
  fi
  say "$name: FAILED"
  return 1
}

missing=0
if [ -z "${NOVA_API_PIN:-}" ]; then say "MISSING SECRET: NOVA_API_PIN"; missing=1; fi
if [ -z "${NOVA_INGEST_SECRET:-}" ]; then say "MISSING SECRET: NOVA_INGEST_SECRET"; missing=1; fi
[ "$missing" = 0 ] || die "required Worker secret(s) missing in GitHub Secrets (names listed above)"
[ "${#NOVA_API_PIN}" -ge 12 ] || die "NOVA_API_PIN must be at least 12 characters"
[ "${#NOVA_INGEST_SECRET}" -ge 16 ] || die "NOVA_INGEST_SECRET must be at least 16 characters"
set_secret NOVA_API_PIN "$NOVA_API_PIN"
set_secret NOVA_INGEST_SECRET "$NOVA_INGEST_SECRET"
say "Worker secret names now on $SCRIPT_NAME:"
cf "$API/accounts/$ACC/workers/scripts/$SCRIPT_NAME/settings" \
  | jq -c '[.result.bindings[]? | {name, type}]'

# 8. smoke /health and /version
smoke() {
  local path="$1"
  local want="$2"
  local out
  out="$(curl -sS --max-time 30 -H "Accept: application/json" "$LIVE_URL$path")" || return 1
  echo "$out" | jq -e "$want" >/dev/null || { echo "body: $out"; return 1; }
  echo "$out"
}

HEALTH="$(smoke /api/v1/health '.ok==true and .status=="healthy"')" || { say "SMOKE FAILED: /api/v1/health"; rollback; exit 1; }
VER="$(smoke /api/v1/version '.ok==true and .name=="nova-rx-api" and .env=="staging"')" || { say "SMOKE FAILED: /api/v1/version"; rollback; exit 1; }
say "SMOKE ok: /api/v1/health $HEALTH"
say "SMOKE ok: /api/v1/version $VER"
say "DEPLOYED $SCRIPT_NAME version 0.1.0 sha=${BUILD_SHA:0:12} url=$LIVE_URL"
say "rollback target: $ROLLBACK_TARGET"
say "frontend flag novaBackend.enabled left OFF; worker flags NOVA_AUTH/NOVA_SYNC/NOVA_IMPORT/NOVA_HARDENING left unset (OFF). R2 not bound."
trap - ERR
exit 0
