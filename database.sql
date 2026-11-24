PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('super_owner','owner','reseller'))
);

CREATE TABLE IF NOT EXISTS license_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_code TEXT NOT NULL UNIQUE,
  user_name TEXT NOT NULL,
  product TEXT NOT NULL,
  expired_at TEXT,
  is_lifetime INTEGER DEFAULT 0,
  is_muted INTEGER DEFAULT 0,
  muted_by TEXT,
  muted_by_role TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER,
  staff_username TEXT NOT NULL,
  staff_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO system_state(id, revision) VALUES(1, 0);
CREATE INDEX IF NOT EXISTS idx_license_keys_product ON license_keys(product);
CREATE INDEX IF NOT EXISTS idx_license_keys_created ON license_keys(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at);
