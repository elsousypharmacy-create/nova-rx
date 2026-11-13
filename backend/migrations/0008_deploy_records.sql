-- 0008: deploy/version record (N108). Additive only. Rows are appended by the release process; never updated in place except status.
CREATE TABLE IF NOT EXISTS deploy_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,
  sha TEXT NOT NULL,
  env TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live','superseded','rolled_back','failed')),
  cf_version_id TEXT,
  note TEXT,
  deployed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deploy_records_env ON deploy_records (env, id);
