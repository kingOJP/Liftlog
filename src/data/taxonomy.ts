// Domain taxonomy: the closed vocabularies every exercise is classified with.
// These are training-domain concepts (not storage concerns), so they live in
// data/ — the IndexedDB layer and UI both import from here.
// The option arrays are kept alphabetical — they render directly as dropdowns.

export type MuscleGroup =
  | 'Abductors' | 'Abs' | 'Adductors' | 'Biceps' | 'Calves' | 'Chest' | 'Delts'
  | 'Forearms' | 'Glutes' | 'Hamstrings' | 'Lats' | 'Lower Back' | 'Obliques'
  | 'Quads' | 'Traps' | 'Triceps' | 'Upper Back';

// ── Tiers of muscle tracking ─────────────────────────────────────────────────
// Three tiers, from coarsest to finest. MuscleGroup (above) is the *middle*
// tier — the one every engine already operates at (volume targets, heatmap,
// splits, substitution matching, priority muscles, synced metadata) — and it
// stays that way; this isn't a breaking rename, it's the layers above and
// below it becoming explicit.
//
//   Tier 1  Region        Chest / Back / Shoulders / Arms / Core / Legs
//           — purely organizational grouping of MuscleGroups, for pickers
//           and displays that want to talk about "legs" without committing
//           to a specific muscle. No volume target of its own.
//
//   Tier 2  MuscleGroup    Chest, Lats, Traps, Quads, Hamstrings, ...
//           — the level every engine already reasons about: what a lifter
//           programs and recovers as a unit, what the heatmap colors, what
//           carries a 10–20 (or goal-specific) weekly-set target.
//
//   Tier 3  MuscleHead     Front Delt, Long Head (biceps), Vastus Lateralis...
//           — anatomically distinct heads *within* a single MuscleGroup, for
//           muscles where exercise selection actually differentiates them
//           (a deltoid has three heads; a lat doesn't have a meaningful
//           "upper lat" vs "lower lat" split a program would act on). Not
//           surfaced in the main UI and not a volume-target level — it's
//           compiled catalog data (see exercises.ts MUSCLE_HEADS/headsFor),
//           the same footing as difficulty/prerequisites, kept for future
//           holistic-planning use (e.g. "your rear delts are undertrained
//           even though total delt volume looks fine").

export type MuscleRegion = 'Arms' | 'Back' | 'Chest' | 'Core' | 'Legs' | 'Shoulders';

export const MUSCLE_REGIONS: MuscleRegion[] = ['Arms', 'Back', 'Chest', 'Core', 'Legs', 'Shoulders'];

const REGION_OF: Record<MuscleGroup, MuscleRegion> = {
  Chest: 'Chest',
  Delts: 'Shoulders',
  Lats: 'Back', 'Upper Back': 'Back', 'Lower Back': 'Back', Traps: 'Back',
  Biceps: 'Arms', Triceps: 'Arms', Forearms: 'Arms',
  Abs: 'Core', Obliques: 'Core',
  Quads: 'Legs', Hamstrings: 'Legs', Glutes: 'Legs', Calves: 'Legs',
  Abductors: 'Legs', Adductors: 'Legs',
};

/** Which Tier-1 region a Tier-2 muscle group belongs to. */
export function regionFor(muscle: MuscleGroup): MuscleRegion {
  return REGION_OF[muscle];
}

// Tier 3 — see the comment block above. The vocabulary is muscle-specific
// (a head name only makes sense relative to its MuscleGroup), so there's no
// closed cross-muscle union — just a label string. Defined here as a type
// alias so it reads as a taxonomy concept; the actual vocabulary and the
// per-exercise assignments live in exercises.ts, compiled catalog data like
// difficulty and prerequisites.
export type MuscleHead = string;

// The specific movement family an exercise belongs to — same job "WorkoutType"
// always had (substitution matching, slot templates), renamed because that's
// what it actually is. The ExerciseDef/metadata *field* stays `workoutType`
// for wire/schema compatibility (JSON keys and the D1 column are unchanged);
// only the type name and vocabulary change.
//
// One correction from the old flat list: 'Press' used to span two different
// planes — bench-style horizontal pressing and overhead-style vertical
// pressing — the one real inconsistency in an otherwise-consistent list (Row,
// Pull Down and Pull Up were already kept distinct by plane). Split here.
export type MovementPattern =
  | 'Abduction' | 'Anti-Rotation' | 'Calf Raise' | 'Carry' | 'Crunch' | 'Curl' | 'Dip'
  | 'Face Pull' | 'Fly' | 'Hip Hinge' | 'Hip Thrust' | 'Horizontal Press' | 'Jump'
  | 'Lateral Raise' | 'Leg Curl' | 'Leg Extension' | 'Leg Press' | 'Lunge' | 'Plank'
  | 'Pull Down' | 'Pull Over' | 'Pull Up' | 'Reverse Fly' | 'Rotation' | 'Row'
  | 'Shrug' | 'Squat' | 'Tricep Extension' | 'Vertical Press';

// ── Movement category (Tier 1) ───────────────────────────────────────────────
// A coarser layer above MovementPattern, for the same reason Region sits above
// MuscleGroup: MovementPattern is the right altitude for "find a similar
// exercise" (Row and Pull Down are genuinely different movements), but most
// of its ~28 values have only 1–3 exercises — too few to say anything about a
// *trend*. "Is my Face Pull number going up" is just that exercise's own
// progress restated; "is my Push pattern going up" aggregates enough
// exercises to be a real signal, the same mental model lifters already use
// for squat/bench/deadlift/press trends.
//
// Compiled catalog data (patternCategoryFor below), not user-editable, not
// synced — the same footing as MuscleHead. 'Isolation' is a deliberate
// catch-all: every pattern needs a category, but a bicep curl and a calf
// raise trending on the same line isn't a meaningful signal, so isolation
// work is bucketed together without being treated as trend-worthy itself.
export type MovementCategory =
  | 'Carry' | 'Core' | 'Hinge' | 'Isolation' | 'Power' | 'Pull' | 'Push' | 'Squat';

export const MOVEMENT_CATEGORIES: MovementCategory[] = [
  'Carry', 'Core', 'Hinge', 'Isolation', 'Power', 'Pull', 'Push', 'Squat',
];

const CATEGORY_OF: Record<MovementPattern, MovementCategory> = {
  Squat: 'Squat', 'Leg Press': 'Squat', Lunge: 'Squat',
  'Hip Hinge': 'Hinge', 'Hip Thrust': 'Hinge',
  'Horizontal Press': 'Push', 'Vertical Press': 'Push', Dip: 'Push',
  Row: 'Pull', 'Pull Down': 'Pull', 'Pull Up': 'Pull', 'Pull Over': 'Pull', 'Face Pull': 'Pull',
  Crunch: 'Core', 'Anti-Rotation': 'Core', Plank: 'Core',
  Carry: 'Carry',
  Jump: 'Power',
  Curl: 'Isolation', 'Tricep Extension': 'Isolation', Fly: 'Isolation',
  'Reverse Fly': 'Isolation', 'Lateral Raise': 'Isolation', 'Leg Extension': 'Isolation',
  'Leg Curl': 'Isolation', 'Calf Raise': 'Isolation', Abduction: 'Isolation',
  Shrug: 'Isolation', Rotation: 'Isolation',
};

/** Which Tier-1 movement category a Tier-2 movement pattern rolls up into. */
export function patternCategoryFor(pattern: MovementPattern): MovementCategory {
  return CATEGORY_OF[pattern];
}

// How one set of an exercise is counted. Absent on an exercise means 'reps' —
// every pre-existing catalog row and user override keeps its meaning untouched.
// Isometric and carry work (planks, dead hangs, loaded carries) is held for
// time, so the logger, charts and the progression engine need to know which
// number they are looking at rather than calling seconds "reps".
export type MeasureUnit = 'reps' | 'seconds';

export const MEASURE_UNITS: MeasureUnit[] = ['reps', 'seconds'];

/** Short label for a set's count, e.g. "12 reps" / "45 sec". */
export function unitLabel(unit: MeasureUnit, plural = true): string {
  if (unit === 'seconds') return 'sec';
  return plural ? 'reps' : 'rep';
}

export type Equipment =
  | 'Bench' | 'Cable Machine' | 'Dip Station' | 'Machine' | 'None'
  | 'Pull Up Bar' | 'Smith Machine' | 'Squat Rack';

export type WeightType =
  | 'Barbell' | 'Bodyweight' | 'Dumbbell' | 'EZ Bar'
  | 'Kettlebell' | 'Machine' | 'Resistance Band';

export const MUSCLE_GROUPS: MuscleGroup[] = [
  'Abductors', 'Abs', 'Adductors', 'Biceps', 'Calves', 'Chest', 'Delts',
  'Forearms', 'Glutes', 'Hamstrings', 'Lats', 'Lower Back', 'Obliques',
  'Quads', 'Traps', 'Triceps', 'Upper Back',
];

export const MOVEMENT_PATTERNS: MovementPattern[] = [
  'Abduction', 'Anti-Rotation', 'Calf Raise', 'Carry', 'Crunch', 'Curl', 'Dip',
  'Face Pull', 'Fly', 'Hip Hinge', 'Hip Thrust', 'Horizontal Press', 'Jump',
  'Lateral Raise', 'Leg Curl', 'Leg Extension', 'Leg Press', 'Lunge', 'Plank',
  'Pull Down', 'Pull Over', 'Pull Up', 'Reverse Fly', 'Rotation', 'Row',
  'Shrug', 'Squat', 'Tricep Extension', 'Vertical Press',
];

export const EQUIPMENT_OPTIONS: Equipment[] = [
  'Bench', 'Cable Machine', 'Dip Station', 'Machine', 'None',
  'Pull Up Bar', 'Smith Machine', 'Squat Rack',
];

export const WEIGHT_TYPES: WeightType[] = [
  'Barbell', 'Bodyweight', 'Dumbbell', 'EZ Bar',
  'Kettlebell', 'Machine', 'Resistance Band',
];
