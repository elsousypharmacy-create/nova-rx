-- 0004: audit_logs gains before/after/reason/outcome (SEC-04). Additive only; append-only triggers from 0003 stay.
ALTER TABLE audit_logs ADD COLUMN before_json TEXT;
ALTER TABLE audit_logs ADD COLUMN after_json TEXT;
ALTER TABLE audit_logs ADD COLUMN reason TEXT;
ALTER TABLE audit_logs ADD COLUMN outcome TEXT;
