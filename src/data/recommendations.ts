import type { Exercise } from './program';
import type { WeightType } from './taxonomy';
import type { ExperienceLevel, Goal, PhaseKind } from './plan';
import { isEasyPhase } from './plan';
import { epley1RM } from './analytics';

// Next-session prescriptions built on double progression — the standard
// evidence-based loading scheme for hypertrophy and strength:
//   1. Work at a weight inside the target rep range.
//   2. Add reps session to session until the session's rep target is met.
//   3. Then add load (which drops reps back into the range) and repeat.
//
// Five things separate this from "same weight as last time":
//
//   • The trigger is the session's REP TOTAL over the programmed set count, not
//     "every single set hit the top". A coach counts total work: 13/12/11 is the
//     same 36 reps as 12/12/12 and has equally earned the increase, but the
//     strict per-set rule holds that lifter at one weight indefinitely.
//
//   • The SIZE of the jump comes from the load–rep relationship rather than a
//     flat 5 lbs. Standard %1RM tables (1RM 100%, 5RM ~87%, 10RM ~75%) put one
//     rep at roughly 2.5–3% of load, so a lifter sitting 4 reps above the bottom
//     of their range can absorb ~12% more weight and still land inside it.
//     Creeping 5 lbs after a 3×12 just spends a session repeating 3×11.
//
//   • Load climbs are RATE-LIMITED PER WEEK by training age. Progression rate as
//     a function of training age is one of the best-established principles in
//     the field: novices add load session to session, intermediates weekly,
//     advanced lifters across a mesocycle. Without a cap, a lift trained twice a
//     week gets two increases a week — which is what manufactures the stall the
//     engine then tries to fix with a deload.
//
//   • Stalls are read on BOTH levers. e1RM alone marks a lifter going
//     10/9/8 → 10/10/9 → 10/10/10 at a fixed load as stalled, because their top
//     set never moved — yet that is textbook double progression working. And
//     1RM prediction equations are fitted on sets of ~1–10 reps and drift badly
//     past ~12, so on 3×20 cable laterals the e1RM number is noise; high-rep
//     work is judged on reps alone.
//
//   • The GOAL changes the answer. Most consequentially in a deficit: plateaus
//     there are driven by energy availability, not accumulated fatigue, and the
//     objective is retaining muscle — so a fat-loss stall holds the load instead
//     of deloading it, and load is never cut off a single bad session.
//
// The output is a PER-SET plan, not one number. Sets 2 and 3 are not set 1:
// reps fall off as fatigue accumulates, so prescribing "3 × 12" to someone who
// has never beaten 12/11/10 is prescribing a failure. The plan fits the drop-off
// from the lifter's OWN log — beat every target and the rep total lands, which
// is exactly what earns the next increase.

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

/**
 * A slot with a resolved rep range. Every progression branch needs one — you
 * cannot judge "beat the range" without a range — so the engine narrows to this
 * before doing any work.
 */
export type PrescribedSlot = { sets: number; repLow: number; repHigh: number };

/** One prescribed working set — what the lifter should actually put on the bar. */
export interface PrescribedSet {
  /** 1-based working-set number */
  setNumber: number;
  /** null when there's no history to prescribe from — the lifter picks it */
  weight: number | null;
  /** null when nothing has been prescribed — free logging, no target to chase */
  targetReps: number | null;
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

/**
 * Everything outside the exercise's own history that changes the answer.
 * An options bag rather than positional arguments — the engine now reads the
 * athlete (training age), the plan (goal, phase) and the equipment.
 */
export interface PrescriptionContext {
  weightType?: WeightType | null;
  /** The training-block phase governing this week (plan.ts) */
  phase?: PhaseKind | null;
  /** The active plan's goal — drives how stalls and misses are handled */
  goal?: Goal;
  /** Effective training age (experience.ts) — drives the weekly rate cap */
  experience?: ExperienceLevel;
  /** For the weekly rate cap; defaults to now */
  now?: number;
}

// How many recent sessions at the same weight without progress on either lever
// count as a stall worth deloading for.
const STALL_SESSIONS = 3;
// Improvement below this fraction across the stall window doesn't count.
const STALL_TOLERANCE = 0.01;
// Trained this many slots later than the exercise's usual position = not fresh.
const POSITION_SHIFT_SLOTS = 2;
// Never prescribe less than this — there is no 2.5 lb dumbbell in most gyms.
const MIN_WEIGHT = 5;
// The load–rep trade-off. Standard %1RM tables (1RM 100%, 5RM ~87%, 10RM ~75%)
// put one rep at roughly 2.5–3% of load; 3% is the conservative end, so the
// engine under-jumps rather than over-jumps.
const PCT_LOAD_PER_REP = 3;
// 1RM prediction equations are fitted on sets of ~1–10 reps and drift badly
// beyond this. Past it, progress is read from reps, not estimated strength.
const E1RM_VALID_REPS = 12;
// est. 1RM gain at an unchanged load that earns the increase on its own.
const E1RM_BREAKOUT_PCT = 0.03;
// Reps below repLow that count as a clear miss rather than a bad day.
const BIG_MISS_REPS = 2;
// Ceiling on load added per calendar week, by training age. Novices can add
// load session to session; intermediates progress week to week; advanced
// lifters progress across a block. Un-capped session-to-session loading is what
// creates the plateau the deload branch then has to clean up.
const WEEKLY_LOAD_CAP: Record<ExperienceLevel, number> = {
  beginner: 0.10,
  intermediate: 0.05,
  advanced: 0.025,
};
const DEFAULT_EXPERIENCE: ExperienceLevel = 'intermediate';
const WEEK_MS = 7 * 86_400_000;
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
 * The sessions the prescription is built from: those where the exercise sat in
 * its usual slot. A session trained much later in the workout ran on tired
 * muscles — using it as the baseline would ratchet the prescription down for
 * reasons that have nothing to do with strength. Newest first, as given.
 */
function freshBaseline(history: ExerciseSession[]): ExerciseSession[] {
  const withSets = history.filter(h => h.sets.length > 0);
  if (withSets.length === 0) return [];
  const typical = typicalPosition(withSets);
  const fresh = withSets.filter(h => !isPositionShifted(h, typical));
  return fresh.length > 0 ? fresh : withSets;
}

/**
 * The session's working sets, capped at the programmed set count. Extra sets
 * are bonus volume and must not earn a load increase on their own — five sets
 * of eight is not "beat the 3×12 target".
 */
function countedSets(session: ExerciseSession, sets: number): LoggedSet[] {
  const w = workingWeight(session.sets);
  return session.sets.filter(s => s.weight === w).slice(0, sets);
}

function repSum(sets: LoggedSet[]): number {
  return sets.reduce((sum, s) => sum + s.reps, 0);
}

/**
 * Reps expected at a new load, from the load–rep relationship (~1 rep per
 * PCT_LOAD_PER_REP % of load). Works in both directions: a 10% back-off buys
 * back about 3 reps.
 */
function predictReps(reps: number, fromWeight: number, toWeight: number): number {
  if (fromWeight <= 0) return reps;
  const pctChange = ((toWeight - fromWeight) / fromWeight) * 100;
  return reps - pctChange / PCT_LOAD_PER_REP;
}

/**
 * The jump to take: the largest whole increment that still lands the lifter
 * inside their rep range. Sitting `n` reps above repLow buys roughly
 * `n × PCT_LOAD_PER_REP`% of load — so a 3×12 in an 8–12 range earns a real
 * jump, while scraping the target by one rep earns the minimum step.
 *
 * When even the minimum step overshoots the range (light loads with coarse
 * plates), it's taken anyway: you can't microload past what the gym stocks, and
 * rebuilding the reps over a session or two is the normal cost of the jump.
 */
function sizedIncrement(
  weight: number,
  avgReps: number,
  repLow: number,
  step: number,
): number {
  const roomReps = Math.max(0, avgReps - repLow);
  const maxJump = weight * (roomReps * PCT_LOAD_PER_REP) / 100;
  if (maxJump < step) return step;
  return Math.floor(maxJump / step) * step;
}

/**
 * The heaviest this lift may go today without exceeding the athlete's weekly
 * progression rate, or null when there's nothing from the past week to measure
 * against. Anchored to where the lift *was* a week ago (the oldest session in
 * the window), so it limits the climb across the week rather than per session.
 */
function weeklyCeiling(
  baseline: ExerciseSession[],
  now: number,
  experience: ExperienceLevel,
): number | null {
  const cutoff = now - WEEK_MS;
  const inWeek = baseline.filter(h => h.completedAt >= cutoff);
  if (inWeek.length === 0) return null;
  const weekAgo = workingWeight(inWeek[inWeek.length - 1].sets); // newest-first
  if (weekAgo <= 0) return null;
  return weekAgo * (1 + WEEKLY_LOAD_CAP[experience]);
}

/**
 * Recommend the next working weight (or rep target) for an exercise.
 *
 * @param history  This exercise's recent sessions, newest first (only sessions
 *                 where it was actually performed). One session is enough; more
 *                 enables stall detection and the weekly rate cap.
 * @param exercise The (coach-adjusted) slot: set count and rep range.
 * @param ctx      Equipment, plan phase, training goal and training age — see
 *                 PrescriptionContext. Every field is optional; the defaults
 *                 are the conservative middle (general goal, intermediate).
 */
export function calculateRecommendation(
  history: ExerciseSession[],
  exercise: Pick<Exercise, 'sets' | 'repLow' | 'repHigh'>,
  ctx: PrescriptionContext = {},
): WeightRec | null {
  const {
    weightType, phase,
    goal = 'general',
    experience = DEFAULT_EXPERIENCE,
    now = Date.now(),
  } = ctx;

  const baseline = freshBaseline(history);
  if (baseline.length === 0) return null;

  const withSets = history.filter(h => h.sets.length > 0);
  const skippedShifted = baseline[0] !== withSets[0];

  const last = baseline[0];
  const weight = workingWeight(last.sets);

  const withContext = (rec: WeightRec): WeightRec => skippedShifted
    ? { ...rec, reason: `${rec.reason} (last session ran later in your workout than usual — not held against you)` }
    : rec;

  // No rep range to judge against. This is ad-hoc work by someone with no plan
  // and no history with the movement — every progression branch below is
  // meaningless without a target, so the honest answer is "start where you left
  // off". Inventing a range here is exactly what this engine no longer does.
  if (exercise.repLow == null || exercise.repHigh == null) {
    return withContext({
      weight,
      direction: 'hold',
      kind: 'hold',
      reason: 'No rep target set — log a few sessions and the coach will learn your working range',
    });
  }
  const ex: PrescribedSlot = {
    sets: exercise.sets, repLow: exercise.repLow, repHigh: exercise.repHigh,
  };

  // Planned easy week: back off regardless of how the last session went. A
  // taper keeps the load respectable (intensity is what preserves strength on
  // reduced volume); race week is deliberately much lighter than that — the
  // session exists to move, not to train.
  if (isEasyPhase(phase ?? null)) {
    const easy = phase === 'deload'
      ? 'Planned deload week — ~10% lighter, crisp reps, let fatigue drain'
      : phase === 'race-week'
        ? 'Race week — ~30% lighter and just a couple of sets. Sharpness, not fitness'
        : phase === 'intro'
          ? 'Intro week — well short of your working weight. Learn the movement, leave 4–5 reps in the tank'
          : 'Recovery week — ~10% lighter while you ramp back into training';
    // An intro week isn't shedding fatigue, it's avoiding creating any: on a
    // movement the athlete has done before, a bigger cut than a deload is right,
    // because the point is a comfortably submaximal first exposure.
    const factor = phase === 'race-week' ? 0.7 : phase === 'intro' ? 0.8 : 0.9;
    if (weightType === 'Bodyweight' && weight === 0) {
      return { weight: 0, targetReps: ex.repLow, direction: 'down', kind: 'deload', reason: easy };
    }
    return {
      weight: easeBack(weight, factor, incrementFor(weight, weightType)),
      direction: 'down', kind: 'deload', reason: easy,
    };
  }

  // A maintenance week holds load on purpose: volume is already trimmed by the
  // block's design, and intensity is the half of the dose that defends
  // strength. Double progression still applies — earn the top of the range and
  // the load still moves — it just isn't chased.

  // Bodyweight at 0 lbs → rep progression. If external load was logged
  // (e.g. weighted pull-ups with a belt), the normal weight engine applies.
  if (weightType === 'Bodyweight' && weight === 0) {
    return withContext(repProgression(baseline, last, ex, goal));
  }

  // Stats over the PROGRAMMED set count — extra sets are bonus volume, not
  // evidence that the load has been beaten.
  const counted = countedSets(last, ex.sets);
  const setsDone = counted.length;
  const maxReps = Math.max(...counted.map(s => s.reps));
  const repTotal = repSum(counted);
  const avgReps = repTotal / setsDone;
  const targetTotal = ex.sets * ex.repHigh;
  const fullSetCount = setsDone >= ex.sets;
  const step = incrementFor(weight, weightType);

  // 1RM estimates are only trustworthy on sets of roughly 1–10 reps; past
  // E1RM_VALID_REPS the formula's error swamps the signal, so high-rep work is
  // judged on reps alone.
  const e1rmMeaningful = maxReps <= E1RM_VALID_REPS;

  // Both increase paths funnel through here so the weekly rate cap can never be
  // bypassed by adding another trigger later.
  const increaseTo = (jump: number, evidence: string): WeightRec => {
    const ceiling = weeklyCeiling(baseline, now, experience);

    // Already climbed as far as this athlete consolidates in a week. Adding
    // again today out-runs recovery — bank the reps instead.
    if (ceiling != null && weight >= ceiling) {
      return withContext({
        weight,
        direction: 'hold',
        kind: 'hold',
        reason: `${evidence} — but this lift already went up this week. Repeat ${weight} lbs and add load next week`,
      });
    }

    let target = weight + jump;
    let rateLimited = false;
    if (ceiling != null && target > ceiling) {
      // Trim the jump to the weekly allowance — but never below one increment.
      // You cannot microload finer than the gym stocks, so a light lift whose
      // weekly allowance is under one plate still gets its single jump.
      const allowed = Math.max(step, Math.floor((ceiling - weight) / step) * step);
      if (allowed < jump) {
        target = weight + allowed;
        rateLimited = true;
      }
    }

    return withContext({
      weight: target,
      direction: 'up',
      kind: 'increase',
      reason: rateLimited
        ? `${evidence} — up to ${target} lbs, holding a steady week-over-week climb`
        : `${evidence} — go to ${target} lbs`,
    });
  };

  // 1a. Rep target met across the programmed set count → add load. The jump is
  // sized so the lifter lands back inside the rep range, not on a flat 5 lbs.
  // In a deficit the minimum step is used instead: recovery capacity is reduced
  // and the objective is retaining muscle, not chasing loading PRs.
  if (fullSetCount && repTotal >= targetTotal) {
    const jump = goal === 'fat-loss'
      ? step
      : sizedIncrement(weight, avgReps, ex.repLow, step);
    return increaseTo(jump, `Hit ${repTotal} reps at ${weight} lbs (target ${targetTotal})`);
  }

  // 1b. Strength breakout: est. 1RM climbing at an unchanged load with reps
  // already brushing the top of the range. Holding out for a perfect rep total
  // would leave real progress on the table — a coach moves up now.
  const recentFresh = baseline.slice(0, STALL_SESSIONS);
  if (e1rmMeaningful && fullSetCount && recentFresh.length >= 2 && avgReps >= ex.repHigh - 1) {
    const priorAtWeight = recentFresh.slice(1).filter(h => Math.abs(workingWeight(h.sets) - weight) < 2.5);
    const oldest = priorAtWeight[priorAtWeight.length - 1];
    if (oldest && bestE1rm(last.sets) >= bestE1rm(oldest.sets) * (1 + E1RM_BREAKOUT_PCT)) {
      const gain = Math.round((bestE1rm(last.sets) / bestE1rm(oldest.sets) - 1) * 100);
      return increaseTo(step, `Est. 1RM up ${gain}% at ${weight} lbs with reps at the top of the range`);
    }
  }

  // 2. Genuinely stalled at this weight → deload and rebuild.
  //
  // Two things a naive stall check gets wrong, and both of them punish good
  // training. First, reading est. 1RM alone flags a lifter going
  // 10/9/8 → 10/10/9 → 10/10/10 as stalled, because their top set never moved —
  // yet that lifter added three reps at the same load, which is precisely what
  // double progression asks for. Second, comparing only the LATEST session to
  // the oldest turns one bad night's sleep into a deload: 24 → 27 → 30 → 24
  // reads as "no progress" even though the lifter set a high-water mark two
  // sessions ago. A stall means nothing in the window beat where it started, on
  // either lever.
  const window = baseline.slice(0, STALL_SESSIONS);
  if (window.length >= STALL_SESSIONS) {
    const sameWeight = window.every(h => Math.abs(workingWeight(h.sets) - weight) < 2.5);
    const anchor = window[window.length - 1];
    const anchorTotal = repSum(countedSets(anchor, ex.sets));
    const anchorE1rm = bestE1rm(anchor.sets);
    const since = window.slice(0, -1);

    const repsImproved = since.some(h => repSum(countedSets(h, ex.sets)) > anchorTotal);
    const e1rmImproved = e1rmMeaningful &&
      since.some(h => bestE1rm(h.sets) > anchorE1rm * (1 + STALL_TOLERANCE));

    if (sameWeight && !repsImproved && !e1rmImproved) {
      // In an energy deficit a plateau is expected — it reflects energy
      // availability, not accumulated fatigue, and the goal is holding onto
      // muscle. Cutting the load would give away the very stimulus that
      // defends it.
      if (goal === 'fat-loss') {
        return withContext({
          weight,
          direction: 'hold',
          kind: 'hold',
          reason: `Holding ${weight} lbs through a deficit is the win — defend this load, PRs come back when you eat`,
        });
      }
      return withContext({
        weight: easeBack(weight, 0.9, step),
        direction: 'down',
        kind: 'deload',
        reason: `${window.length} sessions at ${weight} lbs with no gain in reps or strength — deload, then build back up`,
      });
    }
  }

  // 3. Under the rep range → ease the load back, but only on evidence. Day-to-day
  // strength swings from sleep, food and stress are large; programming a load cut
  // off one session reacts to noise. It takes a clear miss, or a second session
  // confirming the first. In a deficit only a confirmed miss counts — an
  // under-range day there is the deficit talking.
  if (avgReps < ex.repLow) {
    // The confirming session has to be at the SAME load. Judging the first
    // session after a back-off against the miss that caused it would walk the
    // weight down a step at a time, forever.
    const previous = baseline[1];
    const repeated = previous != null &&
      Math.abs(workingWeight(previous.sets) - weight) < 2.5 && (() => {
        const prev = countedSets(previous, ex.sets);
        return prev.length > 0 && repSum(prev) / prev.length < ex.repLow;
      })();
    const bigMiss = goal !== 'fat-loss' && avgReps <= ex.repLow - BIG_MISS_REPS;

    if (repeated || bigMiss) {
      return withContext({
        weight: easeBack(weight, 0.95, step),
        direction: 'down',
        kind: 'decrease',
        reason: repeated
          ? `Two sessions under ${ex.repLow} reps — ease back and rebuild`
          : `Reps fell well under ${ex.repLow} — ease back and rebuild`,
      });
    }
    return withContext({
      weight,
      direction: 'hold',
      kind: 'hold',
      reason: `Short of ${ex.repLow} reps, but one session isn't a trend — repeat ${weight} lbs before dropping it`,
    });
  }

  // 4. In the range → double progression: keep the weight, chase reps. The
  // reason names the exact gap to close, so "hold" is a target, not a shrug.
  const reason = !fullSetCount
    ? `Complete all ${ex.sets} sets at this weight, then chase reps`
    : `${targetTotal - repTotal} more reps than last time (${targetTotal} total) earns the next increase`;
  return withContext({ weight, direction: 'hold', kind: 'hold', reason });
}

// ── Rep progression (bodyweight at 0 lbs) ─────────────────────────────────────
// Same shape as the weight engine, but the lever is reps per set: total session
// reps stand in for e1RM as the progress metric, and the recommendation carries
// a `targetReps` goal instead of a new load.

function repProgression(
  history: ExerciseSession[],
  last: ExerciseSession,
  exercise: PrescribedSlot,
  goal: Goal,
): WeightRec {
  const minReps = Math.min(...last.sets.map(s => s.reps));
  const avgReps = repSum(last.sets) / last.sets.length;

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
    if (repSum(last.sets) <= repSum(oldest.sets)) {
      // Same reasoning as the loaded engine: in a deficit a rep plateau is the
      // deficit, not fatigue — hold the standard rather than cutting it.
      if (goal === 'fat-loss') {
        return {
          weight: 0,
          targetReps: minReps,
          direction: 'hold',
          kind: 'hold',
          reason: `Holding ${minReps} reps through a deficit is the win — defend this standard`,
        };
      }
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
function fatigueDrops(baseline: ExerciseSession[], sets: number, baseReps: number): number[] {
  const sums = new Array(sets).fill(0) as number[];
  const counts = new Array(sets).fill(0) as number[];

  for (const h of baseline.slice(0, FATIGUE_SAMPLE_SESSIONS)) {
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
  ctx: PrescriptionContext = {},
): SetPlan {
  const count = Math.max(1, exercise.sets);
  const rec = calculateRecommendation(history, exercise, ctx);
  const { phase } = ctx;

  // Nothing prescribed — ad-hoc work with no plan to dose it and no history to
  // read a range off. Lay out the sets and let the lifter log freely; showing a
  // fabricated 8–12 target here would be the coach guessing out loud.
  if (exercise.repLow == null || exercise.repHigh == null) {
    return {
      rec,
      sets: Array.from({ length: count }, (_, i) => ({
        setNumber: i + 1, weight: rec?.weight ?? null, targetReps: null,
      })),
      goal: 'No rep target yet — log this session and the coach will learn the range you work in.',
    };
  }
  const ex: PrescribedSlot = {
    sets: exercise.sets, repLow: exercise.repLow, repHigh: exercise.repHigh,
  };

  // Never trained: prescribe the rep range and let the lifter find the load.
  if (!rec) {
    return {
      rec: null,
      sets: Array.from({ length: count }, (_, i) => ({
        setNumber: i + 1, weight: null, targetReps: ex.repLow,
      })),
      goal: `First time on this lift — find a weight you can control for ${ex.repLow}–${ex.repHigh} reps with 1–2 in reserve.`,
    };
  }

  const bodyweight = rec.targetReps != null && rec.weight === 0;

  // A planned easy week is about crisp, submaximal reps — flat targets at the
  // bottom of the range, no fatigue-chasing. Every other week gets the model.
  if (rec.kind === 'deload' && (phase === 'deload' || phase === 'recovery')) {
    return {
      rec,
      sets: Array.from({ length: count }, (_, i) => ({
        setNumber: i + 1, weight: rec.weight, targetReps: ex.repLow,
      })),
      goal: `Leave 3–4 reps in reserve on every set. The easy week is the plan working.`,
    };
  }

  // The prescription builds off the same fresh-slot sessions the recommendation
  // did, so a late-slot session can't skew either the targets or the drop-off.
  const baseline = freshBaseline(history);
  const lastCounted = baseline.length > 0 ? countedSets(baseline[0], count) : [];
  const lastWeight = lastCounted.length > 0 ? lastCounted[0].weight : null;
  const lastAvg = lastCounted.length > 0 ? repSum(lastCounted) / lastCounted.length : null;

  // Set 1's target:
  //   hold          → one rep past what set 1 managed last time
  //   load changed  → what the load–rep relationship predicts at the new weight.
  //                   Blanket-prescribing repLow after every change is wrong in
  //                   both directions: a rate-capped 2.5% jump barely costs a
  //                   rep, and a 10% deload buys back about three.
  const baseReps = rec.kind === 'hold'
    ? clamp((lastCounted[0]?.reps ?? ex.repLow) + 1, ex.repLow, ex.repHigh)
    : bodyweight
      ? clamp(rec.targetReps!, ex.repLow, ex.repHigh)
      : lastAvg != null && lastWeight != null && lastWeight > 0
        ? clamp(Math.round(predictReps(lastAvg, lastWeight, rec.weight)), ex.repLow, ex.repHigh)
        : ex.repLow;

  const drops = fatigueDrops(baseline, count, baseReps);
  const sets: PrescribedSet[] = Array.from({ length: count }, (_, i) => ({
    setNumber: i + 1,
    weight: rec.weight,
    targetReps: clamp(baseReps + drops[i], ex.repLow, ex.repHigh),
  }));

  const planTotal = sets.reduce((sum, s) => sum + (s.targetReps ?? 0), 0);
  const targetTotal = count * ex.repHigh;
  const goal = bodyweight
    ? `Hit every target for ${planTotal} total reps — ${targetTotal} earns a harder variation or added load.`
    : rec.kind === 'increase'
      ? `New load: ${rec.weight} lbs — around ${planTotal} reps today, then climb to ${targetTotal} to earn the next jump.`
      : rec.kind === 'hold'
        ? `Hit every target (${planTotal} reps) — ${targetTotal} at ${rec.weight} lbs earns the next increase.`
        : `Rebuild at ${rec.weight} lbs: ${planTotal} clean reps, then start climbing again.`;

  return { rec, sets, goal };
}
