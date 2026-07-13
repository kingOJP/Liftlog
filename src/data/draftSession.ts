// In-workout draft persistence. Sets live in WorkoutView React state until
// "Finish Workout" — an app kill or Safari tab eviction mid-session used to
// lose everything. WorkoutView writes the draft here on every set change and
// clears it at finish; reopening the same day restores it.
//
// localStorage (not IndexedDB) on purpose: a draft is one small object with a
// single writer, and synchronous writes can't be lost to an interrupted async
// transaction during a kill. One slot suffices — you're only ever mid-workout
// on one day at a time.

export interface DraftSession {
  dayId: number;
  /** When the workout view was opened — preserved so duration stays correct */
  startedAt: number;
  savedAt: number;
  sets: Record<string, Array<{ weight: number; reps: number }>>;
  /** exercise ids in the order they were first trained (order tracking) */
  order?: string[];
}

const KEY = 'liftlog_draft_session';

// A draft older than this is a workout that was abandoned, not interrupted.
export const DRAFT_MAX_AGE_MS = 12 * 3_600_000;

export function saveDraftSession(draft: DraftSession): void {
  localStorage.setItem(KEY, JSON.stringify(draft));
}

export function clearDraftSession(): void {
  localStorage.removeItem(KEY);
}

// The draft for this day, if one exists and is fresh enough to resume. A draft
// with no sets yet is still resumable — a *started* workout is stored from the
// moment the view opens, so an app kill before the first set keeps its start
// time (and duration tracking) intact.
export function getResumableDraft(dayId: number, now = Date.now()): DraftSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as DraftSession;
    if (draft.dayId !== dayId) return null;
    if (now - draft.savedAt > DRAFT_MAX_AGE_MS) return null;
    return draft;
  } catch {
    return null;
  }
}

// Whether a draft actually contains logged sets (drives the restore banner —
// restoring just a start time isn't worth announcing).
export function draftHasSets(draft: DraftSession | null): boolean {
  return draft != null && Object.values(draft.sets).some(s => s.length > 0);
}
