-- 0011: MSG-02 unified inbox server (N115). Additive only.
CREATE TABLE IF NOT EXISTS inbox_conversations (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  customer TEXT NOT NULL DEFAULT '',
  customer_id TEXT,
  order_id TEXT,
  assignee TEXT,
  mode TEXT NOT NULL DEFAULT 'bot' CHECK (mode IN ('bot','human')),
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE IF NOT EXISTS inbox_messages (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  dir TEXT NOT NULL CHECK (dir IN ('in','out')),
  text TEXT NOT NULL,
  status TEXT CHECK (status IS NULL OR status IN ('sent','delivered','failed')),
  at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_inbox_messages_conv ON inbox_messages (tenant_id, conversation_id, at);
