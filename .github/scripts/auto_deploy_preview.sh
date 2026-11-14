#!/usr/bin/env bash
# Auto-deploy the newest worker/live/nova-rx-preview.*.js (by git commit time) to nova-rx-preview.
# Never deploys an older artifact over a newer one. Preview only; never production or api-staging.
# Used by .github/workflows/auto-deploy-preview.yml. Secrets are used, never printed.
set -euo pipefail
set +x

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

: "${CF_API_TOKEN:?missing CF_API_TOKEN}"
SCRIPT_NAME="nova-rx-preview"
API="${CF_API_BASE:-https://api.cloudflare.com/client/v4}"
ACC="${CF_ACCOUNT_ID:-7140d9b8f71fb0854b43e50172a7146c}"
LIVE_URL="${LIVE_URL:-https://nova-rx-preview.elsousypharmacy.workers.dev}"

# Refresh origin/main so a queued older run can see a newer artifact that landed later.
git fetch -q origin main 2>/dev/null || true

CHANGED="${CHANGED_PATHS:-}"
if [ -z "$CHANGED" ] && [ -n "${GITHUB_EVENT_BEFORE:-}" ] && [ -n "${GITHUB_SHA:-}" ] \
   && [ "$GITHUB_EVENT_BEFORE" != "0000000000000000000000000000000000000000" ]; then
  CHANGED="$(git diff --name-only "$GITHUB_EVENT_BEFORE" "$GITHUB_SHA" || true)"
fi

ORIGIN_NEWEST=""
if git rev-parse --verify -q origin/main >/dev/null; then
  ORIGIN_ROOT="$(mktemp -d)"
  git --work-tree="$ORIGIN_ROOT" --git-dir="$ROOT/.git" checkout -q origin/main -- worker/live 2>/dev/null || true
  if [ -d "$ORIGIN_ROOT/worker/live" ]; then
    # reuse this repo's git log (commit times) with files from origin/main names
    mapfile -t _on < <(git ls-tree -r --name-only origin/main -- worker/live | grep -E 'worker/live/nova-rx-preview\..+\.js$' || true)
    best_t=0; best_p=""
    for rel in "${_on[@]}"; do
      t="$(git log -1 --format=%ct origin/main -- "$rel" 2>/dev/null || echo 0)"
      if [ "${t:-0}" -gt "$best_t" ] || { [ "${t:-0}" -eq "$best_t" ] && [ "$rel" \> "$best_p" ]; }; then
        best_t=$t; best_p=$rel
      fi
    done
    [ -n "$best_p" ] && ORIGIN_NEWEST="$best_p	$best_t"
  fi
  rm -rf "$ORIGIN_ROOT"
fi

LIVE_HTML="$(mktemp)"
curl -sS --max-time 30 -H "User-Agent: nova-smoke" -H "Cache-Control: no-cache" -o "$LIVE_HTML" "$LIVE_URL/" || true

set +e
SEL="$(python3 tools/preview_auto_deploy.py --root "$ROOT" --changed "$CHANGED" --live-html "$LIVE_HTML" ${ORIGIN_NEWEST:+--origin-newest "$ORIGIN_NEWEST"})"
rc=$?
set -e
rm -f "$LIVE_HTML"
echo "$SEL"
if [ "$rc" != 0 ]; then
  echo "auto-deploy: skipped (exit $rc)"
  exit 0
fi

ARTIFACT_PATH="$(printf '%s\n' "$SEL" | sed -n 's/^ARTIFACT_PATH=//p' | head -1)"
WANT_SHA256="$(printf '%s\n' "$SEL" | sed -n 's/^SHA256=//p' | head -1)"
[ -n "$ARTIFACT_PATH" ] && [ -n "$WANT_SHA256" ] || { echo "selector did not print ARTIFACT_PATH/SHA256"; exit 1; }

# Live modified_on for the expected_modified_on guard (fail closed).
LIVE_MOD="$(curl -sS --max-time 30 -H "Authorization: Bearer $CF_API_TOKEN" \
  "$API/accounts/$ACC/workers/scripts" | jq -r --arg n "$SCRIPT_NAME" '.result[]?|select(.id==$n)|.modified_on')"
[ -n "$LIVE_MOD" ] && [ "$LIVE_MOD" != "null" ] || { echo "cannot read live modified_on; fail closed"; exit 1; }

# Re-check we are still the newest on origin/main immediately before upload.
if [ -n "$ORIGIN_NEWEST" ]; then
  opath="${ORIGIN_NEWEST%%	*}"; otime="${ORIGIN_NEWEST#*	}"
  mytime="$(git log -1 --format=%ct -- "$ARTIFACT_PATH" || echo 0)"
  if [ "${otime:-0}" -gt "${mytime:-0}" ]; then
    echo "auto-deploy: origin/main now has newer $opath; not uploading $ARTIFACT_PATH"
    exit 0
  fi
fi

export ARTIFACT_REF="${ARTIFACT_REF:-${GITHUB_SHA:-HEAD}}"
# deploy_worker.sh checks out ARTIFACT_REF from the already-checked-out repo via git show
# The existing script uses the workspace file after checkout of artifact_ref.
# We pass env vars the workflow script expects.
export CF_API_TOKEN CF_ACCOUNT_ID="$ACC" SCRIPT_NAME
export ARTIFACT_PATH WANT_SHA256
export EXPECTED_MODIFIED_ON="$LIVE_MOD"
export DRY_RUN="${DRY_RUN:-false}"
export CONFIRM="${CONFIRM:-DEPLOY nova-rx-preview}"
export LIVE_URL
if [ "$DRY_RUN" = true ]; then CONFIRM=""; export CONFIRM; fi

echo "auto-deploy: $ARTIFACT_PATH sha256=$WANT_SHA256 expected_modified_on=$LIVE_MOD dry_run=$DRY_RUN"
bash .github/scripts/deploy_worker.sh
