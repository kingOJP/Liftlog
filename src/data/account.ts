// Account-level actions: take your data with you, or delete everything.
//
// Both are things a store-distributed app is expected to offer (and, for
// deletion, required to: App Store guideline 5.1.1(v)). Export reads the
// local database — which holds everything the account has after a sync — so
// it works offline.

import { dumpIDB } from '../db/database';
import type { Session, SetLog } from '../db/database';
import { getStoredProgram, getExerciseLibrary, getExerciseName } from './programStore';
import { getAllExerciseMeta } from './exercises';
import { getPlanState } from './planStore';
import { getLoggedInUser, clearLocalUserData, clearLocalDataOwner } from './sync';
import { APP_NAME, APP_VERSION } from './appInfo';

export interface ExportedSet {
  exerciseId: string;
  exercise: string;
  set: number;
  weightLbs: number;
  reps: number;
  warmup?: true;
  technique?: string;
  grip?: string;
}

export interface ExportedSession {
  id: string;
  dayId: number;
  startedAt: string;
  completedAt: string | null;
  note?: string;
  sets: ExportedSet[];
}

export interface DataExport {
  app: string;
  appVersion: string;
  formatVersion: 1;
  exportedAt: string;
  account: { email: string; name: string } | null;
  /** every weight in this file is in pounds, whatever unit the app displays */
  weightUnit: 'lb';
  sessions: ExportedSession[];
  program: unknown;
  exerciseLibrary: unknown;
  exerciseMetadata: unknown;
  trainingJourney: unknown;
}

const iso = (ms: number | undefined): string | null =>
  typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;

/** Pure: shape the raw stores into a file a person (or a spreadsheet) can read. */
export function shapeExport(
  sessions: Session[], setLogs: SetLog[], nameOf: (id: string) => string, now: number,
): ExportedSession[] {
  const bySession = new Map<number, SetLog[]>();
  for (const log of setLogs) {
    const list = bySession.get(log.sessionId);
    if (list) list.push(log); else bySession.set(log.sessionId, [log]);
  }
  return [...sessions]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map(s => ({
      id: s.guid ?? `legacy-${s.startedAt}`,
      dayId: s.dayId,
      startedAt: iso(s.startedAt) ?? new Date(now).toISOString(),
      completedAt: iso(s.completedAt),
      ...(s.note ? { note: s.note } : {}),
      sets: (bySession.get(s.id ?? -1) ?? [])
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id ?? 0) - (b.id ?? 0))
        .map(l => ({
          exerciseId: l.exerciseId,
          exercise: nameOf(l.exerciseId),
          set: l.setNumber,
          weightLbs: l.weight,
          reps: l.reps,
          ...(l.warmup ? { warmup: true as const } : {}),
          ...(l.technique ? { technique: l.technique } : {}),
          ...(l.grip ? { grip: l.grip } : {}),
        })),
    }));
}

export async function buildDataExport(now = Date.now()): Promise<DataExport> {
  const { sessions, setLogs } = await dumpIDB();
  return {
    app: APP_NAME,
    appVersion: APP_VERSION,
    formatVersion: 1,
    exportedAt: new Date(now).toISOString(),
    account: getLoggedInUser(),
    weightUnit: 'lb',
    sessions: shapeExport(sessions, setLogs, getExerciseName, now),
    program: getStoredProgram(),
    exerciseLibrary: getExerciseLibrary(),
    exerciseMetadata: getAllExerciseMeta(),
    trainingJourney: getPlanState(),
  };
}

/**
 * Hand the export to the user. The share sheet where files can be shared
 * (an installed iOS web app cannot save a download any other way), a plain
 * download elsewhere. Resolves to how many workouts the file holds.
 */
export async function exportMyData(): Promise<number> {
  const data = await buildDataExport();
  const filename = `liftlog-export-${data.exportedAt.slice(0, 10)}.json`;
  const json = JSON.stringify(data, null, 2);
  const file = new File([json], filename, { type: 'application/json' });

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'LiftLog export' });
      return data.sessions.length;
    } catch (err) {
      // Closing the share sheet is not a failure; anything else falls through.
      if (err instanceof DOMException && err.name === 'AbortError') return data.sessions.length;
    }
  }

  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return data.sessions.length;
}

/**
 * Permanently delete the account on the server, then everything it left on
 * this device. Throws (and deletes nothing locally) if the server did not
 * confirm — an offline tap must not wipe the only remaining copy.
 */
export async function deleteMyAccount(): Promise<void> {
  const res = await fetch('/api/auth/account', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'DELETE' }),
    credentials: 'same-origin',
  });
  if (res.status === 401) throw new Error('Your sign-in has expired. Sign in again, then delete the account.');
  if (!res.ok) throw new Error('The account could not be deleted. Check your connection and try again.');
  await clearLocalUserData();
  clearLocalDataOwner();
}
