import type { WorkoutDay } from './program';

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
