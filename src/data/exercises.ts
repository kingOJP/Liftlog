import type { MuscleGroup, WorkoutType, Equipment, WeightType } from './taxonomy';

export interface ExerciseDef {
  id: string;
  name: string;
  primaryMuscle: MuscleGroup | null;
  secondaryMuscles: [MuscleGroup | null, MuscleGroup | null, MuscleGroup | null];
  workoutType: WorkoutType | null;
  equipment: Equipment | null;
  weightType: WeightType | null;
}

export const EXERCISES: ExerciseDef[] = [
  // Chest
  { id: 'incline-barbell-press',    name: 'Incline Barbell Press',            primaryMuscle: 'Chest',       secondaryMuscles: ['Front Delts', 'Triceps', null], workoutType: 'Chest Press',      equipment: 'Bench',             weightType: 'Barbell'    },
  { id: 'dumbbell-bench-press',     name: 'Dumbbell Bench Press',             primaryMuscle: 'Chest',       secondaryMuscles: ['Front Delts', 'Triceps', null], workoutType: 'Chest Press',      equipment: 'Bench',             weightType: 'Dumbbell'   },
  { id: 'cable-fly',                name: 'Cable Fly',                        primaryMuscle: 'Chest',       secondaryMuscles: ['Front Delts', null, null],      workoutType: 'Fly',              equipment: 'Cable Machine',     weightType: 'Machine'    },

  // Front Delts
  { id: 'seated-db-overhead-press', name: 'Seated Dumbbell Overhead Press',   primaryMuscle: 'Front Delts', secondaryMuscles: ['Side Delts', 'Triceps', null],  workoutType: 'Overhead Press',   equipment: 'Bench',             weightType: 'Dumbbell'   },
  { id: 'barbell-overhead-press',   name: 'Barbell Overhead Press',           primaryMuscle: 'Front Delts', secondaryMuscles: ['Side Delts', 'Triceps', null],  workoutType: 'Overhead Press',   equipment: 'Squat Rack',        weightType: 'Barbell'    },

  // Side Delts
  { id: 'cable-lateral-raises',     name: 'Cable Lateral Raises',             primaryMuscle: 'Side Delts',  secondaryMuscles: [null, null, null],               workoutType: 'Lateral Raise',    equipment: 'Cable Machine',     weightType: 'Machine'    },
  { id: 'dumbbell-lateral-raises',  name: 'Dumbbell Lateral Raises',          primaryMuscle: 'Side Delts',  secondaryMuscles: [null, null, null],               workoutType: 'Lateral Raise',    equipment: 'None',              weightType: 'Dumbbell'   },

  // Rear Delts
  { id: 'face-pulls',               name: 'Face Pulls',                       primaryMuscle: 'Rear Delts',  secondaryMuscles: ['Upper Back', 'Traps', null],    workoutType: 'Face Pull',        equipment: 'Cable Machine',     weightType: 'Machine'    },

  // Upper Back
  { id: 'bent-over-db-row',         name: 'Bent Over One Arm Dumbbell Row',   primaryMuscle: 'Upper Back',  secondaryMuscles: ['Lats', 'Rear Delts', 'Biceps'], workoutType: 'Row',              equipment: 'None',              weightType: 'Dumbbell'   },
  { id: 'barbell-rows',             name: 'Barbell Rows',                     primaryMuscle: 'Upper Back',  secondaryMuscles: ['Lats', 'Biceps', null],         workoutType: 'Row',              equipment: 'None',              weightType: 'Barbell'    },

  // Lats
  { id: 'lat-pull-down',            name: 'Lat Pull Down',                    primaryMuscle: 'Lats',        secondaryMuscles: ['Upper Back', 'Biceps', null],   workoutType: 'Pull Down',        equipment: 'Cable Machine',     weightType: 'Machine'    },
  { id: 'straight-arm-pulldowns',   name: 'Straight Arm Pull Downs',          primaryMuscle: 'Lats',        secondaryMuscles: ['Upper Back', null, null],       workoutType: 'Pull Down',        equipment: 'Cable Machine',     weightType: 'Machine'    },
  { id: 'weighted-pull-ups',        name: 'Weighted Pull Ups',                primaryMuscle: 'Lats',        secondaryMuscles: ['Upper Back', 'Biceps', null],   workoutType: 'Pull Up',          equipment: 'Pull Up Bar',       weightType: 'Bodyweight' },

  // Lower Back
  { id: 'back-extensions',          name: 'Back Extensions',                  primaryMuscle: 'Lower Back',  secondaryMuscles: ['Glutes', null, null],           workoutType: 'Hip Hinge',        equipment: 'None',              weightType: 'Bodyweight' },

  // Triceps
  { id: 'overhead-tricep-ext',      name: 'Overhead Tricep Extension',        primaryMuscle: 'Triceps',     secondaryMuscles: [null, null, null],               workoutType: 'Tricep Extension', equipment: 'Cable Machine',     weightType: 'Machine'    },
  { id: 'tricep-cable-pushdown',    name: 'Tricep Cable Pushdown',            primaryMuscle: 'Triceps',     secondaryMuscles: [null, null, null],               workoutType: 'Tricep Extension', equipment: 'Cable Machine',     weightType: 'Machine'    },
  { id: 'cable-pushdown',           name: 'Cable Pushdown',                   primaryMuscle: 'Triceps',     secondaryMuscles: [null, null, null],               workoutType: 'Tricep Extension', equipment: 'Cable Machine',     weightType: 'Machine'    },
  { id: 'cable-kick-backs',         name: 'Cable Kick Backs',                 primaryMuscle: 'Triceps',     secondaryMuscles: [null, null, null],               workoutType: 'Tricep Extension', equipment: 'Cable Machine',     weightType: 'Machine'    },

  // Biceps
  { id: 'incline-db-curls',         name: 'Incline Dumbbell Curls',           primaryMuscle: 'Biceps',      secondaryMuscles: [null, null, null],               workoutType: 'Curl',             equipment: 'Bench',             weightType: 'Dumbbell'   },
  { id: 'hammer-curls',             name: 'Hammer Curls',                     primaryMuscle: 'Biceps',      secondaryMuscles: ['Forearms', null, null],         workoutType: 'Curl',             equipment: 'None',              weightType: 'Dumbbell'   },

  // Forearms
  { id: 'reverse-curls',            name: 'Reverse Curls',                    primaryMuscle: 'Forearms',    secondaryMuscles: ['Biceps', null, null],           workoutType: 'Curl',             equipment: 'None',              weightType: 'EZ Bar'     },

  // Quads
  { id: 'leg-press',                name: 'Leg Press',                        primaryMuscle: 'Quads',       secondaryMuscles: ['Glutes', 'Hamstrings', null],   workoutType: 'Leg Press',        equipment: 'Machine',           weightType: 'Machine'    },
  { id: 'leg-extension',            name: 'Leg Extension',                    primaryMuscle: 'Quads',       secondaryMuscles: [null, null, null],               workoutType: 'Leg Extension',    equipment: 'Machine',           weightType: 'Machine'    },

  // Hamstrings
  { id: 'romanian-deadlifts',       name: 'Romanian Deadlifts',               primaryMuscle: 'Hamstrings',  secondaryMuscles: ['Glutes', 'Lower Back', null],   workoutType: 'Hip Hinge',        equipment: 'None',              weightType: 'Barbell'    },

  // Glutes
  { id: 'hip-thrusts',              name: 'Hip Thrusts',                      primaryMuscle: 'Glutes',      secondaryMuscles: ['Hamstrings', null, null],       workoutType: 'Hip Thrust',       equipment: 'Bench',             weightType: 'Barbell'    },

  // Calves
  { id: 'seated-calf-raises',       name: 'Seated Calf Raises',               primaryMuscle: 'Calves',      secondaryMuscles: [null, null, null],               workoutType: 'Calf Raise',       equipment: 'None',              weightType: 'Machine'    },
  { id: 'standing-calf-raises',     name: 'Standing Calf Raises',             primaryMuscle: 'Calves',      secondaryMuscles: [null, null, null],               workoutType: 'Calf Raise',       equipment: 'None',              weightType: 'Barbell'    },
];

export const EXERCISE_MAP = new Map<string, ExerciseDef>(EXERCISES.map(e => [e.id, e]));

// ── Per-exercise metadata overrides (user edits stored in localStorage) ───────

const META_KEY = 'liftlog_exercise_meta';

export interface ExerciseMetaOverride {
  primaryMuscle: MuscleGroup | null;
  secondaryMuscle1: MuscleGroup | null;
  secondaryMuscle2: MuscleGroup | null;
  secondaryMuscle3: MuscleGroup | null;
  workoutType: WorkoutType | null;
  equipment: Equipment | null;
  weightType: WeightType | null;
}

function loadMetaOverrides(): Record<string, ExerciseMetaOverride> {
  try {
    const raw = localStorage.getItem(META_KEY);
    const overrides = raw ? JSON.parse(raw) as Record<string, ExerciseMetaOverride> : {};
    // 'Leg Press Machine' was folded into the 'Machine' catch-all; stored
    // overrides (local edits or a server pull) may still carry the old value.
    for (const o of Object.values(overrides)) {
      if ((o.equipment as string) === 'Leg Press Machine') o.equipment = 'Machine';
    }
    return overrides;
  } catch {
    return {};
  }
}

export function getExerciseMeta(id: string): ExerciseMetaOverride {
  const overrides = loadMetaOverrides();
  if (overrides[id]) return overrides[id];

  const def = EXERCISE_MAP.get(id);
  return {
    primaryMuscle:    def?.primaryMuscle          ?? null,
    secondaryMuscle1: def?.secondaryMuscles[0]    ?? null,
    secondaryMuscle2: def?.secondaryMuscles[1]    ?? null,
    secondaryMuscle3: def?.secondaryMuscles[2]    ?? null,
    workoutType:      def?.workoutType            ?? null,
    equipment:        def?.equipment              ?? null,
    weightType:       def?.weightType             ?? null,
  };
}

export function saveExerciseMeta(id: string, meta: ExerciseMetaOverride): void {
  const overrides = loadMetaOverrides();
  overrides[id] = meta;
  localStorage.setItem(META_KEY, JSON.stringify(overrides));
}

// All user-edited metadata overrides — used by cloud sync so muscle/equipment
// info the user enters survives on other devices and after a re-pull.
export function getAllExerciseMeta(): Record<string, ExerciseMetaOverride> {
  return loadMetaOverrides();
}

// Merge server-provided overrides into the local set (server wins per exercise;
// local-only edits not yet pushed are preserved so a pull can't drop them).
export function mergeExerciseMeta(incoming: Record<string, ExerciseMetaOverride>): void {
  if (Object.keys(incoming).length === 0) return;
  const merged = { ...loadMetaOverrides(), ...incoming };
  localStorage.setItem(META_KEY, JSON.stringify(merged));
}
