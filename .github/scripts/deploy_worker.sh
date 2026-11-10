#!/usr/bin/env bash
# Guarded deploy of ONE Cloudflare Worker (service-worker syntax) with its existing bindings kept.
# Runs from .github/workflows/deploy-worker.yml. The only secret it uses is CF_API_TOKEN.
#
# Order: validate inputs -> read the artifact from git and check sha256 -> find the account ->
# check the live Worker was not modified since EXPECTED_MODIFIED_ON -> save settings + a backup
# of the live code -> (DRY_RUN stops here) -> upload with keep_bindings -> verify settings and code
# -> on ANY failure after the upload: put the backup back.
set -euo pipefail
: "${CF_API_TOKEN:?missing}" "${SCRIPT_NAME:?missing}" "${ARTIFACT_PATH:?missing}" "${ARTIFACT_REF:?missing}"
: "${WANT_SHA256:?missing}" "${EXPECTED_MODIFIED_ON:?missing}" "${DRY_RUN:?missing}"
API="${CF_API_BASE:-https://api.cloudflare.com/client/v4}"
WORK="$(mktemp -d)"; UPLOADED=0
say(){ echo "$*"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$*" >> "$GITHUB_STEP_SUMMARY" || true; }
die(){ say "FAILED: $*"; exit 1; }
cf(){ curl -sS --max-time 120 -H "Authorization: Bearer $CF_API_TOKEN" "$@"; }

# 1. inputs
[ "$SCRIPT_NAME" = "nova-rx-preview" ] || die "only nova-rx-preview may be deployed"
[[ "$ARTIFACT_PATH" =~ ^worker/live/[A-Za-z0-9._-]+\.js$ ]] || die "artifact path not allowed"
[[ "$WANT_SHA256" =~ ^[0-9a-f]{64}$ ]] || die "sha256 must be 64 lowercase hex characters"
[[ "$ARTIFACT_REF" =~ ^[A-Za-z0-9._/-]+$ ]] || die "artifact ref not allowed"
case "$DRY_RUN" in true|false) ;; *) die "dry_run must be true or false";; esac
if [ "$DRY_RUN" = false ] && [ "${CONFIRM:-}" != "DEPLOY nova-rx-preview" ]; then die "type exactly: DEPLOY nova-rx-preview"; fi

# 2. artifact
git cat-file -e "$ARTIFACT_REF:$ARTIFACT_PATH" 2>/dev/null || git fetch -q origin "$ARTIFACT_REF" 2>/dev/null || true
SRC="$ARTIFACT_REF"; git cat-file -e "$SRC:$ARTIFACT_PATH" 2>/dev/null || SRC="origin/$ARTIFACT_REF"
git show "$SRC:$ARTIFACT_PATH" > "$WORK/new.js" 2>/dev/null || die "cannot read $ARTIFACT_PATH at $ARTIFACT_REF"
GOT="$(sha256sum "$WORK/new.js" | cut -d' ' -f1)"
[ "$GOT" = "$WANT_SHA256" ] || die "sha256 mismatch: file is $GOT"
NEW_SIZE="$(wc -c < "$WORK/new.js")"; [ "$NEW_SIZE" -gt 100000 ] || die "artifact too small ($NEW_SIZE bytes)"
grep -q "addEventListener(" "$WORK/new.js" || die "not a service-worker script"
NEW_FORMAT=legacy; if grep -q "^export default" "$WORK/new.js"; then NEW_FORMAT=module; fi
node --check "$WORK/new.js" || die "artifact has a syntax error"
say "artifact ok: $ARTIFACT_PATH @ $SRC, $NEW_SIZE bytes, sha256 $GOT"

# 3. account
ACC="${CF_ACCOUNT_ID:-}"
if [ -z "$ACC" ]; then
  cf "$API/accounts" > "$WORK/accounts.json"
  jq -e '.success==true' "$WORK/accounts.json" >/dev/null || die "cannot list accounts (token needs Account Settings: Read, or set CF_ACCOUNT_ID)"
  [ "$(jq '.result|length' "$WORK/accounts.json")" = 1 ] || die "token sees several accounts; set the CF_ACCOUNT_ID secret"
  ACC="$(jq -r '.result[0].id' "$WORK/accounts.json")"
fi

# 4. live Worker unchanged since the baseline
cf "$API/accounts/$ACC/workers/scripts" > "$WORK/list.json"
jq -e '.success==true' "$WORK/list.json" >/dev/null || die "cannot list Workers"
LIVE_MOD="$(jq -r --arg n "$SCRIPT_NAME" '.result[]|select(.id==$n)|.modified_on' "$WORK/list.json")"
[ -n "$LIVE_MOD" ] || die "Worker $SCRIPT_NAME not found"
case "$LIVE_MOD" in "$EXPECTED_MODIFIED_ON"*) ;; *) die "live Worker changed: modified_on is $LIVE_MOD, expected $EXPECTED_MODIFIED_ON...";; esac
say "live Worker unchanged since baseline (modified_on $LIVE_MOD)"

# 5. settings + backup of the live code (the backup is what a rollback restores)
cf "$API/accounts/$ACC/workers/scripts/$SCRIPT_NAME/settings" > "$WORK/settings.json"
jq -e '.success==true' "$WORK/settings.json" >/dev/null || die "cannot read Worker settings"
BEFORE="$(jq -c '[.result.bindings[]?|{name,type}]|sort_by(.name)' "$WORK/settings.json")"
KEEP="$(jq -c '[.result.bindings[]?.type]|unique' "$WORK/settings.json")"
[ "$(jq 'length' <<<"$BEFORE")" -gt 0 ] || die "no bindings found on the live Worker; refusing to continue"
cf -D "$WORK/backup.headers" "$API/accounts/$ACC/workers/scripts/$SCRIPT_NAME" > "$WORK/backup.raw"
BACKUP_FORMAT="$(python3 tools/worker-download-content.py "$WORK/backup.headers" "$WORK/backup.raw" "$WORK/backup.js")"
BK_SIZE="$(wc -c < "$WORK/backup.js")"; [ "$BK_SIZE" -gt 100000 ] || die "cannot back up the live code ($BK_SIZE bytes)"
grep -q "addEventListener(" "$WORK/backup.js" || die "backup does not look like the live Worker"
say "bindings kept (names and types only): $BEFORE"
say "backup of live code: $BK_SIZE bytes, sha256 $(sha256sum "$WORK/backup.js" | cut -d' ' -f1)"
write_meta(){
  local format="$1" out="$2";
  jq -c --argjson keep "$KEEP" --arg format "$format" '(if $format=="module" then {main_module:"script.js",keep_bindings:$keep} else {body_part:"script",keep_bindings:$keep} end)
  + (if .result.compatibility_date then {compatibility_date:.result.compatibility_date} else {} end)
  + (if (.result.compatibility_flags|length)>0 then {compatibility_flags:.result.compatibility_flags} else {} end)
  + (if .result.usage_model then {usage_model:.result.usage_model} else {} end)' "$WORK/settings.json" > "$out"
}
put_script(){ # $1 file, $2 module/legacy
  local part=script ctype=application/javascript;
  if [ "$2" = module ]; then part=script.js; ctype=application/javascript+module; fi
  write_meta "$2" "$WORK/meta.json"
  cf -X PUT "$API/accounts/$ACC/workers/scripts/$SCRIPT_NAME" \
    -F "metadata=<$WORK/meta.json;type=application/json" -F "$part=@$1;type=$ctype;filename=$part" > "$WORK/put.json"
  jq -e '.success==true' "$WORK/put.json" >/dev/null
}
verify(){ # $1 = file whose content must be live
  cf "$API/accounts/$ACC/workers/scripts/$SCRIPT_NAME/settings" > "$WORK/after.json" || return 1
  jq -e '.success==true' "$WORK/after.json" >/dev/null || return 1
  local after; after="$(jq -c '[.result.bindings[]?|{name,type}]|sort_by(.name)' "$WORK/after.json")"
  [ "$after" = "$BEFORE" ] || { echo "bindings differ: $after"; return 1; }
  [ "$(jq -c '.result.compatibility_date' "$WORK/after.json")" = "$(jq -c '.result.compatibility_date' "$WORK/settings.json")" ] || { echo "compatibility_date differs"; return 1; }
  [ "$(jq -c '.result.compatibility_flags//[]' "$WORK/after.json")" = "$(jq -c '.result.compatibility_flags//[]' "$WORK/settings.json")" ] || { echo "compatibility_flags differ"; return 1; }
  cf -D "$WORK/live_now.headers" "$API/accounts/$ACC/workers/scripts/$SCRIPT_NAME" > "$WORK/live_now.raw" || return 1
  python3 tools/worker-download-content.py "$WORK/live_now.headers" "$WORK/live_now.raw" "$WORK/live_now.js" >/dev/null || return 1
  local want have; want="$(wc -c < "$1")"; have="$(wc -c < "$WORK/live_now.js")"
  [ "$have" -gt $((want*995/1000)) ] && [ "$have" -lt $((want*1005/1000+1)) ] || { echo "live code size $have, expected about $want"; return 1; }
  [ "$(sha256sum "$1" | cut -d' ' -f1)" = "$(sha256sum "$WORK/live_now.js" | cut -d' ' -f1)" ] || { echo "live digest differs"; return 1; }
  echo "live code sha256 $(sha256sum "$WORK/live_now.js" | cut -d' ' -f1) (artifact $(sha256sum "$1" | cut -d' ' -f1))"
}
rollback(){
  say "ROLLING BACK to the backup of the live code..."
  if put_script "$WORK/backup.js" "$BACKUP_FORMAT" && verify "$WORK/backup.js"; then say "rollback done: previous code restored"; else say "ROLLBACK FAILED: restore version 33fe0516-2931-40cb-93a4-808e3c4f7724 by hand in Cloudflare (Workers > $SCRIPT_NAME > Deployments)"; fi
}
on_err(){ if [ "$UPLOADED" = 1 ]; then rollback; fi; }
trap on_err ERR

if [ "$DRY_RUN" = true ]; then say "DRY RUN: all checks passed. Nothing was uploaded."; exit 0; fi

# 6. upload, verify, roll back on failure
UPLOADED=1
put_script "$WORK/new.js" "$NEW_FORMAT" || { say "upload failed: $(jq -c '.errors' "$WORK/put.json" 2>/dev/null || true)"; false; }
V="$(verify "$WORK/new.js")" || { say "verification failed: $V"; false; }
say "$V"
if [ -n "${LIVE_URL:-}" ]; then
  CODE="$(curl -sS -o "$WORK/live.html" -w '%{http_code}' --max-time 30 "$LIVE_URL/" || echo 000)"
  say "HTTP check $LIVE_URL/ -> $CODE (informational; the code check above is the real proof)"
fi
trap - ERR
say "DEPLOYED $SCRIPT_NAME: modified_on $(jq -r '.result.modified_on // "n/a"' "$WORK/put.json"), etag $(jq -r '.result.etag // "n/a"' "$WORK/put.json")"

