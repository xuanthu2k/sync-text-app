CREATE TABLE IF NOT EXISTS image_quota (
  id TEXT PRIMARY KEY CHECK (id = 'main'),
  used_bytes INTEGER NOT NULL DEFAULT 0 CHECK (used_bytes >= 0)
);

INSERT OR IGNORE INTO image_quota (id, used_bytes) VALUES ('main', 0);
