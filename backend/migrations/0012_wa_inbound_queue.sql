-- 0009: WhatsApp inbound webhook queue (N114). Additive only.
-- Dedup by Meta message id (UNIQUE). status: pending -> done | dead (dead-letter after max attempts).
CREATE TABLE IF NOT EXISTS wa_inbound_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_message_id TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wa_inbound_queue_due ON wa_inbound_queue (status, next_attempt_at);
