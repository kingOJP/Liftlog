import { dumpIDB, clearIDB, purgeEmptySessions, mergeServerSessions } from '../db/database';
import type { Session, SetLog } from '../db/database';
import { sessionGuid, sessionUpdatedAt } from './syncMerge';
import type { SessionDoc } from './syncMerge';
import { getSessionTombstones, addSessionTombstones, clearSessionTombstones } from './sessionTombstones';
import { clearDraftSession } from './draftSession';
import {
  getStoredProgram, saveStoredProgram, clearStoredProgram,
  getExerciseLibrary, saveExerciseLibrary, mergeExerciseLibrary,
  ensureProgramExercisesInLibrary,
  getDeletedExerciseIds, addDeletedExerciseIds,
} from './programStore';
import { getAllExerciseMeta, mergeExerciseMeta, deleteExerciseMeta } from './exercises';
import type { ExerciseMetaOverride } from './exercises';
import type { WorkoutDay, Exercise } from './program';
import { getPlanState, mergeServerPlanState, clearPlanState } from './planStore';
import type { PlanState } from './planStore';

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

// Wire shape: sessions and set logs travel as flat arrays (setLogs reference
// the session `id` within the same payload/response), but the unit of merge is
// the session document — the server groups them by session and stores each as
// one row keyed by GUID.
interface WireSession {
  id: number;
  guid: string;
  dayId: number;
  weekNumber: number;
  startedAt: number;
  completedAt?: number;
  updatedAt: number;
}

interface SyncPayload {
  sessions:            WireSession[];
  setLogs:             SetLog[];
  /** Dead feature (difficulty ratings) — field kept for wire compatibility */
  exerciseLogs:        never[];
  deletedSessionGuids: string[];
  program:             WorkoutDay[];
  exercises:           Exercise[];
  exerciseMuscles:     ExerciseMusclesRow[];
  exerciseDetails:     ExerciseDetailsRow[];
  deletedExerciseIds:  string[];
  /** the training journey (plans + blocks) — whole-document LWW by updatedAt */
  plan:                PlanState | null;
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
    // Account switch: wipe user-scoped data (workout history, program, session
    // tombstones, training journey, any in-progress draft). App-wide data —
    // exercise library, metadata, deletion tombstones — and device settings
    // survive the switch.
    await clearIDB();
    clearStoredProgram();
    clearSessionTombstones();
    clearDraftSession();
    clearPlanState();
  }
  localStorage.setItem(OWNER_KEY, user.email);
}

export async function pushSync(): Promise<void> {
  // Drop ghost/empty workouts before uploading so they don't propagate
  // (the purge records tombstones, which this push carries)
  await purgeEmptySessions();
  const idb = await dumpIDB();

  const deletedExercises = getDeletedExerciseIds();
  const meta = Object.fromEntries(
    Object.entries(getAllExerciseMeta()).filter(([id]) => !deletedExercises.has(id)),
  );

  const payload: SyncPayload = {
    sessions: idb.sessions.map(s => ({
      id:          s.id!,
      guid:        sessionGuid(s),
      dayId:       s.dayId,
      weekNumber:  s.weekNumber,
      startedAt:   s.startedAt,
      completedAt: s.completedAt,
      updatedAt:   sessionUpdatedAt(s),
    })),
    setLogs:             idb.setLogs,
    exerciseLogs:        [],
    deletedSessionGuids: [...getSessionTombstones()],
    program:             getStoredProgram(),
    exercises:           getExerciseLibrary(),
    deletedExerciseIds:  [...deletedExercises],
    plan:                getPlanState().plans.length > 0 ? getPlanState() : null,
    ...splitMeta(meta),
  };

  const res = await fetch('/api/sync', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  if (res.status === 401) return;
  if (!res.ok) throw new Error(`Sync push failed: ${res.status}`);
}

// Returns true if local state changed (caller should refresh UI state)
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
    sessions:            WireSession[];
    setLogs:             SetLog[];
    deletedSessionGuids: string[]             | null;
    program:             WorkoutDay[]         | null;
    exercises:           Exercise[]           | null;
    exerciseMuscles:     ExerciseMusclesRow[] | null;
    exerciseDetails:     ExerciseDetailsRow[] | null;
    deletedExerciseIds:  string[]             | null;
    plan?:               PlanState            | null;
  };

  // Exercise deletions are permanent and app-wide: merge the server's
  // tombstones, then scrub any local trace of the deleted exercises so a stale
  // copy on this device can't resurrect them (or be pushed back up).
  addDeletedExerciseIds(data.deletedExerciseIds ?? []);
  const deleted = getDeletedExerciseIds();
  if (deleted.size > 0) {
    for (const id of deleted) deleteExerciseMeta(id);
    saveExerciseLibrary(getExerciseLibrary()); // getter filters tombstones
  }

  // The exercise library and its metadata are app-wide — apply them even when
  // this account has no workout history yet. Metadata is merged so unsynced
  // local edits survive; both are filtered through the tombstones. The library
  // is MERGED, never replaced: a local-only exercise (added on this device,
  // not yet pushed) must survive a pull, or a background pull racing the push
  // silently deletes it (only tombstones delete).
  const incomingMeta = recombineMeta(data.exerciseMuscles, data.exerciseDetails);
  for (const id of deleted) delete incomingMeta[id];
  mergeExerciseMeta(incomingMeta);
  if (data.exercises) {
    mergeExerciseLibrary(data.exercises);
  }

  // Merge server sessions per-document: tombstoned sessions are removed, newer
  // server copies replace local ones, and sessions that exist only locally are
  // left alone (they upload on the next push). A pull can never drop a workout
  // logged on this device — this replaces the old wipe-and-restore sync and
  // the pendingSessions workaround it needed.
  addSessionTombstones(data.deletedSessionGuids ?? []);
  const docs = groupWireSessions(data.sessions, data.setLogs);
  let changed = await mergeServerSessions(docs, getSessionTombstones());
  if (await purgeEmptySessions() > 0) changed = true;

  // Training journey: whole-document LWW — a newer server copy replaces local
  // (an older server copy is ignored; the next push uploads ours).
  if (mergeServerPlanState(data.plan ?? null)) changed = true;

  if (data.program) {
    const incomingProgram = data.program.map(d => ({
      ...d,
      exercises: d.exercises.filter(e => !deleted.has(e.id)),
    }));
    const next = JSON.stringify(incomingProgram);
    if (next !== JSON.stringify(getStoredProgram())) {
      saveStoredProgram(incomingProgram);
      changed = true;
    }
  } else if (deleted.size > 0) {
    // No server program, but tombstones may still need scrubbing locally
    const program = getStoredProgram();
    const scrubbed = program.map(d => ({
      ...d,
      exercises: d.exercises.filter(e => !deleted.has(e.id)),
    }));
    if (scrubbed.some((d, i) => d.exercises.length !== program[i].exercises.length)) {
      saveStoredProgram(scrubbed);
      changed = true;
    }
  }

  // Repair pass: an exercise the program references but the library lost (the
  // old replace-on-pull sync could gut it) is rebuilt from the program slot so
  // history and the Exercises screen resolve its name again.
  ensureProgramExercisesInLibrary(getStoredProgram());

  return changed;
}

// Reassemble the wire's flat arrays into session documents for the merge.
function groupWireSessions(sessions: WireSession[], setLogs: SetLog[]): SessionDoc[] {
  const setsBySession = new Map<number, SetLog[]>();
  for (const log of setLogs) {
    const arr = setsBySession.get(log.sessionId);
    if (arr) arr.push(log);
    else setsBySession.set(log.sessionId, [log]);
  }
  return sessions.map(s => ({
    guid:        sessionGuid(s as Session), // derives legacy-<startedAt> if guid missing
    dayId:       s.dayId,
    weekNumber:  s.weekNumber,
    startedAt:   s.startedAt,
    completedAt: s.completedAt,
    updatedAt:   sessionUpdatedAt(s as Session),
    sets: (setsBySession.get(s.id) ?? []).map(l => ({
      exerciseId: l.exerciseId,
      setNumber:  l.setNumber,
      weight:     l.weight,
      reps:       l.reps,
      order:      l.order,
    })),
  }));
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
