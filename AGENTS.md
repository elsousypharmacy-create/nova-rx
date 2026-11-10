# AI Agent Instructions — NOVA Rx

These instructions apply to every AI agent operating in this repository.

**First action every session:** Read `HANDOFF.md`, `docs/ERP_MASTER_PLAN.md`, `reports/erp-roadmap.json`, and inspect live Issues/PRs/CI/deploy state. Read `docs/NOVA_MANAGER_PLAYBOOK.md` for team operating policy; ChatGPT manager also uses `skills/nova-rx-chatgpt-manager/SKILL.md`. These files are repository guidance, not proof of runtime skill installation.

**One source of work:** GitHub Issues are assignments; PRs are implementation artifacts, not extra queues. Record one accountable agent, scoped files, acceptance checks, claim/checkpoint, and exact next action in the Issue. Maximum three active implementation PRs by default; prefer finishing existing PRs before opening more. No overlapping edits without explicit coordination. A posted Issue/comment does not trigger an agent or prove receipt; require acknowledgement or execution evidence.

**Roles:** Claude Sonnet primary coder; ChatGPT manager/QA; Claude Opus optional independent high-risk reviewer; Gemini optional for explicitly assigned, isolated analysis/tests, never overlapping Sonnet-owned files; Kimi and Grok standby/isolated tasks only by explicit assignment. Never infer a running session from historical comments or email addresses. Previous Kimi-default instructions are superseded.

**Definition of done:** CLAIM → implement → relevant tests/CI → fix failures → resolve conflicts → merge when checks and safety gates pass → deploy through authorized workflow → verify deployed SHA and available live evidence → update Issue, HANDOFF and roadmap. Do not stop at Draft PR or ask routine approval each stage. Independent pre-merge review is optional for ordinary changes under the owner's 2026-11-10 direction; material security/data-integrity defects remain blocking. Real supplier cart writes/orders/checkout, destructive operations and secrets changes still require specific owner approval. Do not claim untested real supplier behavior as PASS. Weekly QA is follow-up, not a substitute for critical safety checks.

**Mandatory checkpoint:** After each meaningful batch and before exit, update `HANDOFF.md` with actual branch/SHA/PR, tests, blocker and next action, commit and push. If push fails, report it. Re-read latest HANDOFF before writing to avoid overwriting concurrent work. Never expose secrets.

**Roadmap:** Master Issue #87 and `docs/ERP_MASTER_PLAN.md` define acceptance; use stable roadmap IDs. Keep `reports/erp-roadmap.json` and sanitized public dashboard mirror consistent; report mirror failures. Distinguish CODE_PUSHED / CI_PASS / MERGED / DEPLOYED / LIVE_VERIFIED. Scope/weight changes need planVersion and changelog.
