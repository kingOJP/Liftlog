# D1 migrations

`worker/schema.sql` is the schema a **fresh** database gets (and what the test
harness runs). A live database is brought up to date by applying the numbered
files in this folder, in order, once each:

```sh
npx wrangler d1 execute liftlog --remote --file worker/migrations/0008_sync_clocks.sql
npx wrangler d1 execute liftlog --remote --file worker/migrations/0009_session_notes.sql
```

Every migration records itself in `schema_migrations`, so the applied set is
visible in D1 itself:

```sh
npx wrangler d1 execute liftlog --remote --command "SELECT version, applied_at FROM schema_migrations ORDER BY version"
```

Rules for a new migration:

- Number it after the last file and name it for what it changes.
- End it with `INSERT OR IGNORE INTO schema_migrations (version, applied_at)
  VALUES ('<file stem>', strftime('%s','now') * 1000);`.
- Make the same change in `schema.sql`, so a fresh database and a migrated
  one agree (the worker tests run `schema.sql`; a drift between the two is a
  production-only failure).
- Prefer additive changes (`ADD COLUMN ... DEFAULT`, `CREATE TABLE IF NOT
  EXISTS`). SQLite cannot drop a `NOT NULL` in place; `0007` shows the rebuild
  pattern when that is unavoidable.
- Deploy the worker that needs the migration **after** applying it. A column
  the code reads but the database lacks is a 500 on every sync.
