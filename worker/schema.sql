CREATE TABLE IF NOT EXISTS users (
  id   TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name  TEXT
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token      TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workout_sessions (
  local_id    INTEGER NOT NULL,
  user_id     TEXT    NOT NULL,
  day_id      INTEGER NOT NULL,
  week_number INTEGER NOT NULL,
  started_at  INTEGER NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY (local_id, user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS set_logs (
  local_id    INTEGER NOT NULL,
  user_id     TEXT    NOT NULL,
  session_id  INTEGER NOT NULL,
  exercise_id TEXT    NOT NULL,
  set_number  INTEGER NOT NULL,
  weight      REAL    NOT NULL,
  reps        INTEGER NOT NULL,
  PRIMARY KEY (local_id, user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS exercise_logs (
  local_id    INTEGER NOT NULL,
  user_id     TEXT    NOT NULL,
  session_id  INTEGER NOT NULL,
  exercise_id TEXT    NOT NULL,
  difficulty  TEXT,
  PRIMARY KEY (local_id, user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Combines exerciseMuscles + exerciseDetails into one server-side table
CREATE TABLE IF NOT EXISTS exercise_metadata (
  exercise_id       TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  primary_muscle    TEXT,
  secondary_muscle1 TEXT,
  secondary_muscle2 TEXT,
  secondary_muscle3 TEXT,
  workout_type      TEXT,
  equipment         TEXT,
  weight_type       TEXT,
  PRIMARY KEY (exercise_id, user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Sync v2: each workout session is one atomic document — the session row and
-- its sets travel together, keyed by an immutable client-generated GUID.
-- Pushes upsert per document (newer updated_at wins), so two devices logging
-- different workouts both keep theirs. Replaces the full-replace sync over
-- workout_sessions/set_logs/exercise_logs, which are kept only as a legacy
-- pull fallback until each user's first sync-v2 push.
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

-- Session deletion tombstones (per user): once a session is deleted — ghost
-- cleanup or wiping an exercise's history — it stays deleted on every device.
CREATE TABLE IF NOT EXISTS deleted_sessions (
  user_id    TEXT    NOT NULL,
  guid       TEXT    NOT NULL,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, guid),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- App-wide exercise library (shared across all accounts — exercises are an
-- app-level feature, not per-user). Populated from the client's library on
-- push; per-user exercises_json remains only as a legacy fallback for pull.
CREATE TABLE IF NOT EXISTS app_exercises (
  id       TEXT PRIMARY KEY,
  name     TEXT    NOT NULL,
  sets     INTEGER NOT NULL,
  rep_low  INTEGER NOT NULL,
  rep_high INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);

-- App-wide exercise metadata (successor of the per-user exercise_metadata,
-- which is kept only as a legacy pull fallback).
CREATE TABLE IF NOT EXISTS app_exercise_metadata (
  exercise_id       TEXT PRIMARY KEY,
  primary_muscle    TEXT,
  secondary_muscle1 TEXT,
  secondary_muscle2 TEXT,
  secondary_muscle3 TEXT,
  workout_type      TEXT,
  equipment         TEXT,
  weight_type       TEXT
);

-- Deletion tombstones: once an exercise is deleted it stays deleted, no matter
-- which device or account later pushes a stale copy of the library.
CREATE TABLE IF NOT EXISTS deleted_exercises (
  exercise_id TEXT PRIMARY KEY,
  deleted_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_programs (
  user_id        TEXT PRIMARY KEY,
  program_json   TEXT NOT NULL,
  exercises_json TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Training journey (plans + blocks + retrospectives) as one per-user document.
-- Whole-document last-write-wins by updated_at — the merge-sensitive data
-- (workout sessions) has its own per-document merge in session_docs.
CREATE TABLE IF NOT EXISTS training_plans (
  user_id    TEXT    PRIMARY KEY,
  plan_json  TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
