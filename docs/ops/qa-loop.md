# Continuous QA loop

Every 2 hours `.github/workflows/qa-loop.yml` runs `.nova/qa_loop.py`, which (one cycle at a time) commits
`.nova/inbox/qa-loop-<N>.json` with one audit task `UX<N>` (focus area rotates over 14 areas covering every main screen). The audit writes
`.nova/qa/qa-loop-<N>.md`, up to 12 frontend-only fix tasks and, only if there are fixes, a task titled
`Build worker/live/nova-rx-preview.qa-<N>.js (qa-loop, no deploy)`. The queue file is never touched by qa_loop.py.

## Auto preview deploy
When that build task is `done` and the artifact is on main, `cloud_scheduler.py` runs the guarded `deploy-worker.yml`
(nova-rx-preview ONLY): dry run, then real deploy, then a smoke (HTTP 200 on `/`, `/emergency/stock.json` valid and non-empty,
search present in the page). The workflow itself restores the pre-deploy code if upload/verify fails; if the scheduler smoke
fails, it redeploys the previously auto-deployed artifact (recorded in `preview_deploy.previous`). State is in the task's
`preview_deploy` field. Limit: the scheduler only has `GITHUB_TOKEN`, so the Cloudflare version id is not recorded, and
the first-ever auto deploy has no previous artifact to roll back to (it fails and needs a human). Never production,
`nova-rx-api-staging`, GATE-17, or migrations.

## Pause / resume
Set repository variable `QA_LOOP_DISABLED=true` (Settings > Secrets and variables > Actions > Variables, or
`gh variable set QA_LOOP_DISABLED --body true`). The workflow job is skipped and `qa_loop.py` exits. Resume: delete it or set `false`.
Already-created tasks keep running; to stop the auto deploy of a queued build, mark its task `failed` in the queue.

## Workflow
`.github/workflows/qa-loop.yml` (source copy also at `docs/ops/qa-loop.workflow.yml`) runs on a 2-hourly cron (`17 */2 * * *`) and `workflow_dispatch`. Each audit must click every top-nav link and primary header button and flag any 404, blank page, or console error.
