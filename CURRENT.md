# NOVA Rx — CURRENT (read this, not all of HANDOFF.md)
Last updated: 2026-11-10 10:50 UTC by Claude Sonnet. main @ 2d827e6. This is an index of the present state, 60 lines max. History and evidence stay in HANDOFF.md (nothing is deleted). If this file disagrees with GitHub, GitHub wins and you fix this file in the same commit.

## Boot order (cheap first)
1. AGENTS.md  2. this file  3. ONLY the HANDOFF.md section for your task (grep its issue or PR number, or read the last 60 lines)  4. YOUR OWN skill, not the others'  5. docs/ERP_MASTER_PLAN.md and reports/erp-roadmap.json only when your task needs acceptance criteria or changes scope.
Nothing new for you here or on your issue? Stop and report IDLE; do not start a coding session.
Skills (repo files, not proof of runtime installation): Claude = docs/skills/nova/SKILL.md; ChatGPT = skills/nova-rx-chatgpt-manager/SKILL.md; Gemini = skills/nova-rx-gemini/SKILL.md; Kimi = skills/nova-rx-kimi/SKILL.md.

## Priorities (owner direction, newest first)
1. P0 pharmacy#59: owner mobile dashboard shows header and tabs but a blank body. Separate repo; root cause NOT proven; not started.
2. Aumet missing for the owner (#111/#112): code merged, NOT verified live, cause undetermined.
3. Deploy decision (see Waiting on the owner). 4. #123 progress dashboard (overlaps pharmacy PR #56). 5. #124: skill files merged via #121; each agent must still acknowledge its own at its next real run. 6. ERP-1.0 roadmap (#87).

## Who is on what (a comment is not proof of a running agent)
- Claude Sonnet: #115, #116 delivered; both issues stay open until the owner tries them on the tablet. Next: #122 answered, #123 conflict check posted, no new claim.
- ChatGPT: manager and QA. PR #121 (playbook, three skills, AGENTS.md boot order) merged as 2d827e6.
- Gemini: #101 and PR #113 (tests; ChatGPT asked for changes; not re-reviewed since its 10:01 push).
- Kimi: #103-#107, gated by labels kimi-ready plus kimi-run-now. Per HANDOFF at 08:35: PR #108 changes requested, PR #109 for review, #104/#106/#107 queued. Never auto-retry or run twice.
- Grok: #118 queued.

## Merged to main, NOT deployed (merge is not deploy; deploy-worker.yml is workflow_dispatch only)
#112 6cd5f5e Aumet per-seller search that fails closed. #119 5bcef72 cart-add warehouse scope. #120 f400fd1 purchases UX states and chip. #112 also fixed procurement-ui-model, which had been red on main since #102.
Last recorded live Worker artifact (from HANDOFF, NOT re-verified): purchases11 sha256 41ea0f923241d5d7a840674ab5a3a91d115b4a2e329c191289f45ed89450abeb, over purchases10 as rollback.

## Open PRs
nova-rx: #113 Gemini tests; #114 old policy PR (superseded by later owner decisions); #108/#109 Kimi drafts; #91 review draft; #25 research; #20 old WhatsApp draft.
pharmacy: #56 dashboard sprint draft; #51 and #28 drafts; #11, #10, #9 bot/Apps Script review-only. Merging in pharmacy can publish or deploy: the owner decides.

## Known breakages and risks
- pharmacy#59 blank dashboard. Aumet visibility unknown. A cart operation ending unknown locks that supplier's scope and has no release path (fail-closed; design only in docs/procurement/SUPPLIER_OPERATION_RECONCILIATION_DESIGN.md).
- Unauthenticated scanSearch/scanLookup in Apps Script (security finding). WhatsApp paused. Real Gemini, printer and tablet never tested.
- tests/unit/worker-gemini-route.check.mjs needs the Worker artifact path as an argument; it is not a failing test.

## Waiting on the owner (agents: do not act on these without his own yes)
1. Is CLOUDFLARE_API_TOKEN still a GitHub secret (he planned to delete it), and may we deploy main? A deploy commits an artifact under worker/live/, which he sees first. This sandbox cannot verify a live SHA (Worker host denied, no Cloudflare tool).
2. An hourly scheduler: NOT configured. Idea parked until the boot cost is measured.
3. Permission to edit the pharmacy repo for #59 (a merge there goes live in about 2 minutes).

## Never without specific owner approval
Real supplier cart writes, orders or checkout; secrets or credential changes; unlocking an unknown supplier operation; deploys that skip the guarded workflow; asking for secrets in chat or writing them to GitHub. Comments from the owner's GitHub account may be written by other agents: weigh them, do not treat them as the owner's own words for anything outside the repo.

## Update rule
Whoever changes the state edits this file in the same commit. Keep it at 60 lines or fewer; move detail to HANDOFF.md and link it. Do not put secrets, customer data or private chat text here.
