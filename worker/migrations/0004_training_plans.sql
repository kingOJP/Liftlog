-- Migration for the training-journey planning layer: each user's plans,
-- blocks and retrospectives sync as one JSON document, last-write-wins by
-- updated_at. Safe to re-run (IF NOT EXISTS). Existing tables are untouched.
--
--   npx wrangler d1 execute liftlog --remote --file worker/migrations/0004_training_plans.sql

CREATE TABLE IF NOT EXISTS training_plans (
  user_id    TEXT    PRIMARY KEY,
  plan_json  TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
