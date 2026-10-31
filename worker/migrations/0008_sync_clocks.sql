-- Clocks on the program, the exercise library and the metadata overrides.
--
-- Session documents and the training journey already carried updated_at, so
-- the newer copy won on either end. The program, library entries and metadata
-- rows did not: pull adopted whatever the server had, push uploaded whatever
-- was local, and a background pull landing after a day edit silently reverted
-- it (audit H4). Each now carries the client's clock for its last edit and a
-- push only replaces a row with a copy at least as new. Existing rows default
-- to 0, which the client treats as "unstamped": the first stamped edit from
-- any device wins over it, exactly as before.
--
-- Also introduces schema_migrations so the applied set is visible in D1
-- itself, back-filling the migrations every live database has already run.
--
--   npx wrangler d1 execute liftlog --remote --file worker/migrations/0008_sync_clocks.sql

ALTER TABLE user_programs     ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_exercises    ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exercise_metadata ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT    PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES
  ('0002_app_exercises',                 0),
  ('0003_session_docs',                  0),
  ('0004_training_plans',                0),
  ('0005_ownership',                     0),
  ('0006_exercise_merges',               0),
  ('0007_nullable_prescription_columns', 0),
  ('0008_sync_clocks',                   strftime('%s', 'now') * 1000);
