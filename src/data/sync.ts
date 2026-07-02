import { dumpIDB, restoreIDB, createSession, completeSession, addSetLog, purgeEmptySessions } from '../db/database';
import type { Session, SetLog, ExerciseLog } from '../db/database';
import { getPendingSessions, clearPendingSessions } from './pendingSessions';
import { getStoredProgram, saveStoredProgram, getExerciseLibrary, saveExerciseLibrary } from './programStore';
import { getAllExerciseMeta, mergeExerciseMeta } from './exercises';
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
  sessions:        Session[];
  setLogs:         SetLog[];
  exerciseLogs:    ExerciseLog[];
  program:         WorkoutDay[];
  exercises:       Exercise[];
  exerciseMuscles: ExerciseMusclesRow[];
  exerciseDetails: ExerciseDetailsRow[];
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

export async function pushSync(): Promise<void> {
  // Drop ghost/empty workouts before uploading so they don't propagate
  await purgeEmptySessions();
  const idb = await dumpIDB();
  const payload: SyncPayload = {
    ...idb,
    program:   getStoredProgram(),
    exercises: getExerciseLibrary(),
    ...splitMeta(getAllExerciseMeta()),
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
    sessions:        Session[];
    setLogs:         SetLog[];
    exerciseLogs:    ExerciseLog[];
    program:         WorkoutDay[]         | null;
    exercises:       Exercise[]           | null;
    exerciseMuscles: ExerciseMusclesRow[] | null;
    exerciseDetails: ExerciseDetailsRow[] | null;
  };

  // Restore exercise metadata even when there are no sessions yet (a fresh
  // device pulling an existing account) — merge so unsynced local edits survive.
  mergeExerciseMeta(recombineMeta(data.exerciseMuscles, data.exerciseDetails));

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

  if (data.program)   saveStoredProgram(data.program);
  if (data.exercises) saveExerciseLibrary(data.exercises);

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
