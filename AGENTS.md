# AI Agent Instructions — NOVA Rx

These instructions apply to every AI agent operating in this repository, including ChatGPT, Kimi, Grok, and review agents.

**First action:** Read `HANDOFF.md` and inspect current issue/branch/PR/CI status before starting work. Follow owner priorities and token-saving rules in that file.

**Mandatory progress persistence:** After each meaningful batch, and before handoff or exit, update `HANDOFF.md` with a short factual checkpoint: what changed, files, branch/commit/PR, test evidence, blockers, and next exact step. Commit and push the update. If unable to push, report that clearly and supply the checkpoint text; never claim it was saved.

**Never automatically restart a failed AI coding job.** First inspect committed progress and owner approval. Use Kimi 2 by default for routine coding; reserve Kimi 3 for justified complex work. This policy does not prove the runtime model currently selected.

When concurrent agents work, read latest `HANDOFF.md` before editing and do not overwrite another agent's updates. Never expose secrets.

## ERP master roadmap (owner request, 2026-11-09)
Before choosing a task, read `docs/ERP_MASTER_PLAN.md`, `reports/erp-roadmap.json`, and master issue #87. Claude is the implementation owner; ChatGPT reviews acceptance evidence. Use a stable roadmap task ID in each implementation issue/PR. Existing work must be reconciled against acceptance criteria before `verified`. After each checkpoint update the canonical JSON, HANDOFF, and sanitized public `elsousypharmacy-create/pharmacy/nova-status.json` mirror; do not include customer data or secrets. If mirror publication fails, record the failure and do not claim the dashboard is current. Never count CI success, deployment, or issue closure alone as product acceptance. Scope/weight changes require a new planVersion and changelog.
