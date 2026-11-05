# Agent prompt contract — NOVA Rx

Applies to all future Kimi coding prompts, Grok QA prompts, and other agent handoffs. A live run started before this commit will not inherit these instructions automatically.

## Mandatory preflight (token-efficient)
1. Read only the short summary and latest checkpoint in HANDOFF.md; consult AGENTS.md once per task.
2. Inspect the specific issue, current branch/PR and saved commits. Never redo completed work.
3. Work only on the next unverified checklist item; avoid full repository audits.

## Progress accounting
- Every task must define stable item IDs, weight, acceptance criteria, and status: pending | in_progress | implemented | verified | blocked.
- Only **verified** items count toward the completion percentage. A verified item requires committed implementation and relevant test/review evidence.
- Percent = 100 * sum(weights of verified items) / sum(weights of all scoped items). If task has no agreed checklist, percent is **unknown**, not 0 or an estimate.
- Publish machine-readable progress to `reports/agent-progress.json` after meaningful checkpoints, and summarize changes/commit/test/next step in HANDOFF.md. Commit both. Keep last known valid state if blocked; never fabricate percent.
- Track active run ID, branch, latest checkpoint timestamp, and whether data is stale; never confuse CI 'in_progress' with percentage.
- If GitHub Actions runtime cannot push checkpoints, write the checkpoint in a PR/branch and explicitly report that the canonical dashboard may lag.

## Handoff output at every checkpoint
Agent, task ID, current branch/commit, verified items, remaining items, test evidence, blockers, exact next action, timestamp. Do not expose tokens or customer data.

## Quota safety
Kimi 2 default; Kimi 3 only for justified complex tasks. Never rerun failed jobs automatically. No extra agent calls merely to calculate progress: compute from saved JSON. Avoid duplicate progress updates if nothing changed.

## Grok QA
Read the same checklist and evidence; independently mark items verified only when test evidence exists. Report mismatches without overwriting Kimi's code or falsely inflating percentage.

## Dashboard contract (pharmacy Home)
Show a compact NOVA Rx agent-progress tile: task name, verified percent OR 'غير متاح', verified/total weighted progress or item counts, active/idle/failed CI status, latest checkpoint in Egypt time, and link to run/issue. Do not show a fabricated percentage. Read public sanitized JSON with cache/fallback; no credentials or new backend dependency. Keep mobile Home uncluttered.
