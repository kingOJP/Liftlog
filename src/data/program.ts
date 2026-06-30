import { EXERCISE_MAP } from './exercises';

export interface Exercise {
  id: string;
  name: string;
  sets: number;
  repLow: number;
  repHigh: number;
  archived?: boolean;
}

export interface WorkoutDay {
  id: number;
  label: string;
  muscleGroups: string;
  exercises: Exercise[];
}

export const PROGRAM: WorkoutDay[] = [
  {
    id: 1,
    label: 'Day 1',
    muscleGroups: 'Chest, Tris, Shoulders',
    exercises: [
      { id: 'incline-barbell-press',    name: 'Incline Barbell Press',          sets: 4, repLow: 6,  repHigh: 8  },
      { id: 'dumbbell-bench-press',     name: 'Dumbbell Bench Press',           sets: 3, repLow: 8,  repHigh: 10 },
      { id: 'seated-db-overhead-press', name: 'Seated Dumbbell Overhead Press', sets: 3, repLow: 8,  repHigh: 10 },
      { id: 'cable-lateral-raises',     name: 'Cable Lateral Raises',           sets: 4, repLow: 16, repHigh: 20 },
      { id: 'overhead-tricep-ext',      name: 'Overhead Tricep Extension',      sets: 3, repLow: 10, repHigh: 12 },
      { id: 'tricep-cable-pushdown',    name: 'Tricep Cable Pushdown',          sets: 3, repLow: 12, repHigh: 15 },
    ],
  },
  {
    id: 2,
    label: 'Day 2',
    muscleGroups: 'Back, Biceps, Rear Delts',
    exercises: [
      { id: 'face-pulls',               name: 'Face Pulls',                     sets: 3, repLow: 15, repHigh: 20 },
      { id: 'straight-arm-pulldowns',   name: 'Straight Arm Pull Downs',        sets: 3, repLow: 10, repHigh: 14 },
      { id: 'lat-pull-down',            name: 'Lat Pull Down',                  sets: 3, repLow: 10, repHigh: 12 },
      { id: 'bent-over-db-row',         name: 'Bent Over One Arm Dumbbell Row', sets: 4, repLow: 8,  repHigh: 10 },
      { id: 'incline-db-curls',         name: 'Incline Dumbbell Curls',         sets: 3, repLow: 10, repHigh: 12 },
      { id: 'hammer-curls',             name: 'Hammer Curls',                   sets: 3, repLow: 12, repHigh: 15 },
    ],
  },
  {
    id: 3,
    label: 'Day 3',
    muscleGroups: 'Legs',
    exercises: [
      { id: 'seated-calf-raises',       name: 'Seated Calf Raises',             sets: 3, repLow: 20, repHigh: 25 },
      { id: 'romanian-deadlifts',       name: 'Romanian Deadlifts',             sets: 4, repLow: 8,  repHigh: 12 },
      { id: 'leg-press',                name: 'Leg Press',                      sets: 4, repLow: 8,  repHigh: 12 },
      { id: 'leg-extension',            name: 'Leg Extension',                  sets: 3, repLow: 12, repHigh: 15 },
      { id: 'hip-thrusts',              name: 'Hip Thrusts',                    sets: 3, repLow: 10, repHigh: 12 },
      { id: 'standing-calf-raises',     name: 'Standing Calf Raises',           sets: 4, repLow: 15, repHigh: 20 },
    ],
  },
  {
    id: 4,
    label: 'Day 4',
    muscleGroups: 'Upper Body',
    exercises: [
      { id: 'cable-fly',                name: 'Cable Fly',                      sets: 3, repLow: 12, repHigh: 15 },
      { id: 'weighted-pull-ups',        name: 'Weighted Pull Ups',              sets: 4, repLow: 6,  repHigh: 10 },
      { id: 'cable-lateral-raises',     name: 'Cable Lateral Raises',           sets: 4, repLow: 16, repHigh: 20 },
      { id: 'tricep-cable-pushdown',    name: 'Tricep Cable Pushdown',          sets: 3, repLow: 12, repHigh: 15 },
      { id: 'back-extensions',          name: 'Back Extensions',                sets: 3, repLow: 15, repHigh: 20 },
      { id: 'reverse-curls',            name: 'Reverse Curls',                  sets: 2, repLow: 12, repHigh: 15 },
      { id: 'face-pulls',               name: 'Face Pulls',                     sets: 3, repLow: 15, repHigh: 20 },
    ],
  },
];

export function getExerciseName(id: string): string {
  return EXERCISE_MAP.get(id)?.name ?? id;
}

// First Monday of your current training block — make this user-configurable later
export const PROGRAM_START = new Date('2026-06-09');

export function getWeekNumberForDate(date: Date): number {
  const start = new Date(PROGRAM_START);
  start.setHours(0, 0, 0, 0);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.max(1, Math.floor((date.getTime() - start.getTime()) / msPerWeek) + 1);
}

export function getWeekNumber(): number {
  return getWeekNumberForDate(new Date());
}

export function getWeekDateRange(): string {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const monthName = (d: Date) => d.toLocaleString('en-US', { month: 'long' });

  if (monday.getMonth() === sunday.getMonth()) {
    return `${monthName(monday)} ${monday.getDate()}–${sunday.getDate()}`;
  }
  return `${monthName(monday)} ${monday.getDate()}–${monthName(sunday)} ${sunday.getDate()}`;
}
