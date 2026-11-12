// A copy of the account that does not depend on the server.
//
// Until now the only copy of a workout outside the device that logged it was
// the one sync uploaded — so when sync was broken for two weeks, the phone was
// a single point of failure and nothing in the app could do anything about it.
// A backup is the whole user-scoped state as one JSON document: it can be
// saved as a file from Settings (or from the dashboard warning when workouts
// are stranded), and restored on any device.
//
// Restore is a MERGE through the same functions a sync pull uses, never a
// replace: sessions merge per document (newer wins, nothing local is dropped),
// the journey merges by its clocks, the library and metadata merge per row,
// and the program is adopted only when this device has none. Restoring an old
// backup onto a current account therefore cannot lose anything.
//
// The same document is what `ensureLocalDataOwner` stashes before an account
// switch wipes a device that still holds workouts the server never received.

import { dumpIDB, mergeServerSessions } from '../db/database';
import type { Session, SetLog } from '../db/database';
import { sessionGuid, sessionUpdatedAt } from './syncMerge';
import type { SessionDoc } from './syncMerge';
import { getSessionTombstones } from './sessionTombstones';
import {
  getStoredProgram, saveStoredProgram, getProgramUpdatedAt,
  getExerciseLibrary, mergeExerciseLibrary, getDeletedExerciseIds,
} from './programStore';
import { getAllExerciseMeta, mergeExerciseMeta } from './exercises';
import type { ExerciseMetaOverride } from './exercises';
import type { WorkoutDay, LibraryExercise } from './program';
import { getPlanState, mergeServerPlanState, planStateHasContent } from './planStore';
import type { PlanState } from './planStore';
import { unbackedSessions } from './syncedSessions';

export interface BackupFile {
  format: 'liftlog-backup';
  version: 1;
  exportedAt: number;
  /** email of the account the data belongs to (null if unknown) */
  owner: string | null;
  sessions: SessionDoc[];
  program: WorkoutDay[];
  programUpdatedAt: number;
  exercises: LibraryExercise[];
  exerciseMeta: Record<string, ExerciseMetaOverride>;
  plan: PlanState | null;
}

function toDocs(sessions: Session[], setLogs: SetLog[]): SessionDoc[] {
  const bySession = new Map<number, SetLog[]>();
  for (const log of setLogs) {
    const arr = bySession.get(log.sessionId);
    if (arr) arr.push(log);
    else bySession.set(log.sessionId, [log]);
  }
  return sessions
    .map(s => ({
      guid:        sessionGuid(s),
      dayId:       s.dayId,
      weekNumber:  s.weekNumber,
      startedAt:   s.startedAt,
      completedAt: s.completedAt,
      updatedAt:   sessionUpdatedAt(s),
      ...(s.note ? { note: s.note } : {}),
      sets: (bySession.get(s.id!) ?? []).map(l => ({
        exerciseId: l.exerciseId, setNumber: l.setNumber, weight: l.weight, reps: l.reps,
        order: l.order, warmup: l.warmup, repLow: l.repLow, repHigh: l.repHigh,
        technique: l.technique, grip: l.grip,
      })),
    }))
    .filter(d => d.sets.length > 0);
}

/** Everything user-scoped on this device, as one document. */
export async function buildBackup(owner: string | null, now = Date.now()): Promise<BackupFile> {
  const idb = await dumpIDB();
  const deleted = getDeletedExerciseIds();
  const plan = getPlanState();
  return {
    format: 'liftlog-backup',
    version: 1,
    exportedAt: now,
    owner,
    sessions: toDocs(idb.sessions, idb.setLogs),
    program: getStoredProgram(),
    programUpdatedAt: getProgramUpdatedAt(),
    exercises: getExerciseLibrary(),
    exerciseMeta: Object.fromEntries(
      Object.entries(getAllExerciseMeta()).filter(([id]) => !deleted.has(id)),
    ),
    plan: planStateHasContent(plan) ? plan : null,
  };
}

export function isBackupFile(value: unknown): value is BackupFile {
  if (value == null || typeof value !== 'object') return false;
  const b = value as Partial<BackupFile>;
  if (b.format !== 'liftlog-backup' || b.version !== 1) return false;
  if (!Array.isArray(b.sessions) || !Array.isArray(b.program) || !Array.isArray(b.exercises)) return false;
  return b.sessions.every(s =>
    s != null && typeof s === 'object' && typeof s.guid === 'string' &&
    typeof s.startedAt === 'number' && typeof s.updatedAt === 'number' &&
    typeof s.dayId === 'number' && Array.isArray(s.sets) &&
    s.sets.every(l => l != null && typeof l.exerciseId === 'string' &&
      typeof l.weight === 'number' && typeof l.reps === 'number'));
}

export interface RestoreResult {
  /** workouts this device did not have (or had an older copy of) */
  sessionsRestored: number;
  programRestored: boolean;
  planRestored: boolean;
}

/**
 * Merge a backup into this device. Never drops or downgrades local data; the
 * caller pushes afterwards so the server receives whatever was restored.
 */
export async function restoreBackup(backup: BackupFile, now = Date.now()): Promise<RestoreResult> {
  const before = new Map((await dumpIDB()).sessions.map(s => [sessionGuid(s), sessionUpdatedAt(s)]));
  await mergeServerSessions(backup.sessions, getSessionTombstones());
  const after = (await dumpIDB()).sessions;
  const sessionsRestored = after.filter(s => {
    const prev = before.get(sessionGuid(s));
    return prev == null || prev < sessionUpdatedAt(s);
  }).length;

  mergeExerciseLibrary(backup.exercises);
  if (backup.exerciseMeta && typeof backup.exerciseMeta === 'object') {
    const deleted = getDeletedExerciseIds();
    mergeExerciseMeta(Object.fromEntries(
      Object.entries(backup.exerciseMeta).filter(([id]) => !deleted.has(id)),
    ));
  }

  const planRestored = backup.plan != null && mergeServerPlanState(backup.plan);

  // The program has no per-day merge, so a backup only fills a gap: it never
  // overwrites a program this device already has. Stamped `now` so the
  // restored copy is the one the next push delivers.
  let programRestored = false;
  if (backup.program.length > 0 && getStoredProgram().length === 0) {
    saveStoredProgram(backup.program, now);
    programRestored = true;
  }

  return { sessionsRestored, programRestored, planRestored };
}

/** How many workouts exist only on this device (see syncedSessions.ts). */
export async function countUnbackedSessions(): Promise<number> {
  const idb = await dumpIDB();
  const withSets = new Set(idb.setLogs.map(l => l.sessionId));
  return unbackedSessions(idb.sessions.filter(s => withSets.has(s.id!))).length;
}

// ── Stranded data across an account switch ──────────────────────────────────
// Signing a different account in wipes this device's user-scoped data — it
// must, or account A's history is shown to (and pushed into) account B. But
// if A still had workouts the server never received, that wipe destroyed the
// only copy. The wipe now stashes A's backup first, keyed by A's email, and
// A's next sign-in on this device merges it back and uploads it.

const strandedKey = (email: string) => `liftlog_stranded_backup:${email}`;

/** Before a wipe: keep the outgoing account's data if the server lacks any of it. */
export async function stashStrandedBackup(owner: string): Promise<boolean> {
  if (await countUnbackedSessions() === 0) return false;
  try {
    localStorage.setItem(strandedKey(owner), JSON.stringify(await buildBackup(owner)));
    return true;
  } catch {
    return false; // quota — nothing more this device can do
  }
}

/** After sign-in: merge back anything this account left stranded here. */
export async function restoreStrandedBackup(owner: string): Promise<RestoreResult | null> {
  const raw = localStorage.getItem(strandedKey(owner));
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  if (!isBackupFile(parsed)) {
    localStorage.removeItem(strandedKey(owner));
    return null;
  }
  const result = await restoreBackup(parsed);
  localStorage.removeItem(strandedKey(owner));
  return result;
}
