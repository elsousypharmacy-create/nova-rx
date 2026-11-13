-- 0007: per-tenant/branch change feed for sync pull (N102). Additive only.
-- seq is the monotonic cursor. Deletes are tombstones: a row with deleted=1 (soft flag), never a hard delete.
CREATE TABLE IF NOT EXISTS change_feed (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0,1)),
  payload_json TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_change_feed_scope ON change_feed (tenant_id, branch_id, seq);
