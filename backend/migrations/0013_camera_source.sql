-- 0012: OPS-05 cameras as an independent source (N120). Additive only. Read-only API; rows are written by the
-- separate camera pipeline (not by this Worker). No quality score column on purpose.
CREATE TABLE IF NOT EXISTS camera_reports (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  camera_id TEXT NOT NULL DEFAULT '',
  report_date TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  evidence_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_camera_reports_date ON camera_reports (tenant_id, report_date);
CREATE TABLE IF NOT EXISTS camera_source_status (
  tenant_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'unknown' CHECK (state IN ('online','offline','unknown')),
  last_report_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, source_id)
);
