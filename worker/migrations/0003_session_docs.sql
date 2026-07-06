-- Migration for merge-based session sync (sync v2): sessions become atomic
-- documents keyed by GUID, merged per-session by updated_at, with deletion
-- tombstones. Safe to re-run (IF NOT EXISTS). Existing tables are untouched
-- (workout_sessions/set_logs remain as the legacy pull fallback).
--
--   npx wrangler d1 execute liftlog --remote --file worker/migrations/0003_session_docs.sql

CREATE TABLE IF NOT EXISTS session_docs (
  user_id      TEXT    NOT NULL,
  guid         TEXT    NOT NULL,
  day_id       INTEGER NOT NULL,
  week_number  INTEGER NOT NULL,
  started_at   INTEGER NOT NULL,
  completed_at INTEGER,
  updated_at   INTEGER NOT NULL,
  sets_json    TEXT    NOT NULL,
  PRIMARY KEY (user_id, guid),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS deleted_sessions (
  user_id    TEXT    NOT NULL,
  guid       TEXT    NOT NULL,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, guid),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
