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

-- Layer 2 (user-owned) exercise metadata overrides — one row per
-- (exercise, user). Originally the pre-app-wide per-user table; the ownership
-- architecture reuses it as the user-override layer, so rows written before
-- the app-wide era are already in the right place.
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

-- LEGACY (pre-ownership): app-wide exercise library shared by every account.
-- Superseded by per-user user_exercises + admin-curated global_exercises.
-- Read-only adoption fallback on pull until a user's first post-ownership
-- push; nothing writes it anymore.
CREATE TABLE IF NOT EXISTS app_exercises (
  id       TEXT PRIMARY KEY,
  name     TEXT    NOT NULL,
  sets     INTEGER NOT NULL,
  rep_low  INTEGER NOT NULL,
  rep_high INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);

-- LEGACY (pre-ownership): app-wide exercise metadata. Superseded by per-user
-- rows in exercise_metadata (reused as the user-override layer) + admin-curated
-- global_exercise_metadata. Read-only adoption fallback; nothing writes it.
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

-- LEGACY (pre-ownership): app-wide deletion tombstones. Kept as a read-only
-- seed (deletions that happened while deletion was app-wide still apply to
-- everyone); new deletions go to per-user user_deleted_exercises.
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

-- ── Ownership architecture (see docs/ownership-architecture.md) ─────────────
-- Exercises split into owned layers: Layer 1 = application-owned (built-in
-- catalog in the client bundle + admin-curated global_exercises), Layer 2 =
-- user-owned (user_exercises / exercise_metadata / user_deleted_exercises),
-- Layer 3 = workout instances (session_docs — unchanged). Custom exercises
-- flow through pending_exercises before any global promotion.

-- Roles: absent row = 'user'. Values: 'user' | 'admin' | 'tester'.
CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT PRIMARY KEY,
  role    TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Layer 2: the user's own exercise library. Upserted per exercise on push,
-- never delete-and-replace; deletion only via user_deleted_exercises.
CREATE TABLE IF NOT EXISTS user_exercises (
  user_id  TEXT    NOT NULL,
  id       TEXT    NOT NULL,
  name     TEXT    NOT NULL,
  sets     INTEGER NOT NULL,
  rep_low  INTEGER NOT NULL,
  rep_high INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Layer 2: per-user deletion tombstones — deleting an exercise deletes it for
-- this user only.
CREATE TABLE IF NOT EXISTS user_deleted_exercises (
  user_id     TEXT    NOT NULL,
  exercise_id TEXT    NOT NULL,
  deleted_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, exercise_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Layer 1: admin-curated global exercises + metadata, served to every user on
-- pull. Only admins write; every write is audited.
CREATE TABLE IF NOT EXISTS global_exercises (
  id       TEXT PRIMARY KEY,
  name     TEXT    NOT NULL,
  sets     INTEGER NOT NULL,
  rep_low  INTEGER NOT NULL,
  rep_high INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS global_exercise_metadata (
  exercise_id       TEXT PRIMARY KEY,
  primary_muscle    TEXT,
  secondary_muscle1 TEXT,
  secondary_muscle2 TEXT,
  secondary_muscle3 TEXT,
  workout_type      TEXT,
  equipment         TEXT,
  weight_type       TEXT
);

-- Audit trail for every global-layer change: what/who/when/why.
CREATE TABLE IF NOT EXISTS global_exercise_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  exercise_id TEXT    NOT NULL,
  action      TEXT    NOT NULL,  -- 'promote' | 'reject' | 'edit' | 'retire'
  changed_by  TEXT    NOT NULL,
  changed_at  INTEGER NOT NULL,
  reason      TEXT,
  detail_json TEXT
);

-- Admin exercise merges: from→to id mapping served to every client on pull;
-- each client remaps its own history/program/library through it (see
-- worker/migrations/0006_exercise_merges.sql). Audited like every global edit.
CREATE TABLE IF NOT EXISTS exercise_merges (
  from_id   TEXT    PRIMARY KEY,
  to_id     TEXT    NOT NULL,
  merged_by TEXT    NOT NULL,
  merged_at INTEGER NOT NULL,
  reason    TEXT
);

-- Exercise lifecycle: custom exercises observed in user pushes queue here for
-- admin review. status: 'pending' | 'approved' | 'rejected'.
CREATE TABLE IF NOT EXISTS pending_exercises (
  id            TEXT PRIMARY KEY,
  name          TEXT    NOT NULL,
  submitted_by  TEXT    NOT NULL,
  source        TEXT    NOT NULL,      -- 'user' | 'ai'
  metadata_json TEXT,
  status        TEXT    NOT NULL DEFAULT 'pending',
  created_at    INTEGER NOT NULL,
  reviewed_by   TEXT,
  reviewed_at   INTEGER,
  review_note   TEXT
);
