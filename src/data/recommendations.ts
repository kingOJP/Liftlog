import type { Exercise } from './program';
import type { WeightType } from './taxonomy';
import type { PhaseKind } from './plan';
import { epley1RM } from './analytics';

// Next-session prescriptions built on double progression — the standard
// evidence-based loading scheme for hypertrophy and strength:
//   1. Work at a weight inside the target rep range.
//   2. Add reps session to session until the session's rep target is met.
//   3. Then add load (which drops reps back to the bottom of the range) and
//      repeat.
//
// Two things make this more than "same weight as last time":
//
//   • The progression trigger is the session's REP TOTAL (sets × repHigh), not
//     "every single set hit the top". A coach counts total work: 13/12/11 is
//     the same 36 reps as 12/12/12 and has equally earned the load increase,
//     but the strict per-set rule would hold that lifter at the same weight
//     indefinitely. Two extra triggers back it up: a clear overshoot earns a
//     double jump, and a rising est. 1RM at a fixed load earns the increase
//     even before the rep total lands.
//
//   • The output is a PER-SET plan, not one number. Sets 2 and 3 are not set 1:
//     reps fall off as fatigue accumulates, so prescribing "3 × 12" when the
//     lifter has never done more than 12/11/10 is prescribing a failure. The
//     plan uses the lifter's OWN observed drop-off (how many reps they lose per
//     set at that load) to set a target for each set — beat every target and
//     the rep total lands, which is exactly what earns the next increase.
//
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
  /**
   * 0-based position of this exercise within that workout, when known.
   * Sessions trained much later than the exercise's usual slot are skipped as
   * the recommendation baseline — the numbers dropped because the muscles
   * weren't fresh, not because the lifter got weaker.
   */
  position?: number | null;
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

/** One prescribed working set — what the lifter should actually put on the bar. */
export interface PrescribedSet {
  /** 1-based working-set number */
  setNumber: number;
  /** null when there's no history to prescribe from — the lifter picks it */
  weight: number | null;
  targetReps: number;
}

/** The full next-session prescription for one exercise. */
export interface SetPlan {
  /** The headline recommendation (the chip on the exercise card) */
  rec: WeightRec | null;
  /** One entry per programmed working set, in order */
  sets: PrescribedSet[];
  /** What has to happen this session to earn the next load increase */
  goal: string;
}

// How many recent sessions at the same weight without strength improvement
// count as a stall worth deloading for.
const STALL_SESSIONS = 3;
// e1RM must improve by more than this fraction across the stall window to not
// count as stalled.
const STALL_TOLERANCE = 0.01;
// Trained this many slots later than the exercise's usual position = not fresh.
const POSITION_SHIFT_SLOTS = 2;
// Never prescribe less than this — there is no 2.5 lb dumbbell in most gyms.
const MIN_WEIGHT = 5;
// Reps past repHigh that mark the load as clearly too light (double jump).
const OVERSHOOT_REPS = 2;
// est. 1RM gain at an unchanged load that earns the increase on its own.
const E1RM_BREAKOUT_PCT = 0.03;
// Sessions of history the fatigue drop-off model is fitted from.
const FATIGUE_SAMPLE_SESSIONS = 3;
// Fallback rep loss per set when there's no drop-off history to fit.
const DEFAULT_FATIGUE_PCT = 0.07;

function typicalPosition(history: ExerciseSession[]): number | null {
  const positions = history
    .map(h => h.position)
    .filter((p): p is number => p != null)
    .sort((a, b) => a - b);
  if (positions.length === 0) return null;
  return positions[Math.floor(positions.length / 2)];
}

function isPositionShifted(session: ExerciseSession, typical: number | null): boolean {
  return session.position != null && typical != null &&
    session.position >= typical + POSITION_SHIFT_SLOTS;
}

function roundTo5(x: number): number {
  return Math.round(x / 5) * 5;
}

function roundToStep(x: number, step: number): number {
  return Math.round(x / step) * step;
}

// Load jump when the rep target is beaten. 5 lbs is the default gym plate jump,
// but it's the wrong unit at both ends: on a light cable/machine movement it can
// be a 30% increase, and on a 400 lb leg press it's noise. So the increment
// scales with the load — and with what the equipment can actually be loaded in:
// a dumbbell rack goes up in 5s whatever you'd prefer, while a barbell, a belt
// or a machine takes 2.5 lb microloading happily.
function incrementFor(weight: number, weightType?: WeightType | null): number {
  const rackLoaded = weightType === 'Dumbbell' || weightType === 'Kettlebell';
  if (weight < 30 && !rackLoaded) return 2.5;
  return Math.max(5, roundTo5(weight * 0.025));
}

// Back off to `factor` of the working weight, snapped to the exercise's own
// increment and guaranteed to actually move (and stay loadable).
function easeBack(weight: number, factor: number, step: number): number {
  return Math.max(MIN_WEIGHT, Math.min(roundToStep(weight * factor, step), weight - step));
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
 * @param phase       The training-block phase governing this week (plan.ts).
 *                    During a planned deload/recovery week the engine stops
 *                    chasing progression and prescribes ~10% off the working
 *                    weight — the deload is scheduled, not reactive.
 */
export function calculateRecommendation(
  history: ExerciseSession[],
  exercise: Pick<Exercise, 'sets' | 'repLow' | 'repHigh'>,
  weightType?: WeightType | null,
  phase?: PhaseKind | null,
): WeightRec | null {
  const withSets = history.filter(h => h.sets.length > 0);
  if (withSets.length === 0) return null;

  // Freshness context: prescribe off sessions where the exercise sat in its
  // usual slot. A session trained much later in the workout ran on tired
  // muscles — using it as the baseline would ratchet the prescription down
  // for reasons that have nothing to do with strength.
  const typical = typicalPosition(withSets);
  const fresh = withSets.filter(h => !isPositionShifted(h, typical));
  const baseline = fresh.length > 0 ? fresh : withSets;
  const skippedShifted = fresh.length > 0 && baseline[0] !== withSets[0];

  const last = baseline[0];
  const weight = workingWeight(last.sets);

  const withContext = (rec: WeightRec): WeightRec => skippedShifted
    ? { ...rec, reason: `${rec.reason} (last session ran later in your workout than usual — not held against you)` }
    : rec;

  // Planned easy week: back off ~10% regardless of how the last session went.
  if (phase === 'deload' || phase === 'recovery') {
    const easy = phase === 'deload'
      ? 'Planned deload week — ~10% lighter, crisp reps, let fatigue drain'
      : 'Recovery week — ~10% lighter while you ramp back into training';
    if (weightType === 'Bodyweight' && weight === 0) {
      return { weight: 0, targetReps: exercise.repLow, direction: 'down', kind: 'deload', reason: easy };
    }
    return {
      weight: easeBack(weight, 0.9, incrementFor(weight, weightType)),
      direction: 'down', kind: 'deload', reason: easy,
    };
  }

  // Bodyweight at 0 lbs → rep progression. If external load was logged
  // (e.g. weighted pull-ups with a belt), the normal weight engine applies.
  if (weightType === 'Bodyweight' && weight === 0) {
    return withContext(repProgression(baseline, last, exercise));
  }
  const workingSets = last.sets.filter(s => s.weight === weight);
  const setsDone = workingSets.length;
  const minReps = Math.min(...workingSets.map(s => s.reps));
  const maxReps = Math.max(...workingSets.map(s => s.reps));
  const repTotal = workingSets.reduce((sum, s) => sum + s.reps, 0);
  const avgReps = repTotal / setsDone;
  // The session's rep target: what "beating the range" actually means across a
  // full set count. Counting the total, not each set individually, is how a
  // coach reads a log — and it stops one lagging set from freezing the load.
  const targetTotal = exercise.sets * exercise.repHigh;
  const fullSetCount = setsDone >= exercise.sets;
  const increment = incrementFor(weight, weightType);

  // 1a. Rep target met across a full set count → add load.
  if (fullSetCount && (repTotal >= targetTotal || minReps >= exercise.repHigh)) {
    // A clear overshoot (top set well past the range) means the load was too
    // light to begin with — take a double jump instead of creeping.
    const overshoot = avgReps >= exercise.repHigh + OVERSHOOT_REPS;
    const step = increment * (overshoot ? 2 : 1);
    return withContext({
      weight: weight + step,
      direction: 'up',
      kind: 'increase',
      reason: overshoot
        ? `${repTotal} reps at ${weight} lbs — well past ${targetTotal}, this load is too light. Jump ${step} lbs`
        : `Hit ${repTotal} reps across ${setsDone} sets (target ${targetTotal}) — add load`,
    });
  }

  // 1b. Strength breakout: est. 1RM is climbing at an unchanged load and the
  // lifter is already brushing the top of the range. Holding out for a perfect
  // rep total would leave real progress on the table — a coach moves up now.
  const recentFresh = baseline.slice(0, STALL_SESSIONS);
  if (fullSetCount && recentFresh.length >= 2 && avgReps >= exercise.repHigh - 1) {
    const priorAtWeight = recentFresh.slice(1).filter(h => Math.abs(workingWeight(h.sets) - weight) < 2.5);
    const oldest = priorAtWeight[priorAtWeight.length - 1];
    if (oldest && bestE1rm(last.sets) >= bestE1rm(oldest.sets) * (1 + E1RM_BREAKOUT_PCT)) {
      const gain = Math.round((bestE1rm(last.sets) / bestE1rm(oldest.sets) - 1) * 100);
      return withContext({
        weight: weight + increment,
        direction: 'up',
        kind: 'increase',
        reason: `Est. 1RM up ${gain}% at ${weight} lbs with reps at the top of the range — you've outgrown this load`,
      });
    }
  }

  // 2. Stalled at this weight for several sessions → deload and rebuild.
  // Only fresh-slot sessions count toward the stall — a lift that dipped
  // because it ran last in the workout hasn't actually stalled.
  const window = baseline.slice(0, STALL_SESSIONS);
  if (window.length >= STALL_SESSIONS) {
    const sameWeight = window.every(h => Math.abs(workingWeight(h.sets) - weight) < 2.5);
    const oldest = window[window.length - 1];
    const stalled = bestE1rm(last.sets) <= bestE1rm(oldest.sets) * (1 + STALL_TOLERANCE);
    if (sameWeight && stalled) {
      return withContext({
        weight: easeBack(weight, 0.9, increment),
        direction: 'down',
        kind: 'deload',
        reason: `Stalled ${window.length} sessions at ${weight} lbs — deload, then build back up`,
      });
    }
  }

  // 3. Clearly under the rep range → ease the load back
  if (avgReps < exercise.repLow) {
    return withContext({
      weight: easeBack(weight, 0.95, increment),
      direction: 'down',
      kind: 'decrease',
      reason: `Reps fell under ${exercise.repLow} — ease back and rebuild`,
    });
  }

  // 4. In the range → double progression: keep the weight, chase reps. The
  // reason names the exact gap to close, so "hold" is a target, not a shrug.
  const reason = !fullSetCount
    ? `Complete all ${exercise.sets} sets at this weight, then chase reps`
    : maxReps >= exercise.repHigh
      ? `${targetTotal - repTotal} more reps than last time earns +${increment} lbs`
      : `In range — work toward ${exercise.sets}×${exercise.repHigh} (${targetTotal} reps) to earn an increase`;
  return withContext({ weight, direction: 'hold', kind: 'hold', reason });
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

// ── Per-set prescription ──────────────────────────────────────────────────────
// One weight is a recommendation; a plan is what a coach actually writes down.
// The load is the same across straight sets, but the REP target is not: reps
// fall off set to set as fatigue accumulates, and the size of that drop-off is
// personal (and load-dependent). Fitting it from the lifter's own log means the
// targets are beatable — and beating all of them is exactly the rep total that
// earns the next load increase.

/**
 * Reps lost per set relative to set 1, fitted from recent sessions.
 * Index 0 is always 0. Never positive: a plan doesn't ask for MORE reps as
 * fatigue builds.
 */
function fatigueDrops(history: ExerciseSession[], sets: number, baseReps: number): number[] {
  const sums = new Array(sets).fill(0) as number[];
  const counts = new Array(sets).fill(0) as number[];

  for (const h of history.slice(0, FATIGUE_SAMPLE_SESSIONS)) {
    const weight = workingWeight(h.sets);
    const working = h.sets.filter(s => s.weight === weight);
    if (working.length < 2) continue;
    for (let i = 1; i < Math.min(working.length, sets); i++) {
      sums[i] += working[i].reps - working[0].reps;
      counts[i] += 1;
    }
  }

  const drops = [0];
  for (let i = 1; i < sets; i++) {
    // No observed data for this set index (a set the lifter hasn't reached yet)
    // → fall back to a ~7%-per-set decay, the typical straight-set drop-off.
    const drop = counts[i] > 0
      ? Math.round(sums[i] / counts[i])
      : -Math.round(baseReps * DEFAULT_FATIGUE_PCT * i);
    drops.push(Math.min(0, drop));
  }
  return drops;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * The full prescription for the next session: one row per programmed working
 * set, with the load and the rep target for each.
 *
 * @param history   This exercise's recent sessions, newest first (as for
 *                  calculateRecommendation). May be empty — a first-time
 *                  exercise still gets rep targets, just no weight.
 * @param exercise  The (coach-adjusted) slot: set count and rep range.
 */
export function buildSetPlan(
  history: ExerciseSession[],
  exercise: Pick<Exercise, 'sets' | 'repLow' | 'repHigh'>,
  weightType?: WeightType | null,
  phase?: PhaseKind | null,
): SetPlan {
  const count = Math.max(1, exercise.sets);
  const rec = calculateRecommendation(history, exercise, weightType, phase);

  // Never trained: prescribe the rep range and let the lifter find the load.
  if (!rec) {
    return {
      rec: null,
      sets: Array.from({ length: count }, (_, i) => ({
        setNumber: i + 1, weight: null, targetReps: exercise.repLow,
      })),
      goal: `First time on this lift — find a weight you can control for ${exercise.repLow}–${exercise.repHigh} reps with 1–2 in reserve.`,
    };
  }

  const bodyweight = rec.targetReps != null && rec.weight === 0;

  // A planned easy week is about crisp, submaximal reps — flat targets, no
  // fatigue-chasing. Every other week gets the drop-off model.
  if (rec.kind === 'deload' && (phase === 'deload' || phase === 'recovery')) {
    return {
      rec,
      sets: Array.from({ length: count }, (_, i) => ({
        setNumber: i + 1, weight: rec.weight, targetReps: exercise.repLow,
      })),
      goal: `Leave 3–4 reps in reserve on every set. The easy week is the plan working.`,
    };
  }

  // Set 1's target, by what the engine decided:
  //   increase / decrease / deload → a fresh load, aim at the bottom of the range
  //   hold                        → one rep past what set 1 did last time
  const lastWorking = (() => {
    const withSets = history.filter(h => h.sets.length > 0);
    if (withSets.length === 0) return null;
    const w = workingWeight(withSets[0].sets);
    const working = withSets[0].sets.filter(s => s.weight === w);
    return working.length > 0 ? working : null;
  })();

  const baseReps = rec.kind === 'hold'
    ? clamp((lastWorking?.[0].reps ?? exercise.repLow) + 1, exercise.repLow, exercise.repHigh)
    : bodyweight
      ? clamp(rec.targetReps!, exercise.repLow, exercise.repHigh)
      : exercise.repLow;

  const drops = fatigueDrops(history, count, baseReps);
  const sets: PrescribedSet[] = Array.from({ length: count }, (_, i) => ({
    setNumber: i + 1,
    weight: rec.weight,
    targetReps: clamp(baseReps + drops[i], exercise.repLow, exercise.repHigh),
  }));

  const planTotal = sets.reduce((sum, s) => sum + s.targetReps, 0);
  const targetTotal = count * exercise.repHigh;
  const goal = bodyweight
    ? `Hit every target for ${planTotal} total reps — ${targetTotal} earns a harder variation or added load.`
    : rec.kind === 'increase'
      ? `New load: ${rec.weight} lbs. Land ${planTotal} reps today, then build toward ${targetTotal}.`
      : rec.kind === 'hold'
        ? `Hit every target (${planTotal} reps) — ${targetTotal} at ${rec.weight} lbs earns +${incrementFor(rec.weight, weightType)} lbs.`
        : `Rebuild at ${rec.weight} lbs: ${planTotal} clean reps, then start climbing again.`;

  return { rec, sets, goal };
}
