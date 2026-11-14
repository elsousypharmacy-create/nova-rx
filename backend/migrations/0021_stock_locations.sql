-- 0021_stock_locations (UX37-14): additive only. NOT applied to any real D1 (owner decision); flag NOVA_BRANCHES default OFF.
CREATE TABLE IF NOT EXISTS stock_locations (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'main' CHECK (kind IN ('main','shelf','fridge','controlled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, branch_id, id)
);
CREATE INDEX IF NOT EXISTS idx_stock_locations_branch ON stock_locations (tenant_id, branch_id);
-- Link table instead of ALTERing inventory_batches: location_id is nullable by construction (no row = unassigned).
CREATE TABLE IF NOT EXISTS inventory_batch_locations (
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  batch_id TEXT NOT NULL REFERENCES inventory_batches(id),
  location_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (batch_id),
  FOREIGN KEY (tenant_id, branch_id, location_id) REFERENCES stock_locations (tenant_id, branch_id, id)
);
CREATE INDEX IF NOT EXISTS idx_batch_locations_loc ON inventory_batch_locations (tenant_id, branch_id, location_id);
