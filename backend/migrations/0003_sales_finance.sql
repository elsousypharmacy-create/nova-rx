-- 0003: sales, purchasing, finance, audit. Additive only. Money = integer minor units.
-- Every row carries tenant_id + branch_id. Quantities are integers in base units.

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  credit_limit_minor INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit_minor >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_scope ON customers (tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS cashier_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  opening_float_minor INTEGER NOT NULL DEFAULT 0 CHECK (opening_float_minor >= 0),
  closing_counted_minor INTEGER CHECK (closing_counted_minor IS NULL OR closing_counted_minor >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cashier_sessions_scope ON cashier_sessions (tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  cashier_session_id TEXT REFERENCES cashier_sessions(id),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','void')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sales_scope ON sales (tenant_id, branch_id, created_at);

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  batch_id TEXT REFERENCES inventory_batches(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0)
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items (sale_id);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  method TEXT NOT NULL CHECK (method IN ('cash','card','credit','wallet')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments (sale_id);

CREATE TABLE IF NOT EXISTS sale_returns (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale_return_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  return_id TEXT NOT NULL REFERENCES sale_returns(id),
  sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  refund_minor INTEGER NOT NULL DEFAULT 0 CHECK (refund_minor >= 0)
);
CREATE INDEX IF NOT EXISTS idx_sale_return_items_si ON sale_return_items (sale_item_id);

-- Returns can never exceed the sold quantity: enforced in the database by this trigger
-- (cumulative returned qty per sale_item + new qty <= sold qty).
CREATE TRIGGER IF NOT EXISTS trg_sale_return_items_max_qty
BEFORE INSERT ON sale_return_items
BEGIN
  SELECT RAISE(ABORT, 'RETURN_EXCEEDS_SOLD')
  WHERE NEW.qty + COALESCE((SELECT SUM(qty) FROM sale_return_items WHERE sale_item_id = NEW.sale_item_id), 0)
        > (SELECT qty FROM sale_items WHERE id = NEW.sale_item_id);
END;

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_suppliers_scope ON suppliers (tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','received','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0)
);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  batch_no TEXT,
  expiry_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  memo TEXT,
  ref_type TEXT,
  ref_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  entry_id TEXT NOT NULL REFERENCES journal_entries(id),
  account_code TEXT NOT NULL,
  debit_minor INTEGER NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor INTEGER NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  CHECK ((debit_minor = 0) <> (credit_minor = 0))
);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines (entry_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_scope ON audit_logs (tenant_id, created_at);

CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;

CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete
BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  request_hash TEXT,
  response_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, idem_key)
);
