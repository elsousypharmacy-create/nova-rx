# NOVA Rx — CURRENT (snapshot, 60 lines max; read this, not all of HANDOFF.md)
Last updated: 2026-11-28 (Batch 4 non-sales workspace declutter: tabbed Settings + search, categorized Tools hub, Bento reports, quiet hints + preview rcv34). GitHub `main` wins; old log: `docs/archive/current-history/CURRENT-until-2026-11-23.md`.

## Boot order
1. `AGENTS.md`  2. `CURRENT.md`  3. Relevant section of `HANDOFF.md` + Issue #87  4. `docs/skills/nova/SKILL.md`  5. `docs/ERP_MASTER_PLAN.md` & `reports/erp-roadmap.json` for scope/acceptance. Related: `docs/procurement/SUPPLIER_OPERATION_RECONCILIATION_DESIGN.md`, `.github/workflows/deploy-worker.yml`, `tests/unit/worker-gemini-route.check.mjs`.

## Priorities
1. Core pharmacy operational reliability (POS, credit, discount limits, inventory/lots, catalog CRUD, receiving, customers, shifts, reports, RBAC, encrypted backup, offline `/emergency-sales.html`).
2. Commercial readiness for selling NOVA Rx to other pharmacies: white-label pharmacy profile (`nova-rx-pharmacy-profile-v1`), multi-tenant onboarding behind `NOVA_ONBOARDING` / `novaOnboarding`, clean operator/buyer deployment docs (`docs/product/GO-LIVE.md`).

## Who is on what
- **Antigravity:** Lead manager and primary implementer on `main` (batches reviewed independently before push).
- **Claude sessions:** Secondary implementer/reviewer on request only; QA loop disabled manually by owner.

## Merged to main
- PR `#584` (`ff80d56`): slimmed `CURRENT.md`; `4ab71bf`: governance update (`AGENTS.md`).
- `e5e5a97` + `4839998` (`rcv31`): Batch 1 fixes (shift double-close guard, async autoPrint, live stock/customer refresh, lazy receiving embed, receiving mouse click, settings card layout) deployed to preview; `Non-WhatsApp UX checkout and page regression checks`, `Perf budget`, `Secret scan` green.
- Batch 2 (`09ca08a`, `rcv32`): catalog add/edit (`novaCatalogApi` + `#novaAddProductBtn` + Item Card edit), white-label Pharmacy Profile (`novaPharmacyProfile`), English settings sub-tabs, `/purchases` mobile nav unclipped, 5 legacy UX tests fixed, `commercial-readiness.mjs` E2E + backup/restore drill.
- Batch 3 (`48f5a8d`, `rcv33`): Apple Native Light Mode, bulk CSV import, 3-step setup wizard, auto-hide demo pill, mobile/modal polish.
- Batch 4 (`rcv34`): Non-sales workspace declutter — tabbed Settings (`#novaSetSearch` + section tabs), categorized Tools hub (`#novaToolsCats`), Bento Reports grid (keeping `#novaSupplierAccountsSection` at root), calm dashboard offline notice + quick wizard CTA, full non-sales Light Mode, quieter `.nx-i`.

## Open PRs
- Check GitHub for legacy draft PRs (`#553`, `#566`) and issues (`#545`, `#550`) before acting.

## Known breakages
- CI `Playwright POS smoke` previously failed on `ux413-wa-voice.mjs` (`Send a photo... + 24 h note`); physical phone, thermal printer, and live second-device restore still require the owner.
- `worker/live` holds >10 preview artifacts (pruning is owner-only). Local print agent / cash drawer pulse is not installed yet.
- Perf budget: `index.html` must stay <= +5%; keep new screens in lazy modules or modals.

## Waiting on the owner
Physical phone + thermal printer go-live check (`docs/product/GO-LIVE.md`), D1/Cloudflare production deploy decision, billing/payment provider choice (`NEEDS-OWNER.md`), commercial pricing/legal review (`docs/backend/legal/`), pruning `worker/live`.

## Never without specific owner approval
Production deploy (`deploy-backend-production.yml`), real supplier cart writes/orders/payments, reading/changing secrets or PINs, editing `.github/workflows/*`, destructive DB deletes, unlocking unknown supplier operations, spending money.

## Update rule
Edit this file in the same reviewed batch/PR as the change (max 60 lines). Full history stays in `HANDOFF.md` and `docs/archive/current-history/`.
