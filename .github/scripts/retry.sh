#!/usr/bin/env bash
# Retry wrapper for transient CI network steps (npm, playwright download, git fetch, apt fallback).
# Usage: bash .github/scripts/retry.sh <max_attempts> <base_delay_sec> -- <command...>
set -euo pipefail

if [ "$#" -lt 4 ] || [ "$3" != "--" ]; then
  echo "Usage: $0 <max_attempts> <base_delay_sec> -- <command...>" >&2
  exit 2
fi

max_attempts="$1"
base_delay="$2"
shift 3

if ! [[ "$max_attempts" =~ ^[1-9][0-9]*$ ]] || ! [[ "$base_delay" =~ ^[0-9]+$ ]]; then
  echo "retry.sh: max_attempts must be >=1 and base_delay must be >=0" >&2
  exit 2
fi

attempt=1
while true; do
  rc=0
  "$@" || rc=$?
  if [ "$rc" -eq 0 ]; then
    exit 0
  fi
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "retry.sh: command failed after ${attempt}/${max_attempts} attempts (exit ${rc}): $*" >&2
    exit "$rc"
  fi
  delay=$((base_delay * attempt))
  echo "retry.sh: attempt ${attempt}/${max_attempts} failed (exit ${rc}); retrying in ${delay}s: $*" >&2
  sleep "$delay"
  attempt=$((attempt + 1))
done
