-- 0018: SaaS plans + entitlements (N122). Additive only. Expiry => read-only mode; data is never deleted.
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  features TEXT NOT NULL DEFAULT '[]',
  limits TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  tenant_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT,
  provider TEXT,
  provider_ref TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
