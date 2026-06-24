import type { ExerciseMuscles, ExerciseDetails } from '../db/database';

// Fill in null values and call seedExerciseData() once to populate IndexedDB.
// Existing records are never overwritten — safe to run multiple times.

export const EXERCISE_MUSCLES_SEED: ExerciseMuscles[] = [
  // Day 1 — Chest, Tris, Shoulders
  { exerciseId: 'incline-barbell-press',    primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'dumbbell-bench-press',     primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'seated-db-overhead-press', primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'cable-lateral-raises-d1',  primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'overhead-tricep-ext',      primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'tricep-cable-pushdown',    primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },

  // Day 2 — Back, Biceps, Rear Delts
  { exerciseId: 'face-pulls-d2',            primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'cable-pull-down-d2',       primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'lat-pulldown-d2',          primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'bent-over-db-row',         primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'incline-db-curls',         primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'hammer-curls',             primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },

  // Day 3 — Legs
  { exerciseId: 'seated-calf-raises',       primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'romanian-deadlifts',       primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'leg-press',                primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'leg-extension',            primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'hip-thrusts',              primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'standing-calf-raises',     primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },

  // Day 4 — Upper Body
  { exerciseId: 'cable-fly',               primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'weighted-pull-ups',        primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'cable-lateral-raises',     primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'tricep-pushdowns-d4',      primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'back-extensions',          primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'reverse-curls',            primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'face-pulls-d4',            primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },

  // Retired
  { exerciseId: 'barbell-overhead-press',   primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'dumbbell-lateral-raises',  primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'cable-pushdown',           primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'barbell-rows',             primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'straight-arm-pulldowns',   primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'cable-kick-backs',         primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
  { exerciseId: 'lat-pull-down',            primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null },
];

export const EXERCISE_DETAILS_SEED: ExerciseDetails[] = [
  // Day 1 — Chest, Tris, Shoulders
  { exerciseId: 'incline-barbell-press',    workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'dumbbell-bench-press',     workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'seated-db-overhead-press', workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'cable-lateral-raises-d1',  workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'overhead-tricep-ext',      workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'tricep-cable-pushdown',    workoutType: null, equipment: null, weightType: null },

  // Day 2 — Back, Biceps, Rear Delts
  { exerciseId: 'face-pulls-d2',            workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'cable-pull-down-d2',       workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'lat-pulldown-d2',          workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'bent-over-db-row',         workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'incline-db-curls',         workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'hammer-curls',             workoutType: null, equipment: null, weightType: null },

  // Day 3 — Legs
  { exerciseId: 'seated-calf-raises',       workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'romanian-deadlifts',       workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'leg-press',                workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'leg-extension',            workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'hip-thrusts',              workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'standing-calf-raises',     workoutType: null, equipment: null, weightType: null },

  // Day 4 — Upper Body
  { exerciseId: 'cable-fly',               workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'weighted-pull-ups',        workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'cable-lateral-raises',     workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'tricep-pushdowns-d4',      workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'back-extensions',          workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'reverse-curls',            workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'face-pulls-d4',            workoutType: null, equipment: null, weightType: null },

  // Retired
  { exerciseId: 'barbell-overhead-press',   workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'dumbbell-lateral-raises',  workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'cable-pushdown',           workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'barbell-rows',             workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'straight-arm-pulldowns',   workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'cable-kick-backs',         workoutType: null, equipment: null, weightType: null },
  { exerciseId: 'lat-pull-down',            workoutType: null, equipment: null, weightType: null },
];
