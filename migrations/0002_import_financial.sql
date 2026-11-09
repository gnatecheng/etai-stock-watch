-- 机器导入批次 + 港股财务版本模型（与 0001 独立扩展）

CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  batch_type TEXT NOT NULL CHECK (batch_type IN ('bars_daily', 'financial', 'calendar')),
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('staging', 'validating', 'validated', 'publishing', 'published', 'failed', 'abandoned')),
  idempotency_key TEXT NOT NULL UNIQUE,
  trade_date_scope TEXT,
  scope_complete INTEGER NOT NULL DEFAULT 0,
  row_count_expected INTEGER,
  row_count_staged INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);

CREATE INDEX idx_import_batches_status ON import_batches(status);

CREATE TABLE import_batch_rows (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  payload_type TEXT NOT NULL CHECK (payload_type IN ('bar', 'financial', 'calendar')),
  payload_json TEXT NOT NULL,
  validation_status TEXT NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending', 'ok', 'error')),
  validation_message TEXT,
  UNIQUE(batch_id, seq)
);

CREATE INDEX idx_import_batch_rows_batch ON import_batch_rows(batch_id);

CREATE TABLE fin_report_versions (
  id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  report_family TEXT NOT NULL,
  statement_type TEXT,
  period_end TEXT NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('annual', 'interim', 'quarter')),
  accounting_standard TEXT,
  currency TEXT NOT NULL,
  unit_label TEXT NOT NULL,
  source TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  announced_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  import_batch_id TEXT NOT NULL REFERENCES import_batches(id),
  published_at TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  UNIQUE(instrument_id, report_family, period_end, period_type, revision)
);

CREATE INDEX idx_fin_report_versions_inst ON fin_report_versions(instrument_id, period_end);
CREATE INDEX idx_fin_report_visible ON fin_report_versions(announced_at);
