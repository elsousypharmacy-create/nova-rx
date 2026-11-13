-- 0010: prescription-to-order (N117). Additive only. Attachment is an AES-GCM encrypted, size-capped blob stored in D1 (no R2).
CREATE TABLE IF NOT EXISTS rx_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_ref TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','extracted','reviewed','customer_approved','customer_rejected','reserved')),
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  blob_iv TEXT NOT NULL,
  blob_enc TEXT NOT NULL,
  extraction_json TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  customer_decision_by TEXT,
  customer_decision_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rx_orders_tenant ON rx_orders (tenant_id, status, created_at);
CREATE TABLE IF NOT EXISTS rx_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rx_order_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  extracted_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  is_alternative INTEGER NOT NULL DEFAULT 0 CHECK (is_alternative IN (0,1)),
  original_product_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_rx_items_order ON rx_order_items (rx_order_id);
CREATE TABLE IF NOT EXISTS rx_approved_alternatives (
  tenant_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  alternative_product_id TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, product_id, alternative_product_id)
);
