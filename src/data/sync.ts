import { dumpIDB, restoreIDB } from '../db/database';
import type { Session, SetLog, ExerciseLog } from '../db/database';
import { getStoredProgram, saveStoredProgram, getExerciseLibrary, saveExerciseLibrary } from './programStore';
import type { WorkoutDay, Exercise } from './program';

export interface SyncUser {
  email: string;
  name: string;
}

interface SyncPayload {
  sessions:     Session[];
  setLogs:      SetLog[];
  exerciseLogs: ExerciseLog[];
  program:      WorkoutDay[];
  exercises:    Exercise[];
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
  const idb = await dumpIDB();
  const payload: SyncPayload = {
    ...idb,
    program:   getStoredProgram(),
    exercises: getExerciseLibrary(),
  };

  const res = await fetch('/api/sync', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  if (res.status === 401) return;
  if (!res.ok) throw new Error(`Sync push failed: ${res.status}`);
}

// Returns true if server had data and local state was updated
export async function pullSync(): Promise<boolean> {
  const res = await fetch('/api/sync');
  if (res.status === 401) return false;
  if (!res.ok) throw new Error(`Sync pull failed: ${res.status}`);

  const data = await res.json() as {
    sessions:     Session[];
    setLogs:      SetLog[];
    exerciseLogs: ExerciseLog[];
    program:      WorkoutDay[] | null;
    exercises:    Exercise[]   | null;
  };

  const hasData = data.sessions.length > 0 || data.setLogs.length > 0;
  if (!hasData) return false;

  await restoreIDB({
    sessions:     data.sessions,
    setLogs:      data.setLogs,
    exerciseLogs: data.exerciseLogs,
  });

  if (data.program)   saveStoredProgram(data.program);
  if (data.exercises) saveExerciseLibrary(data.exercises);

  return true;
}
