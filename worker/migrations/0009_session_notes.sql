-- Per-session notes ("how did it go?"), carried on the session document and
-- merged with it: the note rides the same updated_at as the sets, so an edit
-- from any device propagates like any other change to the session.
--
--   npx wrangler d1 execute liftlog --remote --file worker/migrations/0009_session_notes.sql

ALTER TABLE session_docs ADD COLUMN note TEXT;

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
  VALUES ('0009_session_notes', strftime('%s', 'now') * 1000);
