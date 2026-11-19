# Production Worker status (nova-rx-api)

Read-only snapshot. **Do not treat this as a deploy request.** Values are flag *names* and Git SHAs only — no secrets, tokens, or PINs.

Updated: 19 Nov 2026, 15:30 Asia/Riyadh, against `origin/main` at `c03fbb0` (queue reconcile).

## Worker and database

| Item | Value |
|---|---|
| Worker name | `nova-rx-api` |
| Wrangler env | `[env.production]` in `backend/wrangler.toml` |
| `NOVA_ENV` | `production` |
| D1 database name | `nova-rx-production` |
| Allowed CORS origin | `https://nova-rx-preview.elsousypharmacy.workers.dev` |

## Flags in wrangler production vars

These are **on** in `backend/wrangler.toml` `[env.production.vars]` since S1-11 (`f02e5dd`, 17 Nov 2026, 11:19 Asia/Riyadh; commit message records owner approval to publish, and that nobody was using production yet):

- `NOVA_AUTH = "1"`
- `NOVA_SYNC = "1"`
- `NOVA_SALES_WRITES = "1"`

Still **off / unset** in production vars:

- Frontend device flag `novaBackend.enabled` — stays **OFF** on every device until the owner turns it on per device. The production API can accept writes, but the POS app should not call production until that flag is enabled.
- `NOVA_ONBOARDING` — not set in production (onboarding routes stay disabled there until S4-05 / an explicit owner decision).
- Staging-only inbox send flags (`NOVA_INBOX_SEND`, `NOVA_INBOX_SEND_MEDIA`, `NOVA_INBOX_SEND_VOICE`) are **not** set in production vars (photo/voice send stays staging-only).

The test `tests/unit/wrangler-stage1-flags.check.mjs` asserts the three server flags are `"1"` in both staging and production, and unset in top-level dev `[vars]`.

## Last production deploy

- Workflow: `deploy-backend-production.yml`
- Run: [44139526065](https://github.com/elsousypharmacy-create/nova-rx/actions/runs/44139526065) (workflow_dispatch, success)
- Created: 17 Nov 2026, 20:40 Asia/Riyadh (17:40:15Z)
- SHA deployed: `5dbe4e2` (`chore(preview): s3-01f build (paged pull)`, 17 Nov 2026, 16:56 Asia/Riyadh)

No production deploy has been run since that date. As of `c03fbb0` (19 Nov 2026, 15:14 Asia/Riyadh), `origin/main` is **148 commits** ahead of `5dbe4e2`. Later UI and WhatsApp work from 18–19 Nov is therefore **not** on the production Worker.

A production deploy earlier the same day failed: run [44046870892](https://github.com/elsousypharmacy-create/nova-rx/actions/runs/44046870892) at 11:27 Asia/Riyadh; a later dispatch the same morning succeeded.

## Backups

Daily encrypted export of D1 `nova-rx-staging` and `nova-rx-production` (separate GitHub Actions artifacts, no R2): `.github/workflows/d1-backup.yml`, added for production in S1-09 (`482a301`). Scheduled runs succeeded on 17, 18, and 19 Nov 2026 (for example [44487631869](https://github.com/elsousypharmacy-create/nova-rx/actions/runs/44487631869) on 19 Nov, 11:26 Asia/Riyadh). This is not a live restore drill.

## What this does *not* mean

- Stage 1 is not field-complete: there is no live tablet-to-phone sale check, and `/whatsapp` on staging/preview is still PIN-less (S1-01 was reverted; S1-07 is still pending).
- The repo remains public by owner choice (S1-12 is checklist-only).
- Do not deploy production, change visibility, enable the Claude scheduler, or set device flags from this document.
