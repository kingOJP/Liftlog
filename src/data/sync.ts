import { dumpIDB, clearIDB, purgeEmptySessions, mergeServerSessions } from '../db/database';
import type { Session, SetLog } from '../db/database';
import { sessionGuid, sessionUpdatedAt } from './syncMerge';
import type { SessionDoc } from './syncMerge';
import { getSessionTombstones, addSessionTombstones, clearSessionTombstones } from './sessionTombstones';
import { clearDraftSession } from './draftSession';
import {
  getStoredProgram, saveStoredProgram, clearStoredProgram, getProgramUpdatedAt,
  getExerciseLibrary, saveExerciseLibrary, mergeExerciseLibrary,
  ensureProgramExercisesInLibrary, clearExerciseLibraryData,
  getDeletedExerciseIds, addDeletedExerciseIds,
  getRestoredExerciseIds, clearRestoredExerciseIds,
} from './programStore';
import {
  getAllExerciseMeta, mergeExerciseMeta, deleteExerciseMeta,
  saveGlobalExerciseMeta, clearExerciseMeta,
} from './exercises';
import type { ExerciseMetaOverride } from './exercises';
import type { WorkoutDay, LibraryExercise } from './program';
import { getPlanState, mergeServerPlanState, clearPlanState, planStateHasContent } from './planStore';
import { saveExerciseMerges, applyExerciseMerges } from './merges';
import type { MergeMap } from './merges';
import type { PlanState } from './planStore';
import { syncLock } from './syncLock';
import {
  markAuthExpired, markPullSucceeded, markPushStarted, markPushSucceeded, markSyncFailed,
  clearSyncStatus, getSyncStatus,
} from './syncStatus';

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
  /** the override's clock — one per exercise, carried on the details row */
  updatedAt?: number;
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
  note?: string;
}

interface SyncPayload {
  sessions:            WireSession[];
  setLogs:             SetLog[];
  /** Dead feature (difficulty ratings) — field kept for wire compatibility */
  exerciseLogs:        never[];
  deletedSessionGuids: string[];
  program:             WorkoutDay[];
  exercises:           LibraryExercise[];
  exerciseMuscles:     ExerciseMusclesRow[];
  exerciseDetails:     ExerciseDetailsRow[];
  deletedExerciseIds:  string[];
  /** tombstones this device knowingly lifted (re-added by hand / merge survivor) */
  restoredExerciseIds: string[];
  /** clock of the program's last local edit (0 = unstamped) */
  programUpdatedAt:    number;
  /** the training journey (plans + blocks) — plans LWW by updatedAt, profile by its own clock */
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
      ...(m.updatedAt ? { updatedAt: m.updatedAt } : {}),
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

// The signed-in account's role ('user' | 'admin' | 'tester'), as reported by
// the server on every pull. Purely a UI hint — every privileged action is
// enforced server-side by /api/admin.
const ROLE_KEY = 'liftlog_role';

export type UserRole = 'user' | 'admin' | 'tester';

export function getUserRole(): UserRole {
  const r = localStorage.getItem(ROLE_KEY);
  return r === 'admin' || r === 'tester' ? r : 'user';
}

// Tracks which account the *local* data belongs to. Without this, signing in
// with a different account on the same device shows the previous account's
// workouts — and worse, the startup push uploads them into the new account.
const OWNER_KEY = 'liftlog_data_owner';

// The ETag of the last full pull. Sent back as If-None-Match; a 304 means the
// server has nothing this device hasn't merged, and the pull costs one small
// request instead of the whole history (audit M2). Device-local.
const ETAG_KEY = 'liftlog_sync_etag';

export async function ensureLocalDataOwner(): Promise<void> {
  const user = getLoggedInUser();
  if (!user) return;
  const owner = localStorage.getItem(OWNER_KEY);
  if (owner && owner !== user.email) {
    // Account switch: wipe user-scoped data (workout history, program, session
    // tombstones, training journey, drafts — and, under the ownership model,
    // the exercise library, metadata overrides and deletion tombstones, which
    // are user-owned too). Application-owned data (the compiled-in catalog,
    // the pulled global metadata layer) and device settings survive.
    await clearIDB();
    clearStoredProgram();
    clearSessionTombstones();
    clearDraftSession();
    clearPlanState();
    clearExerciseLibraryData();
    clearExerciseMeta();
    clearSyncStatus();
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(ETAG_KEY);
  }
  localStorage.setItem(OWNER_KEY, user.email);
}

/**
 * Upload local state. Serialized with every other sync entry point through
 * `syncLock`, and reported through `syncStatus`: a failed push leaves
 * `hasUnpushed` set so the background tick retries instead of waiting for the
 * next cold start, and a 401 flips `authExpired` so the UI can ask the user to
 * sign in again rather than looking synced while uploading nothing.
 */
export function pushSync(): Promise<void> {
  return syncLock.run(async () => {
    markPushStarted();
    try {
      const status = await pushSyncUnlocked();
      if (status === 'unauthorized') markAuthExpired();
      else markPushSucceeded();
    } catch (err) {
      markSyncFailed(err);
      throw err;
    }
  });
}

// Returns true if local state changed (caller should refresh UI state)
export function pullSync(): Promise<boolean> {
  return syncLock.run(async () => {
    try {
      const result = await pullSyncUnlocked();
      if (result === 'unauthorized') { markAuthExpired(); return false; }
      markPullSucceeded();
      return result;
    } catch (err) {
      markSyncFailed(err);
      throw err;
    }
  });
}

async function pushSyncUnlocked(): Promise<'ok' | 'unauthorized'> {
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
      ...(s.note ? { note: s.note } : {}),
    })),
    setLogs:             idb.setLogs,
    exerciseLogs:        [],
    deletedSessionGuids: [...getSessionTombstones()],
    program:             getStoredProgram(),
    programUpdatedAt:    getProgramUpdatedAt(),
    exercises:           getExerciseLibrary(),
    deletedExerciseIds:  [...deletedExercises],
    restoredExerciseIds: [...getRestoredExerciseIds()],
    // Send the journey document when there's anything to sync — plans, the
    // onboarding profile (a user can onboard before activating a plan), or
    // strength records (a 1RM can be entered before any of those).
    plan:                (() => { const s = getPlanState(); return planStateHasContent(s) ? s : null; })(),
    ...splitMeta(meta),
  };

  const res = await fetch('/api/sync', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  if (res.status === 401) return 'unauthorized';
  if (!res.ok) throw new Error(`Sync push failed: ${res.status}`);
  return 'ok';
}

async function pullSyncUnlocked(): Promise<boolean | 'unauthorized'> {
  const etag = localStorage.getItem(ETAG_KEY);
  const res = await fetch('/api/sync', etag ? { headers: { 'If-None-Match': etag } } : undefined);
  if (res.status === 401) return 'unauthorized';
  // Nothing changed on the server since this device last merged it.
  if (res.status === 304) return false;
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
    programUpdatedAt?:   number               | null;
    exercises:           LibraryExercise[]    | null;
    exerciseMuscles:     ExerciseMusclesRow[] | null;
    exerciseDetails:     ExerciseDetailsRow[] | null;
    deletedExerciseIds:  string[]             | null;
    plan?:               PlanState            | null;
    /** Layer 1: admin-curated global metadata (combined muscles + details rows) */
    globalExerciseMetadata?: Array<ExerciseMusclesRow & ExerciseDetailsRow> | null;
    /** admin exercise merges (from→to id map) — applied to local data below */
    exerciseMerges?:     Array<{ fromId: string; toId: string }> | null;
    role?:               string               | null;
  };

  if (data.role) localStorage.setItem(ROLE_KEY, data.role);

  // Layer 1 global metadata: server-authoritative, replaced wholesale. Sits
  // below the user's own overrides in getExerciseMeta precedence.
  if (data.globalExerciseMetadata) {
    saveGlobalExerciseMeta(Object.fromEntries(
      data.globalExerciseMetadata.map(g => [g.exerciseId, {
        primaryMuscle:    g.primaryMuscle,
        secondaryMuscle1: g.secondaryMuscle1,
        secondaryMuscle2: g.secondaryMuscle2,
        secondaryMuscle3: g.secondaryMuscle3,
        workoutType:      g.workoutType,
        equipment:        g.equipment,
        weightType:       g.weightType,
      } as ExerciseMetaOverride]),
    ));
  }

  // Exercise deletions are permanent: merge the server's tombstones, then
  // scrub any local trace of the deleted exercises so a stale copy on this
  // device can't resurrect them (or be pushed back up). The exception is a
  // tombstone this device knowingly lifted (re-added by hand, or made the
  // survivor of an admin merge) and hasn't told the server about yet — the
  // server drops it on the next push, and once it stops reporting the id
  // deleted there is nothing left to tell.
  const serverDeleted = new Set(data.deletedExerciseIds ?? []);
  const restored = getRestoredExerciseIds();
  addDeletedExerciseIds([...serverDeleted].filter(id => !restored.has(id)));
  clearRestoredExerciseIds([...restored].filter(id => !serverDeleted.has(id)));
  const deleted = getDeletedExerciseIds();
  if (deleted.size > 0) {
    for (const id of deleted) deleteExerciseMeta(id);
    saveExerciseLibrary(getExerciseLibrary()); // getter filters tombstones
  }

  // The exercise library and its metadata apply even when this account has
  // no workout history yet. Both are MERGED per exercise by clock, never
  // replaced: a local-only exercise (added on this device, not yet pushed)
  // must survive a pull, and a local edit newer than the server's copy keeps
  // it (only tombstones delete).
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

  // Training journey: the newer plans document wins and the newer profile
  // wins, independently (planMerge.ts — the worker applies the same rule).
  if (mergeServerPlanState(data.plan ?? null)) changed = true;

  // The program: adopt the server's copy when its clock is newer than this
  // device's. An UNSTAMPED local program (never edited since clocks arrived)
  // yields to a non-empty server copy as it always did — unless this device
  // still owes the server a push, in which case the local copy may be the
  // edit that push is carrying, and it waits. An unstamped EMPTY server
  // program is still treated as the wipe it used to be (a bug, a bad push, a
  // corrupted row) and never adopted; a stamped empty one is the user
  // deleting their last day, and is.
  const serverClock = data.programUpdatedAt ?? 0;
  const localClock = getProgramUpdatedAt();
  const holdUnstamped = localClock === 0 && getSyncStatus().hasUnpushed;
  const adoptProgram = data.program != null && (
    serverClock > localClock ||
    (localClock === 0 && data.program.length > 0 && !holdUnstamped)
  );
  if (data.program && adoptProgram) {
    const incomingProgram = data.program.map(d => ({
      ...d,
      exercises: d.exercises.filter(e => !deleted.has(e.id)),
    }));
    const next = JSON.stringify(incomingProgram);
    if (next !== JSON.stringify(getStoredProgram()) || serverClock !== localClock) {
      saveStoredProgram(incomingProgram, serverClock);
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

  // Admin exercise merges: replace the stored map wholesale (application-owned,
  // like the global metadata layer), then apply it to everything local — set
  // logs, program, library. Runs after the session merge so server documents
  // that still carry a merged-away id get remapped too; the touched sessions
  // upload on the next push, converging the server copy. Applying means a
  // full read of the set logs, so it only runs when the map changed or this
  // pull brought something new (audit M17) — never on a quiet tick.
  let mapChanged = false;
  if (data.exerciseMerges) {
    const map: MergeMap = {};
    for (const m of data.exerciseMerges) {
      if (m.fromId && m.toId && m.fromId !== m.toId) map[m.fromId] = m.toId;
    }
    mapChanged = saveExerciseMerges(map);
  }
  if ((mapChanged || changed) && await applyExerciseMerges()) changed = true;

  // Repair pass: an exercise the program references but the library lost (the
  // old replace-on-pull sync could gut it) is rebuilt from the program slot so
  // history and the Exercises screen resolve its name again.
  ensureProgramExercisesInLibrary(getStoredProgram());

  // Remember what we merged — but only once every part of it was taken. A
  // pull that held the program back (unpushed local state) must come back
  // in full next time, or the server copy would never be adopted.
  const tag = res.headers.get('ETag');
  if (tag && !holdUnstamped) localStorage.setItem(ETAG_KEY, tag);
  else localStorage.removeItem(ETAG_KEY);

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
    ...(typeof s.note === 'string' && s.note ? { note: s.note } : {}),
    sets: (setsBySession.get(s.id) ?? []).map(l => ({
      exerciseId: l.exerciseId,
      setNumber:  l.setNumber,
      weight:     l.weight,
      reps:       l.reps,
      order:      l.order,
      warmup:     l.warmup,
      repLow:     l.repLow,
      repHigh:    l.repHigh,
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
    if (typeof d.updatedAt === 'number' && d.updatedAt > 0) o.updatedAt = d.updatedAt;
    map[d.exerciseId] = o;
  }
  return map;
}
