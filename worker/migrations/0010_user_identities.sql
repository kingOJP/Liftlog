-- One LiftLog user, many sign-in identities (Google, Sign in with Apple).
-- Purely additive: no existing row is touched. Every existing account was a
-- Google account keyed by its Google subject, so each gets its Google identity
-- back-filled (users.id stays the Google sub; nothing is re-keyed).
CREATE TABLE IF NOT EXISTS user_identities (
  provider       TEXT    NOT NULL,
  subject        TEXT    NOT NULL,
  user_id        TEXT    NOT NULL,
  email          TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (provider, subject),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_identities_email ON user_identities(email);

-- A verified Apple identity that matched no account waits here (15 minutes)
-- while the user either signs in with Google to link it or explicitly creates
-- a new account. Never auto-creates a second account.
CREATE TABLE IF NOT EXISTS link_tokens (
  token          TEXT    PRIMARY KEY,
  provider       TEXT    NOT NULL,
  subject        TEXT    NOT NULL,
  email          TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  name           TEXT,
  expires_at     INTEGER NOT NULL
);

INSERT OR IGNORE INTO user_identities (provider, subject, user_id, email, email_verified, created_at)
  SELECT 'google', id, id, email, 1, 0 FROM users;

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
  VALUES ('0010_user_identities', strftime('%s','now') * 1000);
