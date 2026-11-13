-- 0018: SaaS per-tenant usage metering + quotas (N123). Additive only.
CREATE TABLE IF NOT EXISTS tenant_usage (
  tenant_id TEXT NOT NULL,
  period TEXT NOT NULL,            -- YYYY-MM
  metric TEXT NOT NULL,            -- requests | storage_bytes | ai_calls | jobs
  used INTEGER NOT NULL DEFAULT 0,
  denied INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, period, metric)
);
CREATE TABLE IF NOT EXISTS tenant_quotas (
  tenant_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  limit_value INTEGER NOT NULL,    -- per period (storage_bytes: absolute cap)
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, metric)
);
