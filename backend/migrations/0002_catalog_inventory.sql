-- 0002: catalog + inventory. Additive only. Money = integer minor units (e.g. piasters).
-- Every row carries tenant_id + branch_id. Quantities are integers in base units.

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  base_unit TEXT NOT NULL DEFAULT 'unit',
  price_minor INTEGER NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (cost_minor >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, branch_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_products_scope ON products (tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS product_barcodes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  barcode TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, branch_id, barcode)
);
CREATE INDEX IF NOT EXISTS idx_barcodes_product ON product_barcodes (product_id);

CREATE TABLE IF NOT EXISTS product_units (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  unit_name TEXT NOT NULL,
  factor INTEGER NOT NULL CHECK (factor > 0),
  price_minor INTEGER NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (product_id, unit_name)
);

CREATE TABLE IF NOT EXISTS inventory_batches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  batch_no TEXT NOT NULL,
  expiry_date TEXT,
  qty_on_hand INTEGER NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
  cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (cost_minor >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, branch_id, product_id, batch_no)
);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON inventory_batches (tenant_id, branch_id, expiry_date);

-- Append-only ledger: corrections are new rows (reversal), never edits.
CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  batch_id TEXT REFERENCES inventory_batches(id),
  kind TEXT NOT NULL CHECK (kind IN ('receipt','sale','return','adjustment','count','transfer_out','transfer_in','reversal')),
  qty_delta INTEGER NOT NULL CHECK (qty_delta <> 0),
  unit_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_minor >= 0),
  ref_type TEXT,
  ref_id TEXT,
  reverses_id TEXT REFERENCES inventory_movements(id),
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_movements_product ON inventory_movements (tenant_id, branch_id, product_id, created_at);

CREATE TRIGGER IF NOT EXISTS trg_inventory_movements_no_update
BEFORE UPDATE ON inventory_movements
BEGIN
  SELECT RAISE(ABORT, 'inventory_movements is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_inventory_movements_no_delete
BEFORE DELETE ON inventory_movements
BEGIN
  SELECT RAISE(ABORT, 'inventory_movements is append-only');
END;

CREATE TABLE IF NOT EXISTS stock_counts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  batch_id TEXT REFERENCES inventory_batches(id),
  expected_qty INTEGER NOT NULL CHECK (expected_qty >= 0),
  counted_qty INTEGER NOT NULL CHECK (counted_qty >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','applied','cancelled')),
  counted_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_counts_scope ON stock_counts (tenant_id, branch_id, status);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,           -- source branch
  to_branch_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  batch_id TEXT REFERENCES inventory_batches(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','shipped','received','cancelled')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (to_branch_id <> branch_id)
);
CREATE INDEX IF NOT EXISTS idx_transfers_scope ON stock_transfers (tenant_id, branch_id, status);
