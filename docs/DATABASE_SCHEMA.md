# NOVA Rx — Database Schema Contract

Status: target design only. No production relational schema or migration is implemented in this branch.

## Required groups

- Identity: tenants, branches, users, roles, permissions, user_roles.
- Catalog: products, product_barcodes, product_units, product_categories and reviewed alternatives.
- Inventory: inventory_batches, inventory_movements, stock_counts, stock_transfers.
- Purchasing: suppliers, purchase_orders, purchase_order_items, receipts, invoices and returns.
- Sales: customers, sales, sale_items, payments, sale_returns and sale_return_items.
- Finance: cashier_sessions, expenses, financial_accounts, journal_entries and journal_lines.
- Safety/operations: prescriptions, sticker_jobs, ai_generations, settings and audit_logs.

## Invariants

Every operational row carries tenant and branch scope where applicable, primary/foreign keys, timestamps and appropriate indexes. Money uses fixed-precision decimal types. Batch stock derives from an auditable movement ledger. Returns cannot exceed original sold quantities and returned medication enters quarantine by default. Completed financial records are reversed, not casually deleted. Sale/payment idempotency keys are unique within their tenant.
