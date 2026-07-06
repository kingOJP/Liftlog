import type { Exercise } from './program';
import type { WeightType } from './taxonomy';
import { epley1RM } from './analytics';

// Next-weight recommendations built on double progression — the standard
// evidence-based loading scheme for hypertrophy:
//   1. Work at a weight inside the target rep range.
//   2. Add reps session to session until EVERY working set hits the top of
//      the range.
//   3. Then add load (which drops reps back to the bottom of the range) and
//      repeat.
// On top of that, a stall across several sessions at the same weight triggers
// a ~10% deload so the lifter can build back up with momentum instead of
// grinding at a plateau.

export interface LoggedSet {
  weight: number;
  reps: number;
}

export interface ExerciseSession {
  completedAt: number;
  sets: LoggedSet[]; // in set order
}

export type RecKind = 'increase' | 'hold' | 'decrease' | 'deload';

export interface WeightRec {
  weight: number;
  // Set for rep-progression recommendations (bodyweight exercises logged at
  // 0 lbs) — the per-set rep goal for the next session.
  targetReps?: number;
  direction: 'up' | 'down' | 'hold';
  kind: RecKind;
  reason: string;
}

// How many recent sessions at the same weight without strength improvement
// count as a stall worth deloading for.
const STALL_SESSIONS = 3;
// e1RM must improve by more than this fraction across the stall window to not
// count as stalled.
const STALL_TOLERANCE = 0.01;

function roundTo5(x: number): number {
  return Math.round(x / 5) * 5;
}

// Load jump when the rep range is beaten: 5 lbs, scaling to ~2.5% for heavy
// lifts (e.g. a 400 lb leg press moves in 10 lb jumps, not 5).
function incrementFor(weight: number): number {
  return Math.max(5, roundTo5(weight * 0.025));
}

// The session's working weight: the most-used weight, tie broken heaviest.
// This keeps warm-up or ramp-up sets from skewing the recommendation.
function workingWeight(sets: LoggedSet[]): number {
  const counts = new Map<number, number>();
  for (const s of sets) counts.set(s.weight, (counts.get(s.weight) ?? 0) + 1);
  let best = sets[0].weight;
  let bestCount = 0;
  for (const [weight, count] of counts) {
    if (count > bestCount || (count === bestCount && weight > best)) {
      best = weight;
      bestCount = count;
    }
  }
  return best;
}

function bestE1rm(sets: LoggedSet[]): number {
  return sets.reduce((max, s) => Math.max(max, epley1RM(s.weight, s.reps)), 0);
}

/**
 * Recommend the next working weight (or rep target) for an exercise.
 *
 * @param history     This exercise's recent sessions, newest first (only
 *                    sessions where it was actually performed). One session is
 *                    enough; more enables stall detection.
 * @param weightType  The exercise's weight type. Bodyweight exercises logged
 *                    without external load progress by reps instead of weight
 *                    (e1RM and load increments are meaningless at 0 lbs).
 */
export function calculateRecommendation(
  history: ExerciseSession[],
  exercise: Pick<Exercise, 'sets' | 'repLow' | 'repHigh'>,
  weightType?: WeightType | null,
): WeightRec | null {
  const last = history.find(h => h.sets.length > 0);
  if (!last) return null;

  const weight = workingWeight(last.sets);

  // Bodyweight at 0 lbs → rep progression. If external load was logged
  // (e.g. weighted pull-ups with a belt), the normal weight engine applies.
  if (weightType === 'Bodyweight' && weight === 0) {
    return repProgression(history, last, exercise);
  }
  const workingSets = last.sets.filter(s => s.weight === weight);
  const minReps = Math.min(...workingSets.map(s => s.reps));
  const avgReps = workingSets.reduce((sum, s) => sum + s.reps, 0) / workingSets.length;

  // 1. Rep range beaten across a full set count → add load
  if (workingSets.length >= exercise.sets && minReps >= exercise.repHigh) {
    return {
      weight: weight + incrementFor(weight),
      direction: 'up',
      kind: 'increase',
      reason: `All ${workingSets.length} sets hit ${exercise.repHigh}+ reps — add load`,
    };
  }

  // 2. Stalled at this weight for several sessions → deload and rebuild
  const window = history.filter(h => h.sets.length > 0).slice(0, STALL_SESSIONS);
  if (window.length >= STALL_SESSIONS) {
    const sameWeight = window.every(h => Math.abs(workingWeight(h.sets) - weight) < 2.5);
    const oldest = window[window.length - 1];
    const stalled = bestE1rm(last.sets) <= bestE1rm(oldest.sets) * (1 + STALL_TOLERANCE);
    if (sameWeight && stalled) {
      const deloaded = Math.max(5, Math.min(roundTo5(weight * 0.9), weight - 5));
      return {
        weight: deloaded,
        direction: 'down',
        kind: 'deload',
        reason: `Stalled ${window.length} sessions at ${weight} lbs — deload, then build back up`,
      };
    }
  }

  // 3. Clearly under the rep range → ease the load back
  if (avgReps < exercise.repLow) {
    const reduced = Math.max(5, Math.min(roundTo5(weight * 0.95), weight - 5));
    return {
      weight: reduced,
      direction: 'down',
      kind: 'decrease',
      reason: `Reps fell under ${exercise.repLow} — ease back and rebuild`,
    };
  }

  // 4. In the range → double progression: keep the weight, chase reps
  const reason =
    workingSets.length < exercise.sets
      ? `Complete all ${exercise.sets} sets at this weight, then chase reps`
      : `In range — work toward ${exercise.sets}×${exercise.repHigh} to earn an increase`;
  return { weight, direction: 'hold', kind: 'hold', reason };
}

// ── Rep progression (bodyweight at 0 lbs) ─────────────────────────────────────
// Same shape as the weight engine, but the lever is reps per set: total session
// reps stand in for e1RM as the progress metric, and the recommendation carries
// a `targetReps` goal instead of a new load.

function totalReps(sets: LoggedSet[]): number {
  return sets.reduce((sum, s) => sum + s.reps, 0);
}

function repProgression(
  history: ExerciseSession[],
  last: ExerciseSession,
  exercise: Pick<Exercise, 'sets' | 'repLow' | 'repHigh'>,
): WeightRec {
  const minReps = Math.min(...last.sets.map(s => s.reps));
  const avgReps = totalReps(last.sets) / last.sets.length;

  // 1. Rep range beaten across a full set count → raise the rep goal
  if (last.sets.length >= exercise.sets && minReps >= exercise.repHigh) {
    return {
      weight: 0,
      targetReps: minReps + 1,
      direction: 'up',
      kind: 'increase',
      reason: `All ${last.sets.length} sets hit ${exercise.repHigh}+ — push for ${minReps + 1} reps, or add weight`,
    };
  }

  // 2. Total reps stalled for several sessions → back off and rebuild
  const window = history.filter(h => h.sets.length > 0).slice(0, STALL_SESSIONS);
  if (window.length >= STALL_SESSIONS) {
    const oldest = window[window.length - 1];
    if (totalReps(last.sets) <= totalReps(oldest.sets)) {
      return {
        weight: 0,
        targetReps: exercise.repLow,
        direction: 'down',
        kind: 'deload',
        reason: `Stalled ${window.length} sessions — reset to ${exercise.repLow} crisp reps and build back up`,
      };
    }
  }

  // 3. Under the range → work back toward it
  if (avgReps < exercise.repLow) {
    return {
      weight: 0,
      targetReps: exercise.repLow,
      direction: 'down',
      kind: 'decrease',
      reason: `Reps fell under ${exercise.repLow} — build back into the range`,
    };
  }

  // 4. In range → chase one more rep per set
  const target = Math.min(minReps + 1, exercise.repHigh);
  const reason =
    last.sets.length < exercise.sets
      ? `Complete all ${exercise.sets} sets, then chase reps`
      : `In range — aim for ${target}+ reps per set, toward ${exercise.sets}×${exercise.repHigh}`;
  return { weight: 0, targetReps: target, direction: 'hold', kind: 'hold', reason };
}
