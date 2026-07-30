// Domain taxonomy: the closed vocabularies every exercise is classified with.
// These are training-domain concepts (not storage concerns), so they live in
// data/ — the IndexedDB layer and UI both import from here.
// The option arrays are kept alphabetical — they render directly as dropdowns.

export type MuscleGroup =
  | 'Abductors' | 'Abs' | 'Adductors' | 'Biceps' | 'Calves' | 'Chest' | 'Delts'
  | 'Forearms' | 'Glutes' | 'Hamstrings' | 'Lats' | 'Lower Back'
  | 'Quads' | 'Traps' | 'Triceps' | 'Upper Back';

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
  'Forearms', 'Glutes', 'Hamstrings', 'Lats', 'Lower Back',
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
