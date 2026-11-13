#!/usr/bin/env bash
# Print the current D1 Time Travel bookmark as one JSON line (read-only).
#   scripts/d1-bookmark.sh [db-name]        (default nova-rx-staging)
# stdout: {"ok":true,"db":"...","bookmark":"...","recorded_at":"..."}
# Exit 0 ok; 2 = token lacks permission (Account.D1:Read); 1 = other failure.
# On failure stdout is still one JSON line with ok:false and a reason.
# WRANGLER overrides the CLI (tests use a mock). Never prints secrets.
set -euo pipefail
set +x
DB="${1:-${DB_NAME:-nova-rx-staging}}"
WRANGLER="${WRANGLER:-npx --yes wrangler@4}"
export WRANGLER_SEND_METRICS=false
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
OUT="$(mktemp)"; ERR="$(mktemp)"
trap 'rm -f "$OUT" "$ERR"' EXIT
scrub(){ sed -E 's#https?://[^[:space:]"]+#[redacted-url]#g;s/(Bearer|token|secret|pass(word|phrase)?)[=: ]+[^[:space:]"]+/\1=[redacted]/gi'; }
fail(){ # code reason
  jq -cn --arg db "$DB" --arg at "$NOW" --arg r "$2" '{ok:false,db:$db,bookmark:null,recorded_at:$at,reason:$r}'
  exit "$1"
}
set +e
$WRANGLER d1 time-travel info "$DB" --json >"$OUT" 2>"$ERR"
rc=$?
set -e
ALL="$(cat "$OUT" "$ERR")"
if [ "$rc" != 0 ]; then
  if printf '%s' "$ALL" | grep -Eqi '7403|9106|"code": ?10000|not authorized|Authentication error'; then
    fail 2 "missing Cloudflare token permission: Account.D1:Read"
  fi
  fail 1 "wrangler time-travel info failed: $(printf '%s' "$ALL" | scrub | tr '\n' ' ' | cut -c1-300)"
fi
# Prefer JSON .bookmark; fall back to a bookmark-shaped token in text output.
BM="$(jq -r '(if type=="array" then .[0] else . end) | .bookmark // empty' "$OUT" 2>/dev/null || true)"
if [ -z "$BM" ]; then
  BM="$(grep -Eo '[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{32}' "$OUT" | head -1 || true)"
fi
[ -n "$BM" ] || fail 1 "no bookmark in wrangler output"
jq -cn --arg db "$DB" --arg bm "$BM" --arg at "$NOW" '{ok:true,db:$db,bookmark:$bm,recorded_at:$at}'
