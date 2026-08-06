-- Make the prescription columns nullable on global_exercises.
--
-- Sets and rep ranges moved off the exercise and onto the prescription
-- (src/data/dosage.ts): an exercise row is movement identity, and the dose is
-- resolved per plan at the point of use. worker/admin.ts already writes NULL
-- for those columns when promoting an approved custom exercise into the global
-- layer, deliberately, rather than inventing a 3 x 8-12 that would follow the
-- movement into every user's program. The table still declared them NOT NULL,
-- so every approval failed the constraint and returned a 500.
--
-- SQLite cannot drop NOT NULL in place, so the table is rebuilt. The columns
-- themselves stay for wire compatibility: pull still serves them and older
-- clients still read them.
--
--   npx wrangler d1 execute liftlog --remote --file worker/migrations/0007_nullable_prescription_columns.sql

CREATE TABLE IF NOT EXISTS global_exercises_new (
  id       TEXT PRIMARY KEY,
  name     TEXT    NOT NULL,
  sets     INTEGER,
  rep_low  INTEGER,
  rep_high INTEGER,
  archived INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO global_exercises_new (id, name, sets, rep_low, rep_high, archived)
  SELECT id, name, sets, rep_low, rep_high, archived FROM global_exercises;

DROP TABLE global_exercises;

ALTER TABLE global_exercises_new RENAME TO global_exercises;
