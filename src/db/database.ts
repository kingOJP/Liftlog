export type Difficulty = 'easy' | 'medium' | 'hard';

export type MuscleGroup =
  | 'Chest' | 'Upper Back' | 'Lats' | 'Lower Back'
  | 'Front Delts' | 'Side Delts' | 'Rear Delts'
  | 'Triceps' | 'Biceps' | 'Forearms' | 'Traps'
  | 'Quads' | 'Hamstrings' | 'Glutes' | 'Calves' | 'Abs';

export type WorkoutType =
  | 'Chest Press' | 'Row' | 'Pull Down' | 'Overhead Press'
  | 'Curl' | 'Tricep Extension' | 'Lateral Raise' | 'Fly'
  | 'Squat' | 'Hip Hinge' | 'Leg Press' | 'Leg Curl'
  | 'Leg Extension' | 'Calf Raise' | 'Hip Thrust' | 'Face Pull'
  | 'Pull Up' | 'Push Up';

export type Equipment =
  | 'Bench' | 'Cable Machine' | 'Squat Rack' | 'Leg Press Machine'
  | 'Smith Machine' | 'Pull Up Bar' | 'None';

export type WeightType =
  | 'Barbell' | 'Dumbbell' | 'Machine' | 'Bodyweight'
  | 'EZ Bar' | 'Kettlebell' | 'Resistance Band';

export const MUSCLE_GROUPS: MuscleGroup[] = [
  'Chest', 'Upper Back', 'Lats', 'Lower Back',
  'Front Delts', 'Side Delts', 'Rear Delts',
  'Triceps', 'Biceps', 'Forearms', 'Traps',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs',
];

export const WORKOUT_TYPES: WorkoutType[] = [
  'Chest Press', 'Row', 'Pull Down', 'Overhead Press',
  'Curl', 'Tricep Extension', 'Lateral Raise', 'Fly',
  'Squat', 'Hip Hinge', 'Leg Press', 'Leg Curl',
  'Leg Extension', 'Calf Raise', 'Hip Thrust', 'Face Pull',
  'Pull Up', 'Push Up',
];

export const EQUIPMENT_OPTIONS: Equipment[] = [
  'Bench', 'Cable Machine', 'Squat Rack', 'Leg Press Machine',
  'Smith Machine', 'Pull Up Bar', 'None',
];

export const WEIGHT_TYPES: WeightType[] = [
  'Barbell', 'Dumbbell', 'Machine', 'Bodyweight',
  'EZ Bar', 'Kettlebell', 'Resistance Band',
];

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

export async function createSession(dayId: number, weekNumber: number): Promise<number> {
  const db = await openDB();
  const id = await idbReq(
    db.transaction('sessions', 'readwrite').objectStore('sessions').add({
      dayId, weekNumber, startedAt: Date.now(),
    } as Session),
  );
  return id as number;
}

export async function completeSession(sessionId: number): Promise<void> {
  const db = await openDB();
  const store = db.transaction('sessions', 'readonly').objectStore('sessions');
  const session = await idbReq<Session>(store.get(sessionId));
  session.completedAt = Date.now();
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

export async function saveExerciseDifficulty(
  sessionId: number,
  exerciseId: string,
  difficulty: Difficulty,
): Promise<void> {
  const db = await openDB();

  // Read in one transaction, write in another — avoids IDB transaction auto-commit issues
  const all = await idbReq<ExerciseLog[]>(
    db.transaction('exerciseLogs', 'readonly')
      .objectStore('exerciseLogs')
      .index('sessionId')
      .getAll(sessionId),
  );
  const existing = all.find(e => e.exerciseId === exerciseId);

  const writeStore = db.transaction('exerciseLogs', 'readwrite').objectStore('exerciseLogs');
  if (existing) {
    await idbReq(writeStore.put({ ...existing, difficulty }));
  } else {
    await idbReq(writeStore.add({ sessionId, exerciseId, difficulty } as ExerciseLog));
  }
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

export async function getAllCompletedSessions(): Promise<Session[]> {
  const db = await openDB();
  const all = await idbReq<Session[]>(
    db.transaction('sessions', 'readonly').objectStore('sessions').getAll(),
  );
  return all
    .filter(s => s.completedAt != null)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
}

export async function getLastCompletedSessionForDay(dayId: number): Promise<Session | undefined> {
  const db = await openDB();
  const all = await idbReq<Session[]>(
    db.transaction('sessions', 'readonly').objectStore('sessions').getAll(),
  );
  return all
    .filter(s => s.dayId === dayId && s.completedAt != null)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0];
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

export async function getExerciseLogsForSession(sessionId: number): Promise<ExerciseLog[]> {
  const db = await openDB();
  return idbReq<ExerciseLog[]>(
    db.transaction('exerciseLogs', 'readonly')
      .objectStore('exerciseLogs')
      .index('sessionId')
      .getAll(sessionId),
  );
}

export async function deleteSetLogsForSession(sessionId: number): Promise<void> {
  const db = await openDB();
  const logs = await idbReq<SetLog[]>(
    db.transaction('setLogs', 'readonly')
      .objectStore('setLogs')
      .index('sessionId')
      .getAll(sessionId),
  );
  if (logs.length === 0) return;
  const store = db.transaction('setLogs', 'readwrite').objectStore('setLogs');
  for (const log of logs) {
    await idbReq(store.delete(log.id!));
  }
}

export async function deleteExerciseLogsForSession(sessionId: number): Promise<void> {
  const db = await openDB();
  const logs = await idbReq<ExerciseLog[]>(
    db.transaction('exerciseLogs', 'readonly')
      .objectStore('exerciseLogs')
      .index('sessionId')
      .getAll(sessionId),
  );
  if (logs.length === 0) return;
  const store = db.transaction('exerciseLogs', 'readwrite').objectStore('exerciseLogs');
  for (const log of logs) {
    await idbReq(store.delete(log.id!));
  }
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
  const toDelete = all.filter(l => l.exerciseId === exerciseId);
  if (toDelete.length === 0) return;
  const store = db.transaction('setLogs', 'readwrite').objectStore('setLogs');
  for (const log of toDelete) {
    await idbReq(store.delete(log.id!));
  }
}

// ── Exercise ID migration ─────────────────────────────────────────────────────

const EXERCISE_ID_MIGRATIONS: Record<string, string> = {
  'cable-lateral-raises-d1': 'cable-lateral-raises',
  'face-pulls-d2':           'face-pulls',
  'face-pulls-d4':           'face-pulls',
  'lat-pulldown-d2':         'lat-pull-down',
  'cable-pull-down-d2':      'straight-arm-pulldowns',
  'tricep-pushdowns-d4':     'tricep-cable-pushdown',
};

export async function migrateExerciseIds(): Promise<number> {
  const db = await openDB();
  const logs = await idbReq<SetLog[]>(
    db.transaction('setLogs', 'readonly').objectStore('setLogs').getAll(),
  );
  const toFix = logs.filter(l => EXERCISE_ID_MIGRATIONS[l.exerciseId]);
  if (toFix.length === 0) return 0;

  const store = db.transaction('setLogs', 'readwrite').objectStore('setLogs');
  for (const log of toFix) {
    await idbReq(store.put({ ...log, exerciseId: EXERCISE_ID_MIGRATIONS[log.exerciseId] }));
  }
  return toFix.length;
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

export async function restoreIDB(data: Awaited<ReturnType<typeof dumpIDB>>): Promise<void> {
  const db = await openDB();

  for (const store of ['sessions', 'setLogs', 'exerciseLogs']) {
    await idbReq(db.transaction(store, 'readwrite').objectStore(store).clear());
  }

  const putAll = async <T>(storeName: string, records: T[]) => {
    for (const record of records) {
      await idbReq(db.transaction(storeName, 'readwrite').objectStore(storeName).put(record));
    }
  };

  await putAll('sessions', data.sessions);
  await putAll('setLogs', data.setLogs);
  await putAll('exerciseLogs', data.exerciseLogs);
}
