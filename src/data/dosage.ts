// THE prescription resolver — how many sets, in what rep range, for one
// exercise in one context.
//
// This used to live in two incompatible places: `dosage()` inside the planner
// (goal-aware, only ever run when a plan was built) and a hardcoded
// `{ sets: 3, repLow: 8, repHigh: 12 }` scattered across the library seed, the
// day editor, the mid-workout add panel and the worker's exercise-promotion
// path. The result was that an exercise entering your program by any route
// other than the plan wizard carried a rep range nobody chose — a barbell
// deadlift got the same 3×8–12 as a cable row, whatever you were training for.
//
// A rep range is a property of a PRESCRIPTION, not of a movement. The movement
// is "conventional deadlift"; the prescription is "3 × 5–8, because you're
// chasing hypertrophy and this is a heavy axial pull". So dosage is computed
// here, from (goal, athlete, movement, slot), and never stored on the exercise.
//
// Pure functions only — no store reads, no history loads. Callers supply the
// context, which keeps this testable and free of import cycles with planStore.

import type { Exercise } from './program';
import type { Goal, ExperienceLevel } from './plan';
import type { WorkoutType } from './taxonomy';
import type { ExerciseProfile } from './substitution';

/** sets × rep range — the prescription, without the exercise it belongs to. */
export type RepPrescription = Pick<Exercise, 'sets' | 'repLow' | 'repHigh'>;

/** The parts of a program slot that change the dose. */
export interface DosageSlot {
  /** the day's heavy anchor — more sets, lower reps */
  main?: boolean;
}

// Movements whose stimulus lives at high reps: small muscles, long ranges, and
// loads too light for the rep count to matter much.
const HIGH_REP_PATTERNS = new Set<WorkoutType>([
  'Lateral Raise', 'Calf Raise', 'Face Pull', 'Reverse Fly', 'Crunch',
]);

// Heavy axial patterns — the barbell hinge and squat families. These load the
// spine directly and cost far more systemic fatigue per rep than any other
// compound, and technique is the first thing to go as a set drags on. A set of
// 12 deadlifts is not "a set of 12" in the way a set of 12 rows is.
const HEAVY_AXIAL_PATTERNS = new Set<WorkoutType>(['Hip Hinge', 'Squat']);

/**
 * A barbell hinge or squat. The barbell condition matters: a cable pull-through
 * and a 45° hip extension are both Hip Hinge, but neither loads the spine the
 * way a deadlift does, and neither earns the lower rep range.
 */
export function isHeavyAxial(profile: ExerciseProfile): boolean {
  return profile.weightType === 'Barbell' &&
    profile.workoutType != null &&
    HEAVY_AXIAL_PATTERNS.has(profile.workoutType);
}

/**
 * The dose for an exercise in a slot, given the plan's goal and the athlete.
 * The single source of truth — the planner, the day editor, the mid-workout add
 * panel and quick workouts all resolve through here.
 */
export function dosage(
  goal: Goal,
  slot: DosageSlot,
  profile: ExerciseProfile,
  experience: ExperienceLevel,
): RepPrescription {
  if (profile.workoutType && HIGH_REP_PATTERNS.has(profile.workoutType)) {
    return experience === 'beginner'
      ? { sets: 2, repLow: 12, repHigh: 20 }
      : { sets: 3, repLow: 12, repHigh: 20 };
  }
  const compound = profile.mechanics === 'compound';

  // Beginners: submaximal loads, moderate reps, and fewer sets. Rep ranges
  // never drop below 8 — a novice building technique should not be grinding
  // near-maximal singles/triples, whatever their stated goal, and that holds on
  // the axial lifts too. Lower set counts keep total volume in the range a new
  // lifter actually recovers from.
  if (experience === 'beginner') {
    if (slot.main && compound) return { sets: 3, repLow: 8, repHigh: 12 };
    if (compound) return { sets: 2, repLow: 8, repHigh: 12 };
    return { sets: 2, repLow: 10, repHigh: 15 };
  }

  // Heavy axial work is capped well below the other compounds. Chasing a rep
  // total of 3×12 on a deadlift buys a lot of spinal fatigue and degraded bar
  // paths for stimulus you could get more cheaply elsewhere — which is exactly
  // why every serious programme keeps the pull in the 3–8 region.
  if (isHeavyAxial(profile)) {
    if (goal === 'strength') return { sets: 4, repLow: 3, repHigh: 5 };
    if (goal === 'athletic') return { sets: 4, repLow: 4, repHigh: 6 };
    return { sets: 3, repLow: 5, repHigh: 8 };
  }

  if (slot.main && compound) {
    if (goal === 'strength') return { sets: 4, repLow: 4, repHigh: 6 };
    if (goal === 'athletic') return { sets: 4, repLow: 5, repHigh: 8 };
    if (goal === 'hypertrophy') return { sets: 3, repLow: 6, repHigh: 10 };
    return { sets: 3, repLow: 8, repHigh: 12 };
  }
  if (compound) {
    return goal === 'strength'
      ? { sets: 3, repLow: 6, repHigh: 10 }
      : { sets: 3, repLow: 8, repHigh: 12 };
  }
  // isolation
  if (goal === 'strength') return { sets: 3, repLow: 8, repHigh: 12 };
  if (goal === 'hypertrophy') return { sets: 3, repLow: 10, repHigh: 15 };
  return { sets: 3, repLow: 12, repHigh: 15 };
}

// ── History-derived prescription ─────────────────────────────────────────────

/** Minimal shape of a past session — just the working sets that were logged. */
export interface DosageHistorySession {
  sets: { reps: number }[];
}

/** Sessions read when inferring a range from what the lifter actually does. */
const HISTORY_SAMPLE_SESSIONS = 3;
/** Half-width of the derived range around the lifter's typical reps. */
const DERIVED_RANGE_SPREAD = 2;
const MIN_SETS = 2;
const MAX_SETS = 5;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * The range this lifter actually works this movement in, read off their own
 * log. Used when there's no plan to prescribe from: inventing 8–12 would be a
 * guess, but "you do about 10 reps for 3 sets" is data.
 *
 * @param history newest-first sessions of this exercise; empty → null
 */
export function rangeFromHistory(history: DosageHistorySession[]): RepPrescription | null {
  const recent = history.filter(h => h.sets.length > 0).slice(0, HISTORY_SAMPLE_SESSIONS);
  if (recent.length === 0) return null;

  const typicalReps = median(recent.flatMap(h => h.sets.map(s => s.reps)));
  const typicalSets = median(recent.map(h => h.sets.length));

  return {
    sets: Math.min(MAX_SETS, Math.max(MIN_SETS, Math.round(typicalSets))),
    repLow: Math.max(1, typicalReps - DERIVED_RANGE_SPREAD),
    repHigh: typicalReps + DERIVED_RANGE_SPREAD,
  };
}

// ── The cascade ──────────────────────────────────────────────────────────────

export interface PrescriptionInput {
  /** The exercise, normalized (substitution.profileFor) */
  profile: ExerciseProfile;
  /** The slot it occupies, when it has one */
  slot?: DosageSlot;
  /** The active plan's goal — null when the user has no plan */
  goal: Goal | null;
  experience: ExperienceLevel;
  /** This exercise's own recent sessions, newest first */
  history?: DosageHistorySession[];
}

/**
 * What to prescribe for an exercise that is NOT already carrying a slot's
 * prescription — a mid-workout addition, a quick-workout pick, a lift logged
 * under a day that no longer lists it.
 *
 * The cascade, most informed first:
 *   1. an active plan  → dose it for that goal and athlete
 *   2. no plan, but the lifter has trained it → read the range off their log
 *   3. neither         → null. No targets is honest; a made-up 8–12 is not.
 */
export function resolvePrescription(input: PrescriptionInput): RepPrescription | null {
  if (input.goal) {
    return dosage(input.goal, input.slot ?? {}, input.profile, input.experience);
  }
  return rangeFromHistory(input.history ?? []);
}
