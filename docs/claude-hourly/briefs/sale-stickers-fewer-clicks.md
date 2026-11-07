# Sale stickers — full power, fewer clicks

Updated: 7 November 2026 (Asia/Riyadh)  
Queue id: CH-1  
Model: sonnet  
Live target: `#sale` → `#novaLabelsPanel` on `nova-rx-preview`

## Goal

Keep **every current sticker capability**. Cut **clicks and reading**. Same print quality. No new visual theme for decoration.

**Reference UX (Ahmed):** interaction feel of the **previous live version** (backup / v247 — `nlSimple` + V95 flow: left form, grid, footer, approval, pay). Not a literal revive of V95 as the product name set. Current v248 studio is too much chrome. Target = prior path simplicity + studio/print completeness.

Path (whole invoice vs one med) undecided — keep both reachable; shortest safe default.

## Must keep

- Patient: age سنة/شهر, حامل / رضاعة required
- Meds: tabs 1..N, add med, one focused editor
- Preview + select for print
- Print settings (may stay collapsed)
- Pharmacist approval before print
- Existing AI assist
- Invoice auto-open / new-sale close
- RTL Arabic pharmacist flow

## Change (UX only)

1. One primary path: ready → approve → print (~3 decisive taps)
2. Hide advanced chrome until needed (stepper noise, duplicate previews, extra helper text)
3. Smart defaults (last print settings, select complete meds, remember age unit)
4. Less reading; errors only when blocking print
5. Do not simplify the printed sticker itself

## Out of scope

- `pharmacy` repo, new paid APIs, secret changes
- Third sticker design language
- POS rewrites outside sale sticker panel

## Acceptance

- Must-keep features reachable in ≤1 extra tap from the main path
- Clearer/fewer chrome than current studio
- Sale-sticker tests updated/pass or reported fail/not-tested
- Branch + draft PR (not main). No deploy by Claude

## Deliverable

Draft PR + write `docs/claude-hourly/results/latest.md` (status, PR URL, tests, blockers).
