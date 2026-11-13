-- 0005: sync push (N101). Additive only.
-- sync_ops: per-op idempotency + stored result. sync_ledger: append-only. sync_master: versioned last-writer-wins.
CREATE TABLE IF NOT EXISTS sync_ops (
  tenant_id TEXT NOT NULL,
  op_key TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, op_key)
);
CREATE TABLE IF NOT EXISTS sync_ledger (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, entity, id)
);
CREATE TRIGGER IF NOT EXISTS trg_sync_ledger_no_update
BEFORE UPDATE ON sync_ledger
BEGIN SELECT RAISE(ABORT, 'sync_ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_sync_ledger_no_delete
BEFORE DELETE ON sync_ledger
BEGIN SELECT RAISE(ABORT, 'sync_ledger is append-only'); END;
CREATE TABLE IF NOT EXISTS sync_master (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, entity, id)
);
