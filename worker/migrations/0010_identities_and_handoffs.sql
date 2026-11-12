-- Sign in with Apple + native-app sign-in handoff.
--
-- user_identities maps a provider's subject to a LiftLog account, so one
-- account can be reached through Google and Apple alike (linked by verified
-- email). Google accounts created before this table keep users.id = their
-- Google subject and are back-filled on their next sign-in. refresh_token is
-- only kept for Apple: App Store rules require revoking it when the account
-- is deleted.
CREATE TABLE IF NOT EXISTS user_identities (
  provider      TEXT    NOT NULL,   -- 'google' | 'apple'
  subject       TEXT    NOT NULL,
  user_id       TEXT    NOT NULL,
  refresh_token TEXT,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (provider, subject),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities (user_id);

-- One-time codes that carry a finished sign-in from the system browser (where
-- OAuth must run inside a native app) into the app's own web view.
CREATE TABLE IF NOT EXISTS auth_handoffs (
  code       TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0010_identities_and_handoffs', strftime('%s','now') * 1000);
