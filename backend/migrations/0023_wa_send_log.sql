-- 0023: audit log of pharmacist WhatsApp replies sent from the in-app conversations screen (owner approved 2026-11-14). Additive only.
CREATE TABLE IF NOT EXISTS wa_send_log (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  client_id TEXT,
  ip_hash TEXT,
  sent_by TEXT,
  text_len INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT 0,
  finished_at INTEGER,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_wa_send_log_conv ON wa_send_log (tenant_id, conversation_id, created_at);
