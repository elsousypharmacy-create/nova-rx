-- 0017: SaaS tenant onboarding (N121). Additive only. Rollback = soft-disable (status/disabled_at), never delete.
ALTER TABLE tenants ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE tenants ADD COLUMN sandbox INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN disabled_at TEXT;
CREATE TABLE IF NOT EXISTS onboarding_steps (
  tenant_id TEXT NOT NULL,
  step TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  detail TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, step)
);
