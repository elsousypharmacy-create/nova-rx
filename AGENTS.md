# AI Agent Instructions — NOVA Rx

These instructions apply to every AI agent operating in this repository, including ChatGPT, Kimi, Grok, and review agents.

**First action:** Read `HANDOFF.md` and inspect current issue/branch/PR/CI status before starting work. Follow owner priorities and token-saving rules in that file.

**Mandatory progress persistence:** After each meaningful batch, and before handoff or exit, update `HANDOFF.md` with a short factual checkpoint: what changed, files, branch/commit/PR, test evidence, blockers, and next exact step. Commit and push the update. If unable to push, report that clearly and supply the checkpoint text; never claim it was saved.

**Never automatically restart a failed AI coding job.** First inspect committed progress and owner approval. Use Kimi 2 by default for routine coding; reserve Kimi 3 for justified complex work. This policy does not prove the runtime model currently selected.

When concurrent agents work, read latest `HANDOFF.md` before editing and do not overwrite another agent's updates. Never expose secrets.

## ERP master roadmap (owner request, 2026-11-09)
Before choosing a task, read `docs/ERP_MASTER_PLAN.md`, `reports/erp-roadmap.json`, and master issue #87. The premium agent ownership policy below supersedes older default implementation-owner statements. ChatGPT manages task assignment and acceptance evidence; Claude Sonnet is the primary implementation agent for premium product features; Claude Opus is reserved for high-risk architecture/security review. Use a stable roadmap task ID in each implementation issue/PR. Existing work must be reconciled against acceptance criteria before `verified`. After each checkpoint update the canonical JSON, HANDOFF, and sanitized public `elsousypharmacy-create/pharmacy/nova-status.json` mirror; do not include customer data or secrets. If mirror publication fails, record the failure and do not claim the dashboard is current. Never count CI success, deployment, or issue closure alone as product acceptance. Scope/weight changes require a new planVersion and changelog.

## Premium product agent policy — owner decision 2026-11-10 (takes precedence over older routing rules)
- Quality first: NOVA Rx is a premium, production-intended pharmacy ERP/POS. Passing CI alone does not establish product acceptance.
- ChatGPT: product manager, issue decomposition, scope/ownership coordination, initial QA and acceptance tracking; does not silently assign implementation to itself.
- Claude account 1 / Sonnet: primary developer for core product features, premium UX, multi-file integration and nontrivial bugs.
- Claude account 2 / Opus: independent reviewer for architecture, security, financial/inventory correctness and high-risk changes; not routine implementation or automatic review of every cosmetic change. Sonnet may review ordinary changes where appropriate.
- Kimi and Gemini: narrowly scoped, independent implementation/tests/docs tasks with explicit file boundaries; their output requires tests and review before merge. Grok: independent browser/live QA; QA observations do not authorize code changes.
- Haiku is not the default developer or approval authority for core premium features; use only for low-risk bounded tasks if explicitly assigned.
- Ownership lock: BEFORE editing, check current issue, PR, branch and HANDOFF; post a claim on the issue with agent/model, exact file paths, branch, acceptance criteria and status `IN_PROGRESS`. If another active claim overlaps files or scope, STOP and coordinate; never launch a second agent on the same work. A label/assignment is not evidence of an actual running agent; verify Actions/run state.
- One active implementation task per agent; use a separate branch and PR per task. No cross-agent edits to another agent's branch without explicit handoff. Existing #103–#107 Kimi queue and #111/#112 Aumet work must be reconciled before reassignment.
- Handoff on quota/error: checkpoint committed changes, tests, known failures and exact next step; change issue status to `BLOCKED` or `READY_FOR_HANDOFF`, release ownership explicitly, then new agent claims it. Never auto-retry failed jobs or duplicate a run.
- Review gate: author cannot self-approve high-risk changes. Require independent review and focused tests; for checkout, stock, supplier-cart writes, permissions and security, verify negative cases and live behavior where applicable. No merge/deploy without established authorization and evidence.
- If these rules conflict with an older instruction saying Claude owns all implementation or Kimi is the default for every coding task, this section wins. Agent model availability and account identity are NOT verified merely by this policy; never claim a specific model/account was used without runtime evidence.
