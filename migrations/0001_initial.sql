-- 观股记 D1 初始架构（独立库，与 etai-access-log 无关）

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_by TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE instruments (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  name_zh TEXT NOT NULL,
  name_en TEXT,
  currency TEXT NOT NULL DEFAULT 'HKD',
  board_lot INTEGER NOT NULL,
  exchange TEXT NOT NULL DEFAULT 'XHKG',
  status TEXT NOT NULL DEFAULT 'active',
  listed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE calendar_hk (
  trade_date TEXT PRIMARY KEY,
  session_type TEXT NOT NULL CHECK (session_type IN ('full', 'half', 'closed')),
  note TEXT
);

CREATE TABLE data_snapshots (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_version TEXT,
  imported_at TEXT NOT NULL,
  trade_date_start TEXT,
  trade_date_end TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  provenance_json TEXT
);

CREATE TABLE bars_daily (
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  trade_date TEXT NOT NULL,
  open_cents INTEGER NOT NULL,
  high_cents INTEGER NOT NULL,
  low_cents INTEGER NOT NULL,
  close_cents INTEGER NOT NULL,
  volume INTEGER NOT NULL,
  turnover_cents INTEGER,
  adj_factor INTEGER NOT NULL DEFAULT 10000,
  snapshot_id TEXT NOT NULL REFERENCES data_snapshots(id),
  PRIMARY KEY (instrument_id, trade_date)
);

CREATE INDEX idx_bars_daily_date ON bars_daily(trade_date);

CREATE TABLE fee_schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rate_bps INTEGER NOT NULL DEFAULT 0,
  flat_cents INTEGER NOT NULL DEFAULT 0,
  effective_from TEXT NOT NULL,
  effective_to TEXT
);

CREATE TABLE strategies (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name_zh TEXT NOT NULL,
  version INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(slug, version)
);

CREATE TABLE signals (
  id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  strategy_id TEXT NOT NULL REFERENCES strategies(id),
  strategy_version INTEGER NOT NULL,
  trade_date TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('buy', 'sell', 'watch')),
  reasons_json TEXT NOT NULL,
  data_snapshot_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(instrument_id, strategy_id, strategy_version, trade_date, direction)
);

CREATE TABLE watchlists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  created_at TEXT NOT NULL,
  UNIQUE(user_id, instrument_id)
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  dedupe_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, dedupe_key)
);

CREATE TABLE paper_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  cash_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'HKD',
  updated_at TEXT NOT NULL
);

CREATE TABLE paper_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  signal_id TEXT REFERENCES signals(id),
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'filled', 'cancelled', 'rejected')),
  idempotency_key TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  fill_trade_date TEXT,
  fill_price_cents INTEGER,
  fees_cents INTEGER NOT NULL DEFAULT 0,
  meta_json TEXT,
  UNIQUE(user_id, idempotency_key)
);

CREATE TABLE paper_positions (
  user_id TEXT NOT NULL REFERENCES users(id),
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  quantity INTEGER NOT NULL,
  avg_cost_cents INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, instrument_id)
);

CREATE TABLE paper_trades (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  order_id TEXT NOT NULL REFERENCES paper_orders(id),
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  side TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  fees_cents INTEGER NOT NULL,
  trade_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE job_runs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT 'HK',
  trade_date TEXT NOT NULL,
  strategy_slug TEXT,
  strategy_version INTEGER,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  detail_json TEXT,
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start TEXT NOT NULL
);
