# NOVA Rx — HANDOFF (living project state)

Last documented: 2026-11-05 (Asia/Riyadh). This document is a handoff, not proof of current CI status. Verify GitHub before making changes.

## Owner priorities and non-negotiables
- Phase 1: finish premium, responsive pharmacy POS frontend and UX. Database/backend integration comes later.
- Preserve the existing implementation and UX decisions. Never restart a task from scratch without checking saved work and explicit owner approval.
- **Kimi 2 is the default for routine UI coding, bug fixes and Playwright work; Kimi 3 only for demonstrably complex architecture or broad redesign.** This is a policy, NOT a verified statement of the currently configured runtime model.
- Kimi quota is precious: minimal file reads, narrow scope, small batches, no repetitive repo audits or unnecessary agent calls/tests.
- Keep credentials in secrets; never commit tokens, passwords, or keys.
- Do not merge or deploy without the established review/approval workflow.

## Current project context (verify live before acting)
- Repository: elsousypharmacy-create/nova-rx.
- Existing README describes desktop POS prototype, 72/28 invoice/customer layout, keyboard-first search, discounts and checkout.
- Active work tracked by issue #4: [Kimi TASK 002] remaining Grok-confirmed POS UX defects in batches. Areas: label panel blocking next sale, language switching/i18n, mobile FAB overlap, empty search, discount feedback, AI retry, product filter empty state, and smaller UX fixes.
- Workflow run 42033433619 had failed on a Kimi 5-hour quota limit, then its failed job was rerun. Rerun creates a new runner/session; uncommitted work from the failed runner is not automatically preserved. At last verification, the rerun's implementation step was in progress. **This is historical status, not a live claim.**
- Prior completed work includes issue #2 / PR #3, reportedly merged at commit 236dba1281972f99a0845e5e617c5d2bdefa0129. Verify current branches/PRs/commits before assuming a task is unfinished.

## Required agent protocol — ALL AI agents (ChatGPT, Kimi, Grok, others)
1. At start, read this HANDOFF.md and check current issue, branch, PR, commits, and CI status. Do not duplicate completed work.
2. Before work, state exact narrow scope, files to touch, expected result and token-conscious plan. Avoid broad exploratory reads.
3. **Every meaningful progress checkpoint must be written to HANDOFF.md and committed/pushed to GitHub**, including: completed work, changed files, commit/branch/PR links, tests and results, remaining work, blockers, next exact action. Update before handing off, stopping, or hitting limits whenever possible.
4. If a task fails, times out, or hits quota, inspect commits/PR/checkpoints FIRST. Never rerun failed workflow jobs automatically. Ask owner before any potentially expensive restart.
5. Keep handoff updates factual and concise; distinguish verified facts from plans. Do not claim a commit or test passed unless confirmed.
6. Coordinate handoff edits carefully: fetch latest before writing, avoid overwriting another agent's updates; use separate branch/PR if concurrent edits conflict.

## Latest human decision
Owner explicitly requires **all AI-agent prompts/instructions to require writing progress to HANDOFF.md**. Kimi 2 default, Kimi 3 reserved for complex tasks. Protect Kimi usage and avoid repeating work.

## Next action
Verify latest state of issue #4, run 42033433619, and associated branches/PRs. Do not trigger a run merely to check. Continue only unfinished work from verified checkpoint.

## Agent checkpoint log
- 2026-11-05 — ChatGPT: Created project handoff and agent-wide checkpoint policy. No Kimi execution was started by this documentation change.
