import { EXERCISE_MAP } from './exercises';
import { getProgramStart } from './settings';
import type { PhaseKind } from './plan';

/**
 * A programmed exercise — one slot in a workout day. Carries the PRESCRIPTION
 * (sets and rep range) as well as the movement's identity, because that is what
 * a slot is: "conventional deadlift, 3 × 5–8, this Tuesday".
 */
export interface Exercise {
  id: string;
  name: string;
  sets: number;
  /**
   * The rep range to work in. Optional, and genuinely absent for ad-hoc work
   * the coach has nothing to prescribe from — a movement logged in a quick
   * workout by someone with no plan and no history with it. Showing no target
   * is honest there; inventing 8–12 is what this whole change removes.
   */
  repLow?: number;
  repHigh?: number;
  archived?: boolean;
}

/**
 * A movement in the user's exercise library — identity only.
 *
 * Deliberately carries NO sets/rep range. A rep range is a property of a
 * prescription, not of a movement: the same deadlift is 3 × 5–8 in a
 * hypertrophy block and 4 × 3–5 in a strength block. Storing a range on the
 * library entry is what let a barbell deadlift wander around the app carrying a
 * default 3 × 8–12 that no goal ever chose. Dosage is resolved at the point of
 * use by `data/dosage.ts`.
 *
 * The sets/repLow/repHigh fields are still accepted on the wire (older clients
 * and the server's exercise tables still send them) but are never read.
 */
export interface LibraryExercise {
  id: string;
  name: string;
  archived?: boolean;
  /** @deprecated wire-compatibility only — never read; see data/dosage.ts */
  sets?: number;
  /** @deprecated wire-compatibility only — never read; see data/dosage.ts */
  repLow?: number;
  /** @deprecated wire-compatibility only — never read; see data/dosage.ts */
  repHigh?: number;
}

export interface WorkoutDay {
  id: number;
  label: string;
  muscleGroups: string;
  exercises: Exercise[];
  /**
   * Weeks this day is programmed for, by block phase. Absent — the case for
   * every day of a normal lifting block — means "every week".
   *
   * This is how a lifting taper is actually enforced rather than merely
   * described: a sport-support block programs three days during its build
   * weeks, drops the short power session once maintenance starts, and runs a
   * single session through the taper and race week. Rides the program document,
   * so it syncs with everything else for free.
   */
  phases?: PhaseKind[];
}

/** Is this day programmed for the given week's phase? */
export function dayInPhase(day: WorkoutDay, phase: PhaseKind | null): boolean {
  if (!day.phases || day.phases.length === 0) return true;
  // No phase resolved (open-ended block, or between blocks) — show everything
  // rather than hiding workouts the user can still choose to run.
  if (phase == null) return true;
  return day.phases.includes(phase);
}

// The original owner's 4-day split. No longer anyone's starting program — new
// accounts begin with a blank slate and build their first program through the
// plan wizard, and the exercise library no longer seeds sets/reps from it
// (dosage is resolved per prescription; see data/dosage.ts). Kept as a
// reference layout and for the tests that exercise a realistic program.
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
    muscleGroups: 'Back, Biceps, Delts',
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

/**
 * "3 × 8–12", or "3 sets" when the slot carries no rep range. Every surface
 * that shows a slot's dose goes through here, so an unprescribed exercise never
 * renders as "3 × undefined–undefined" (or, worse, an invented 8–12).
 */
export function prescriptionLabel(ex: Pick<Exercise, 'sets' | 'repLow' | 'repHigh'>): string {
  return ex.repLow != null && ex.repHigh != null
    ? `${ex.sets} × ${ex.repLow}–${ex.repHigh}`
    : `${ex.sets} set${ex.sets === 1 ? '' : 's'}`;
}

/** "3 sets · 8–12 reps", or "3 sets" when unprescribed — the long form. */
export function prescriptionDetail(ex: Pick<Exercise, 'sets' | 'repLow' | 'repHigh'>): string {
  const sets = `${ex.sets} set${ex.sets === 1 ? '' : 's'}`;
  return ex.repLow != null && ex.repHigh != null
    ? `${sets} · ${ex.repLow}–${ex.repHigh} reps`
    : sets;
}

// ── Calendar weeks (Monday-anchored) ─────────────────────────────────────────
// The *calendar* week a date falls in, independent of any program anchor. This
// is what every week-bucketed analytic groups by: a session's stored
// `weekNumber` is computed from the week anchor in force when it was logged,
// and that anchor moves (every block activation re-anchors it), so two sessions
// from the same real week can carry different numbers — and two sessions months
// apart can collide on the same one. Wall-clock Mondays never drift.

/** Monday 00:00 local time of the week containing `date`, as a timestamp. */
export function startOfWeek(date: Date | number): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.getTime();
}

/** `n` weeks after a week-start timestamp — calendar math, so DST can't drift it. */
export function addWeeks(weekStart: number, n: number): number {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + n * 7);
  return d.getTime();
}

/** Whole weeks between two week starts (b − a). */
export function weeksBetween(a: number, b: number): number {
  return Math.round((b - a) / (7 * 86_400_000));
}

/** "7/27" — the Monday that starts the week, how the volume chart labels bars. */
export function weekStartLabel(weekStart: number): string {
  return new Date(weekStart).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
}

// Program week numbering is anchored to the training-block start date (managed
// by the journey). The anchor is snapped back to the Monday of that week so
// week numbers roll over on Monday — matching the Mon–Sun range the dashboard
// displays — even when the start date itself falls mid-week.
export function getWeekNumberForDate(date: Date, programStart = getProgramStart()): number {
  const start = startOfWeek(programStart);
  const current = new Date(date);
  current.setHours(0, 0, 0, 0);

  // Count whole days (rounded, so DST's 23/25-hour days can't drift the boundary)
  const days = Math.round((current.getTime() - start) / 86_400_000);
  return Math.max(1, Math.floor(days / 7) + 1);
}

export function getWeekNumber(): number {
  return getWeekNumberForDate(new Date());
}

export function getWeekDateRange(): string {
  const monday = new Date(startOfWeek(Date.now()));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const monthName = (d: Date) => d.toLocaleString('en-US', { month: 'long' });

  if (monday.getMonth() === sunday.getMonth()) {
    return `${monthName(monday)} ${monday.getDate()}–${sunday.getDate()}`;
  }
  return `${monthName(monday)} ${monday.getDate()}–${monthName(sunday)} ${sunday.getDate()}`;
}
