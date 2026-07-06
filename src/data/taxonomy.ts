// Domain taxonomy: the closed vocabularies every exercise is classified with.
// These are training-domain concepts (not storage concerns), so they live in
// data/ — the IndexedDB layer and UI both import from here.

export type MuscleGroup =
  | 'Chest' | 'Upper Back' | 'Lats' | 'Lower Back'
  | 'Front Delts' | 'Side Delts' | 'Rear Delts'
  | 'Triceps' | 'Biceps' | 'Forearms' | 'Traps'
  | 'Quads' | 'Hamstrings' | 'Glutes' | 'Calves' | 'Abs';

export type WorkoutType =
  | 'Chest Press' | 'Row' | 'Pull Down' | 'Overhead Press'
  | 'Curl' | 'Tricep Extension' | 'Lateral Raise' | 'Fly'
  | 'Squat' | 'Hip Hinge' | 'Leg Press' | 'Leg Curl'
  | 'Leg Extension' | 'Calf Raise' | 'Hip Thrust' | 'Face Pull'
  | 'Pull Up' | 'Push Up';

export type Equipment =
  | 'Bench' | 'Cable Machine' | 'Squat Rack' | 'Machine'
  | 'Smith Machine' | 'Pull Up Bar' | 'None';

export type WeightType =
  | 'Barbell' | 'Dumbbell' | 'Machine' | 'Bodyweight'
  | 'EZ Bar' | 'Kettlebell' | 'Resistance Band';

export const MUSCLE_GROUPS: MuscleGroup[] = [
  'Chest', 'Upper Back', 'Lats', 'Lower Back',
  'Front Delts', 'Side Delts', 'Rear Delts',
  'Triceps', 'Biceps', 'Forearms', 'Traps',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs',
];

export const WORKOUT_TYPES: WorkoutType[] = [
  'Chest Press', 'Row', 'Pull Down', 'Overhead Press',
  'Curl', 'Tricep Extension', 'Lateral Raise', 'Fly',
  'Squat', 'Hip Hinge', 'Leg Press', 'Leg Curl',
  'Leg Extension', 'Calf Raise', 'Hip Thrust', 'Face Pull',
  'Pull Up', 'Push Up',
];

export const EQUIPMENT_OPTIONS: Equipment[] = [
  'Bench', 'Cable Machine', 'Squat Rack', 'Machine',
  'Smith Machine', 'Pull Up Bar', 'None',
];

export const WEIGHT_TYPES: WeightType[] = [
  'Barbell', 'Dumbbell', 'Machine', 'Bodyweight',
  'EZ Bar', 'Kettlebell', 'Resistance Band',
];
