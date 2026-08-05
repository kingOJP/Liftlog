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

export type WorkoutType =
  | 'Abduction' | 'Anti-Rotation' | 'Calf Raise' | 'Carry' | 'Crunch' | 'Curl' | 'Dip'
  | 'Face Pull' | 'Fly' | 'Hip Hinge' | 'Hip Thrust' | 'Jump' | 'Lateral Raise'
  | 'Leg Curl' | 'Leg Extension' | 'Leg Press' | 'Lunge' | 'Plank' | 'Press'
  | 'Pull Down' | 'Pull Over' | 'Pull Up' | 'Reverse Fly' | 'Rotation' | 'Row'
  | 'Shrug' | 'Squat' | 'Tricep Extension';

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

export const WORKOUT_TYPES: WorkoutType[] = [
  'Abduction', 'Anti-Rotation', 'Calf Raise', 'Carry', 'Crunch', 'Curl', 'Dip',
  'Face Pull', 'Fly', 'Hip Hinge', 'Hip Thrust', 'Jump', 'Lateral Raise',
  'Leg Curl', 'Leg Extension', 'Leg Press', 'Lunge', 'Plank', 'Press',
  'Pull Down', 'Pull Over', 'Pull Up', 'Reverse Fly', 'Rotation', 'Row',
  'Shrug', 'Squat', 'Tricep Extension',
];

export const EQUIPMENT_OPTIONS: Equipment[] = [
  'Bench', 'Cable Machine', 'Dip Station', 'Machine', 'None',
  'Pull Up Bar', 'Smith Machine', 'Squat Rack',
];

export const WEIGHT_TYPES: WeightType[] = [
  'Barbell', 'Bodyweight', 'Dumbbell', 'EZ Bar',
  'Kettlebell', 'Machine', 'Resistance Band',
];
