-- 0025 (UX414): Web Push subscriptions for the NOVA WhatsApp PWA. Additive only; KV (wapush:*) stays as a fallback.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_tenant ON push_subscriptions (tenant_id, updated_at);
