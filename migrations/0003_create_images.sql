CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  content_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  unreferenced_at TEXT NOT NULL,
  cleanup_claimed_at TEXT
);

CREATE INDEX IF NOT EXISTS images_cleanup_idx ON images (unreferenced_at, cleanup_claimed_at);

CREATE TRIGGER IF NOT EXISTS images_after_delete
AFTER DELETE ON images
BEGIN
  UPDATE image_quota
  SET used_bytes = MAX(used_bytes - OLD.size_bytes, 0)
  WHERE id = 'main';
END;
