// Domain taxonomy: the closed vocabularies every exercise is classified with.
// These are training-domain concepts (not storage concerns), so they live in
// data/ — the IndexedDB layer and UI both import from here.
// The option arrays are kept alphabetical — they render directly as dropdowns.

export type MuscleGroup =
  | 'Abs' | 'Biceps' | 'Calves' | 'Chest' | 'Delts'
  | 'Forearms' | 'Glutes' | 'Hamstrings' | 'Lats' | 'Lower Back'
  | 'Quads' | 'Traps' | 'Triceps' | 'Upper Back';

export type WorkoutType =
  | 'Calf Raise' | 'Crunch' | 'Curl' | 'Dip' | 'Face Pull' | 'Fly'
  | 'Hip Hinge' | 'Hip Thrust' | 'Lateral Raise' | 'Leg Curl'
  | 'Leg Extension' | 'Leg Press' | 'Lunge' | 'Press'
  | 'Pull Down' | 'Pull Over' | 'Pull Up' | 'Reverse Fly' | 'Row'
  | 'Shrug' | 'Squat' | 'Tricep Extension';

export type Equipment =
  | 'Bench' | 'Cable Machine' | 'Dip Station' | 'Machine' | 'None'
  | 'Pull Up Bar' | 'Smith Machine' | 'Squat Rack';

export type WeightType =
  | 'Barbell' | 'Bodyweight' | 'Dumbbell' | 'EZ Bar'
  | 'Kettlebell' | 'Machine' | 'Resistance Band';

export const MUSCLE_GROUPS: MuscleGroup[] = [
  'Abs', 'Biceps', 'Calves', 'Chest', 'Delts',
  'Forearms', 'Glutes', 'Hamstrings', 'Lats', 'Lower Back',
  'Quads', 'Traps', 'Triceps', 'Upper Back',
];

export const WORKOUT_TYPES: WorkoutType[] = [
  'Calf Raise', 'Crunch', 'Curl', 'Dip', 'Face Pull', 'Fly',
  'Hip Hinge', 'Hip Thrust', 'Lateral Raise', 'Leg Curl',
  'Leg Extension', 'Leg Press', 'Lunge', 'Press',
  'Pull Down', 'Pull Over', 'Pull Up', 'Reverse Fly', 'Row',
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
