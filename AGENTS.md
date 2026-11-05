# AI Agent Instructions — NOVA Rx

These instructions apply to every AI agent operating in this repository, including ChatGPT, Kimi, Grok, and review agents.

**First action:** Read `HANDOFF.md` and inspect current issue/branch/PR/CI status before starting work. Follow owner priorities and token-saving rules in that file.

**Mandatory progress persistence:** After each meaningful batch, and before handoff or exit, update `HANDOFF.md` with a short factual checkpoint: what changed, files, branch/commit/PR, test evidence, blockers, and next exact step. Commit and push the update. If unable to push, report that clearly and supply the checkpoint text; never claim it was saved.

**Never automatically restart a failed AI coding job.** First inspect committed progress and owner approval. Use Kimi 2 by default for routine coding; reserve Kimi 3 for justified complex work. This policy does not prove the runtime model currently selected.

When concurrent agents work, read latest `HANDOFF.md` before editing and do not overwrite another agent's updates. Never expose secrets.
