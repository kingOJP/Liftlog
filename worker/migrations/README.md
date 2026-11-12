# D1 migrations

`worker/schema.sql` is the schema a **fresh** database gets (and what the test
harness runs). A live database is brought up to date **by the worker itself**:
`worker/migrate.ts` (`ensureSchema`) runs before every `/api/sync` and
`/api/admin` request, costs one small read per isolate when the database is
current, and adds whatever columns are missing when it is not. Deploying is
therefore enough — there is no manual step to forget.

That was not always true. 0008 and 0009 shipped as a `wrangler` step only; the
step was missed, every sync answered 500, and a fresh sign-in showed an empty
account while the data sat untouched in D1.

The numbered files remain the readable record of each change and a manual
fallback, applied in order, once each:

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
- Add the same step to `MIGRATIONS` in `worker/migrate.ts` so the worker
  applies it on deploy. `migrate.test.ts` rolls a database back to pre-0008 and
  fails if the migrated result differs from `schema.sql` in any column.
- Make the same change in `schema.sql`, so a fresh database and a migrated
  one agree (the worker tests run `schema.sql`; a drift between the two is a
  production-only failure).
- Prefer additive changes (`ADD COLUMN ... DEFAULT`, `CREATE TABLE IF NOT
  EXISTS`). SQLite cannot drop a `NOT NULL` in place; `0007` shows the rebuild
  pattern when that is unavoidable.
- `migrate.ts` handles additive column changes. Anything else (a table
  rebuild like `0007`) still has to be applied by hand **before** deploying the
  worker that needs it: a column the code reads but the database lacks is a
  500 on every sync.
