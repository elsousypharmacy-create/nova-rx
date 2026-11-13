-- 0005: DB-level integrity for transactional sales/stock writes (N103). Additive only.
-- Stock is derived from the append-only ledger: a negative movement may not take SUM(qty_delta) below zero.
CREATE TRIGGER IF NOT EXISTS trg_inventory_movements_no_negative_stock
BEFORE INSERT ON inventory_movements
WHEN NEW.qty_delta < 0
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_STOCK')
  WHERE COALESCE((SELECT SUM(qty_delta) FROM inventory_movements
                  WHERE tenant_id = NEW.tenant_id AND branch_id = NEW.branch_id AND product_id = NEW.product_id), 0) + NEW.qty_delta < 0;
END;

-- A movement can be reversed at most once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_movements_reverses ON inventory_movements (reverses_id) WHERE reverses_id IS NOT NULL;

-- Completed financial records are reversed, never deleted or rewritten.
CREATE TRIGGER IF NOT EXISTS trg_sales_no_delete BEFORE DELETE ON sales BEGIN SELECT RAISE(ABORT, 'FINANCIAL_RECORD_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sale_items_no_delete BEFORE DELETE ON sale_items BEGIN SELECT RAISE(ABORT, 'FINANCIAL_RECORD_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sale_items_no_update BEFORE UPDATE ON sale_items BEGIN SELECT RAISE(ABORT, 'FINANCIAL_RECORD_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_payments_no_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT, 'FINANCIAL_RECORD_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_payments_no_update BEFORE UPDATE ON payments BEGIN SELECT RAISE(ABORT, 'FINANCIAL_RECORD_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sale_returns_no_delete BEFORE DELETE ON sale_returns BEGIN SELECT RAISE(ABORT, 'FINANCIAL_RECORD_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sale_return_items_no_delete BEFORE DELETE ON sale_return_items BEGIN SELECT RAISE(ABORT, 'FINANCIAL_RECORD_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_journal_entries_no_delete BEFORE DELETE ON journal_entries BEGIN SELECT RAISE(ABORT, 'FINANCIAL_RECORD_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_journal_lines_no_delete BEFORE DELETE ON journal_lines BEGIN SELECT RAISE(ABORT, 'FINANCIAL_RECORD_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_journal_lines_no_update BEFORE UPDATE ON journal_lines BEGIN SELECT RAISE(ABORT, 'FINANCIAL_RECORD_IMMUTABLE'); END;

-- A sale may only move completed -> void; nothing else on it changes.
CREATE TRIGGER IF NOT EXISTS trg_sales_only_void
BEFORE UPDATE ON sales
WHEN NOT (OLD.status = 'completed' AND NEW.status = 'void' AND NEW.total_minor = OLD.total_minor
          AND NEW.discount_minor = OLD.discount_minor AND NEW.tenant_id = OLD.tenant_id AND NEW.branch_id = OLD.branch_id)
BEGIN SELECT RAISE(ABORT, 'FINANCIAL_RECORD_IMMUTABLE'); END;
