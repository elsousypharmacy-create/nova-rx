#!/usr/bin/env bash
# Run from nova-rx repo root (or any cwd; script cds to repo root).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
BRIEF_MODEL="$(grep -m1 '^Model:' docs/claude-hourly/current.md | sed 's/^Model:[[:space:]]*//' || true)"
MODEL="${BRIEF_MODEL:-sonnet}"
exec claude -p "$(cat docs/claude-hourly/kickoff.txt)" --model "$MODEL"
