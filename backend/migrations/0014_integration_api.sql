-- 0009: integration API (N111). Additive only. Keys stored hashed (SHA-256); the plaintext is shown once at creation.
CREATE TABLE IF NOT EXISTS integration_api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '',
  sandbox INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_integration_keys_tenant ON integration_api_keys (tenant_id);
CREATE TABLE IF NOT EXISTS integration_nonces (
  nonce TEXT NOT NULL,
  key_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (key_id, nonce)
);
