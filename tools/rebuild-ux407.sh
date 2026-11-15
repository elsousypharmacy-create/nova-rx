#!/usr/bin/env bash
# Rebuild the preview artifact worker/live/nova-rx-preview.ux-407.js from the current index.html (Worker code stays identical to ux-406),
# then commit and push it to the CURRENT branch. Run it from the repo root after changing index.html / unified-inbox.js:
#   bash tools/rebuild-ux407.sh
# Needed because artifact-ux407.check requires the artifact's app HTML to equal index.html.
set -euo pipefail
cd "$(dirname "$0")/.."
branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" != "main" ] || { echo "refusing to run on main: use a branch"; exit 1; }
node tools/build-worker-artifact.mjs worker/live/nova-rx-preview.ux-406.js index.html worker/live/nova-rx-preview.ux-407.js
node tests/unit/artifact-ux407.check.mjs | tail -3
git add worker/live/nova-rx-preview.ux-407.js
if git diff --cached --quiet; then echo "artifact already current"; exit 0; fi
git commit -qm "chore(preview): rebuild ux-407 artifact from index.html" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Ak2z1PWstq84qXsH78oeG7"
git push -q origin "$branch"
echo "pushed $branch"
