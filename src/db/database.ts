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
  /** Free-text session note (how it went); synced on the session document */
  note?: string;
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
  /**
   * The rep range prescribed when this set was logged (Stage 0 of the
   * adaptive-engine roadmap). Lets the engine tell "the range changed under
   * me" from "I missed" — a 10–15 slot becoming 12–15 the week after an
   * increase used to read as a failed session. Absent on pre-prescription
   * rows and on unprescribed (free) logging; schemaless like `order`.
   */
  repLow?: number;
  repHigh?: number;
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
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    // A deliberate tx.abort() carries no error object — never reject with null
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
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
  const session = await idbReq<Session | undefined>(store.get(sessionId));
  // Tolerate a missing row (a purge or an account switch got there first)
  // rather than throwing on `undefined` and leaving the caller's UI stuck.
  if (!session) return;
  session.completedAt = completedAt;
  session.updatedAt = Date.now();
  await idbReq(db.transaction('sessions', 'readwrite').objectStore('sessions').put(session));
}

/** One logged set, as the atomic writers take it. */
export interface SetInput {
  exerciseId: string;
  setNumber: number;
  weight: number;
  reps: number;
  order?: number;
  warmup?: boolean;
  repLow?: number;
  repHigh?: number;
}

function setLogRecord(sessionId: number, s: SetInput): SetLog {
  return {
    sessionId,
    exerciseId: s.exerciseId,
    setNumber: s.setNumber,
    weight: s.weight,
    reps: s.reps,
    ...(s.order != null ? { order: s.order } : {}),
    ...(s.warmup ? { warmup: true } : {}),
    ...(s.repLow != null && s.repHigh != null ? { repLow: s.repLow, repHigh: s.repHigh } : {}),
  } as SetLog;
}

/**
 * Write a finished workout — the session row AND every set — in ONE readwrite
 * transaction over both stores. Either all of it lands or none of it does.
 *
 * This is what makes the ghost purge safe: before, createSession committed
 * first and each set followed in its own transaction, so an app kill, a quota
 * error or a background purge racing the writes could leave (and then
 * tombstone, app-wide) a real workout with no sets. There is no such window
 * now — a session row never exists without its sets.
 */
export async function saveWorkout(input: {
  dayId: number;
  weekNumber: number;
  startedAt: number;
  completedAt: number;
  sets: SetInput[];
  note?: string;
}): Promise<number> {
  const db = await openDB();
  const tx = db.transaction(['sessions', 'setLogs'], 'readwrite');
  const now = Date.now();
  const session: Session = {
    guid: crypto.randomUUID(),
    dayId: input.dayId,
    weekNumber: input.weekNumber,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    updatedAt: now,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };
  const putReq = tx.objectStore('sessions').add(session);
  let sessionId = 0;
  // The add's success callback runs while the transaction is still active, so
  // the set inserts queue on the same transaction and commit with it.
  putReq.onsuccess = () => {
    sessionId = putReq.result as number;
    const logs = tx.objectStore('setLogs');
    for (const s of input.sets) logs.add(setLogRecord(sessionId, s));
  };
  await txDone(tx);
  return sessionId;
}

/**
 * Replace a session's sets (the edit-session flow), optionally re-dating it,
 * in ONE transaction: the old logs are deleted and the new ones inserted
 * together, and the session's updatedAt is bumped in the same commit so merge
 * sync propagates the edit. An interruption leaves the original intact.
 */
export async function rewriteSessionSets(
  sessionId: number,
  sets: SetInput[],
  redate?: { completedAt: number; weekNumber: number },
  /** undefined leaves the note alone; null or '' clears it */
  note?: string | null,
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(['sessions', 'setLogs'], 'readwrite');
  const sessions = tx.objectStore('sessions');
  const logs = tx.objectStore('setLogs');
  const now = Date.now();

  const getReq = sessions.get(sessionId) as IDBRequest<Session | undefined>;
  getReq.onsuccess = () => {
    const session = getReq.result;
    if (!session) { tx.abort(); return; }
    session.updatedAt = now;
    if (redate) {
      session.completedAt = redate.completedAt;
      session.startedAt = Math.min(session.startedAt, redate.completedAt);
      session.weekNumber = redate.weekNumber;
    }
    if (note !== undefined) {
      if (note && note.trim()) session.note = note.trim();
      else delete session.note;
    }
    sessions.put(session);
  };
  const keysReq = logs.index('sessionId').getAllKeys(sessionId);
  keysReq.onsuccess = () => {
    for (const key of keysReq.result) logs.delete(key);
    for (const s of sets) logs.add(setLogRecord(sessionId, s));
  };
  await txDone(tx);
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
/**
 * A session younger than this is never purged. Every write path is atomic now,
 * so an empty session should not exist at all — but a ghost is old by
 * definition, and refusing to tombstone anything fresh costs nothing while
 * guaranteeing that no future write path (or a crash mid-transaction on a
 * browser with weaker guarantees) can delete a workout app-wide.
 */
export const PURGE_GRACE_MS = 60 * 60_000;

export async function purgeEmptySessions(now = Date.now()): Promise<number> {
  const db = await openDB();
  const [sessions, setLogs, exerciseLogs] = await Promise.all([
    idbReq<Session[]>(db.transaction('sessions', 'readonly').objectStore('sessions').getAll()),
    idbReq<SetLog[]>(db.transaction('setLogs', 'readonly').objectStore('setLogs').getAll()),
    idbReq<ExerciseLog[]>(db.transaction('exerciseLogs', 'readonly').objectStore('exerciseLogs').getAll()),
  ]);

  const withSets = new Set(setLogs.map(l => l.sessionId));
  const isOld = (s: Session) =>
    now - Math.max(s.startedAt, s.completedAt ?? 0, s.updatedAt ?? 0) > PURGE_GRACE_MS;
  const empty = sessions.filter(s => !withSets.has(s.id!) && isOld(s));
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
export async function remapSetLogExerciseIds(
  map: Record<string, string>,
): Promise<{ remapped: number; fromIds: string[] }> {
  const db = await openDB();
  const logs = await idbReq<SetLog[]>(
    db.transaction('setLogs', 'readonly').objectStore('setLogs').getAll(),
  );
  const toFix = logs.filter(l => map[l.exerciseId]);
  if (toFix.length === 0) return { remapped: 0, fromIds: [] };

  const tx = db.transaction('setLogs', 'readwrite');
  const store = tx.objectStore('setLogs');
  for (const log of toFix) {
    store.put({ ...log, exerciseId: map[log.exerciseId] });
  }
  await txDone(tx);

  for (const sessionId of new Set(toFix.map(l => l.sessionId))) {
    await touchSession(sessionId);
  }
  return { remapped: toFix.length, fromIds: [...new Set(toFix.map(l => l.exerciseId))] };
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
  // The whole plan — deletions, replaced-session cleanup, and every incoming
  // document with its sets — commits in ONE transaction. A kill mid-pull used
  // to leave the other device's workout as an empty local session, which the
  // next purge tombstoned and the next push deleted everywhere.
  const doomedSessionIds = new Set<number>([
    ...plan.deleteLocalIds,
    ...plan.replace.map(r => r.localId),
  ]);
  const allLogs = doomedSessionIds.size > 0
    ? await idbReq<SetLog[]>(db.transaction('setLogs', 'readonly').objectStore('setLogs').getAll())
    : [];

  const tx = db.transaction(['sessions', 'setLogs'], 'readwrite');
  const sessionStore = tx.objectStore('sessions');
  const logStore = tx.objectStore('setLogs');
  for (const id of plan.deleteLocalIds) sessionStore.delete(id);
  for (const log of allLogs) {
    if (doomedSessionIds.has(log.sessionId)) logStore.delete(log.id!);
  }
  // Replaced sessions keep their local id (kept references stay valid);
  // inserted sessions get a fresh autoincrement id.
  for (const { localId, doc } of plan.replace) queueSessionDoc(tx, doc, localId);
  for (const doc of plan.insert) queueSessionDoc(tx, doc);
  await txDone(tx);
}

function queueSessionDoc(tx: IDBTransaction, doc: SessionDoc, localId?: number): void {
  const session: Session = {
    ...(localId !== undefined ? { id: localId } : {}),
    guid: doc.guid,
    dayId: doc.dayId,
    weekNumber: doc.weekNumber,
    startedAt: doc.startedAt,
    completedAt: doc.completedAt,
    updatedAt: doc.updatedAt,
    ...(doc.note ? { note: doc.note } : {}),
  };
  const putReq = tx.objectStore('sessions').put(session);
  putReq.onsuccess = () => {
    const sid = putReq.result as number;
    const store = tx.objectStore('setLogs');
    for (const s of doc.sets) {
      store.add(setLogRecord(sid, {
        exerciseId: s.exerciseId, setNumber: s.setNumber, weight: s.weight, reps: s.reps,
        order: s.order ?? undefined, warmup: s.warmup ?? undefined,
        repLow: s.repLow ?? undefined, repHigh: s.repHigh ?? undefined,
      }));
    }
  };
}
