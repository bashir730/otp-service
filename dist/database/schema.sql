-- ==================================================
-- otp-service — SQLite schema
-- (نسخه runtime همین DDL در init اجرا می‌شود؛
--  migrations/ برای تغییرات آینده است)
-- ==================================================

CREATE TABLE IF NOT EXISTS api_clients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL UNIQUE,
  api_key_hash  TEXT    NOT NULL UNIQUE,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS otp_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   INTEGER NOT NULL,
  phone       TEXT    NOT NULL,
  purpose     TEXT    NOT NULL DEFAULT 'login',
  otp_hash    TEXT    NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  verified    INTEGER NOT NULL DEFAULT 0,
  invalidated INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT    NOT NULL,
  FOREIGN KEY (client_id) REFERENCES api_clients(id)
);

CREATE TABLE IF NOT EXISTS logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER,
  phone      TEXT,
  action     TEXT NOT NULL,
  status     TEXT NOT NULL,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS migrations (
  version    TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_otp_phone_purpose ON otp_requests(phone, purpose);
CREATE INDEX IF NOT EXISTS idx_otp_active        ON otp_requests(client_id, phone, purpose, verified, invalidated);
CREATE INDEX IF NOT EXISTS idx_otp_expires       ON otp_requests(expires_at);
CREATE INDEX IF NOT EXISTS idx_logs_created      ON logs(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_client       ON logs(client_id);
CREATE INDEX IF NOT EXISTS idx_clients_active    ON api_clients(active);
