-- Wedding timeline app. Safe to run more than once.
CREATE TABLE IF NOT EXISTS weddings (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,          -- the secret part of the couple's link
  couple TEXT NOT NULL DEFAULT '',
  wedding_date TEXT NOT NULL DEFAULT '',
  draft TEXT NOT NULL DEFAULT '{}',    -- Mary's working copy (JSON)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS versions (
  wedding_id TEXT NOT NULL REFERENCES weddings(id),
  n INTEGER NOT NULL,
  snapshot TEXT NOT NULL,              -- frozen copy of what was published (JSON)
  published_at TEXT NOT NULL,
  published_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (wedding_id, n)
);
