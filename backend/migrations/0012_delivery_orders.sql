-- 0012: OPS-03 delivery orders (N119). Additive only.
CREATE TABLE IF NOT EXISTS delivery_orders (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  order_ref TEXT,
  customer TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','assigned','picked_up','delivered','collected','failed')),
  courier TEXT,
  failure_reason TEXT,
  pending_address TEXT,
  pending_reason TEXT,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE IF NOT EXISTS delivery_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT,
  from_status TEXT,
  to_status TEXT,
  detail TEXT,
  at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_events_d ON delivery_events (tenant_id, delivery_id, at);
