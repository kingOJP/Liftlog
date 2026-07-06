-- Migration for the backend-audit changes: app-wide exercise library,
-- app-wide exercise metadata, and deletion tombstones.
-- Safe to re-run (IF NOT EXISTS). Existing tables are untouched.
--
--   npx wrangler d1 execute liftlog --remote --file worker/migrations/0002_app_exercises.sql

CREATE TABLE IF NOT EXISTS app_exercises (
  id       TEXT PRIMARY KEY,
  name     TEXT    NOT NULL,
  sets     INTEGER NOT NULL,
  rep_low  INTEGER NOT NULL,
  rep_high INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);

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

CREATE TABLE IF NOT EXISTS deleted_exercises (
  exercise_id TEXT PRIMARY KEY,
  deleted_at  INTEGER NOT NULL
);
