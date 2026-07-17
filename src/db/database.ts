import { LEGACY_ID_MAP } from '../data/legacyIds';
import { addSessionTombstones } from '../data/sessionTombstones';
import { planSessionMerge, mergePlanIsEmpty } from '../data/syncMerge';
import type { SessionDoc, SessionMergePlan } from '../data/syncMerge';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Session {
  id?: number;
  /** Immutable sync identity. Absent on pre-sync-v2 rows (derived as legacy-<startedAt>). */
  guid?: string;
  dayId: number;
  weekNumber: number;
  startedAt: number;
  completedAt?: number;
  /** Last meaningful write — per-session conflict resolution for merge sync. */
  updatedAt?: number;
}

export interface SetLog {
  id?: number;
  sessionId: number;
  exerciseId: string;
  setNumber: number;
  weight: number;
  reps: number;
  /**
   * 0-based position of this set's exercise within the workout (the order it
   * was trained in). Fresh-form context for the progress engine — benching
   * 4th reads differently than benching 1st. Absent on pre-order rows;
   * consumers fall back to set-log insertion order.
   */
  order?: number;
  /**
   * Warm-up set. Logged so the user can see it, but excluded from every
   * analytical read (metrics, recommendations, progress, volume) — the
   * snapshot keeps warm-ups out of `setsBySession`. Absent/false on working
   * sets; schemaless like `order`, so no version bump. `undefined` is dropped
   * by JSON so legacy docs stay byte-identical on the wire.
   */
  warmup?: boolean;
}

// Difficulty ratings — feature removed, store kept for compatibility
export interface ExerciseLog {
  id?: number;
  sessionId: number;
  exerciseId: string;
  difficulty: Difficulty;
}

// Wraps any IDB request in a Promise so we can use async/await instead of callbacks
function idbReq<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Resolves when a transaction commits. Queue all requests on the transaction
// synchronously (never await between them — an await lets the transaction
// auto-commit), then await this once.
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

let _db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('liftlog', 3);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const { oldVersion } = event;

      if (oldVersion < 1) {
        const sessions = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        sessions.createIndex('weekNumber', 'weekNumber');

        const setLogs = db.createObjectStore('setLogs', { keyPath: 'id', autoIncrement: true });
        setLogs.createIndex('sessionId', 'sessionId');

        const exerciseLogs = db.createObjectStore('exerciseLogs', { keyPath: 'id', autoIncrement: true });
        exerciseLogs.createIndex('sessionId', 'sessionId');
      }

      if (oldVersion < 2) {
        db.createObjectStore('exerciseMuscles', { keyPath: 'exerciseId' });
        db.createObjectStore('exerciseDetails', { keyPath: 'exerciseId' });
      }

      // v3: exercise metadata moved to localStorage — remove the IDB stores
      if (oldVersion < 3) {
        if (db.objectStoreNames.contains('exerciseMuscles')) db.deleteObjectStore('exerciseMuscles');
        if (db.objectStoreNames.contains('exerciseDetails')) db.deleteObjectStore('exerciseDetails');
      }
    };

    request.onsuccess = () => { _db = request.result; resolve(request.result); };
    request.onerror = () => reject(request.error);
  });
}

export async function createSession(dayId: number, weekNumber: number, startedAt = Date.now()): Promise<number> {
  const db = await openDB();
  const id = await idbReq(
    db.transaction('sessions', 'readwrite').objectStore('sessions').add({
      guid: crypto.randomUUID(), dayId, weekNumber, startedAt, updatedAt: Date.now(),
    } as Session),
  );
  return id as number;
}

export async function completeSession(sessionId: number, completedAt = Date.now()): Promise<void> {
  const db = await openDB();
  const store = db.transaction('sessions', 'readonly').objectStore('sessions');
  const session = await idbReq<Session>(store.get(sessionId));
  session.completedAt = completedAt;
  session.updatedAt = Date.now();
  await idbReq(db.transaction('sessions', 'readwrite').objectStore('sessions').put(session));
}

// Bump a session's updatedAt after its set logs were rewritten (edit-session
// flow) so the merge protocol propagates the edit as the newer copy.
export async function touchSession(sessionId: number): Promise<void> {
  const db = await openDB();
  const session = await idbReq<Session | undefined>(
    db.transaction('sessions', 'readonly').objectStore('sessions').get(sessionId),
  );
  if (!session) return;
  session.updatedAt = Date.now();
  await idbReq(db.transaction('sessions', 'readwrite').objectStore('sessions').put(session));
}

// Pins a stored GUID onto pre-sync-v2 sessions. The value is derived
// deterministically from startedAt so every device holding a copy of the same
// legacy session computes the same identity; materializing it protects the
// identity against later startedAt mutation (updateSessionDate re-dating).
export async function ensureSessionGuids(): Promise<void> {
  const db = await openDB();
  const sessions = await idbReq<Session[]>(
    db.transaction('sessions', 'readonly').objectStore('sessions').getAll(),
  );
  const missing = sessions.filter(s => !s.guid);
  if (missing.length === 0) return;

  const tx = db.transaction('sessions', 'readwrite');
  const store = tx.objectStore('sessions');
  for (const s of missing) store.put({ ...s, guid: `legacy-${s.startedAt}` });
  await txDone(tx);
}

export async function addSetLog(
  sessionId: number,
  exerciseId: string,
  setNumber: number,
  weight: number,
  reps: number,
  order?: number,
  warmup?: boolean,
): Promise<void> {
  const db = await openDB();
  await idbReq(
    db.transaction('setLogs', 'readwrite').objectStore('setLogs').add({
      sessionId, exerciseId, setNumber, weight, reps,
      ...(order != null ? { order } : {}),
      ...(warmup ? { warmup: true } : {}),
    } as SetLog),
  );
}

export async function getSession(sessionId: number): Promise<Session | undefined> {
  const db = await openDB();
  return idbReq<Session | undefined>(
    db.transaction('sessions', 'readonly').objectStore('sessions').get(sessionId),
  );
}

// Move a completed session to a new date. weekNumber is recomputed by the caller
// (which owns the program start date) so weekly metrics bucket the session correctly.
export async function updateSessionDate(
  sessionId: number,
  completedAt: number,
  weekNumber: number,
): Promise<void> {
  const db = await openDB();
  const session = await idbReq<Session | undefined>(
    db.transaction('sessions', 'readonly').objectStore('sessions').get(sessionId),
  );
  if (!session) return;
  session.completedAt = completedAt;
  session.startedAt = Math.min(session.startedAt, completedAt);
  session.weekNumber = weekNumber;
  session.updatedAt = Date.now();
  await idbReq(db.transaction('sessions', 'readwrite').objectStore('sessions').put(session));
}

export async function getSetLogsForSession(sessionId: number): Promise<SetLog[]> {
  const db = await openDB();
  return idbReq<SetLog[]>(
    db.transaction('setLogs', 'readonly')
      .objectStore('setLogs')
      .index('sessionId')
      .getAll(sessionId),
  );
}

// Delete every set log whose key is returned by the given lookup, in one
// readwrite transaction (all-or-nothing, single commit).
async function deleteSetLogs(getKeys: (store: IDBObjectStore) => IDBRequest<IDBValidKey[]>): Promise<void> {
  const db = await openDB();
  const keys = await idbReq(getKeys(db.transaction('setLogs', 'readonly').objectStore('setLogs')));
  if (keys.length === 0) return;

  const tx = db.transaction('setLogs', 'readwrite');
  const store = tx.objectStore('setLogs');
  for (const key of keys) store.delete(key);
  await txDone(tx);
}

export async function deleteSetLogsForSession(sessionId: number): Promise<void> {
  await deleteSetLogs(store => store.index('sessionId').getAllKeys(sessionId));
}

export async function hasSetLogsForExercise(exerciseId: string): Promise<boolean> {
  const db = await openDB();
  const all = await idbReq<SetLog[]>(
    db.transaction('setLogs', 'readonly').objectStore('setLogs').getAll(),
  );
  return all.some(l => l.exerciseId === exerciseId);
}

export async function deleteSetLogsByExerciseId(exerciseId: string): Promise<void> {
  const db = await openDB();
  const all = await idbReq<SetLog[]>(
    db.transaction('setLogs', 'readonly').objectStore('setLogs').getAll(),
  );
  const doomed = all.filter(l => l.exerciseId === exerciseId);
  if (doomed.length === 0) return;

  const tx = db.transaction('setLogs', 'readwrite');
  const store = tx.objectStore('setLogs');
  for (const log of doomed) store.delete(log.id!);
  await txDone(tx);

  // Bump the affected sessions so merge sync propagates the removal as the
  // newer copy (sessions emptied entirely are tombstoned by the purge that
  // follows in pushSync).
  for (const sessionId of new Set(doomed.map(l => l.sessionId))) {
    await touchSession(sessionId);
  }
}

// Remove sessions that carry no set logs. Empty sessions are meaningless
// "ghost" workouts (a residue of old buggy builds / interrupted syncs) that
// kept reappearing as duplicates. Runs at startup and around every sync.
// Each purge records a session tombstone so the deletion propagates through
// merge sync instead of resurrecting from the server copy. exerciseLogs for
// the removed sessions are dropped too (that store is otherwise unused).
export async function purgeEmptySessions(): Promise<number> {
  const db = await openDB();
  const [sessions, setLogs, exerciseLogs] = await Promise.all([
    idbReq<Session[]>(db.transaction('sessions', 'readonly').objectStore('sessions').getAll()),
    idbReq<SetLog[]>(db.transaction('setLogs', 'readonly').objectStore('setLogs').getAll()),
    idbReq<ExerciseLog[]>(db.transaction('exerciseLogs', 'readonly').objectStore('exerciseLogs').getAll()),
  ]);

  const withSets = new Set(setLogs.map(l => l.sessionId));
  const empty = sessions.filter(s => !withSets.has(s.id!));
  if (empty.length === 0) return 0;
  const emptyIds = new Set(empty.map(s => s.id!));

  addSessionTombstones(empty.map(s => s.guid ?? `legacy-${s.startedAt}`));

  const tx = db.transaction(['sessions', 'exerciseLogs'], 'readwrite');
  const sessionStore = tx.objectStore('sessions');
  const exerciseLogStore = tx.objectStore('exerciseLogs');
  for (const id of emptyIds) sessionStore.delete(id);
  for (const log of exerciseLogs) {
    if (emptyIds.has(log.sessionId)) exerciseLogStore.delete(log.id!);
  }
  await txDone(tx);
  return empty.length;
}

// ── Exercise ID migration ─────────────────────────────────────────────────────

export async function migrateExerciseIds(): Promise<number> {
  const db = await openDB();
  const logs = await idbReq<SetLog[]>(
    db.transaction('setLogs', 'readonly').objectStore('setLogs').getAll(),
  );
  const toFix = logs.filter(l => LEGACY_ID_MAP[l.exerciseId]);
  if (toFix.length === 0) return 0;

  const tx = db.transaction('setLogs', 'readwrite');
  const store = tx.objectStore('setLogs');
  for (const log of toFix) {
    store.put({ ...log, exerciseId: LEGACY_ID_MAP[log.exerciseId] });
  }
  await txDone(tx);
  return toFix.length;
}

// Remap set-log exercise ids through an admin merge map (data/merges.ts).
// Same mechanics as migrateExerciseIds, but the map is dynamic (pulled from
// the server) and every affected session gets its updatedAt bumped so the
// remapped copy propagates through merge sync as the newer document.
export async function remapSetLogExerciseIds(map: Record<string, string>): Promise<number> {
  const db = await openDB();
  const logs = await idbReq<SetLog[]>(
    db.transaction('setLogs', 'readonly').objectStore('setLogs').getAll(),
  );
  const toFix = logs.filter(l => map[l.exerciseId]);
  if (toFix.length === 0) return 0;

  const tx = db.transaction('setLogs', 'readwrite');
  const store = tx.objectStore('setLogs');
  for (const log of toFix) {
    store.put({ ...log, exerciseId: map[log.exerciseId] });
  }
  await txDone(tx);

  for (const sessionId of new Set(toFix.map(l => l.sessionId))) {
    await touchSession(sessionId);
  }
  return toFix.length;
}

// Wipes every store. Used when a different account signs in on this device so
// one user's workout history can never leak into (or be pushed up to) another
// account.
export async function clearIDB(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(['sessions', 'setLogs', 'exerciseLogs'], 'readwrite');
  tx.objectStore('sessions').clear();
  tx.objectStore('setLogs').clear();
  tx.objectStore('exerciseLogs').clear();
  await txDone(tx);
}

// ── Backup / restore ─────────────────────────────────────────────────────────

export async function dumpIDB(): Promise<{
  sessions: Session[];
  setLogs: SetLog[];
  exerciseLogs: ExerciseLog[];
}> {
  const db = await openDB();
  const [sessions, setLogs, exerciseLogs] = await Promise.all([
    idbReq<Session[]>(db.transaction('sessions', 'readonly').objectStore('sessions').getAll()),
    idbReq<SetLog[]>(db.transaction('setLogs', 'readonly').objectStore('setLogs').getAll()),
    idbReq<ExerciseLog[]>(db.transaction('exerciseLogs', 'readonly').objectStore('exerciseLogs').getAll()),
  ]);
  return { sessions, setLogs, exerciseLogs };
}

// ── Merge sync ───────────────────────────────────────────────────────────────

// Plans a merge of server session documents into the local DB (pure logic in
// data/syncMerge.ts) and applies it. Local-only sessions are untouched — they
// upload on the next push — so a pull can never drop a workout logged on this
// device. Returns true if anything changed.
export async function mergeServerSessions(
  incoming: SessionDoc[],
  tombstones: Set<string>,
): Promise<boolean> {
  const db = await openDB();
  const local = await idbReq<Session[]>(
    db.transaction('sessions', 'readonly').objectStore('sessions').getAll(),
  );
  const plan = planSessionMerge(local, incoming, tombstones);
  if (mergePlanIsEmpty(plan)) return false;
  await applySessionMergePlan(db, plan);
  return true;
}

async function applySessionMergePlan(db: IDBDatabase, plan: SessionMergePlan): Promise<void> {
  // Deletions + replaced-session cleanup need the set logs of every touched session
  const doomedSessionIds = new Set<number>([
    ...plan.deleteLocalIds,
    ...plan.replace.map(r => r.localId),
  ]);

  if (doomedSessionIds.size > 0) {
    const allLogs = await idbReq<SetLog[]>(
      db.transaction('setLogs', 'readonly').objectStore('setLogs').getAll(),
    );
    const tx = db.transaction(['sessions', 'setLogs'], 'readwrite');
    const sessionStore = tx.objectStore('sessions');
    const logStore = tx.objectStore('setLogs');
    for (const id of plan.deleteLocalIds) sessionStore.delete(id);
    for (const log of allLogs) {
      if (doomedSessionIds.has(log.sessionId)) logStore.delete(log.id!);
    }
    await txDone(tx);
  }

  // Replaced sessions keep their local id (kept references stay valid);
  // inserted sessions get a fresh autoincrement id.
  for (const { localId, doc } of plan.replace) {
    await writeSessionDoc(db, doc, localId);
  }
  for (const doc of plan.insert) {
    await writeSessionDoc(db, doc);
  }
}

async function writeSessionDoc(db: IDBDatabase, doc: SessionDoc, localId?: number): Promise<void> {
  const session: Session = {
    ...(localId !== undefined ? { id: localId } : {}),
    guid: doc.guid,
    dayId: doc.dayId,
    weekNumber: doc.weekNumber,
    startedAt: doc.startedAt,
    completedAt: doc.completedAt,
    updatedAt: doc.updatedAt,
  };
  const sid = await idbReq(
    db.transaction('sessions', 'readwrite').objectStore('sessions').put(session),
  ) as number;

  const tx = db.transaction('setLogs', 'readwrite');
  const store = tx.objectStore('setLogs');
  for (const s of doc.sets) {
    store.add({
      sessionId: sid,
      exerciseId: s.exerciseId,
      setNumber: s.setNumber,
      weight: s.weight,
      reps: s.reps,
      ...(s.order != null ? { order: s.order } : {}),
      ...(s.warmup ? { warmup: true } : {}),
    } as SetLog);
  }
  await txDone(tx);
}
