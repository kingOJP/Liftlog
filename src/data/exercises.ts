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
  { id: 'incline-barbell-press',    name: 'Incline Barbell Press',            primaryMuscle: 'Chest',       secondaryMuscles: ['Delts', 'Triceps', null],       workoutType: 'Press',            equipment: 'Bench',             weightType: 'Barbell'    },
  { id: 'dumbbell-bench-press',     name: 'Dumbbell Bench Press',             primaryMuscle: 'Chest',       secondaryMuscles: ['Delts', 'Triceps', null],       workoutType: 'Press',            equipment: 'Bench',             weightType: 'Dumbbell'   },
  { id: 'cable-fly',                name: 'Cable Fly',                        primaryMuscle: 'Chest',       secondaryMuscles: ['Delts', null, null],            workoutType: 'Fly',              equipment: 'Cable Machine',     weightType: 'Machine'    },

  // Delts
  { id: 'seated-db-overhead-press', name: 'Seated Dumbbell Overhead Press',   primaryMuscle: 'Delts',       secondaryMuscles: ['Triceps', null, null],          workoutType: 'Press',            equipment: 'Bench',             weightType: 'Dumbbell'   },
  { id: 'barbell-overhead-press',   name: 'Barbell Overhead Press',           primaryMuscle: 'Delts',       secondaryMuscles: ['Triceps', null, null],          workoutType: 'Press',            equipment: 'Squat Rack',        weightType: 'Barbell'    },
  { id: 'cable-lateral-raises',     name: 'Cable Lateral Raises',             primaryMuscle: 'Delts',       secondaryMuscles: [null, null, null],               workoutType: 'Lateral Raise',    equipment: 'Cable Machine',     weightType: 'Machine'    },
  { id: 'dumbbell-lateral-raises',  name: 'Dumbbell Lateral Raises',          primaryMuscle: 'Delts',       secondaryMuscles: [null, null, null],               workoutType: 'Lateral Raise',    equipment: 'None',              weightType: 'Dumbbell'   },
  { id: 'face-pulls',               name: 'Face Pulls',                       primaryMuscle: 'Delts',       secondaryMuscles: ['Upper Back', 'Traps', null],    workoutType: 'Face Pull',        equipment: 'Cable Machine',     weightType: 'Machine'    },

  // Upper Back
  { id: 'bent-over-db-row',         name: 'Bent Over One Arm Dumbbell Row',   primaryMuscle: 'Upper Back',  secondaryMuscles: ['Lats', 'Delts', 'Biceps'],      workoutType: 'Row',              equipment: 'None',              weightType: 'Dumbbell'   },
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

  // ── Catalog expansion ────────────────────────────────────────────────────────
  // Curated additions vetted through the same ExerciseDef pipeline as the
  // originals: canonical slug IDs, normalized names, full muscle/pattern/
  // equipment classification, deduped against everything above. They exist
  // primarily to give the substitution engine (data/substitution.ts) a deep
  // candidate pool; an exercise only joins the user's library when it is
  // actually swapped into the program (addToExerciseLibrary).

  // Chest
  { id: 'flat-barbell-bench-press', name: 'Flat Barbell Bench Press',         primaryMuscle: 'Chest',       secondaryMuscles: ['Delts', 'Triceps', null],       workoutType: 'Press',            equipment: 'Bench',             weightType: 'Barbell'    },
  { id: 'incline-dumbbell-press',   name: 'Incline Dumbbell Press',           primaryMuscle: 'Chest',       secondaryMuscles: ['Delts', 'Triceps', null],       workoutType: 'Press',            equipment: 'Bench',             weightType: 'Dumbbell'   },
  { id: 'machine-chest-press',      name: 'Machine Chest Press',              primaryMuscle: 'Chest',       secondaryMuscles: ['Delts', 'Triceps', null],       workoutType: 'Press',            equipment: 'Machine',           weightType: 'Machine'    },
  { id: 'pec-deck-fly',             name: 'Pec Deck Fly',                     primaryMuscle: 'Chest',       secondaryMuscles: ['Delts', null, null],            workoutType: 'Fly',              equipment: 'Machine',           weightType: 'Machine'    },
  { id: 'dumbbell-fly',             name: 'Dumbbell Fly',                     primaryMuscle: 'Chest',       secondaryMuscles: ['Delts', null, null],            workoutType: 'Fly',              equipment: 'Bench',             weightType: 'Dumbbell'   },
  { id: 'weighted-dips',            name: 'Weighted Dips',                    primaryMuscle: 'Chest',       secondaryMuscles: ['Triceps', 'Delts', null],       workoutType: 'Dip',              equipment: 'Dip Station',       weightType: 'Bodyweight' },
  { id: 'push-ups',                 name: 'Push Ups',                         primaryMuscle: 'Chest',       secondaryMuscles: ['Delts', 'Triceps', null],       workoutType: 'Press',            equipment: 'None',              weightType: 'Bodyweight' },

  // Delts
  { id: 'machine-shoulder-press',   name: 'Machine Shoulder Press',           primaryMuscle: 'Delts',       secondaryMuscles: ['Triceps', null, null],          workoutType: 'Press',            equipment: 'Machine',           weightType: 'Machine'    },
  { id: 'machine-lateral-raise',    name: 'Machine Lateral Raise',            primaryMuscle: 'Delts',       secondaryMuscles: [null, null, null],               workoutType: 'Lateral Raise',    equipment: 'Machine',           weightType: 'Machine'    },
  { id: 'reverse-pec-deck',         name: 'Reverse Pec Deck',                 primaryMuscle: 'Delts',       secondaryMuscles: ['Upper Back', 'Traps', null],    workoutType: 'Reverse Fly',      equipment: 'Machine',           weightType: 'Machine'    },
  { id: 'dumbbell-rear-delt-fly',   name: 'Dumbbell Rear Delt Fly',           primaryMuscle: 'Delts',       secondaryMuscles: ['Upper Back', 'Traps', null],    workoutType: 'Reverse Fly',      equipment: 'Bench',             weightType: 'Dumbbell'   },

  // Traps
  { id: 'barbell-shrugs',           name: 'Barbell Shrugs',                   primaryMuscle: 'Traps',       secondaryMuscles: ['Forearms', null, null],         workoutType: 'Shrug',            equipment: 'None',              weightType: 'Barbell'    },
  { id: 'dumbbell-shrugs',          name: 'Dumbbell Shrugs',                  primaryMuscle: 'Traps',       secondaryMuscles: ['Forearms', null, null],         workoutType: 'Shrug',            equipment: 'None',              weightType: 'Dumbbell'   },

  // Upper Back
  { id: 'seated-cable-row',         name: 'Seated Cable Row',                 primaryMuscle: 'Upper Back',  secondaryMuscles: ['Lats', 'Biceps', null],         workoutType: 'Row',              equipment: 'Cable Machine',     weightType: 'Machine'    },
  { id: 'chest-supported-row',      name: 'Chest Supported Row',              primaryMuscle: 'Upper Back',  secondaryMuscles: ['Lats', 'Biceps', null],         workoutType: 'Row',              equipment: 'Machine',           weightType: 'Machine'    },
  { id: 't-bar-row',                name: 'T-Bar Row',                        primaryMuscle: 'Upper Back',  secondaryMuscles: ['Lats', 'Biceps', null],         workoutType: 'Row',              equipment: 'Machine',           weightType: 'Barbell'    },

  // Lats
  { id: 'chin-ups',                 name: 'Chin Ups',                         primaryMuscle: 'Lats',        secondaryMuscles: ['Biceps', 'Upper Back', null],   workoutType: 'Pull Up',          equipment: 'Pull Up Bar',       weightType: 'Bodyweight' },
  { id: 'dumbbell-pullover',        name: 'Dumbbell Pullover',                primaryMuscle: 'Lats',        secondaryMuscles: ['Chest', null, null],            workoutType: 'Pull Over',        equipment: 'Bench',             weightType: 'Dumbbell'   },

  // Posterior chain
  { id: 'conventional-deadlift',    name: 'Conventional Deadlift',            primaryMuscle: 'Glutes',      secondaryMuscles: ['Hamstrings', 'Lower Back', 'Traps'], workoutType: 'Hip Hinge',   equipment: 'None',              weightType: 'Barbell'    },
  { id: 'good-mornings',            name: 'Good Mornings',                    primaryMuscle: 'Hamstrings',  secondaryMuscles: ['Glutes', 'Lower Back', null],   workoutType: 'Hip Hinge',        equipment: 'Squat Rack',        weightType: 'Barbell'    },
  { id: 'dumbbell-rdl',             name: 'Dumbbell Romanian Deadlift',       primaryMuscle: 'Hamstrings',  secondaryMuscles: ['Glutes', 'Lower Back', null],   workoutType: 'Hip Hinge',        equipment: 'None',              weightType: 'Dumbbell'   },
  { id: 'seated-leg-curl',          name: 'Seated Leg Curl',                  primaryMuscle: 'Hamstrings',  secondaryMuscles: [null, null, null],               workoutType: 'Leg Curl',         equipment: 'Machine',           weightType: 'Machine'    },
  { id: 'lying-leg-curl',           name: 'Lying Leg Curl',                   primaryMuscle: 'Hamstrings',  secondaryMuscles: [null, null, null],               workoutType: 'Leg Curl',         equipment: 'Machine',           weightType: 'Machine'    },
  { id: 'cable-pull-through',       name: 'Cable Pull Through',               primaryMuscle: 'Glutes',      secondaryMuscles: ['Hamstrings', 'Lower Back', null], workoutType: 'Hip Hinge',      equipment: 'Cable Machine',     weightType: 'Machine'    },

  // Quads
  { id: 'barbell-back-squat',       name: 'Barbell Back Squat',               primaryMuscle: 'Quads',       secondaryMuscles: ['Glutes', 'Hamstrings', 'Lower Back'], workoutType: 'Squat',      equipment: 'Squat Rack',        weightType: 'Barbell'    },
  { id: 'hack-squat',               name: 'Hack Squat',                       primaryMuscle: 'Quads',       secondaryMuscles: ['Glutes', null, null],           workoutType: 'Squat',            equipment: 'Machine',           weightType: 'Machine'    },
  { id: 'smith-machine-squat',      name: 'Smith Machine Squat',              primaryMuscle: 'Quads',       secondaryMuscles: ['Glutes', 'Hamstrings', null],   workoutType: 'Squat',            equipment: 'Smith Machine',     weightType: 'Machine'    },
  { id: 'goblet-squat',             name: 'Goblet Squat',                     primaryMuscle: 'Quads',       secondaryMuscles: ['Glutes', null, null],           workoutType: 'Squat',            equipment: 'None',              weightType: 'Dumbbell'   },
  { id: 'bulgarian-split-squat',    name: 'Bulgarian Split Squat',            primaryMuscle: 'Quads',       secondaryMuscles: ['Glutes', 'Hamstrings', null],   workoutType: 'Lunge',            equipment: 'Bench',             weightType: 'Dumbbell'   },
  { id: 'walking-lunges',           name: 'Walking Lunges',                   primaryMuscle: 'Quads',       secondaryMuscles: ['Glutes', 'Hamstrings', null],   workoutType: 'Lunge',            equipment: 'None',              weightType: 'Dumbbell'   },

  // Calves
  { id: 'leg-press-calf-raise',     name: 'Leg Press Calf Raise',             primaryMuscle: 'Calves',      secondaryMuscles: [null, null, null],               workoutType: 'Calf Raise',       equipment: 'Machine',           weightType: 'Machine'    },

  // Biceps
  { id: 'ez-bar-curls',             name: 'EZ Bar Curls',                     primaryMuscle: 'Biceps',      secondaryMuscles: ['Forearms', null, null],         workoutType: 'Curl',             equipment: 'None',              weightType: 'EZ Bar'     },
  { id: 'preacher-curls',           name: 'Preacher Curls',                   primaryMuscle: 'Biceps',      secondaryMuscles: [null, null, null],               workoutType: 'Curl',             equipment: 'Machine',           weightType: 'EZ Bar'     },
  { id: 'cable-curls',              name: 'Cable Curls',                      primaryMuscle: 'Biceps',      secondaryMuscles: ['Forearms', null, null],         workoutType: 'Curl',             equipment: 'Cable Machine',     weightType: 'Machine'    },

  // Triceps
  { id: 'skull-crushers',           name: 'Skull Crushers',                   primaryMuscle: 'Triceps',     secondaryMuscles: [null, null, null],               workoutType: 'Tricep Extension', equipment: 'Bench',             weightType: 'EZ Bar'     },
  { id: 'close-grip-bench-press',   name: 'Close Grip Bench Press',           primaryMuscle: 'Triceps',     secondaryMuscles: ['Chest', 'Delts', null],         workoutType: 'Press',            equipment: 'Bench',             weightType: 'Barbell'    },

  // Abs
  { id: 'cable-crunch',             name: 'Cable Crunch',                     primaryMuscle: 'Abs',         secondaryMuscles: [null, null, null],               workoutType: 'Crunch',           equipment: 'Cable Machine',     weightType: 'Machine'    },
  { id: 'hanging-leg-raise',        name: 'Hanging Leg Raise',                primaryMuscle: 'Abs',         secondaryMuscles: ['Forearms', null, null],         workoutType: 'Crunch',           equipment: 'Pull Up Bar',       weightType: 'Bodyweight' },
  { id: 'machine-crunch',           name: 'Machine Crunch',                   primaryMuscle: 'Abs',         secondaryMuscles: [null, null, null],               workoutType: 'Crunch',           equipment: 'Machine',           weightType: 'Machine'    },

  // Forearms
  { id: 'wrist-curls',              name: 'Wrist Curls',                      primaryMuscle: 'Forearms',    secondaryMuscles: [null, null, null],               workoutType: 'Curl',             equipment: 'Bench',             weightType: 'Dumbbell'   },
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

// Taxonomy values that were merged away — stored overrides (local edits or a
// server pull) may still carry them, so every read normalizes.
const LEGACY_MUSCLES: Record<string, MuscleGroup> = {
  'Front Delts': 'Delts', 'Side Delts': 'Delts', 'Rear Delts': 'Delts',
};
const LEGACY_WORKOUT_TYPES: Record<string, WorkoutType> = {
  'Chest Press': 'Press', 'Overhead Press': 'Press', 'Push Up': 'Press',
};

function normalizeOverride(o: ExerciseMetaOverride): void {
  const muscle = (m: MuscleGroup | null): MuscleGroup | null =>
    m ? (LEGACY_MUSCLES[m as string] ?? m) : null;
  o.primaryMuscle    = muscle(o.primaryMuscle);
  o.secondaryMuscle1 = muscle(o.secondaryMuscle1);
  o.secondaryMuscle2 = muscle(o.secondaryMuscle2);
  o.secondaryMuscle3 = muscle(o.secondaryMuscle3);
  // Folding the three delt groups into one can leave the same muscle listed
  // twice (e.g. primary Front Delts + secondary Side Delts) — keep the first.
  const seen = new Set<MuscleGroup>();
  if (o.primaryMuscle) seen.add(o.primaryMuscle);
  for (const key of ['secondaryMuscle1', 'secondaryMuscle2', 'secondaryMuscle3'] as const) {
    const m = o[key];
    if (!m) continue;
    if (seen.has(m)) o[key] = null;
    else seen.add(m);
  }
  if (o.workoutType) o.workoutType = LEGACY_WORKOUT_TYPES[o.workoutType as string] ?? o.workoutType;
  if ((o.equipment as string) === 'Leg Press Machine') o.equipment = 'Machine';
}

function loadMetaOverrides(): Record<string, ExerciseMetaOverride> {
  try {
    const raw = localStorage.getItem(META_KEY);
    const overrides = raw ? JSON.parse(raw) as Record<string, ExerciseMetaOverride> : {};
    for (const o of Object.values(overrides)) normalizeOverride(o);
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

// Drops an exercise's metadata override — part of deleting the exercise, so a
// later sync merge can't carry its stale metadata back.
export function deleteExerciseMeta(id: string): void {
  const overrides = loadMetaOverrides();
  if (!(id in overrides)) return;
  delete overrides[id];
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
