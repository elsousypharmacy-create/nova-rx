#!/usr/bin/env bash
# Runs after success/failure. Never invokes Kimi or commits user work.
set -euo pipefail
base="${KIMI_CHECKPOINT_BASE_SHA:-${GITHUB_SHA:-}}"
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf 'No checkout was available; no recoverable product changes recorded.\n' > kimi-resume-note.md
  exit 0
fi
if [ ! -s kimi-recovery.patch ]; then
  test -n "$base"
  git cat-file -e "$base^{commit}"
  # Include new files (for example docs/erp), even when the CLI exits before commit.
  git add -N -- . ':!.github/workflows' ':!*.env' ':!*.env.*' ':!**/*.env' ':!**/*.env.*' ':!node_modules' ':!kimi-recovery.patch' ':!kimi-resume-note.md'
  git diff --binary "$base" -- . ':!.github/workflows' ':!*.env' ':!*.env.*' ':!**/*.env' ':!**/*.env.*' ':!node_modules' ':!kimi-recovery.patch' ':!kimi-resume-note.md' > kimi-recovery.patch
fi
{
  printf '# Kimi resume checkpoint\n\n'
  printf 'Issue: %s\nBase SHA: %s\nCurrent HEAD: %s\nBranch: %s\n' "${ISSUE_NUMBER:-unknown}" "$base" "$(git rev-parse HEAD)" "$(git branch --show-current)"
  printf '\nRead the existing branch, BUILD_REPORT and HANDOFF first. Review/apply this patch against its recorded base only if no newer saved branch exists. Do not restart the task from scratch or repeat completed tests without a new reason. An empty patch means no product edits were captured.\n'
} > kimi-resume-note.md
echo 'Kimi checkpoint captured; no model retry performed.'
