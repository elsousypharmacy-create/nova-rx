#!/usr/bin/env bash
# Local test of deploy_worker.sh against a fake Cloudflare API. Needs bash, curl, jq, git, node, python3.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; SCRIPT="$HERE/../../.github/scripts/deploy_worker.sh"
T="$(mktemp -d)"; PORT=18766; fails=0
pad(){ python3 - "$1" "$2" <<'PY'
import sys
body="addEventListener('fetch',e=>e.respondWith(new Response('"+sys.argv[2]+"')));\n"+("/* padding to look like a real Worker */\n"*3500)
open(sys.argv[1],"w").write(body)
PY
}
mkdir -p "$T/repo/worker/live" && cd "$T/repo" && git init -q && git config user.email t@t && git config user.name t
pad worker/live/live-old.js old; pad worker/live/new.js new; git add -A && git commit -qm t
OLD="$T/repo/worker/live/live-old.js"; SHA="$(sha256sum worker/live/new.js | cut -d' ' -f1)"
start(){ python3 "$HERE/mock_cf.py" $PORT "$OLD" & MOCK=$!; sleep 0.7; }
stop(){ kill $MOCK 2>/dev/null; wait $MOCK 2>/dev/null; }
state(){ curl -s -H "Authorization: Bearer x" "http://127.0.0.1:$PORT/__state"; }
mode(){ curl -s -H "Authorization: Bearer x" "http://127.0.0.1:$PORT/__mode?m=$1" >/dev/null; }
run(){ # name, expected exit, env assignments...
  local name="$1" want="$2"; shift 2
  env CF_API_TOKEN=tok CF_API_BASE="http://127.0.0.1:$PORT" SCRIPT_NAME=nova-rx-preview ARTIFACT_PATH=worker/live/new.js ARTIFACT_REF=HEAD \
      WANT_SHA256="$SHA" EXPECTED_MODIFIED_ON=2026-11-07T01:57:40 DRY_RUN=true CONFIRM= "$@" bash "$SCRIPT" > "$T/out.txt" 2>&1; local got=$?
  if [ "$got" = "$want" ]; then echo "PASS $name"; else echo "FAIL $name (exit $got, wanted $want)"; sed 's/^/    /' "$T/out.txt" | tail -6; fails=$((fails+1)); fi
}
expect(){ if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fails=$((fails+1)); fi; }

start
run "dry run passes and uploads nothing" 0
expect "dry run did not upload" '[ "$(state | jq ".puts|length")" = 0 ]'
run "refuses another Worker name" 1 SCRIPT_NAME=other
run "refuses a wrong sha256" 1 WANT_SHA256=$(printf 'a%.0s' $(seq 64))
run "refuses a path outside worker/live" 1 ARTIFACT_PATH=index.html
run "refuses when the live Worker changed" 1 EXPECTED_MODIFIED_ON=2026-11-08
run "real run needs the typed confirmation" 1 DRY_RUN=false CONFIRM=yes
expect "nothing uploaded by refused runs" '[ "$(state | jq ".puts|length")" = 0 ]'
run "real deploy succeeds" 0 DRY_RUN=false "CONFIRM=DEPLOY nova-rx-preview"
expect "upload asked to keep both binding types" '[ "$(state | jq -c ".puts[0].keep_bindings|sort")" = "[\"kv_namespace\",\"secret_text\"]" ]'
expect "upload kept the compatibility date" '[ "$(state | jq -r ".puts[0].compatibility_date")" = "2024-09-23" ]'
expect "new code is live, bindings intact" '[ "$(state | jq ".bindings|length")" = 3 ]'
stop

start; mode put_fail
run "failed upload ends in failure" 1 DRY_RUN=false "CONFIRM=DEPLOY nova-rx-preview"
stop

start; mode drop_bindings
run "lost bindings are detected and rolled back" 1 DRY_RUN=false "CONFIRM=DEPLOY nova-rx-preview"
expect "rollback restored the old code" 'grep -q "ROLLING BACK" "$T/out.txt" && [ "$(state | jq ".puts|length")" = 2 ]'
stop

start; mode truncate
run "truncated live code is detected and rolled back" 1 DRY_RUN=false "CONFIRM=DEPLOY nova-rx-preview"
expect "rollback attempted" 'grep -q "ROLLING BACK" "$T/out.txt"'
stop
rm -rf "$T"
[ "$fails" = 0 ] && echo "ALL DEPLOY-WORKER CHECKS PASSED" || { echo "FAILED: $fails"; exit 1; }
