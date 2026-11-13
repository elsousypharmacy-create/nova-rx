-- 0009: opening-balance migration approval records (N112). Additive only. Rows are append-only; nothing here applies balances.
CREATE TABLE IF NOT EXISTS balance_migration_approvals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  cutoff_at TEXT NOT NULL,
  report_hash TEXT NOT NULL,
  report_json TEXT NOT NULL,
  rollback_plan TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bma_tenant ON balance_migration_approvals (tenant_id, created_at);
