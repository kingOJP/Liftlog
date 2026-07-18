import type { WorkoutDay } from './program';
import { getResumableDraft, draftHasSets } from './draftSession';
import type { DraftSession } from './draftSession';
import { getExerciseLibrary, getExerciseName } from './programStore';

// One-off ("quick") workouts let a new user log a session without committing to
// a training plan/block. They're logged like any other session but under a
// reserved negative dayId so they never collide with real program days (which
// are positive) and never appear as a program day on the dashboard.
export const QUICK_DAY_ID = -2;

export function isQuickWorkout(dayId: number): boolean {
  return dayId === QUICK_DAY_ID;
}

// Assemble the ad-hoc exercises the user picked into a one-off WorkoutDay. The
// exercises are already first-class library entries by this point (the picker
// calls addToExerciseLibrary), so history and metrics resolve their names.
export function buildQuickWorkoutDay(exercises: WorkoutDay['exercises']): WorkoutDay {
  return {
    id: QUICK_DAY_ID,
    label: 'Quick Workout',
    muscleGroups: 'One-off session',
    exercises,
  };
}

// ── Resuming an interrupted quick workout ────────────────────────────────────
// Every quick workout shares QUICK_DAY_ID, so the draft slot can't tell "the
// quick workout I was interrupted in" from "a new quick workout I'm assembling
// now". The quick-setup screen resolves the ambiguity explicitly: it offers to
// resume a draft with logged sets, and starting a fresh one discards it
// (clearDraftForDay) so stale sets can never merge into a new session.

/** The interrupted quick workout worth offering to resume (has logged sets). */
export function getResumableQuickDraft(now = Date.now()): DraftSession | null {
  const draft = getResumableDraft(QUICK_DAY_ID, now);
  return draftHasSets(draft) ? draft : null;
}

/**
 * Rebuild the quick day a draft was logged against, so Resume can drop the
 * user straight back into WorkoutView (which then restores the draft's sets).
 * The draft records exercise ids only — names and sets/rep targets resolve
 * from the library, with the same fallback WorkoutView uses for unknown ids.
 */
export function buildQuickDayFromDraft(draft: DraftSession): WorkoutDay {
  const ids = [...new Set([
    ...(draft.order ?? []),
    ...Object.keys(draft.sets).filter(id => draft.sets[id].length > 0),
  ])];
  const library = getExerciseLibrary();
  return buildQuickWorkoutDay(ids.map(id => {
    const lib = library.find(e => e.id === id);
    return lib
      ? { id, name: lib.name, sets: lib.sets, repLow: lib.repLow, repHigh: lib.repHigh }
      : { id, name: getExerciseName(id), sets: 3, repLow: 8, repHigh: 12 };
  }));
}
