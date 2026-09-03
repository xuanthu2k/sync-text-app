CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  content_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO documents (id, content_json, revision, updated_at)
VALUES ('main', '[]', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
