# Claude hourly line (repo)

Updated: 7 November 2026 Asia/Riyadh  
Repo paths below are what local Claude Code reads from a `nova-rx` checkout.

## What this is

Scheduled Claude Code Pro on the machine works from this folder. The coordinator (Cursor Project) writes briefs here via PR/merge; Claude executes; results land under `results/`.

## Multi-task queue (allowed)

- You may keep **several** pending tasks in `queue.md`.
- Each hourly run takes the **top pending** brief that is not DONE/BLOCKED.
- Tasks must be **distinct**: never enqueue the same brief text verbatim, and never re-open a DONE brief with only a copy-paste of the old wording. New work needs a new goal, acceptance, or scope delta.
- One run = one brief (finish or hard-block). Do not start a second brief in the same hour unless the brief itself lists a tiny related pair and names both.

## Files

| Role | Path |
|------|------|
| Line rules | `docs/claude-hourly/LINE.md` |
| Queue | `docs/claude-hourly/queue.md` |
| Active pointer | `docs/claude-hourly/current.md` |
| Brief bodies | `docs/claude-hourly/briefs/*.md` |
| Kickoff text | `docs/claude-hourly/kickoff.txt` |
| Latest result | `docs/claude-hourly/results/latest.md` |
| Helper script | `docs/claude-hourly/run-hourly.sh` |

## Hourly command

From repo root (with flock so hours do not overlap):

```bash
flock -n /tmp/nova-claude-hourly.lock docs/claude-hourly/run-hourly.sh
```

Wire that line to cron or your scheduler once per hour.

## Hard rules every run

1. Read `LINE.md` + `current.md` + the linked brief only  
2. Model from the brief header (`Model:`)  
3. No live Worker deploy unless the brief says deploy (default: no)  
4. No secret values in chat, commits, or results  
5. No commit to `main`; branch + draft PR when the brief asks  
6. Do not edit `.github/workflows` unless the brief says so  
7. Do not touch `pharmacy` unless the brief says so  
8. If blocked: write `results/latest.md` and exit  

## Coordinator duty

- Keep queue entries unique (no letter-identical repeats)  
- After review: mark DONE in `queue.md`, merge/deploy per standing rules, enqueue the next distinct brief  
- Ping Ahmed only for results or real blockers  
