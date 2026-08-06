// src/data/sync.ts — the client half of cloud sync, wired to the real worker.
//
// This file had no coverage, and neither did the worker, so the one contract
// that spans them — the shape of the sync payload — was checked by nobody. That
// is exactly where it broke: the client stopped sending sets/repLow/repHigh on
// library exercises, the worker still required them, and every push 400'd for
// months with no test to notice.
//
// So `fetch` here is not a mock returning canned JSON. It is routed into the
// actual worker handler over an actual (in-memory) D1. A client change that the
// server would reject fails here, in one assertion, without a deploy.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { handleSync } from '../worker/sync';
import { createTestEnv, signIn } from '../worker/testkit';
import type { TestEnv } from '../worker/testkit';
import {
  pushSync, pullSync, getLoggedInUser, getUserRole, ensureLocalDataOwner,
} from '../src/data/sync';
import {
  createSession, addSetLog, completeSession, dumpIDB, clearIDB,
} from '../src/db/database';
import { getStoredProgram, saveStoredProgram, getExerciseLibrary, addToExerciseLibrary } from '../src/data/programStore';
import { getPlanState, saveTrainingProfile } from '../src/data/planStore';
import { defaultTrainingProfile } from '../src/data/plan';
import { saveExerciseMeta, getExerciseMeta } from '../src/data/exercises';
import type { WorkoutDay } from '../src/data/program';

let env: TestEnv;

// sync.ts reads the signed-in account from `document.cookie`. That one accessor
// is the file's only DOM dependency — and booting jsdom for it would also stop
// the worker harness importing node:sqlite, so it gets a nine-line stand-in
// instead. Behaviour that matters here: writing "k=v; attrs" sets k, and
// Max-Age=0 removes it.
const jar = new Map<string, string>();
const documentStub = {
  get cookie(): string {
    return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  },
  set cookie(raw: string) {
    const [pair, ...attrs] = raw.split(';');
    const idx = pair.indexOf('=');
    const key = pair.slice(0, idx).trim();
    if (attrs.some(a => /^\s*max-age\s*=\s*0\s*$/i.test(a))) jar.delete(key);
    else jar.set(key, pair.slice(idx + 1).trim());
  },
};

/** Sign a user in the way the app sees it: the JS-readable user cookie. */
function signInBrowser(email: string): void {
  const cookie = signIn(env, `user-${email}`, email);
  document.cookie = `${cookie}; path=/`;
  document.cookie = `liftlog_user=${encodeURIComponent(JSON.stringify({ email, name: 'Test' }))}; path=/`;
}

beforeEach(async () => {
  vi.stubGlobal('document', documentStub);
  env = createTestEnv();
  await clearIDB();
  localStorage.clear();
  jar.clear();

  // Route the client's fetch into the worker, carrying the browser's cookies.
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString(), 'https://liftlog.test');
    const headers = new Headers(init?.headers);
    headers.set('Cookie', document.cookie);
    return handleSync(new Request(url, { ...init, headers }), env);
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

const day = (id: number): WorkoutDay => ({
  id, label: `Day ${id}`, muscleGroups: 'Chest',
  exercises: [{ id: 'bench-press', name: 'Bench Press', sets: 3, repLow: 8, repHigh: 12 }],
});

async function logWorkout(startedAt: number, sets = 2): Promise<number> {
  const id = await createSession(1, 1, startedAt);
  for (let i = 0; i < sets; i++) await addSetLog(id, 'bench-press', i + 1, 135, 8, 0);
  await completeSession(id, startedAt + 60_000);
  return id;
}

describe('the payload contract between this client and this worker', () => {
  beforeEach(() => signInBrowser('a@example.com'));

  // The regression that motivated this file.
  it('pushes a library the worker accepts', async () => {
    addToExerciseLibrary({ id: 'bench-press', name: 'Bench Press' });
    await expect(pushSync()).resolves.toBeUndefined();
  });

  it('round-trips a full account: history, program, library, journey', async () => {
    saveStoredProgram([day(1)]);
    addToExerciseLibrary({ id: 'bench-press', name: 'Bench Press' });
    saveTrainingProfile({ ...defaultTrainingProfile(), experience: 'advanced' });
    await logWorkout(1_000, 3);
    await pushSync();

    // A second device: same account, empty local state.
    await clearIDB();
    localStorage.clear();
    expect(await pullSync()).toBe(true);

    expect((await dumpIDB()).setLogs).toHaveLength(3);
    expect(getStoredProgram()[0].exercises[0].id).toBe('bench-press');
    expect(getExerciseLibrary().find(e => e.id === 'bench-press')).toBeTruthy();
    expect(getPlanState().profile?.experience).toBe('advanced');
  });

  it('carries exercise metadata overrides across devices', async () => {
    addToExerciseLibrary({ id: 'my-lift-1700000000000', name: 'My Lift' });
    saveExerciseMeta('my-lift-1700000000000', {
      ...getExerciseMeta('my-lift-1700000000000'), primaryMuscle: 'Lats', equipment: 'Cable Machine' as const,
    });
    await pushSync();

    localStorage.clear();
    await pullSync();
    expect(getExerciseMeta('my-lift-1700000000000')).toMatchObject({ primaryMuscle: 'Lats', equipment: 'Cable Machine' });
  });

  it('carries the warm-up flag and exercise order through the server', async () => {
    const id = await createSession(1, 1, 1_000);
    await addSetLog(id, 'bench-press', 1, 45, 12, 0, true);
    await addSetLog(id, 'bench-press', 2, 135, 8, 0);
    await completeSession(id, 62_000);
    await pushSync();

    await clearIDB();
    await pullSync();
    const sets = (await dumpIDB()).setLogs;
    expect(sets.filter(s => s.warmup)).toHaveLength(1);
    expect(sets.every(s => s.order === 0)).toBe(true);
  });

  it('reports the role the server resolved', async () => {
    await pullSync();
    expect(getUserRole()).toBe('user');
  });
});

describe('merging, not replacing', () => {
  beforeEach(() => signInBrowser('a@example.com'));

  // The property the whole sync-v2 design exists for.
  it('never drops a workout logged locally but not yet pushed', async () => {
    await logWorkout(1_000);
    await pushSync();

    await logWorkout(9_000); // logged on this device since the last push
    await pullSync();
    expect((await dumpIDB()).sessions).toHaveLength(2);
  });

  it('lets an edit made on another device win by updatedAt', async () => {
    await logWorkout(1_000, 2);
    await pushSync();
    const guid = (await dumpIDB()).sessions[0].guid!;

    // Another device rewrites the same session with more sets, later.
    env.raw.prepare(
      'UPDATE session_docs SET sets_json = ?, updated_at = ? WHERE guid = ?',
    ).run(JSON.stringify([
      { exerciseId: 'bench-press', setNumber: 1, weight: 145, reps: 8 },
      { exerciseId: 'bench-press', setNumber: 2, weight: 145, reps: 8 },
      { exerciseId: 'bench-press', setNumber: 3, weight: 145, reps: 8 },
    ]), Date.now() + 60_000, guid);

    await pullSync();
    const sets = (await dumpIDB()).setLogs;
    expect(sets).toHaveLength(3);
    expect(sets.every(s => s.weight === 145)).toBe(true);
  });

  it('keeps a local-only library entry through a pull', async () => {
    addToExerciseLibrary({ id: 'bench-press', name: 'Bench Press' });
    await pushSync();
    addToExerciseLibrary({ id: 'garage-lift-1700000000000', name: 'Garage Lift' });

    await pullSync();
    expect(getExerciseLibrary().find(e => e.id === 'garage-lift-1700000000000')).toBeTruthy();
  });

  it('does not resurrect a deleted session', async () => {
    await createSession(1, 1, 3_000); // a ghost: no sets
    await logWorkout(1_000);
    await pushSync();                 // purges the ghost and tombstones it

    await pullSync();
    expect((await dumpIDB()).sessions).toHaveLength(1);
  });
});

describe('ensureLocalDataOwner — the account switch', () => {
  it('wipes user-scoped local data when a different account signs in', async () => {
    signInBrowser('a@example.com');
    saveStoredProgram([day(1)]);
    saveTrainingProfile(defaultTrainingProfile());
    await logWorkout(1_000, 2);
    await ensureLocalDataOwner();

    signInBrowser('b@example.com');
    await ensureLocalDataOwner();

    // Nothing of A's is left to show B — or, worse, to push into B's account.
    expect((await dumpIDB()).sessions).toHaveLength(0);
    expect(getStoredProgram()).toEqual([]);
    expect(getPlanState().plans).toHaveLength(0);
    expect(localStorage.getItem('liftlog_data_owner')).toBe('b@example.com');
  });

  it('leaves everything alone when the same account signs back in', async () => {
    signInBrowser('a@example.com');
    saveStoredProgram([day(1)]);
    await logWorkout(1_000, 2);
    await ensureLocalDataOwner();
    await ensureLocalDataOwner();

    expect((await dumpIDB()).sessions).toHaveLength(1);
    expect(getStoredProgram()).toHaveLength(1);
  });

  it('claims ownership on first sign-in without wiping', async () => {
    saveStoredProgram([day(1)]); // data from before the owner key existed
    signInBrowser('a@example.com');
    await ensureLocalDataOwner();
    expect(getStoredProgram()).toHaveLength(1);
    expect(localStorage.getItem('liftlog_data_owner')).toBe('a@example.com');
  });

  it('is a no-op when nobody is signed in', async () => {
    await expect(ensureLocalDataOwner()).resolves.toBeUndefined();
    expect(localStorage.getItem('liftlog_data_owner')).toBeNull();
  });

  // A switch must not leak one account's data into another via the server.
  it('never pushes the previous account\'s history into the new one', async () => {
    signInBrowser('a@example.com');
    await ensureLocalDataOwner();
    await logWorkout(1_000, 2);
    await pushSync();

    signInBrowser('b@example.com');
    await ensureLocalDataOwner();
    await pushSync();

    const bDocs = env.raw.prepare('SELECT guid FROM session_docs WHERE user_id = ?')
      .all('user-b@example.com');
    expect(bDocs).toHaveLength(0);
  });
});

describe('getLoggedInUser', () => {
  it('reads the account from the JS-readable cookie', () => {
    signInBrowser('a@example.com');
    expect(getLoggedInUser()).toMatchObject({ email: 'a@example.com' });
  });

  it('returns null with no cookie', () => {
    expect(getLoggedInUser()).toBeNull();
  });

  it('returns null rather than throwing on a corrupt cookie', () => {
    document.cookie = 'liftlog_user=not-json; path=/';
    expect(getLoggedInUser()).toBeNull();
  });
});

describe('when the session has expired', () => {
  // A 401 must be survivable: the app keeps working offline against local data
  // rather than throwing on every startup sync.
  it('pushes and pulls quietly instead of throwing', async () => {
    document.cookie = `liftlog_user=${encodeURIComponent(JSON.stringify({ email: 'x@example.com', name: 'X' }))}; path=/`;
    await expect(pushSync()).resolves.toBeUndefined();
    await expect(pullSync()).resolves.toBe(false);
  });
});
