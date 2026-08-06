// Test harness for the worker: a real D1 against the real schema.
//
// The worker had no test coverage at all, and the reason it was easy to skip is
// that the obvious options are both bad — a hand-written fake D1 tests the fake,
// and vitest-pool-workers boots workerd for every file. node:sqlite is neither:
// it is a real SQL engine in-process, so `schema.sql` is executed verbatim and
// NOT NULL / PRIMARY KEY / FOREIGN KEY violations surface the way they do in
// production, at no measurable cost to the suite.
//
// The adapter below implements exactly the D1 surface worker/ uses:
// prepare → bind → all / first / run, plus batch.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Env } from './types';

// import.meta.dirname rather than new URL(...): this file is typechecked with
// @cloudflare/workers-types taking precedence (D1 row inference depends on it),
// and that URL shadows Node's in a way fileURLToPath rejects.
const SCHEMA = readFileSync(join(import.meta.dirname, 'schema.sql'), 'utf8');

type Bindable = string | number | null;

/**
 * D1 rejects `undefined` bindings with a type error rather than coercing them
 * to NULL. Reproducing that is the whole point of binding through a real
 * driver: a payload field the client stopped sending must fail loudly here,
 * not quietly write a NULL into a NOT NULL column.
 */
function assertBindable(values: unknown[]): asserts values is Bindable[] {
  values.forEach((v, i) => {
    if (v === undefined) {
      throw new Error(`D1_TYPE_ERROR: undefined bound to parameter ${i + 1}`);
    }
    if (typeof v === 'boolean') {
      throw new Error(`D1_TYPE_ERROR: boolean bound to parameter ${i + 1}`);
    }
  });
}

class FakeStatement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private args: Bindable[] = [],
  ) {}

  bind(...values: unknown[]): FakeStatement {
    assertBindable(values);
    return new FakeStatement(this.db, this.sql, values);
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true }> {
    const results = this.db.prepare(this.sql).all(...this.args) as T[];
    return { results, success: true };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.args) as T | undefined) ?? null;
  }

  async run(): Promise<{ success: true }> {
    this.db.prepare(this.sql).run(...this.args);
    return { success: true };
  }
}

class FakeD1 {
  constructor(private db: DatabaseSync) {}

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this.db, sql);
  }

  /**
   * D1's batch is atomic: any statement failing rolls the whole thing back.
   * The push handler leans on that — a rejected exercise row must not leave
   * half a synced payload behind.
   */
  async batch(statements: FakeStatement[]): Promise<Array<{ success: true }>> {
    this.db.exec('BEGIN');
    try {
      const out = [];
      for (const s of statements) out.push(await s.run());
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

export interface TestEnv extends Env {
  /** Raw handle, for arranging fixtures and asserting on stored rows. */
  raw: DatabaseSync;
}

/** A fresh in-memory database with the production schema applied. */
export function createTestEnv(): TestEnv {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);

  return {
    DB: new FakeD1(db) as unknown as D1Database,
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } as unknown as Fetcher,
    raw: db,
  };
}

/** Insert a user plus a live session cookie, and return the cookie header. */
export function signIn(env: TestEnv, userId = 'user-1', email = 'a@example.com'): string {
  env.raw.prepare('INSERT OR REPLACE INTO users (id, email, name) VALUES (?, ?, ?)')
    .run(userId, email, 'Test User');
  const token = `token-${userId}`;
  env.raw.prepare('INSERT OR REPLACE INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, Date.now() + 86_400_000);
  return `liftlog_session=${token}`;
}

export function setRole(env: TestEnv, userId: string, role: 'admin' | 'tester'): void {
  env.raw.prepare('INSERT OR REPLACE INTO user_roles (user_id, role) VALUES (?, ?)')
    .run(userId, role);
}

/** A minimal valid push payload; spread overrides on top. */
export function pushBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { sessions: [], setLogs: [], exerciseLogs: [], ...overrides };
}

export function syncRequest(
  method: 'GET' | 'POST',
  cookie: string | null,
  body?: unknown,
): Request {
  return new Request('https://liftlog.test/api/sync', {
    method,
    headers: cookie ? { Cookie: cookie, 'Content-Type': 'application/json' } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
