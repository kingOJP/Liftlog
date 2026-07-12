-- Migration for the ownership architecture: exercises and their metadata stop
-- being app-wide mutable state and split into three owned layers —
--   Layer 1 (application-owned): the built-in catalog shipped in the client
--     bundle, plus admin-curated additions in global_exercises /
--     global_exercise_metadata (audited via global_exercise_audit).
--   Layer 2 (user-owned): user_exercises / exercise_metadata (per-user rows;
--     the pre-app-wide exercise_metadata table is *reused* as this layer) /
--     user_deleted_exercises.
--   Lifecycle: custom exercises pushed by users are queued in
--     pending_exercises for admin review before any global promotion.
-- The old app-wide tables (app_exercises / app_exercise_metadata /
-- deleted_exercises) become read-only adoption fallbacks: pull serves them to
-- a user who has no per-user rows yet, and the next push snapshots that data
-- into the user's own tables. Nothing writes the app-wide tables anymore.
--
-- Safe to re-run (IF NOT EXISTS). Existing tables are untouched.
--
--   npx wrangler d1 execute liftlog --remote --file worker/migrations/0005_ownership.sql

-- Roles: absent row = 'user'. Values: 'user' | 'admin' | 'tester'.
-- Assign an admin manually:
--   INSERT INTO user_roles (user_id, role) VALUES ('<google-sub>', 'admin');
CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT PRIMARY KEY,
  role    TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Layer 2: the user's own exercise library (custom exercises + their private
-- copies of catalog defaults). Upserted per exercise on push, never
-- delete-and-replace — same merge rule the app-wide table used.
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

-- Layer 2: per-user deletion tombstones. A user deleting an exercise deletes
-- it for *them* only. (The old global deleted_exercises table remains as a
-- read-only seed — deletions that happened while deletion was app-wide.)
CREATE TABLE IF NOT EXISTS user_deleted_exercises (
  user_id     TEXT    NOT NULL,
  exercise_id TEXT    NOT NULL,
  deleted_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, exercise_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Layer 1: admin-curated global exercises (promotions from the pending queue,
-- catalog corrections that must ship without a client deploy). Served to every
-- user on pull; only admins write, every write is audited.
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
  changed_by  TEXT    NOT NULL,  -- admin user_id
  changed_at  INTEGER NOT NULL,
  reason      TEXT,
  detail_json TEXT               -- before/after snapshot of the changed fields
);

-- Exercise lifecycle: custom exercises observed in user pushes are queued here
-- for admin review. status: 'pending' | 'approved' | 'rejected'.
CREATE TABLE IF NOT EXISTS pending_exercises (
  id            TEXT PRIMARY KEY,      -- the client-generated exercise id
  name          TEXT    NOT NULL,
  submitted_by  TEXT    NOT NULL,      -- user_id of first submitter
  source        TEXT    NOT NULL,      -- 'user' | 'ai'
  metadata_json TEXT,                  -- submitter's metadata snapshot, if any
  status        TEXT    NOT NULL DEFAULT 'pending',
  created_at    INTEGER NOT NULL,
  reviewed_by   TEXT,
  reviewed_at   INTEGER,
  review_note   TEXT
);
