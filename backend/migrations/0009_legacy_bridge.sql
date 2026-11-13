-- 0010: INT-01 legacy bridge id map (N110). Additive only. Maps legacy Sheets ids to NOVA ids.
CREATE TABLE IF NOT EXISTS legacy_id_map (
  tenant_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  legacy_id TEXT NOT NULL,
  nova_id TEXT NOT NULL,
  legacy_hash TEXT,
  mapped_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, entity, legacy_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_legacy_id_map_nova ON legacy_id_map (tenant_id, entity, nova_id);
