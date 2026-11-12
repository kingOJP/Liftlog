import type { Env } from './types';

// Self-applying schema migrations.
//
// The worker deploys automatically on a push to `main`; D1 migrations did not —
// they were a `wrangler d1 execute` step somebody had to remember. When 0008
// and 0009 shipped (clocks on the program / library / metadata, session notes)
// and the step was missed, every query naming a new column threw "no such
// column", and /api/sync answered 500 to every pull and every push. A device
// that already held its data kept working from local storage with a quiet
// "not syncing" badge; a fresh sign-in pulled nothing and showed an empty
// account. The data was on the server the whole time, behind a handler that
// could not read it.
//
// So the worker now brings the database up to date itself, before the first
// request that needs it. The steady-state cost is one tiny read per isolate
// (the promise is memoized); a database that is behind is inspected column by
// column and only what is missing is added. Every step is additive and
// idempotent — the same ALTERs as the numbered files in migrations/, which
// stay as the human-readable record and the manual fallback.
//
// A new migration needs an entry here as well as its .sql file (see
// migrations/README.md). `migrate.test.ts` fails if schema.sql gains a column
// that an un-migrated database would not be given.

interface ColumnStep {
  table: string;
  column: string;
  /** everything after `ADD COLUMN <column>` */
  ddl: string;
}

interface Migration {
  version: string;
  columns: ColumnStep[];
}

const MIGRATIONS: Migration[] = [
  {
    version: '0008_sync_clocks',
    columns: [
      { table: 'user_programs',     column: 'updated_at', ddl: 'INTEGER NOT NULL DEFAULT 0' },
      { table: 'user_exercises',    column: 'updated_at', ddl: 'INTEGER NOT NULL DEFAULT 0' },
      { table: 'exercise_metadata', column: 'updated_at', ddl: 'INTEGER NOT NULL DEFAULT 0' },
    ],
  },
  {
    version: '0009_session_notes',
    columns: [
      { table: 'session_docs', column: 'note', ddl: 'TEXT' },
    ],
  },
];

/** Migrations that predate the tracking table; a live database has run them. */
const BACKFILLED = [
  '0002_app_exercises', '0003_session_docs', '0004_training_plans',
  '0005_ownership', '0006_exercise_merges', '0007_nullable_prescription_columns',
];

// One check per database per isolate. Keyed by the binding so tests (a fresh
// in-memory database each) never share a verdict; in production there is one.
const ready = new WeakMap<object, Promise<void>>();

/**
 * Resolve once the database has every column this build reads. Safe to call on
 * every request. A failure is not cached: the next request tries again.
 */
export function ensureSchema(env: Env): Promise<void> {
  const key = env.DB as unknown as object;
  let p = ready.get(key);
  if (!p) {
    p = migrate(env).catch(err => {
      ready.delete(key);
      throw err;
    });
    ready.set(key, p);
  }
  return p;
}

async function appliedVersions(env: Env): Promise<Set<string> | null> {
  try {
    const rows = await env.DB.prepare('SELECT version FROM schema_migrations').all<{ version: string }>();
    return new Set(rows.results.map(r => r.version));
  } catch {
    return null; // the tracking table itself arrives with 0008
  }
}

async function hasColumn(env: Env, table: string, column: string): Promise<boolean> {
  const info = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return info.results.some(r => r.name === column);
}

async function migrate(env: Env): Promise<void> {
  const applied = await appliedVersions(env);
  if (applied && MIGRATIONS.every(m => applied.has(m.version))) return;

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    TEXT    PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`,
  ).run();
  for (const version of BACKFILLED) {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, 0)',
    ).bind(version).run();
  }

  for (const m of MIGRATIONS) {
    if (applied?.has(m.version)) continue;
    for (const step of m.columns) {
      if (await hasColumn(env, step.table, step.column)) continue;
      try {
        await env.DB.prepare(
          `ALTER TABLE ${step.table} ADD COLUMN ${step.column} ${step.ddl}`,
        ).run();
      } catch (err) {
        // Two isolates can race to add the same column; the loser's ALTER
        // fails with "duplicate column name" and the column is there anyway.
        if (!(await hasColumn(env, step.table, step.column))) throw err;
      }
    }
    await env.DB.prepare(
      'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)',
    ).bind(m.version, Date.now()).run();
  }
}
