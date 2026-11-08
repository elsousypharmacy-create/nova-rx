# KIMI_CONTEXT — NOVA Rx (compact durable handoff)

## Read order and token policy
1. Read this file first, then the exact approved GitHub issue body.
2. Inspect only the relevant code ranges with rg/sed. Do NOT print all of index.html.
3. Check BUILD_REPORT.md for previously completed defect IDs and tests, and qa-reports on qa/reports only when the issue needs a specific QA finding. Avoid repeatedly fetching whole reports.
4. One defect or tightly related pair per run. Minimal edits, targeted test, concise handoff. Do not re-analyze completed fixes.
5. No secrets, workflow modifications, backend/database migrations, autonomous merge/deploy.
6. If quota/provider error occurs, do not retry automatically. Leave remaining work for the next explicitly approved run.

## Verified history
- Issue #2 was implemented and tested in BUILD_REPORT.md: 21/21 acceptance checks reported passing for invoice discount/customer draft persistence, search mode badge click, receipt close overlay and i18n DOMStringMap error.
- Preserve those fixes; the report documents browser-local prototype persistence and no backend synchronization.
- Issue #4 covers remaining POS UX defects. The latest 2026-11-05 run 42033433619 failed with provider.api_error: 5-hour usage limit, while working on issue #4. No successful commit/push from that run is confirmed.
- During that failed run, Kimi identified a conflict: README describes customer-first New Sale, while accepted issue #2 flow is product-first. Proposed approach was documentation consistency rather than changing accepted behavior. This is a proposal, not a completed fix.
- The failed run started addressing labels panel blocking the next sale, FAB overlap/mislabel, then language issues; these in-run edits must NOT be assumed persisted.

## Issue #4 priority queue (verify against actual issue and latest branch)
P1: UX-LABELS-PANEL-BLOCKS-NEXT-SALE; UX-MIXED-LANG; UX-LANG-SWITCH-WEAK; UX-FAB-OVERLAP-mobile. UX-CHECKOUT-OVERLAY-LEAK only if reproducible.
P2: UX-SEARCH-EMPTY; UX-DISCOUNT-NO-FEEDBACK; UX-AI-NO-RETRY; UX-FAB-MISLABEL; UX-PRODUCTS-FILTER-EMPTY.
P3: UX-NEW-SALE-MODE; UX-EMPTY-CHECKOUT-NO-HINT; UX-TOAST-EN; UX-TOAST-COVERS-CHECKOUT; UX-DISCOUNT-ZERO-FIELD-CLEARED.

## Deliverable format
Update BUILD_REPORT.md with: issue, defect ID(s) addressed, changed files, tests actually run/results, remaining IDs, limitations. Keep it short and precise. GitHub Actions creates an isolated branch and draft PR only on successful CLI exit; independent Grok QA must validate exact SHA before any merge.

## Procurement track (epic: Supplier Integration & Procurement Intelligence)
- Spec: `docs/procurement/ARCHITECTURE.md` (contract + offer schema = source of truth). Read only the section your issue names.
- Code lives in `worker/procurement/` (ES modules, no dependencies, Workers + Node 22). Tests: `tests/unit/procurement-*.check.mjs`, plain `node:assert`, run by `procurement-unit.yml`.
- Never call supplier websites or APIs, never add credentials, never automate orders. Fixtures are synthetic.
- Do not modify `worker/supplier-price-service.js` or `supplier-compare.html` unless the issue says so.
