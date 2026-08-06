// worker/sync.ts — the push/pull contract.
//
// This is the seam where a client build and a server build have to agree, and
// nothing in the repo was checking it. The first test below is the one that
// matters: it asserts the worker accepts the payload the current client
// actually sends. It failed when written.

import { describe, it, expect, beforeEach } from 'vitest';
import { handleSync } from './sync';
import { createTestEnv, signIn, pushBody, syncRequest } from './testkit';
import type { TestEnv } from './testkit';

let env: TestEnv;
let cookie: string;

beforeEach(() => {
  env = createTestEnv();
  cookie = signIn(env);
});

const push = (body: unknown, c: string | null = cookie) =>
  handleSync(syncRequest('POST', c, body), env);
const pull = (c: string | null = cookie) => handleSync(syncRequest('GET', c), env);

/** A session document as the client sends it: session row + its set logs. */
function doc(guid: string, updatedAt: number, sets = 1) {
  return {
    sessions: [{ id: 1, guid, dayId: 1, weekNumber: 1, startedAt: updatedAt, completedAt: updatedAt, updatedAt }],
    setLogs: Array.from({ length: sets }, (_, i) => ({
      id: i + 1, sessionId: 1, exerciseId: 'bench-press', setNumber: i + 1, weight: 135, reps: 8,
    })),
    exerciseLogs: [],
  };
}

describe('the exercise library payload the client actually sends', () => {
  // LibraryExercise became identity-only when rep ranges moved onto the
  // prescription (dosage.ts). The client has sent { id, name } ever since;
  // validatePush still demanded sets/repLow/repHigh, so every push 400'd and
  // no test noticed. Cloud sync push was dead.
  it('accepts an identity-only exercise — the library carries no rep range', async () => {
    const res = await push(pushBody({
      exercises: [{ id: 'bench-press', name: 'Bench Press' }],
    }));
    expect(res.status).toBe(200);
  });

  it('stores it, so a pull round-trips the library', async () => {
    await push(pushBody({ exercises: [{ id: 'face-pulls', name: 'Face Pulls' }] }));
    const data = await (await pull()).json() as { exercises: Array<{ id: string; name: string }> };
    expect(data.exercises).toContainEqual(expect.objectContaining({ id: 'face-pulls', name: 'Face Pulls' }));
  });

  it('still accepts the deprecated fields from an older client', async () => {
    const res = await push(pushBody({
      exercises: [{ id: 'squat', name: 'Squat', sets: 3, repLow: 8, repHigh: 12 }],
    }));
    expect(res.status).toBe(200);
  });

  it('round-trips the archived flag', async () => {
    await push(pushBody({ exercises: [{ id: 'sit-ups', name: 'Sit Ups', archived: true }] }));
    const data = await (await pull()).json() as { exercises: Array<{ id: string; archived?: boolean }> };
    expect(data.exercises.find(e => e.id === 'sit-ups')?.archived).toBe(true);
  });

  it('rejects an exercise with no identity at all', async () => {
    const res = await push(pushBody({ exercises: [{ name: 'Nameless' }] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'malformed exercise' });
  });
});

describe('authentication', () => {
  it('refuses an unauthenticated pull', async () => {
    expect((await pull(null)).status).toBe(401);
  });

  it('refuses an unauthenticated push', async () => {
    expect((await push(pushBody(), null)).status).toBe(401);
  });

  it('refuses an expired session cookie', async () => {
    env.raw.prepare('UPDATE user_sessions SET expires_at = ? WHERE user_id = ?')
      .run(Date.now() - 1000, 'user-1');
    expect((await pull()).status).toBe(401);
  });

  it('rejects a method that is neither pull nor push', async () => {
    const res = await handleSync(
      new Request('https://liftlog.test/api/sync', { method: 'DELETE', headers: { Cookie: cookie } }),
      env,
    );
    expect(res.status).toBe(405);
  });
});

describe('payload validation', () => {
  it('rejects invalid JSON', async () => {
    const res = await handleSync(new Request('https://liftlog.test/api/sync', {
      method: 'POST', headers: { Cookie: cookie }, body: '{not json',
    }), env);
    expect(res.status).toBe(400);
  });

  it('requires the three core arrays', async () => {
    const res = await push({ sessions: [] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'sessions, setLogs and exerciseLogs must be arrays' });
  });

  it.each([
    ['malformed session',              { sessions: [{ id: 'one', dayId: 1, weekNumber: 1, startedAt: 1 }] }],
    ['malformed set log',              { setLogs: [{ id: 1, sessionId: 1, exerciseId: 'x', setNumber: 1, weight: 'heavy', reps: 8 }] }],
    ['deletedSessionGuids must be an array', { deletedSessionGuids: 'nope' }],
    ['malformed deleted session guid', { deletedSessionGuids: [42] }],
    ['deletedExerciseIds must be an array',  { deletedExerciseIds: {} }],
    ['exercises must be an array',     { exercises: 'nope' }],
    ['malformed plan',                 { plan: { version: 2, plans: [], updatedAt: 1 } }],
  ])('rejects with "%s"', async (error, patch) => {
    const res = await push(pushBody(patch));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error });
  });

  it('accepts the optional set-log fields the client now sends', async () => {
    const res = await push(pushBody({
      setLogs: [{ id: 1, sessionId: 1, exerciseId: 'x', setNumber: 1, weight: 100, reps: 8, order: 2, warmup: true }],
      sessions: [{ id: 1, dayId: 1, weekNumber: 1, startedAt: 1, completedAt: 1, updatedAt: 1 }],
    }));
    expect(res.status).toBe(200);
  });

  it('rejects a set log whose warmup flag is not a boolean', async () => {
    const res = await push(pushBody({
      setLogs: [{ id: 1, sessionId: 1, exerciseId: 'x', setNumber: 1, weight: 100, reps: 8, warmup: 'yes' }],
    }));
    expect(res.status).toBe(400);
  });
});

describe('session documents merge per document', () => {
  it('keeps a newer client document', async () => {
    await push(doc('guid-a', 1_000));
    await push(doc('guid-a', 2_000, 3));
    const data = await (await pull()).json() as { sessions: unknown[]; setLogs: unknown[] };
    expect(data.sessions).toHaveLength(1);
    expect(data.setLogs).toHaveLength(3);
  });

  it('ignores an older client document — the newer copy on the server wins', async () => {
    await push(doc('guid-a', 2_000, 3));
    await push(doc('guid-a', 1_000, 1));
    const data = await (await pull()).json() as { setLogs: unknown[] };
    expect(data.setLogs).toHaveLength(3);
  });

  it('keeps both when two devices log different workouts', async () => {
    await push(doc('device-1', 1_000));
    await push(doc('device-2', 1_100));
    const data = await (await pull()).json() as { sessions: Array<{ guid: string }> };
    expect(data.sessions.map(s => s.guid).sort()).toEqual(['device-1', 'device-2']);
  });

  it('refuses to store an empty session document (a ghost workout)', async () => {
    await push({
      sessions: [{ id: 1, guid: 'ghost', dayId: 1, weekNumber: 1, startedAt: 1, completedAt: 1, updatedAt: 1 }],
      setLogs: [], exerciseLogs: [],
    });
    const data = await (await pull()).json() as { sessions: unknown[] };
    expect(data.sessions).toHaveLength(0);
  });

  it('carries order and warmup through the round trip', async () => {
    await push({
      sessions: [{ id: 1, guid: 'g', dayId: 1, weekNumber: 1, startedAt: 1, completedAt: 1, updatedAt: 1 }],
      setLogs: [
        { id: 1, sessionId: 1, exerciseId: 'bench', setNumber: 1, weight: 45, reps: 12, order: 0, warmup: true },
        { id: 2, sessionId: 1, exerciseId: 'bench', setNumber: 2, weight: 135, reps: 8, order: 0 },
      ],
      exerciseLogs: [],
    });
    const data = await (await pull()).json() as { setLogs: Array<{ warmup?: boolean; order?: number }> };
    expect(data.setLogs.find(s => s.warmup)).toBeTruthy();
    expect(data.setLogs.every(s => s.order === 0)).toBe(true);
  });
});

describe('session tombstones', () => {
  it('deletes a tombstoned session and keeps it deleted', async () => {
    await push(doc('doomed', 1_000));
    await push(pushBody({ deletedSessionGuids: ['doomed'] }));
    expect(((await (await pull()).json()) as { sessions: unknown[] }).sessions).toHaveLength(0);

    // A stale device re-pushing the same session must not resurrect it.
    await push(doc('doomed', 5_000));
    expect(((await (await pull()).json()) as { sessions: unknown[] }).sessions).toHaveLength(0);
  });
});

describe('per-user isolation', () => {
  it('never serves one account the other account\'s data', async () => {
    const other = signIn(env, 'user-2', 'b@example.com');
    await push(doc('mine', 1_000));
    await push(doc('theirs', 1_000), other);

    const mine = await (await pull()).json() as { sessions: Array<{ guid: string }> };
    const theirs = await (await pull(other)).json() as { sessions: Array<{ guid: string }> };
    expect(mine.sessions.map(s => s.guid)).toEqual(['mine']);
    expect(theirs.sessions.map(s => s.guid)).toEqual(['theirs']);
  });

  it('scopes an exercise deletion to the user who made it', async () => {
    const other = signIn(env, 'user-2', 'b@example.com');
    await push(pushBody({ exercises: [{ id: 'curls', name: 'Curls' }] }), other);
    await push(pushBody({
      exercises: [{ id: 'curls', name: 'Curls' }, { id: 'rows', name: 'Rows' }],
      deletedExerciseIds: ['curls'],
    }));

    const mine = await (await pull()).json() as { exercises: Array<{ id: string }>; deletedExerciseIds: string[] };
    const theirs = await (await pull(other)).json() as { exercises: Array<{ id: string }> };
    expect(mine.exercises.map(e => e.id)).toEqual(['rows']);
    expect(mine.deletedExerciseIds).toContain('curls');
    expect(theirs.exercises.find(e => e.id === 'curls')).toBeTruthy();
  });
});

describe('the training plan document (whole-document LWW)', () => {
  const planDoc = (updatedAt: number, goal: string) => ({
    version: 1, updatedAt, plans: [{ id: 'p1', goal }],
  });

  it('stores a plan and returns it on pull', async () => {
    await push(pushBody({ plan: planDoc(1_000, 'hypertrophy') }));
    const data = await (await pull()).json() as { plan: { plans: Array<{ goal: string }> } | null };
    expect(data.plan?.plans[0].goal).toBe('hypertrophy');
  });

  it('upserts only a newer document', async () => {
    await push(pushBody({ plan: planDoc(2_000, 'strength') }));
    await push(pushBody({ plan: planDoc(1_000, 'stale') }));
    const data = await (await pull()).json() as { plan: { plans: Array<{ goal: string }> } };
    expect(data.plan.plans[0].goal).toBe('strength');
  });

  it('returns null when the user has never planned', async () => {
    const data = await (await pull()).json() as { plan: unknown };
    expect(data.plan).toBeNull();
  });
});

describe('the legacy read fallback', () => {
  it('assembles session docs from the pre-v2 tables until the first v2 push', async () => {
    env.raw.prepare(
      'INSERT INTO workout_sessions (local_id, user_id, day_id, week_number, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(1, 'user-1', 2, 3, 7_000, 8_000);
    env.raw.prepare(
      'INSERT INTO set_logs (local_id, user_id, session_id, exercise_id, set_number, weight, reps) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(1, 'user-1', 1, 'deadlift', 1, 225, 5);

    const data = await (await pull()).json() as { sessions: Array<{ guid: string; dayId: number }> };
    // The same deterministic guid the client derives for a pre-v2 row.
    expect(data.sessions).toEqual([expect.objectContaining({ guid: 'legacy-7000', dayId: 2 })]);
  });

  it('drops a legacy session that has no sets', async () => {
    env.raw.prepare(
      'INSERT INTO workout_sessions (local_id, user_id, day_id, week_number, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(1, 'user-1', 2, 3, 7_000, 8_000);
    expect(((await (await pull()).json()) as { sessions: unknown[] }).sessions).toHaveLength(0);
  });

  it('stops consulting the legacy tables once a v2 document exists', async () => {
    env.raw.prepare(
      'INSERT INTO workout_sessions (local_id, user_id, day_id, week_number, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(1, 'user-1', 2, 3, 7_000, 8_000);
    env.raw.prepare(
      'INSERT INTO set_logs (local_id, user_id, session_id, exercise_id, set_number, weight, reps) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(1, 'user-1', 1, 'deadlift', 1, 225, 5);

    await push(doc('modern', 9_000));
    const data = await (await pull()).json() as { sessions: Array<{ guid: string }> };
    expect(data.sessions.map(s => s.guid)).toEqual(['modern']);
  });
});

describe('the program and its metadata', () => {
  const program = [{ id: 1, label: 'Day 1', muscleGroups: 'Chest', exercises: [{ id: 'bench', name: 'Bench', sets: 3 }] }];

  it('round-trips the program document', async () => {
    await push(pushBody({ program, exercises: [{ id: 'bench', name: 'Bench' }] }));
    const data = await (await pull()).json() as { program: unknown };
    expect(data.program).toEqual(program);
  });

  // An empty program array is a wipe, not a design — persisting it once meant
  // every device re-pulled the emptiness. The push must be a no-op instead.
  it('refuses to overwrite a stored program with an empty one', async () => {
    await push(pushBody({ program, exercises: [{ id: 'bench', name: 'Bench' }] }));
    await push(pushBody({ program: [], exercises: [{ id: 'bench', name: 'Bench' }] }));
    const data = await (await pull()).json() as { program: unknown };
    expect(data.program).toEqual(program);
  });

  it('serves per-user metadata overrides back to their owner only', async () => {
    const other = signIn(env, 'user-2', 'b@example.com');
    await push(pushBody({
      exercises: [{ id: 'rows', name: 'Rows' }],
      exerciseMuscles: [{ exerciseId: 'rows', primaryMuscle: 'Lats', secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null }],
      exerciseDetails: [{ exerciseId: 'rows', workoutType: 'Row', equipment: 'Barbell', weightType: 'Total' }],
    }));
    const mine = await (await pull()).json() as { exerciseMuscles: Array<{ exerciseId: string; primaryMuscle: string }> };
    const theirs = await (await pull(other)).json() as { exerciseMuscles: Array<{ exerciseId: string }> };
    expect(mine.exerciseMuscles.find(m => m.exerciseId === 'rows')?.primaryMuscle).toBe('Lats');
    expect(theirs.exerciseMuscles.find(m => m.exerciseId === 'rows')).toBeUndefined();
  });

  it('reports the caller\'s role, defaulting to user', async () => {
    const data = await (await pull()).json() as { role: string };
    expect(data.role).toBe('user');
  });
});
