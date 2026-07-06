import { LEGACY_ID_MAP } from '../data/legacyIds';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Session {
  id?: number;
  dayId: number;
  weekNumber: number;
  startedAt: number;
  completedAt?: number;
}

export interface SetLog {
  id?: number;
  sessionId: number;
  exerciseId: string;
  setNumber: number;
  weight: number;
  reps: number;
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
      dayId, weekNumber, startedAt,
    } as Session),
  );
  return id as number;
}

export async function completeSession(sessionId: number, completedAt = Date.now()): Promise<void> {
  const db = await openDB();
  const store = db.transaction('sessions', 'readonly').objectStore('sessions');
  const session = await idbReq<Session>(store.get(sessionId));
  session.completedAt = completedAt;
  await idbReq(db.transaction('sessions', 'readwrite').objectStore('sessions').put(session));
}

export async function addSetLog(
  sessionId: number,
  exerciseId: string,
  setNumber: number,
  weight: number,
  reps: number,
): Promise<void> {
  const db = await openDB();
  await idbReq(
    db.transaction('setLogs', 'readwrite').objectStore('setLogs').add({
      sessionId, exerciseId, setNumber, weight, reps,
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
  await idbReq(db.transaction('sessions', 'readwrite').objectStore('sessions').put(session));
}

export async function getCompletedSessionsForWeek(weekNumber: number): Promise<Session[]> {
  const db = await openDB();
  const all = await idbReq<Session[]>(
    db.transaction('sessions', 'readonly')
      .objectStore('sessions')
      .index('weekNumber')
      .getAll(weekNumber),
  );
  return all.filter(s => s.completedAt != null);
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
  const ids = all.filter(l => l.exerciseId === exerciseId).map(l => l.id!);
  if (ids.length === 0) return;

  const tx = db.transaction('setLogs', 'readwrite');
  const store = tx.objectStore('setLogs');
  for (const id of ids) store.delete(id);
  await txDone(tx);
}

// Remove sessions that carry no set logs. Empty sessions are meaningless
// "ghost" workouts (a residue of old buggy builds / interrupted syncs) that
// kept reappearing as duplicates. Runs at startup and around every sync so a
// clean local DB also cleans the server copy on the next push. exerciseLogs
// for the removed sessions are dropped too (that store is otherwise unused).
export async function purgeEmptySessions(): Promise<number> {
  const db = await openDB();
  const [sessions, setLogs, exerciseLogs] = await Promise.all([
    idbReq<Session[]>(db.transaction('sessions', 'readonly').objectStore('sessions').getAll()),
    idbReq<SetLog[]>(db.transaction('setLogs', 'readonly').objectStore('setLogs').getAll()),
    idbReq<ExerciseLog[]>(db.transaction('exerciseLogs', 'readonly').objectStore('exerciseLogs').getAll()),
  ]);

  const withSets = new Set(setLogs.map(l => l.sessionId));
  const emptyIds = new Set(sessions.filter(s => !withSets.has(s.id!)).map(s => s.id!));
  if (emptyIds.size === 0) return 0;

  const tx = db.transaction(['sessions', 'exerciseLogs'], 'readwrite');
  const sessionStore = tx.objectStore('sessions');
  const exerciseLogStore = tx.objectStore('exerciseLogs');
  for (const id of emptyIds) sessionStore.delete(id);
  for (const log of exerciseLogs) {
    if (emptyIds.has(log.sessionId)) exerciseLogStore.delete(log.id!);
  }
  await txDone(tx);
  return emptyIds.size;
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

// Replaces all local data in one transaction: either the restore fully applies
// or the previous state survives (no half-cleared database on interruption).
export async function restoreIDB(data: Awaited<ReturnType<typeof dumpIDB>>): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(['sessions', 'setLogs', 'exerciseLogs'], 'readwrite');

  const stores = {
    sessions: data.sessions,
    setLogs: data.setLogs,
    exerciseLogs: data.exerciseLogs,
  } as const;

  for (const [name, records] of Object.entries(stores)) {
    const store = tx.objectStore(name);
    store.clear();
    for (const record of records) store.put(record);
  }
  await txDone(tx);
}
