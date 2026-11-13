# OFF-04 — Scheduled encrypted backup and restore drill

Module: `backup-schedule.js` (pure, local only, no backend). Test: `node tests/unit/backup-schedule.check.mjs`.

- Snapshot = existing sales backup JSON (`novaSales.exportBackup`) encrypted with AES-256-GCM, key from passphrase via PBKDF2-SHA256 (150k iterations). Newest 5 kept.
- Schedule interval is capped at 15 min, so **RPO ≤ 15 min** (default 10 min). The drill reports `rpoMs` = age of the newest snapshot.
- Restore drill: decrypt + validate with the same parser as import (`parseBackup`), read-only. `rtoMs` is the measured decrypt+validate time; target **RTO ≤ 60 min** (`rtoOk`). Real-device figures must be recorded from the drill in the app; the unit test only proves the measurement and the thresholds.
- Owner download requires the `data.export` permission and a fresh re-auth (`novaAuthUI.guard` / `sensitiveAllowed`).
- NOT done: UI wiring in index.html (button/Arabic RTL strings), timer hookup, passphrase UX. Next step for a follow-up task.
