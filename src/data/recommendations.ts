import type { Exercise } from './program';
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
 * Recommend the next working weight for an exercise.
 *
 * @param history  This exercise's recent sessions, newest first (only sessions
 *                 where it was actually performed). One session is enough;
 *                 more enables stall detection.
 */
export function calculateRecommendation(
  history: ExerciseSession[],
  exercise: Pick<Exercise, 'sets' | 'repLow' | 'repHigh'>,
): WeightRec | null {
  const last = history.find(h => h.sets.length > 0);
  if (!last) return null;

  const weight = workingWeight(last.sets);
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
