-- 0018: per-tenant feature flags + opt-in diagnostics (N124). Additive only.
CREATE TABLE IF NOT EXISTS tenant_flags (
  tenant_id TEXT NOT NULL,
  flag TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  rollout_pct INTEGER NOT NULL DEFAULT 100,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, flag)
);
CREATE TABLE IF NOT EXISTS diagnostics_optin (
  tenant_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS diagnostics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  app_version TEXT,
  code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
