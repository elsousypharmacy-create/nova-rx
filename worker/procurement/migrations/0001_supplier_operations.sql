-- Isolated integration journal; not the ERP stock or accounting database.
CREATE TABLE IF NOT EXISTS supplier_operations (
 id TEXT PRIMARY KEY,
 scope TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','unknown','verified','failed')),
 receipt TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_active_scope ON supplier_operations(scope) WHERE state IN ('pending','unknown');
