-- 站主一次性激活 + staging demo 模拟交易日状态

CREATE TABLE site_owner_activation (
  id TEXT PRIMARY KEY,
  login_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  rotation_seq INTEGER NOT NULL DEFAULT 1,
  superseded_at TEXT
);

CREATE INDEX idx_site_owner_activation_login ON site_owner_activation(login_id);
CREATE INDEX idx_site_owner_activation_pending ON site_owner_activation(consumed_at, expires_at);

CREATE TABLE demo_simulation_state (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  current_trade_date TEXT NOT NULL,
  scenario_label TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_user_id TEXT
);
