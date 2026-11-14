-- 0021: batch recall marker used by the stock-transfers API (UX51). Additive only; not applied to any real D1 by this change.
CREATE TABLE IF NOT EXISTS recalled_batches (
  tenant_id TEXT NOT NULL,
  batch_id TEXT NOT NULL REFERENCES inventory_batches(id),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, batch_id)
);
