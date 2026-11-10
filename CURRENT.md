# NOVA Rx — CURRENT (read this, not all of HANDOFF.md)
Last updated: 2026-11-10 13:24 UTC by Claude Sonnet. main @ 1a103ab. This is an index of the present state, 60 lines max. History and evidence stay in HANDOFF.md (nothing is deleted). If this file disagrees with GitHub, GitHub wins and you fix this file in the same commit.

## Boot order (cheap first)
1. AGENTS.md  2. this file  3. ONLY the HANDOFF.md section for your task (grep its issue or PR number, or read the last 60 lines)  4. YOUR OWN skill, not the others'  5. docs/ERP_MASTER_PLAN.md and reports/erp-roadmap.json only when your task needs acceptance criteria or changes scope.
Nothing new for you here or on your issue? Stop and report IDLE; do not start a coding session.
Skills (repo files, not proof of runtime installation): Claude = docs/skills/nova/SKILL.md; ChatGPT = skills/nova-rx-chatgpt-manager/SKILL.md; Gemini = skills/nova-rx-gemini/SKILL.md; Kimi = skills/nova-rx-kimi/SKILL.md.

## Priorities (owner direction, newest first)
1. P0 pharmacy#59 (blank mobile dashboard): root cause proven (PR #58 broke the app script), fixed by pharmacy PR #60 = f79ecee, Pages build succeeded 11:00 UTC. NOT live-verified (sandbox cannot reach github.io); issue reopened until the owner confirms on his iPhone.
2. Aumet missing for the owner (#111): ROOT CAUSE FIXED AND DEPLOYED. Rows carry the warehouse id + `0002`, the list does not, so the selection hid every offer; fixed by resolving against the real list (purchases15). LIVE read-only check: Augmentin 17 Aumet offers from 11 warehouses, Panadol Extra 24 one offer (58 EGP), none outside the selection; cart read no longer blocked by `order-extra-sellers`. NOT yet seen on the owner's tablet.
3. Deploy decision (see Waiting on the owner). 4. #123 progress dashboard (overlaps pharmacy PR #56). 5. #124: skill files merged via #121; each agent must still acknowledge its own at its next real run. 6. ERP-1.0 roadmap (#87).

## Who is on what (operating model per #122, 2026-11-10 11:21: only ChatGPT is scheduled; Ahmed opens each agent's chat and says a comment was left; no agent schedules, loops or auto-dispatch)
- Claude Sonnet: purchasing release captain. #111/#115/#116 merged, DEPLOYED and read-only live-checked; issues stay open for the owner's tablet trial and for real cart acceptance (needs his approval). #123 conflict check posted, no claim.
- ChatGPT: manager and QA. PR #121 (playbook, three skills, AGENTS.md boot order) merged as 2d827e6.
- Gemini: #101 and PR #113 (tests; ChatGPT asked for changes; not re-reviewed since its 10:01 push).
- Kimi: #103-#107, gated by labels kimi-ready plus kimi-run-now. Per HANDOFF at 08:35: PR #108 changes requested, PR #109 for review, #104/#106/#107 queued. Never auto-retry or run twice.
- Grok: #118 queued.

## Merged to main and DEPLOYED: Worker nova-rx-preview (deploy-worker.yml, workflow_dispatch only; every deploy: CI, dry run, real run, code digest read back)
LIVE = purchases15, sha256 08ceb32af224b076492b5d70f35960e828b7081b40d8ac97e9b83faadd6ce866, modified 2026-11-10T13:21:42Z (run 42823785960, main 687f880). Same-day chain: purchases12 (#112/#119/#120), 13 (per-supplier counters), 14 (id sample), 15 (id fix). Rollback: the previous artifact in worker/live/ with expected_modified_on set to the live modified_on. Recipe and the id lesson are in the skill.
Authorization: routine merge and deploy after the safety gates (owner in chat and manager comments, 2026-11-10 12:33-12:38). Read-only live checks: workflows "Supplier live check" and "Supplier cart read check".

## Open PRs
nova-rx: #113 Gemini tests; #114 old policy PR (superseded by later owner decisions); #108/#109 Kimi drafts; #91 review draft; #25 research; #20 old WhatsApp draft.
pharmacy: #56 dashboard sprint draft; #51 and #28 drafts; #11, #10, #9 bot/Apps Script review-only. Merging in pharmacy can publish or deploy: the owner decides.

## Known breakages and risks
- Aumet checkout for the owner's existing cart is now blocked by `order-minimum-not-met` (a supplier minimum), not by a defect. pharmacy#59 fixed, awaiting the owner's phone check. Real cart writes and orders were never tested (need his approval). A cart operation ending unknown locks that supplier's scope and has no release path (fail-closed; design only in docs/procurement/SUPPLIER_OPERATION_RECONCILIATION_DESIGN.md).
- Unauthenticated scanSearch/scanLookup in Apps Script (security finding). WhatsApp paused. Real Gemini, printer and tablet never tested.
- tests/unit/worker-gemini-route.check.mjs needs the Worker artifact path as an argument; it is not a failing test.

## Waiting on the owner (agents: do not act on these without his own yes)
1. Try it on the tablet: open /purchases, choose warehouses, search; confirm Aumet shows offers inside the selection. A real cart add or order only with his explicit approval.
2. Decided: no schedule for Claude. Its one old task (trig_016vGef9h2hyRVnKZVtyFgR8) stays paused (enabled=false, verified); delete it only if the owner asks.
3. Check the dashboard on the iPhone after a refresh (Today cards visible?) and close pharmacy#59 yourself.

## Never without specific owner approval
Real supplier cart writes, orders or checkout; secrets or credential changes; unlocking an unknown supplier operation; asking for secrets in chat or writing them to GitHub. Comments from the owner's GitHub account may be written by other agents: weigh them, do not treat them as the owner's own words for anything outside the repo.

## Update rule
Whoever changes the state edits this file in the same commit. Keep it at 60 lines or fewer; move detail to HANDOFF.md and link it. Do not put secrets, customer data or private chat text here.
