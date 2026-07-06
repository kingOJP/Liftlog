import { dumpIDB, restoreIDB, clearIDB, createSession, completeSession, addSetLog, purgeEmptySessions } from '../db/database';
import type { Session, SetLog, ExerciseLog } from '../db/database';
import { getPendingSessions, clearPendingSessions } from './pendingSessions';
import {
  getStoredProgram, saveStoredProgram, clearStoredProgram,
  getExerciseLibrary, saveExerciseLibrary,
  getDeletedExerciseIds, addDeletedExerciseIds,
} from './programStore';
import { getAllExerciseMeta, mergeExerciseMeta, deleteExerciseMeta } from './exercises';
import type { ExerciseMetaOverride } from './exercises';
import type { WorkoutDay, Exercise } from './program';

export interface SyncUser {
  email: string;
  name: string;
}

// The server stores metadata as two rows (muscles + details); the client keeps
// it as one override object, so we split on push and recombine on pull.
interface ExerciseMusclesRow {
  exerciseId: string;
  primaryMuscle: string | null;
  secondaryMuscle1: string | null;
  secondaryMuscle2: string | null;
  secondaryMuscle3: string | null;
}
interface ExerciseDetailsRow {
  exerciseId: string;
  workoutType: string | null;
  equipment: string | null;
  weightType: string | null;
}

interface SyncPayload {
  sessions:           Session[];
  setLogs:            SetLog[];
  exerciseLogs:       ExerciseLog[];
  program:            WorkoutDay[];
  exercises:          Exercise[];
  exerciseMuscles:    ExerciseMusclesRow[];
  exerciseDetails:    ExerciseDetailsRow[];
  deletedExerciseIds: string[];
}

function splitMeta(meta: Record<string, ExerciseMetaOverride>): {
  exerciseMuscles: ExerciseMusclesRow[];
  exerciseDetails: ExerciseDetailsRow[];
} {
  const exerciseMuscles: ExerciseMusclesRow[] = [];
  const exerciseDetails: ExerciseDetailsRow[] = [];
  for (const [exerciseId, m] of Object.entries(meta)) {
    exerciseMuscles.push({
      exerciseId,
      primaryMuscle:    m.primaryMuscle,
      secondaryMuscle1: m.secondaryMuscle1,
      secondaryMuscle2: m.secondaryMuscle2,
      secondaryMuscle3: m.secondaryMuscle3,
    });
    exerciseDetails.push({
      exerciseId,
      workoutType: m.workoutType,
      equipment:   m.equipment,
      weightType:  m.weightType,
    });
  }
  return { exerciseMuscles, exerciseDetails };
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function getLoggedInUser(): SyncUser | null {
  const raw = getCookie('liftlog_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SyncUser;
  } catch {
    return null;
  }
}

// Tracks which account the *local* data belongs to. Without this, signing in
// with a different account on the same device shows the previous account's
// workouts — and worse, the startup push uploads them into the new account.
const OWNER_KEY = 'liftlog_data_owner';

export async function ensureLocalDataOwner(): Promise<void> {
  const user = getLoggedInUser();
  if (!user) return;
  const owner = localStorage.getItem(OWNER_KEY);
  if (owner && owner !== user.email) {
    // Account switch: wipe user-scoped data (workout history, program, pending
    // sessions). App-wide data — exercise library, metadata, deletion
    // tombstones — and device settings survive the switch.
    await clearIDB();
    clearStoredProgram();
    clearPendingSessions();
  }
  localStorage.setItem(OWNER_KEY, user.email);
}

export async function pushSync(): Promise<void> {
  // Drop ghost/empty workouts before uploading so they don't propagate
  await purgeEmptySessions();
  const idb = await dumpIDB();
  const deleted = getDeletedExerciseIds();
  const meta = Object.fromEntries(
    Object.entries(getAllExerciseMeta()).filter(([id]) => !deleted.has(id)),
  );
  const payload: SyncPayload = {
    ...idb,
    program:            getStoredProgram(),
    exercises:          getExerciseLibrary(),
    deletedExerciseIds: [...deleted],
    ...splitMeta(meta),
  };

  const res = await fetch('/api/sync', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  if (res.status === 401) return;
  if (!res.ok) throw new Error(`Sync push failed: ${res.status}`);
  clearPendingSessions();
}

// Returns true if server had data and local state was updated
export async function pullSync(): Promise<boolean> {
  const res = await fetch('/api/sync');
  if (res.status === 401) return false;
  if (!res.ok) throw new Error(`Sync pull failed: ${res.status}`);
  // Guard against non-API responses served with a 200 (dev server fallback,
  // captive portals, misbehaving proxies) — never parse HTML as sync data.
  if (!res.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Sync pull failed: non-JSON response');
  }

  const data = await res.json() as {
    sessions:           Session[];
    setLogs:            SetLog[];
    exerciseLogs:       ExerciseLog[];
    program:            WorkoutDay[]         | null;
    exercises:          Exercise[]           | null;
    exerciseMuscles:    ExerciseMusclesRow[] | null;
    exerciseDetails:    ExerciseDetailsRow[] | null;
    deletedExerciseIds: string[]             | null;
  };

  // Exercise deletions are permanent and app-wide: merge the server's
  // tombstones, then scrub any local trace of the deleted exercises so a stale
  // copy on this device can't resurrect them (or be pushed back up).
  addDeletedExerciseIds(data.deletedExerciseIds ?? []);
  const deleted = getDeletedExerciseIds();
  if (deleted.size > 0) {
    for (const id of deleted) deleteExerciseMeta(id);
    saveExerciseLibrary(getExerciseLibrary()); // getter filters tombstones
    const program = getStoredProgram();
    const scrubbed = program.map(d => ({
      ...d,
      exercises: d.exercises.filter(e => !deleted.has(e.id)),
    }));
    if (scrubbed.some((d, i) => d.exercises.length !== program[i].exercises.length)) {
      saveStoredProgram(scrubbed);
    }
  }

  // The exercise library and its metadata are app-wide — apply them even when
  // this account has no workout history yet. Metadata is merged so unsynced
  // local edits survive; both are filtered through the tombstones.
  const incomingMeta = recombineMeta(data.exerciseMuscles, data.exerciseDetails);
  for (const id of deleted) delete incomingMeta[id];
  mergeExerciseMeta(incomingMeta);
  if (data.exercises) {
    saveExerciseLibrary(data.exercises.filter(e => !deleted.has(e.id)));
  }

  const hasData = data.sessions.length > 0 || data.setLogs.length > 0;
  if (!hasData) return false;

  await restoreIDB({
    sessions:     data.sessions,
    setLogs:      data.setLogs,
    exerciseLogs: data.exerciseLogs,
  });

  // Re-apply any locally saved sessions not yet confirmed by the server
  const pending = getPendingSessions();
  if (pending.length > 0) {
    const pulledStartedAts = new Set(data.sessions.map(s => s.startedAt));
    for (const p of pending) {
      if (!pulledStartedAts.has(p.startedAt)) {
        const sid = await createSession(p.dayId, p.weekNumber, p.startedAt);
        for (const sl of p.setLogs) {
          await addSetLog(sid, sl.exerciseId, sl.setNumber, sl.weight, sl.reps);
        }
        await completeSession(sid, p.completedAt);
      }
    }
  }

  // A pulled server copy may itself contain ghost/empty sessions from old builds
  await purgeEmptySessions();

  if (data.program) {
    saveStoredProgram(data.program.map(d => ({
      ...d,
      exercises: d.exercises.filter(e => !deleted.has(e.id)),
    })));
  }

  return true;
}

// Recombine the server's two metadata rows into client override objects.
function recombineMeta(
  muscles: ExerciseMusclesRow[] | null,
  details: ExerciseDetailsRow[] | null,
): Record<string, ExerciseMetaOverride> {
  const map: Record<string, ExerciseMetaOverride> = {};
  const blank = (): ExerciseMetaOverride => ({
    primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null,
    secondaryMuscle3: null, workoutType: null, equipment: null, weightType: null,
  });
  for (const m of muscles ?? []) {
    const o = map[m.exerciseId] ?? blank();
    o.primaryMuscle    = m.primaryMuscle    as ExerciseMetaOverride['primaryMuscle'];
    o.secondaryMuscle1 = m.secondaryMuscle1 as ExerciseMetaOverride['secondaryMuscle1'];
    o.secondaryMuscle2 = m.secondaryMuscle2 as ExerciseMetaOverride['secondaryMuscle2'];
    o.secondaryMuscle3 = m.secondaryMuscle3 as ExerciseMetaOverride['secondaryMuscle3'];
    map[m.exerciseId] = o;
  }
  for (const d of details ?? []) {
    const o = map[d.exerciseId] ?? blank();
    o.workoutType = d.workoutType as ExerciseMetaOverride['workoutType'];
    o.equipment   = d.equipment   as ExerciseMetaOverride['equipment'];
    o.weightType  = d.weightType  as ExerciseMetaOverride['weightType'];
    map[d.exerciseId] = o;
  }
  return map;
}
