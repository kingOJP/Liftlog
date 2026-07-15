-- Admin exercise merges: a from→to exercise-id mapping, curated by admins,
-- served to every client on pull. Merging fixes duplicate identities (e.g. a
-- timestamped custom exercise that duplicates a catalog one): each client
-- remaps its OWN set logs / program / library through the map, so all history
-- lands under the surviving id and propagates via normal merge sync. Rows are
-- append-only in practice; re-merging the same from_id replaces its target.
-- Every merge also lands an audit row in global_exercise_audit.
--
-- Safe to re-run (IF NOT EXISTS).
--
--   npx wrangler d1 execute liftlog --remote --file worker/migrations/0006_exercise_merges.sql

CREATE TABLE IF NOT EXISTS exercise_merges (
  from_id   TEXT    PRIMARY KEY,
  to_id     TEXT    NOT NULL,
  merged_by TEXT    NOT NULL,
  merged_at INTEGER NOT NULL,
  reason    TEXT
);
