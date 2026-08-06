// src/db/database.ts — the IndexedDB layer.
//
// 443 lines and no coverage, because reaching it means an IndexedDB. The pure
// merge *planner* is already tested (data/syncMerge.test.ts); what is only
// testable here is everything the plan is applied through — the transaction
// mechanics, the guid backfill, the ghost purge, the id migrations — plus the
// invariants those carry for sync (an edit must bump updatedAt or other devices
// never converge).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  createSession, completeSession, touchSession, ensureSessionGuids,
  addSetLog, getSession, updateSessionDate, getSetLogsForSession,
  deleteSetLogsForSession, deleteSetLogsByExerciseId, hasSetLogsForExercise,
  purgeEmptySessions, migrateExerciseIds, remapSetLogExerciseIds,
  dumpIDB, clearIDB, mergeServerSessions,
} from './database';
import { getSessionTombstones } from '../data/sessionTombstones';

beforeEach(async () => {
  // database.ts caches its open connection in a module-level `_db`, so swapping
  // the IDBFactory out from under it would leave the two pointing at different
  // databases. Emptying the stores through the module's own API is what keeps
  // them in step — and it exercises clearIDB on every test as a side benefit.
  await clearIDB();
  localStorage.clear();
});

/** A completed session with `n` logged sets, returning its local id. */
async function loggedSession(
  { dayId = 1, week = 1, startedAt = 1_000, sets = 1, exerciseId = 'bench-press' } = {},
): Promise<number> {
  const id = await createSession(dayId, week, startedAt);
  for (let i = 0; i < sets; i++) {
    await addSetLog(id, exerciseId, i + 1, 135, 8, 0);
  }
  await completeSession(id, startedAt + 60_000);
  return id;
}

/** Open a second, raw connection — for arranging rows the API cannot write. */
async function rawDB(): Promise<IDBDatabase> {
  const req = indexedDB.open('liftlog', 3);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

describe('logging a workout', () => {
  it('stores the session and its sets', async () => {
    const id = await loggedSession({ sets: 3 });
    const session = await getSession(id);
    expect(session).toMatchObject({ dayId: 1, weekNumber: 1, startedAt: 1_000, completedAt: 61_000 });
    expect(await getSetLogsForSession(id)).toHaveLength(3);
  });

  it('gives every new session an immutable guid', async () => {
    const a = await getSession(await loggedSession());
    const b = await getSession(await loggedSession({ startedAt: 2_000 }));
    expect(a!.guid).toBeTruthy();
    expect(a!.guid).not.toBe(b!.guid);
  });

  it('keeps weight 0 — bodyweight and timed work log at no load', async () => {
    const id = await createSession(1, 1);
    await addSetLog(id, 'plank', 1, 0, 45);
    expect((await getSetLogsForSession(id))[0]).toMatchObject({ weight: 0, reps: 45 });
  });

  // `order` and `warmup` are schemaless additions: undefined must be omitted
  // rather than stored, so a legacy document stays byte-identical on the wire.
  it('omits the optional fields rather than storing undefined', async () => {
    const id = await createSession(1, 1);
    await addSetLog(id, 'bench-press', 1, 135, 8);
    const log = (await getSetLogsForSession(id))[0];
    expect('order' in log).toBe(false);
    expect('warmup' in log).toBe(false);
  });

  it('stores order and the warm-up flag when given them', async () => {
    const id = await createSession(1, 1);
    await addSetLog(id, 'bench-press', 1, 45, 12, 2, true);
    expect((await getSetLogsForSession(id))[0]).toMatchObject({ order: 2, warmup: true });
  });

  it('returns only the requested session\'s sets', async () => {
    const a = await loggedSession({ sets: 2 });
    await loggedSession({ startedAt: 5_000, sets: 3 });
    expect(await getSetLogsForSession(a)).toHaveLength(2);
  });

  it('returns undefined for a session that does not exist', async () => {
    expect(await getSession(999)).toBeUndefined();
  });
});

// Merge sync resolves per session document by updatedAt. Anything that rewrites
// a session's sets without bumping it leaves other devices believing they are
// already in sync, and the edit never lands.
describe('updatedAt — the field the merge resolves on', () => {
  it('is stamped when the session completes', async () => {
    const session = await getSession(await loggedSession());
    expect(session!.updatedAt).toBeGreaterThan(0);
  });

  it('moves forward on touchSession', async () => {
    const id = await loggedSession();
    const before = (await getSession(id))!.updatedAt!;
    vi.setSystemTime(Date.now() + 1000);
    await touchSession(id);
    expect((await getSession(id))!.updatedAt!).toBeGreaterThan(before);
    vi.useRealTimers();
  });

  it('moves forward when the session date is edited', async () => {
    const id = await loggedSession();
    const before = (await getSession(id))!.updatedAt!;
    vi.setSystemTime(Date.now() + 1000);
    await updateSessionDate(id, 99_000, 5);
    const after = await getSession(id);
    expect(after!.completedAt).toBe(99_000);
    expect(after!.weekNumber).toBe(5);
    // Re-dating forward keeps the original start — the duration signal
    // (completedAt − startedAt) must not be invented by an edit.
    expect(after!.startedAt).toBe(1_000);
    expect(after!.updatedAt!).toBeGreaterThan(before);
    vi.useRealTimers();
  });

  it('moves forward when an exercise\'s history is wiped from a session', async () => {
    const id = await loggedSession({ sets: 2, exerciseId: 'curls' });
    const before = (await getSession(id))!.updatedAt!;
    vi.setSystemTime(Date.now() + 1000);
    await deleteSetLogsByExerciseId('curls');
    expect((await getSession(id))!.updatedAt!).toBeGreaterThan(before);
    vi.useRealTimers();
  });

  it('touching a session that does not exist is a no-op, not a crash', async () => {
    await expect(touchSession(999)).resolves.toBeUndefined();
  });
});

describe('ensureSessionGuids — backfilling pre-v2 rows', () => {
  it('derives the deterministic legacy guid every device computes', async () => {
    // A row as a pre-v2 build wrote it: no guid at all.
    const db = await rawDB();
    const tx = db.transaction('sessions', 'readwrite');
    const add = tx.objectStore('sessions').add({ dayId: 1, weekNumber: 1, startedAt: 7_000 });
    const id = await new Promise<number>(res => { add.onsuccess = () => res(add.result as number); });
    await new Promise(res => { tx.oncomplete = res; });
    db.close();

    await ensureSessionGuids();
    // Both devices holding this session derive `legacy-<startedAt>`, so they
    // agree on its identity without ever having exchanged one.
    expect((await getSession(id))!.guid).toBe('legacy-7000');
  });

  it('leaves an existing guid alone', async () => {
    const id = await loggedSession();
    const original = (await getSession(id))!.guid;
    await ensureSessionGuids();
    expect((await getSession(id))!.guid).toBe(original);
  });
});

describe('purgeEmptySessions — ghost workouts', () => {
  it('deletes a session with no sets and reports how many went', async () => {
    await createSession(1, 1, 1_000);      // ghost
    await loggedSession({ startedAt: 2_000 }); // real
    expect(await purgeEmptySessions()).toBe(1);
    expect((await dumpIDB()).sessions).toHaveLength(1);
  });

  // Without a tombstone the ghost simply comes back on the next pull.
  it('records a tombstone so the deletion survives the next sync', async () => {
    const id = await createSession(1, 1, 4_000);
    const guid = (await getSession(id))!.guid!;
    await purgeEmptySessions();
    expect([...getSessionTombstones()]).toContain(guid);
  });

  it('tombstones a pre-guid ghost under its derived legacy identity', async () => {
    const db = await rawDB();
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').add({ dayId: 1, weekNumber: 1, startedAt: 4_000 });
    await new Promise(res => { tx.oncomplete = res; });
    db.close();

    await purgeEmptySessions();
    expect([...getSessionTombstones()]).toContain('legacy-4000');
  });

  it('keeps a session whose only sets are warm-ups — it is real, just light', async () => {
    const id = await createSession(1, 1);
    await addSetLog(id, 'bench-press', 1, 45, 12, 0, true);
    expect(await purgeEmptySessions()).toBe(0);
  });

  it('is a cheap no-op when there is nothing to purge', async () => {
    await loggedSession();
    expect(await purgeEmptySessions()).toBe(0);
  });
});

describe('exercise id migrations', () => {
  it('canonicalizes legacy -d1/-d2/-d4 set logs', async () => {
    const id = await createSession(1, 1);
    await addSetLog(id, 'lat-pulldown-d2', 1, 100, 10);
    expect(await migrateExerciseIds()).toBe(1);
    expect((await getSetLogsForSession(id))[0].exerciseId).toBe('lat-pull-down');
  });

  it('is idempotent — a second run finds nothing to do', async () => {
    const id = await createSession(1, 1);
    await addSetLog(id, 'lat-pulldown-d2', 1, 100, 10);
    await migrateExerciseIds();
    expect(await migrateExerciseIds()).toBe(0);
  });

  it('leaves canonical ids untouched', async () => {
    await loggedSession({ exerciseId: 'bench-press' });
    expect(await migrateExerciseIds()).toBe(0);
  });

  it('applies an admin merge map and bumps the affected sessions', async () => {
    const id = await loggedSession({ sets: 2, exerciseId: 'bench-press-1700000000000' });
    const before = (await getSession(id))!.updatedAt!;
    vi.setSystemTime(Date.now() + 1000);

    expect(await remapSetLogExerciseIds({ 'bench-press-1700000000000': 'bench-press' })).toBe(2);
    expect((await getSetLogsForSession(id)).every(l => l.exerciseId === 'bench-press')).toBe(true);
    // The remap must propagate as the newer document, or other devices keep the old ids.
    expect((await getSession(id))!.updatedAt!).toBeGreaterThan(before);
    vi.useRealTimers();
  });

  it('ignores a merge map with nothing relevant in it', async () => {
    await loggedSession();
    expect(await remapSetLogExerciseIds({ 'something-else': 'other' })).toBe(0);
  });
});

describe('deleting set logs', () => {
  it('clears one session\'s sets and leaves the others alone', async () => {
    const a = await loggedSession({ sets: 2 });
    const b = await loggedSession({ startedAt: 5_000, sets: 2 });
    await deleteSetLogsForSession(a);
    expect(await getSetLogsForSession(a)).toHaveLength(0);
    expect(await getSetLogsForSession(b)).toHaveLength(2);
  });

  it('reports whether an exercise has any history, and wipes it on request', async () => {
    await loggedSession({ sets: 3, exerciseId: 'curls' });
    expect(await hasSetLogsForExercise('curls')).toBe(true);
    expect(await hasSetLogsForExercise('never-trained')).toBe(false);

    await deleteSetLogsByExerciseId('curls');
    expect(await hasSetLogsForExercise('curls')).toBe(false);
  });

  it('wipes that exercise across every session it appears in', async () => {
    await loggedSession({ sets: 1, exerciseId: 'curls' });
    await loggedSession({ startedAt: 5_000, sets: 1, exerciseId: 'curls' });
    await loggedSession({ startedAt: 9_000, sets: 1, exerciseId: 'rows' });
    await deleteSetLogsByExerciseId('curls');
    expect((await dumpIDB()).setLogs.map(l => l.exerciseId)).toEqual(['rows']);
  });
});

describe('clearIDB — the account switch', () => {
  it('empties every store so one account\'s history cannot show up under another', async () => {
    await loggedSession({ sets: 3 });
    await clearIDB();
    const dump = await dumpIDB();
    expect(dump.sessions).toHaveLength(0);
    expect(dump.setLogs).toHaveLength(0);
    expect(dump.exerciseLogs).toHaveLength(0);
  });
});

describe('mergeServerSessions — applying a pull', () => {
  const serverDoc = (guid: string, updatedAt: number, sets = 1) => ({
    guid, dayId: 1, weekNumber: 1, startedAt: updatedAt, completedAt: updatedAt, updatedAt,
    sets: Array.from({ length: sets }, (_, i) => ({
      exerciseId: 'bench-press', setNumber: i + 1, weight: 135, reps: 8,
    })),
  });

  it('inserts a session this device has never seen', async () => {
    expect(await mergeServerSessions([serverDoc('remote-1', 5_000, 2)], new Set())).toBe(true);
    const dump = await dumpIDB();
    expect(dump.sessions).toHaveLength(1);
    expect(dump.setLogs).toHaveLength(2);
  });

  // The whole point of merge sync: a pull must never cost you a workout you
  // logged here and have not pushed yet.
  it('never drops a local-only session', async () => {
    await loggedSession({ startedAt: 1_000 });
    await mergeServerSessions([serverDoc('remote-1', 5_000)], new Set());
    expect((await dumpIDB()).sessions).toHaveLength(2);
  });

  it('replaces the local copy when the server\'s is newer', async () => {
    await mergeServerSessions([serverDoc('shared', 1_000, 1)], new Set());
    expect(await mergeServerSessions([serverDoc('shared', 2_000, 3)], new Set())).toBe(true);
    const dump = await dumpIDB();
    expect(dump.sessions).toHaveLength(1);
    expect(dump.setLogs).toHaveLength(3);
  });

  it('does no work when the server copy is not newer', async () => {
    await mergeServerSessions([serverDoc('shared', 2_000, 3)], new Set());
    expect(await mergeServerSessions([serverDoc('shared', 2_000, 3)], new Set())).toBe(false);
    expect((await dumpIDB()).setLogs).toHaveLength(3);
  });

  it('removes a session the server says was deleted', async () => {
    await mergeServerSessions([serverDoc('doomed', 1_000)], new Set());
    expect(await mergeServerSessions([], new Set(['doomed']))).toBe(true);
    const dump = await dumpIDB();
    expect(dump.sessions).toHaveLength(0);
    expect(dump.setLogs).toHaveLength(0);
  });

  it('never inserts a session that arrives already tombstoned', async () => {
    await mergeServerSessions([serverDoc('doomed', 1_000)], new Set(['doomed']));
    expect((await dumpIDB()).sessions).toHaveLength(0);
  });

  it('reports no change for an empty pull', async () => {
    expect(await mergeServerSessions([], new Set())).toBe(false);
  });
});
