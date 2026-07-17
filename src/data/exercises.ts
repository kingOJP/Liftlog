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

// `generateExerciseId(name)` stamps a custom ID as `${slug}-${Date.now()}`.
// When that slug is itself a catalog exercise (e.g. "Back Extensions" →
// `back-extensions-1782325116469`), the ID is really the catalog exercise
// wearing a timestamp. Strip a trailing `-<10+ digit timestamp>` and, if the
// base is a catalog id, return the canonical `ExerciseDef` — so muscle/metadata
// resolution, naming and the substitution profile all recognise it instead of
// treating it as an unclassified custom lift. Returns null when the id has no
// catalog namesake (a genuinely custom exercise).
export function catalogDefFor(id: string): ExerciseDef | null {
  const direct = EXERCISE_MAP.get(id);
  if (direct) return direct;
  const base = id.replace(/-\d{10,}$/, '');
  return base !== id ? (EXERCISE_MAP.get(base) ?? null) : null;
}

// ── Exercise difficulty + prerequisites ───────────────────────────────────────
// Difficulty is an *intrinsic* property of the movement (skill demand + injury
// risk), so it lives here in the app-owned catalog, not in the user-editable
// metadata layer — it's compiled in and never synced. It drives beginner-safe
// exercise selection in the planner: a novice is steered toward low-skill
// machine/dumbbell work; skill-heavy barbell lifts are gated behind their
// prerequisites (train the RDL before the pull deadlift).

export type ExerciseDifficulty = 'beginner' | 'intermediate' | 'advanced';

export const DIFFICULTY_RANK: Record<ExerciseDifficulty, number> = {
  beginner: 0, intermediate: 1, advanced: 2,
};

// Only exceptions to the default (intermediate) are listed. Beginner = machine
// or supported movements a first-timer can load safely on day one; advanced =
// free-weight lifts that reward a technique base and punish a missing one.
const DIFFICULTY: Record<string, ExerciseDifficulty> = {
  // Beginner — machines, cables, supported & low-skill free weights
  'cable-fly': 'beginner', 'machine-chest-press': 'beginner', 'pec-deck-fly': 'beginner',
  'dumbbell-fly': 'beginner', 'push-ups': 'beginner',
  'seated-db-overhead-press': 'beginner', 'machine-shoulder-press': 'beginner',
  'cable-lateral-raises': 'beginner', 'dumbbell-lateral-raises': 'beginner',
  'machine-lateral-raise': 'beginner', 'reverse-pec-deck': 'beginner',
  'dumbbell-rear-delt-fly': 'beginner', 'face-pulls': 'beginner',
  'barbell-shrugs': 'beginner', 'dumbbell-shrugs': 'beginner',
  'seated-cable-row': 'beginner', 'chest-supported-row': 'beginner',
  'lat-pull-down': 'beginner', 'straight-arm-pulldowns': 'beginner',
  'back-extensions': 'beginner',
  'overhead-tricep-ext': 'beginner', 'tricep-cable-pushdown': 'beginner',
  'cable-pushdown': 'beginner', 'cable-kick-backs': 'beginner',
  'incline-db-curls': 'beginner', 'hammer-curls': 'beginner', 'reverse-curls': 'beginner',
  'cable-curls': 'beginner', 'preacher-curls': 'beginner', 'wrist-curls': 'beginner',
  'leg-press': 'beginner', 'leg-extension': 'beginner',
  'seated-leg-curl': 'beginner', 'lying-leg-curl': 'beginner',
  'hack-squat': 'beginner', 'smith-machine-squat': 'beginner', 'goblet-squat': 'beginner',
  'leg-press-calf-raise': 'beginner', 'seated-calf-raises': 'beginner',
  'standing-calf-raises': 'beginner', 'cable-pull-through': 'beginner',
  'machine-crunch': 'beginner', 'cable-crunch': 'beginner',

  // Advanced — high skill / high axial load / gated behind prerequisites
  'conventional-deadlift': 'advanced', 'barbell-back-squat': 'advanced',
  'weighted-pull-ups': 'advanced', 'good-mornings': 'advanced',
  'hanging-leg-raise': 'advanced',
  // everything else (barbell/dumbbell pressing, rows, RDLs, hip thrusts,
  // dips, chin-ups, lunges) defaults to intermediate
};

// Advanced lifts a novice should earn: at least one prerequisite trained (or
// an intermediate+ profile) before the planner will program them.
const PREREQUISITES: Record<string, string[]> = {
  'conventional-deadlift': ['romanian-deadlifts', 'dumbbell-rdl'],
  'barbell-back-squat':    ['goblet-squat', 'leg-press', 'hack-squat'],
  'weighted-pull-ups':     ['chin-ups', 'lat-pull-down'],
  'good-mornings':         ['romanian-deadlifts', 'dumbbell-rdl'],
  'hanging-leg-raise':     ['machine-crunch', 'cable-crunch'],
};

export function difficultyFor(id: string): ExerciseDifficulty {
  const def = catalogDefFor(id);
  return (def && DIFFICULTY[def.id]) ?? 'intermediate';
}

export function prerequisitesFor(id: string): string[] {
  const def = catalogDefFor(id);
  return (def && PREREQUISITES[def.id]) ?? [];
}

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

// Parse-cache keyed on the raw stored string: getExerciseMeta/profileFor are
// called per exercise in hot loops (candidate ranking, the planner, muscle
// resolution), and re-parsing the whole override blob each time is the single
// biggest repeated cost. Keying on the raw string keeps every write path —
// including direct localStorage writes in tests and the account-switch wipe —
// naturally cache-coherent without explicit invalidation.
let metaCacheRaw: string | null = null;
let metaCache: Record<string, ExerciseMetaOverride> = {};

function loadMetaOverrides(): Record<string, ExerciseMetaOverride> {
  const raw = localStorage.getItem(META_KEY);
  if (raw === metaCacheRaw) return metaCache;
  let overrides: Record<string, ExerciseMetaOverride>;
  try {
    overrides = raw ? JSON.parse(raw) as Record<string, ExerciseMetaOverride> : {};
    for (const o of Object.values(overrides)) normalizeOverride(o);
  } catch {
    overrides = {};
  }
  metaCacheRaw = raw;
  metaCache = overrides;
  return overrides;
}

// ── Layer 1: admin-curated global metadata (read-only, replaced on pull) ─────
// Served by the worker from global_exercise_metadata. Sits between the user's
// own overrides and the compiled-in catalog: catalog < global < user. Kept in
// a separate key so global improvements keep flowing without ever freezing
// into (or clobbering) the user's personal overrides.

const GLOBAL_META_KEY = 'liftlog_global_meta';

// Same raw-string parse-cache as loadMetaOverrides (see comment there).
let globalCacheRaw: string | null = null;
let globalCache: Record<string, ExerciseMetaOverride> = {};

function loadGlobalMeta(): Record<string, ExerciseMetaOverride> {
  const raw = localStorage.getItem(GLOBAL_META_KEY);
  if (raw === globalCacheRaw) return globalCache;
  let meta: Record<string, ExerciseMetaOverride>;
  try {
    meta = raw ? JSON.parse(raw) as Record<string, ExerciseMetaOverride> : {};
    for (const o of Object.values(meta)) normalizeOverride(o);
  } catch {
    meta = {};
  }
  globalCacheRaw = raw;
  globalCache = meta;
  return meta;
}

// The server is authoritative for the global layer — whole-document replace.
export function saveGlobalExerciseMeta(meta: Record<string, ExerciseMetaOverride>): void {
  localStorage.setItem(GLOBAL_META_KEY, JSON.stringify(meta));
}

export function getExerciseMeta(id: string): ExerciseMetaOverride {
  const overrides = loadMetaOverrides();
  if (overrides[id]) return overrides[id];

  const globalMeta = loadGlobalMeta();
  if (globalMeta[id]) return globalMeta[id];

  // Fall back to the catalog def, recognising timestamped custom ids whose
  // slug is a catalog exercise (back-extensions-1782… → back-extensions).
  const def = catalogDefFor(id);
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

// Account switch: metadata overrides are user-owned — wipe them so one
// account's personalization can't color another's coaching. The global layer
// is application-owned and survives.
export function clearExerciseMeta(): void {
  localStorage.removeItem(META_KEY);
}
