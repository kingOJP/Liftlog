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
  | 'Barbell' | 'Dumbbell' | 'Cable' | 'Machine' | 'Bodyweight'
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
  'Barbell', 'Dumbbell', 'Cable', 'Machine', 'Bodyweight',
  'EZ Bar', 'Kettlebell', 'Resistance Band',
];

export interface ExerciseMuscles {
  exerciseId: string;
  primaryMuscle: MuscleGroup | null;
  secondaryMuscle1: MuscleGroup | null;
  secondaryMuscle2: MuscleGroup | null;
  secondaryMuscle3: MuscleGroup | null;
}

export interface ExerciseDetails {
  exerciseId: string;
  workoutType: WorkoutType | null;
  equipment: Equipment | null;
  weightType: WeightType | null;
}

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
    const request = indexedDB.open('liftlog', 2);

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

// ── Exercise muscles ─────────────────────────────────────────────────────────

export async function getExerciseMuscles(exerciseId: string): Promise<ExerciseMuscles | null> {
  const db = await openDB();
  const result = await idbReq<ExerciseMuscles | undefined>(
    db.transaction('exerciseMuscles', 'readonly').objectStore('exerciseMuscles').get(exerciseId),
  );
  return result ?? null;
}

export async function saveExerciseMuscles(data: ExerciseMuscles): Promise<void> {
  const db = await openDB();
  await idbReq(
    db.transaction('exerciseMuscles', 'readwrite').objectStore('exerciseMuscles').put(data),
  );
}

// ── Exercise details ─────────────────────────────────────────────────────────

export async function getExerciseDetails(exerciseId: string): Promise<ExerciseDetails | null> {
  const db = await openDB();
  const result = await idbReq<ExerciseDetails | undefined>(
    db.transaction('exerciseDetails', 'readonly').objectStore('exerciseDetails').get(exerciseId),
  );
  return result ?? null;
}

export async function saveExerciseDetails(data: ExerciseDetails): Promise<void> {
  const db = await openDB();
  await idbReq(
    db.transaction('exerciseDetails', 'readwrite').objectStore('exerciseDetails').put(data),
  );
}

// ── Backup / restore ─────────────────────────────────────────────────────────

export async function dumpIDB(): Promise<{
  sessions: Session[];
  setLogs: SetLog[];
  exerciseLogs: ExerciseLog[];
  exerciseMuscles: ExerciseMuscles[];
  exerciseDetails: ExerciseDetails[];
}> {
  const db = await openDB();
  const [sessions, setLogs, exerciseLogs, exerciseMuscles, exerciseDetails] = await Promise.all([
    idbReq<Session[]>(db.transaction('sessions', 'readonly').objectStore('sessions').getAll()),
    idbReq<SetLog[]>(db.transaction('setLogs', 'readonly').objectStore('setLogs').getAll()),
    idbReq<ExerciseLog[]>(db.transaction('exerciseLogs', 'readonly').objectStore('exerciseLogs').getAll()),
    idbReq<ExerciseMuscles[]>(db.transaction('exerciseMuscles', 'readonly').objectStore('exerciseMuscles').getAll()),
    idbReq<ExerciseDetails[]>(db.transaction('exerciseDetails', 'readonly').objectStore('exerciseDetails').getAll()),
  ]);
  return { sessions, setLogs, exerciseLogs, exerciseMuscles, exerciseDetails };
}

export async function restoreIDB(data: Awaited<ReturnType<typeof dumpIDB>>): Promise<void> {
  const db = await openDB();

  // Clear all stores first
  for (const store of ['sessions', 'setLogs', 'exerciseLogs', 'exerciseMuscles', 'exerciseDetails']) {
    await idbReq(db.transaction(store, 'readwrite').objectStore(store).clear());
  }

  // Restore — use put to preserve original IDs and referential integrity
  const putAll = async <T>(storeName: string, records: T[]) => {
    for (const record of records) {
      await idbReq(db.transaction(storeName, 'readwrite').objectStore(storeName).put(record));
    }
  };

  await putAll('sessions', data.sessions);
  await putAll('setLogs', data.setLogs);
  await putAll('exerciseLogs', data.exerciseLogs);
  await putAll('exerciseMuscles', data.exerciseMuscles);
  await putAll('exerciseDetails', data.exerciseDetails);
}
