// worker/migrate.ts — the worker bringing its own database up to date.
//
// The failure this covers was production-only by construction: every other
// worker test runs schema.sql, which always has every column, so a live
// database that had missed a migration was a state no test could be in. Here
// the database is deliberately rolled back to what a pre-0008 deployment
// looks like, and the worker has to cope with it.

import { describe, it, expect, beforeEach } from 'vitest';
import worker from './index';
import { ensureSchema } from './migrate';
import { handleSync } from './sync';
import { createTestEnv, signIn, syncRequest, pushBody } from './testkit';
import type { TestEnv } from './testkit';

let env: TestEnv;
let cookie: string;

/** Undo 0008 and 0009: the database as it stood before either was applied. */
function rollBackToPre0008(e: TestEnv): void {
  e.raw.exec(`
    ALTER TABLE user_programs     DROP COLUMN updated_at;
    ALTER TABLE user_exercises    DROP COLUMN updated_at;
    ALTER TABLE exercise_metadata DROP COLUMN updated_at;
    ALTER TABLE session_docs      DROP COLUMN note;
    DROP TABLE schema_migrations;
  `);
}

const aWorkout = pushBody({
  sessions: [{ id: 1, guid: 'g-1', dayId: 1, weekNumber: 1, startedAt: 1_000, completedAt: 2_000, updatedAt: 2_000 }],
  setLogs:  [{ id: 1, sessionId: 1, exerciseId: 'bench-press', setNumber: 1, weight: 135, reps: 8 }],
  program:  [{ id: 1, label: 'Day 1', muscleGroups: 'Chest', exercises: [] }],
  exercises: [{ id: 'bench-press', name: 'Bench Press' }],
  plan: { version: 1, plans: [{ id: 'p1' }], updatedAt: 5_000 },
});

beforeEach(async () => {
  env = createTestEnv();
  cookie = signIn(env);
  // An account with history, stored while the database was healthy…
  expect((await handleSync(syncRequest('POST', cookie, aWorkout), env)).status).toBe(200);
  // …on a database that then turns out never to have run the new migrations.
  rollBackToPre0008(env);
});

describe('a database that missed a migration', () => {
  // The bug, stated as the handler sees it: this is why a fresh sign-in showed
  // an empty account while the data sat untouched in D1.
  it('cannot be read by the sync handler on its own', async () => {
    await expect(handleSync(syncRequest('GET', cookie), env)).rejects.toThrow(/no such column/);
  });

  it('is migrated by the worker, and a fresh sign-in gets the whole account back', async () => {
    const res = await worker.fetch(syncRequest('GET', cookie), env);
    expect(res.status).toBe(200);
    const data = await res.json() as {
      sessions: unknown[]; setLogs: unknown[]; program: unknown[]; plan: { plans: unknown[] };
    };
    expect(data.sessions).toHaveLength(1);
    expect(data.setLogs).toHaveLength(1);
    expect(data.program).toHaveLength(1);
    expect(data.plan.plans).toHaveLength(1);
  });

  it('accepts pushes again, so workouts stranded on a device can upload', async () => {
    const res = await worker.fetch(syncRequest('POST', cookie, pushBody({
      sessions: [{ id: 7, guid: 'g-2', dayId: 1, weekNumber: 2, startedAt: 9_000, completedAt: 9_500, updatedAt: 9_500, note: 'felt strong' }],
      setLogs:  [{ id: 1, sessionId: 7, exerciseId: 'bench-press', setNumber: 1, weight: 140, reps: 8 }],
      program:  [{ id: 1, label: 'Day 1', muscleGroups: 'Chest', exercises: [] }],
      programUpdatedAt: 9_000,
      exercises: [{ id: 'bench-press', name: 'Bench Press', updatedAt: 9_000 }],
    })), env);
    expect(res.status).toBe(200);
    const docs = env.raw.prepare('SELECT guid, note FROM session_docs ORDER BY guid').all();
    expect(docs).toEqual([{ guid: 'g-1', note: null }, { guid: 'g-2', note: 'felt strong' }]);
  });

  it('records what it applied, back-filling the migrations that predate the table', async () => {
    await ensureSchema(env);
    const versions = env.raw.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
      .map(r => r.version);
    expect(versions).toEqual([
      '0002_app_exercises', '0003_session_docs', '0004_training_plans', '0005_ownership',
      '0006_exercise_merges', '0007_nullable_prescription_columns',
      '0008_sync_clocks', '0009_session_notes',
    ]);
  });

  it('finishes a migration that was only partly applied by hand', async () => {
    env.raw.exec('ALTER TABLE user_programs ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0');
    await expect(ensureSchema(env)).resolves.toBeUndefined();
    expect((await worker.fetch(syncRequest('GET', cookie), env)).status).toBe(200);
  });

  // The guard for the next migration: schema.sql is what tests run, the steps
  // in migrate.ts are what production gets. If someone adds a column to one
  // and not the other, this is where it shows.
  it('ends up with exactly the schema a fresh database has', async () => {
    await ensureSchema(env);
    const shape = (e: TestEnv) => {
      const tables = e.raw.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      ).all().map(r => r.name as string);
      return Object.fromEntries(tables.map(t => [
        t,
        e.raw.prepare(`PRAGMA table_info(${t})`).all()
          .map(c => `${c.name}:${c.type}:${c.notnull}:${c.dflt_value}`)
          .sort(),
      ]));
    };
    expect(shape(env)).toEqual(shape(createTestEnv()));
  });
});

describe('a database that is already current', () => {
  it('is left alone, at the cost of one read per isolate', async () => {
    const fresh = createTestEnv();
    let statements = 0;
    const db = fresh.DB;
    const counting = {
      prepare: (sql: string) => { statements++; return db.prepare(sql); },
      batch: db.batch.bind(db),
    } as unknown as D1Database;
    const counted = { ...fresh, DB: counting };

    // schema.sql creates the tracking table empty; the first call fills it in.
    await ensureSchema(counted);
    await ensureSchema(counted);
    const afterFirstIsolate = statements;
    await ensureSchema(counted);
    expect(statements).toBe(afterFirstIsolate);

    // A new isolate against the now-recorded database: a single SELECT.
    statements = 0;
    await ensureSchema({ ...fresh, DB: { ...counting } as unknown as D1Database });
    expect(statements).toBe(1);
  });
});
