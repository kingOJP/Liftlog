import type { Exercise } from './program';
import type { WeightType, MeasureUnit } from './taxonomy';
import type { ExperienceLevel, Goal, PhaseKind } from './plan';
import { isEasyPhase } from './plan';
import { epley1RM } from './analytics';
import {
  compositeScore, deadband, pctChange, stallWindowFor, holdsInsteadOfDeload,
  STALL_SCORE, PROGRESS_SCORE,
} from './progression';

// Next-session prescriptions built on double progression — the standard
// evidence-based loading scheme for hypertrophy and strength:
//   1. Work at a weight inside the target rep range.
//   2. Add reps session to session until the session's rep target is met.
//   3. Then add load (which drops reps back into the range) and repeat.
//
// Several things separate this from "same weight as last time":
//
//   • The trigger is VOLUME AT A FIXED LOAD, gated on the top of the range: one
//     set at repHigh, and a session that matches the most work you have ever
//     done at this weight. Demanding a rep total of `sets × repHigh` instead —
//     every set at the ceiling — asks for something reps-fall-off-with-fatigue
//     makes impossible, and the per-set plan itself never prescribes it. The
//     fixed load is what makes volume usable: tonnage across load changes falls
//     every time a lifter successfully adds weight (see progression.ts).
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
//   • A load that belongs to a DIFFERENT REP RANGE is re-anchored, not nudged.
//     Double progression only knows how to move a lifter within a range; when
//     the range itself changes underneath them — a hypertrophy block's 3×10–12
//     becoming a sport-support block's 4×4–6 — every increment rule is working
//     from the wrong starting point, and the rate cap makes the walk to the
//     right load take a month of sessions that are all too easy to be worth
//     doing. The estimated 1RM is what carries strength across rep ranges, so
//     it is what the new load is computed from.
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

export type RecKind = 'increase' | 'hold' | 'decrease' | 'deload' | 'reanchor';

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
  /**
   * How a set of this exercise is counted (exercises.ts `unit`). Timed work —
   * planks, carries — is prescribed and progressed in SECONDS. The engine is
   * otherwise unchanged: a hold logs at 0 lbs like other bodyweight work, so
   * the rep-progression path already drives it. This only fixes what the
   * prescription *says*, so a 45-second plank never reads as 45 repetitions.
   */
  unit?: MeasureUnit;
  /** For the weekly rate cap; defaults to now */
  now?: number;
}

// How many recent sessions at the same weight without progress on either lever
// count as a stall worth deloading for.
const STALL_SESSIONS = 3;
/**
 * How far apart the stall window may stretch before it stops meaning anything.
 *
 * A deload exists to shed accumulated fatigue. Three sessions spread across
 * three months carry no accumulated fatigue — that lifter trains this movement
 * rarely, or has been away, and cutting their load treats absence as if it were
 * over-reaching. Five weeks comfortably covers once-a-week training with a
 * missed session or two; past that the window is measuring the calendar rather
 * than the athlete.
 */
const STALL_WINDOW_DAYS = 35;
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
// How far outside the prescribed range the reps must sit before the load is
// treated as belonging to a different range rather than as ordinary progress.
// One rep past the top of the range is double progression working — that's what
// earns the next increase. Two or more, session after session, means the load
// was chosen for a range nobody is training in any more.
const RANGE_MISMATCH_REPS = 2;
// A rep max is one all-out set. A prescription of SEVERAL sets at that rep
// count necessarily lives below it, so the re-anchored load is shaded off the
// estimate — and on a goal whose whole point is arriving fresh for another
// sport, arriving slightly light is the cheap error.
const REANCHOR_SAFETY = 0.95;
// The most a single re-anchor may move the load. The estimate is built from a
// formula fitted on other people's fatigue profiles; if one step lands short,
// the next session re-anchors again from fresh evidence rather than betting the
// whole correction on one prediction.
const REANCHOR_MAX_STEP = 0.20;
const DEFAULT_EXPERIENCE: ExperienceLevel = 'intermediate';
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
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

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

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
 * The session's working sets in the order they were performed, capped at the
 * programmed set count. This is the STRICT view — the sets that can cost the
 * lifter load. Only work at the working weight counts, so a heavy top single or
 * a junk bonus set can never drag the average under the range and trigger a
 * back-off the lifter didn't earn.
 */
function countedSets(session: ExerciseSession, sets: number): LoggedSet[] {
  const w = workingWeight(session.sets);
  return session.sets.filter(s => s.weight === w).slice(0, sets);
}

/**
 * A set's reps expressed as work at the session's working weight. Ten reps at
 * 110 is not nine-tenths of twelve reps at 100 — it is MORE work, and the same
 * load–rep relationship the increments are sized from says how much more
 * (~1 rep per PCT_LOAD_PER_REP % of load). Lighter sets are never scaled up;
 * they don't reach the credited pool at all.
 */
function equivalentReps(set: LoggedSet, weight: number): number {
  if (weight <= 0 || set.weight <= weight) return set.reps;
  return set.reps + (((set.weight - weight) / weight) * 100) / PCT_LOAD_PER_REP;
}

/** What a session is worth against the prescription, read as generously as the evidence allows. */
interface Credit {
  /** How many of the programmed sets were covered */
  count: number;
  /** Work-equivalent rep total */
  total: number;
  /** Work-equivalent reps per set */
  average: number;
  /** Work-equivalent reps of the single best set — did any set reach the top of the range? */
  best: number;
  /** The sets themselves, for anything that needs the real numbers */
  sets: LoggedSet[];
}

/**
 * The work that counts toward EARNING something: the best `sets` of everything
 * at or above the working weight, each valued at what it would have been worth
 * at that weight. Three deliberate differences from the strict view above, all
 * of them in the lifter's favour:
 *
 *   • Heavier sets count, and count for more. A lifter who works up to a top
 *     set did more than the prescription asked for, not less — excluding it
 *     meant a session of 185×9, 185×9, 185×8, 205×7 registered as three sets
 *     against a programmed four and could never satisfy the increase rule at
 *     all, however hard the lifter worked.
 *   • The best sets count. Extra sets can then only ever help: a fifth set
 *     taken to failure is ignored rather than averaged in, so nobody is worse
 *     off for doing more work than they were asked for.
 *   • Nothing is scaled down. Sets below the working weight are already
 *     excluded as warm-ups.
 *
 * The cap at the programmed count keeps this honest in the other direction —
 * five sets of eight is still not "beat the 3×12 target".
 */
function credit(session: ExerciseSession, sets: number): Credit {
  const w = workingWeight(session.sets);
  const chosen = session.sets
    .filter(s => s.weight >= w)
    .sort((a, b) => equivalentReps(b, w) - equivalentReps(a, w))
    .slice(0, sets);
  const total = chosen.reduce((sum, s) => sum + equivalentReps(s, w), 0);
  return {
    count: chosen.length,
    total,
    average: chosen.length > 0 ? total / chosen.length : 0,
    best: chosen.reduce((max, s) => Math.max(max, equivalentReps(s, w)), 0),
    sets: chosen,
  };
}

/** Work-equivalent reps per set, or null when nothing was logged. */
function creditedAverage(session: ExerciseSession, sets: number): number | null {
  const c = credit(session, sets);
  return c.count > 0 ? c.average : null;
}

/**
 * The most work the lifter has ever done at this load — the high-water mark the
 * next session has to match to earn a load increase.
 *
 * Comparing volume at a FIXED load is what makes volume a usable trigger. Raw
 * tonnage across load changes falls every time a lifter successfully adds
 * weight; held at one load, the weight cancels out, the comparison is
 * like-for-like, and "more work than last time" means exactly what it says.
 *
 * Sessions from a different REP ERA are excluded. Three sets of eight at 100
 * lbs is 24 reps of work; the same 100 lbs prescribed as 4×4–6 is 22 at its
 * ceiling. Left in, the old prescription's volume becomes a bar the new one
 * cannot clear by design, and the lifter is held at a weight they have already
 * mastered — then deloaded for the flat sessions that follow. The threshold is
 * the same one the re-anchor uses to decide a load belongs to another range.
 *
 * @returns null when this load is new — nothing to beat, so nothing to block.
 */
function bestWorkAt(
  sessions: ExerciseSession[],
  weight: number,
  ex: PrescribedSlot,
): number | null {
  let best: number | null = null;
  for (const h of sessions) {
    if (h.sets.length === 0) continue;
    if (Math.abs(workingWeight(h.sets) - weight) >= 2.5) continue;
    const c = credit(h, ex.sets);
    if (c.count === 0 || c.average >= ex.repHigh + RANGE_MISMATCH_REPS) continue;
    if (best == null || c.total > best) best = c.total;
  }
  return best;
}

/**
 * The load an estimated 1RM predicts for a set of `reps` — Epley solved for
 * weight (e1RM = w × (1 + reps/30)). This is the piece that lets strength move
 * BETWEEN rep ranges: 205×7 and 245×3 are the same lifter, and only the e1RM
 * says so.
 */
function loadForReps(e1rm: number, reps: number): number {
  return e1rm / (1 + reps / 30);
}

/**
 * Best estimated 1RM from the sets where the formula is actually fitted
 * (≤ E1RM_VALID_REPS reps). A 20-rep set produces a number too, just not a
 * useful one — and here it would set the load for a whole block.
 */
function validE1rm(sets: LoggedSet[]): number {
  return sets.reduce(
    (max, s) => (s.weight > 0 && s.reps <= E1RM_VALID_REPS
      ? Math.max(max, epley1RM(s.weight, s.reps))
      : max),
    0,
  );
}

/** A load re-matched to a rep range it was not chosen for. */
interface Reanchor {
  weight: number;
  direction: 'up' | 'down';
  /** Reps the lifter was actually doing, which is what gave the mismatch away */
  avgReps: number;
  /** The estimate the new load came from; 0 when the load–rep model was used */
  e1rm: number;
}

/**
 * Detect a load that belongs to a different rep range, and compute what it
 * should be in this one.
 *
 * The set logs don't record the prescription that was in force when they were
 * written, so the mismatch is inferred from the only evidence there is: the
 * reps. A lifter grinding 9s in a 4–6 block is not mid-double-progression, they
 * are lifting a 10–12 load; a lifter managing 5s in a 10–12 block is lifting a
 * heavy-single load. Either way the honest coaching answer is the same, and it
 * is not a 5 lb nudge.
 *
 * Guards keep this from firing on ordinary training. The mismatch has to be
 * gross (RANGE_MISMATCH_REPS past the range), so hitting the top of the range
 * still routes through normal double progression — and the two directions carry
 * different burdens of proof, the same asymmetry the rest of the engine already
 * runs on (an increase fires on one session; a cut never does):
 *
 *   • TOO LIGHT re-anchors on the latest session alone, vetoed by a previous
 *     one that contradicts it. Beating the top of a range by two reps is
 *     evidence the lifter produced — a bad night's sleep makes reps fall, not
 *     climb, so noise is not a competing explanation for it.
 *   • TOO HEAVY needs a previous session that missed the same way. Falling
 *     short is exactly what an off day looks like, and cutting a lifter's load
 *     on one of those is the mistake this engine goes out of its way not to
 *     make. With no confirmation the ordinary under-range branch handles it,
 *     conservatively, as before.
 */
function rangeReanchor(
  baseline: ExerciseSession[],
  ex: PrescribedSlot,
  weight: number,
  step: number,
): Reanchor | null {
  if (weight <= 0 || baseline.length === 0) return null;
  const avg = creditedAverage(baseline[0], ex.sets);
  if (avg == null) return null;

  const tooLight = avg >= ex.repHigh + RANGE_MISMATCH_REPS;
  const tooHeavy = avg <= ex.repLow - RANGE_MISMATCH_REPS;
  if (!tooLight && !tooHeavy) return null;

  const prev = baseline.length > 1 ? creditedAverage(baseline[1], ex.sets) : null;
  if (tooLight ? prev != null && prev <= ex.repHigh : prev == null || prev >= ex.repLow) {
    return null;
  }

  // Match the estimated 1RM to the new range at the TOP of it: the lifter
  // enters able to complete the prescription, and climbs from there the normal
  // way. Entering at the bottom of the range means a near-limit set on the
  // first exposure to an unfamiliar rep bracket, which is where technique goes.
  // Where the estimate isn't trustworthy — every set was past the formula's
  // valid range — fall back to the load–rep model the increments already use.
  const e1rm = validE1rm(baseline[0].sets);
  const predicted = e1rm > 0
    ? loadForReps(e1rm, ex.repHigh) * REANCHOR_SAFETY
    : weight * (1 + ((avg - ex.repHigh) * PCT_LOAD_PER_REP) / 100);

  const capped = clamp(
    predicted,
    weight * (1 - REANCHOR_MAX_STEP),
    weight * (1 + REANCHOR_MAX_STEP),
  );
  const target = Math.max(MIN_WEIGHT, Math.floor(capped / step) * step);

  // The estimate has to agree with the reps about which way to go. When it
  // doesn't, there's no coherent story to tell the lifter — leave it to the
  // ordinary branches.
  if (tooLight && target <= weight) return null;
  if (tooHeavy && target >= weight) return null;

  return { weight: target, direction: target > weight ? 'up' : 'down', avgReps: avg, e1rm };
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
  // Nothing inside the last week is a layoff, not a clean slate. Anchor to the
  // most recent session and allow exactly one week's growth: time away doesn't
  // bank load increases, and the increase is still granted — just at the same
  // rate the lifter who trained through would have got. Lifting the cap here
  // handed the biggest jumps to the least recently trained lifts, which is the
  // wrong direction when the athlete is, if anything, slightly detrained.
  const anchor = inWeek.length > 0 ? inWeek[inWeek.length - 1] : baseline[0];
  if (!anchor) return null;
  const weekAgo = workingWeight(anchor.sets);
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

  // Progression by count (reps or seconds) rather than by load.
  const countProgressed =
    weight === 0 && (weightType === 'Bodyweight' || ctx.unit === 'seconds');

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
  const step = incrementFor(weight, weightType);

  // Does this load still belong to the prescription at all? Computed before the
  // phase branch as well as before the progression branches, because an easy
  // week off the WRONG load is still the wrong load: a new block that opens
  // with an intro week would otherwise spend it 20% below a weight that was
  // already 15 lbs light for the range.
  const reanchor = countProgressed ? null : rangeReanchor(baseline, ex, weight, step);

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

    // Intro weeks come in pairs for a novice, and they sit at the FRONT of a
    // block — so backing off from the last session compounds: week 2 would take
    // 80% of week 1's already-easy 80%, landing at 64% and getting easier as
    // the introduction goes on. Backwards. An intro week is measured against
    // the heaviest recent working weight instead, which is stable across
    // consecutive intro weeks and is what "well short of your working weight"
    // actually means. A deload is different and correctly relative to the last
    // session: it exists to shed fatigue from where you currently are.
    //
    // When the load has been re-anchored to a new rep range, that is the weight
    // the easy week backs off FROM — the old one was answering a question this
    // block is no longer asking.
    const introBase = reanchor
      ? reanchor.weight
      : phase === 'intro'
        ? Math.max(...baseline.map(h => workingWeight(h.sets)), weight)
        : weight;
    if (countProgressed) {
      return { weight: 0, targetReps: ex.repLow, direction: 'down', kind: 'deload', reason: easy };
    }
    return {
      weight: easeBack(introBase, factor, incrementFor(introBase, weightType)),
      direction: 'down', kind: 'deload', reason: easy,
    };
  }

  // A maintenance week holds load on purpose: volume is already trimmed by the
  // block's design, and intensity is the half of the dose that defends
  // strength. Double progression still applies — earn the top of the range and
  // the load still moves — it just isn't chased.

  // Count progression rather than load progression: bodyweight work logged at
  // 0 lbs, and every timed hold. The unit check is not redundant — it holds
  // even if a user edits the exercise's weight-type metadata, because a plank
  // is progressed by time whatever the catalog says it's loaded with. If
  // external load *was* logged (weighted pull-ups on a belt), the normal weight
  // engine applies.
  if (countProgressed) {
    return withContext(repProgression(baseline, last, ex, goal, ctx.unit ?? 'reps'));
  }

  // 0. The load belongs to a different rep range — re-anchor it before any
  // progression rule runs. Every branch below reasons about a lifter working
  // inside their range; none of them has a sensible answer for one who isn't,
  // and the increments they'd hand out are sized for a gap a tenth this size.
  if (reanchor) {
    const { weight: target, direction, avgReps: was, e1rm } = reanchor;
    const range = `${ex.repLow}–${ex.repHigh}`;
    const basis = e1rm > 0
      ? `your est. 1RM of ${Math.round(e1rm)} lbs puts ${range} reps at`
      : `matching that effort to ${range} reps puts you at`;
    return withContext({
      weight: target,
      direction,
      kind: 'reanchor',
      reason: `You've been working ${weight} lbs for about ${Math.round(was)} reps — that's a ${
        direction === 'up' ? 'lighter' : 'heavier'
      } range than this block's ${range}. Re-anchoring: ${basis} ${target} lbs`,
    });
  }

  // Stats over the PROGRAMMED set count, in two views. The GENEROUS one (best
  // sets at or above the working weight) is what can EARN an increase — extra
  // and heavier sets should only ever help. The STRICT one (working sets in
  // order, at the working weight) is what can COST load, so nothing a lifter
  // adds on top of the prescription can be used against them.
  const credited = credit(last, ex.sets);
  const strict = countedSets(last, ex.sets);
  const setsDone = credited.count;
  // Actual reps, not work-equivalent ones: this decides whether the est. 1RM
  // formula is inside the range it was fitted on, which is a fact about the
  // sets that were performed.
  const maxReps = Math.max(...credited.sets.map(s => s.reps));
  const repTotal = credited.total;
  const avgReps = credited.average;
  const strictAvg = repSum(strict) / strict.length;
  const fullSetCount = setsDone >= ex.sets;

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

  // 1a. The load has been mastered → add weight. Two conditions, and the second
  // one is why this reads volume rather than a fixed rep total:
  //
  //   • the top of the rep range was reached on a set, and
  //   • the session is the most work the lifter has ever done AT THIS LOAD.
  //
  // The old rule demanded a rep total of `sets × repHigh` — every set at the
  // ceiling. No lifter does that: reps fall off set to set, which is why the
  // per-set plan prescribes a descending fit in the first place. So the plan
  // asked for 6/6/5/5 while the trigger required 6/6/6/6, the lifter did
  // exactly what was asked every week, and three flat sessions later the stall
  // branch deloaded them for it. Volume at a fixed load is the honest measure
  // of "more than last time", and pairing it with the range ceiling keeps
  // double progression intact: no amount of extra volume adds load until the
  // lifter is working at the top of the range.
  //
  // The jump is sized so they land back inside the range, not on a flat 5 lbs.
  // In a deficit the minimum step is used instead: recovery capacity is reduced
  // and the objective is retaining muscle, not chasing loading PRs.
  const priorBest = bestWorkAt(baseline.slice(1), weight, ex);
  const rangeTopped = credited.best >= ex.repHigh;
  if (fullSetCount && rangeTopped && (priorBest == null || repTotal >= priorBest)) {
    const jump = goal === 'fat-loss'
      ? step
      : sizedIncrement(weight, avgReps, ex.repLow, step);
    const evidence = priorBest == null
      ? `Hit ${ex.repHigh} reps at ${weight} lbs`
      : `${Math.round(repTotal)} reps at ${weight} lbs — your best work at this load, with a set at ${ex.repHigh}`;
    return increaseTo(jump, evidence);
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
  // The verdict comes from the same goal-weighted composite the Metrics screen
  // reports (progression.ts), so the app cannot tell you a lift is steady and
  // then deload it in the next workout. Three properties matter:
  //
  //   • BOTH LEVERS, weighted by the goal. Reading est. 1RM alone flags a
  //     lifter going 10/9/8 → 10/10/9 → 10/10/10 as stalled because their top
  //     set never moved — yet that is textbook double progression. Reading
  //     volume alone misses a lifter whose reps are flat while the bar keeps
  //     getting heavier. What each is worth depends on what they train for:
  //     est. 1RM carries a strength block, volume carries a hypertrophy one.
  //   • THE BEST OF THE WINDOW, not the latest session, is compared to the
  //     anchor — otherwise one bad night's sleep is a deload (24 → 27 → 30 → 24
  //     reads as "no progress" despite a high-water mark two sessions back).
  //   • A DEAD BAND. Session-to-session performance moves a few percent on
  //     sleep and food alone, so changes inside NOISE_FLOOR_PCT are read as no
  //     change rather than as a trend in either direction.
  const stallWindow = stallWindowFor(experience);
  const window = baseline.slice(0, stallWindow);
  const sparseWindow = window.length >= stallWindow &&
    window[0].completedAt - window[window.length - 1].completedAt > STALL_WINDOW_DAYS * DAY_MS;
  if (window.length >= stallWindow && !sparseWindow) {
    const sameWeight = window.every(h => Math.abs(workingWeight(h.sets) - weight) < 2.5);
    const anchor = window[window.length - 1];
    const anchorTotal = credit(anchor, ex.sets).total;
    const anchorE1rm = bestE1rm(anchor.sets);
    const since = window.slice(0, -1);

    // Credited totals on both sides: a session where the lifter added a set or
    // worked up to a heavier top set is evidence of progress, and evidence of
    // progress is what calls off a deload.
    const bestTotal = Math.max(...since.map(h => credit(h, ex.sets).total));
    const bestSinceE1rm = Math.max(...since.map(h => bestE1rm(h.sets)));
    const volumeChangePct = deadband(pctChange(anchorTotal, bestTotal));
    const e1rmChangePct = e1rmMeaningful ? deadband(pctChange(anchorE1rm, bestSinceE1rm)) : null;
    // Local stand-in for the PR events the review engine counts: sessions that
    // set a new high inside the window, on either lever.
    const prEvents = since.filter(h =>
      credit(h, ex.sets).total > anchorTotal ||
      (e1rmMeaningful && bestE1rm(h.sets) > anchorE1rm * (1 + STALL_TOLERANCE))).length;

    const score = compositeScore({ e1rmChangePct, volumeChangePct, prEvents }, goal, experience);

    // Two bars, because the two decisions carry different costs. CUTTING a
    // lifter's load needs a real stall (STALL_SCORE). Merely telling someone
    // they're flat — and that holding here is the win, which is the whole point
    // of the fat-loss and sport-support framing — only needs the absence of
    // clear progress. Scoring them on one bar hid the explanation exactly where
    // it was most useful: "holding counts" lifts the score just past a stall,
    // so the lifter got a generic chase-reps line instead of being told that
    // defending the load through a deficit is the objective.
    const flat = sameWeight && prEvents === 0 && score < PROGRESS_SCORE;
    const stalled = sameWeight && prEvents === 0 && score < STALL_SCORE;

    if (holdsInsteadOfDeload(goal, experience) ? flat : stalled) {
      // Not everyone gets their load cut. In a deficit the plateau reflects
      // energy availability rather than accumulated fatigue; supporting a sport
      // it reflects the swim, bike and run; and a novice who stopped adding
      // reps needs another rep at this weight, not a lighter one.
      if (holdsInsteadOfDeload(goal, experience)) {
        const why = goal === 'fat-loss'
          ? `Holding ${weight} lbs through a deficit is the win — defend this load, PRs come back when you eat`
          : goal === 'sport-support'
            ? `Flat at ${weight} lbs, but your legs are paying for the miles — holding this load through the block is the win`
            : `Flat for ${window.length} sessions — repeat ${weight} lbs and chase one more rep before changing anything`;
        return withContext({ weight, direction: 'hold', kind: 'hold', reason: why });
      }
      return withContext({
        weight: easeBack(weight, 0.9, step),
        direction: 'down',
        kind: 'deload',
        reason: `${window.length} sessions at ${weight} lbs with no gain in volume or strength — deload, then build back up`,
      });
    }
  }

  // 3. Under the rep range → ease the load back, but only on evidence. Day-to-day
  // strength swings from sleep, food and stress are large; programming a load cut
  // off one session reacts to noise. It takes a clear miss, or a second session
  // confirming the first. In a deficit only a confirmed miss counts — an
  // under-range day there is the deficit talking.
  //
  // The session is read at its most favourable here: whichever of the two views
  // looks better is the one that counts, so a lifter who worked up to a heavy
  // top set or tacked on an extra set can never be talked into a load cut by
  // work they volunteered for.
  const judgedAvg = Math.max(strictAvg, avgReps);
  if (judgedAvg < ex.repLow) {
    // The confirming session has to be at the SAME load. Judging the first
    // session after a back-off against the miss that caused it would walk the
    // weight down a step at a time, forever.
    const previous = baseline[1];
    const repeated = previous != null &&
      Math.abs(workingWeight(previous.sets) - weight) < 2.5 && (() => {
        const prev = creditedAverage(previous, ex.sets);
        return prev != null && prev < ex.repLow;
      })();
    const bigMiss = goal !== 'fat-loss' && judgedAvg <= ex.repLow - BIG_MISS_REPS;

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
  // reason names whichever of the two conditions is still outstanding, so
  // "hold" is a target rather than a shrug.
  const reason = !fullSetCount
    ? `Complete all ${ex.sets} sets at this weight, then chase reps`
    : sparseWindow
      // The stall check was skipped on purpose — say so, rather than leaving the
      // lifter wondering why a flat run of sessions produced no verdict.
      ? `You've been away from this one — settle back in at ${weight} lbs before pushing, then a set at ${ex.repHigh} reps earns the next increase`
      : !rangeTopped
        ? `Get one set to ${ex.repHigh} reps at ${weight} lbs — that's what earns the next increase`
        : `${Math.round((priorBest ?? 0) - repTotal + 1)} more reps than your best at ${weight} lbs (${Math.round(priorBest ?? 0)}) earns the next increase`;
  return withContext({ weight, direction: 'hold', kind: 'hold', reason });
}

// ── Rep progression (bodyweight at 0 lbs) ─────────────────────────────────────
// Same shape as the weight engine, but the lever is reps per set: total session
// reps stand in for e1RM as the progress metric, and the recommendation carries
// a `targetReps` goal instead of a new load.

/**
 * Progression by count rather than by load — bodyweight work at 0 lbs, and
 * timed holds, which are the same thing measured in seconds. The four branches
 * are identical either way; only the wording changes, because "push for 46
 * reps" is nonsense on a plank.
 */
function repProgression(
  history: ExerciseSession[],
  last: ExerciseSession,
  exercise: PrescribedSlot,
  goal: Goal,
  unit: MeasureUnit = 'reps',
): WeightRec {
  const minReps = Math.min(...last.sets.map(s => s.reps));
  const avgReps = repSum(last.sets) / last.sets.length;
  const timed = unit === 'seconds';
  const n = (v: number) => (timed ? `${v}s` : `${v} reps`);

  // 1. Rep range beaten across a full set count → raise the rep goal
  if (last.sets.length >= exercise.sets && minReps >= exercise.repHigh) {
    return {
      weight: 0,
      targetReps: minReps + 1,
      direction: 'up',
      kind: 'increase',
      reason: timed
        ? `All ${last.sets.length} holds hit ${exercise.repHigh}s+ — push for ${n(minReps + 1)}`
        : `All ${last.sets.length} sets hit ${exercise.repHigh}+ — push for ${minReps + 1} reps, or add weight`,
    };
  }

  // 2. Total reps stalled for several sessions → back off and rebuild.
  // Same calendar guard as the loaded engine: sessions spread across months are
  // infrequent training, not a plateau to shed fatigue from.
  const window = history.filter(h => h.sets.length > 0).slice(0, STALL_SESSIONS);
  const sparseWindow = window.length >= STALL_SESSIONS &&
    window[0].completedAt - window[window.length - 1].completedAt > STALL_WINDOW_DAYS * DAY_MS;
  if (window.length >= STALL_SESSIONS && !sparseWindow) {
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
          reason: `Holding ${n(minReps)} through a deficit is the win — defend this standard`,
        };
      }
      return {
        weight: 0,
        targetReps: exercise.repLow,
        direction: 'down',
        kind: 'deload',
        reason: timed
          ? `Stalled ${window.length} sessions — reset to ${n(exercise.repLow)} of clean bracing and build back up`
          : `Stalled ${window.length} sessions — reset to ${exercise.repLow} crisp reps and build back up`,
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
      reason: timed
        ? `Holds fell under ${n(exercise.repLow)} — build back into the range`
        : `Reps fell under ${exercise.repLow} — build back into the range`,
    };
  }

  // 4. In range → chase one more rep per set
  const target = Math.min(minReps + 1, exercise.repHigh);
  const reason =
    last.sets.length < exercise.sets
      ? `Complete all ${exercise.sets} sets, then chase ${timed ? 'time' : 'reps'}`
      : sparseWindow
        ? `You've been away from this one — settle back in, then aim for ${n(target)}+ per set`
        : `In range — aim for ${n(target)}+ per set, toward ${exercise.sets}×${exercise.repHigh}${timed ? 's' : ''}`;
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
  const timed = ctx.unit === 'seconds';
  const unitWord = timed ? 'seconds' : 'reps';

  // Nothing prescribed — ad-hoc work with no plan to dose it and no history to
  // read a range off. Lay out the sets and let the lifter log freely; showing a
  // fabricated 8–12 target here would be the coach guessing out loud.
  if (exercise.repLow == null || exercise.repHigh == null) {
    return {
      rec,
      sets: Array.from({ length: count }, (_, i) => ({
        setNumber: i + 1, weight: rec?.weight ?? null, targetReps: null,
      })),
      goal: `No ${unitWord.slice(0, -1)} target yet — log this session and the coach will learn the range you work in.`,
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
      goal: timed
        ? `First time on this one — hold ${ex.repLow}–${ex.repHigh} seconds with clean form, and stop before the form goes.`
        : ctx.weightType === 'Bodyweight'
          ? `First time on this one — ${ex.repLow}–${ex.repHigh} controlled reps, stopping while they still look good.`
          : `First time on this lift — find a weight you can control for ${ex.repLow}–${ex.repHigh} reps with 1–2 in reserve.`,
    };
  }

  const bodyweight = rec.targetReps != null && rec.weight === 0;

  // A planned easy week is about crisp, submaximal reps — flat targets at the
  // bottom of the range, no fatigue-chasing. Every other week gets the model.
  if (rec.kind === 'deload' && isEasyPhase(phase ?? null)) {
    return {
      rec,
      sets: Array.from({ length: count }, (_, i) => ({
        setNumber: i + 1, weight: rec.weight, targetReps: ex.repLow,
      })),
      goal: timed
        ? 'Hold each set to the target and stop — the easy week is the plan working.'
        : 'Leave 3–4 reps in reserve on every set. The easy week is the plan working.',
    };
  }

  // The prescription builds off the same fresh-slot sessions the recommendation
  // did, so a late-slot session can't skew either the targets or the drop-off.
  const baseline = freshBaseline(history);
  const lastCounted = baseline.length > 0 ? countedSets(baseline[0], count) : [];
  const lastWeight = lastCounted.length > 0 ? lastCounted[0].weight : null;
  // Reps to predict from come from the credited view, so a top set counts the
  // same way it does in the recommendation itself.
  const lastAvg = baseline.length > 0 ? creditedAverage(baseline[0], count) : null;

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

  // What actually earns the next jump at this load: reach the top of the range
  // on a set, and beat your own best work here. Stating the real number matters
  // — the old line quoted `sets × repHigh`, a total the targets above it never
  // added up to, so the plan and the goal disagreed on every single card.
  const toBeat = rec.weight > 0 ? bestWorkAt(freshBaseline(history), rec.weight, ex) : null;
  const holdGoal = toBeat == null
    ? `Hit every target (${planTotal} reps) — a set at ${ex.repHigh} reps earns the next increase.`
    : `Hit every target (${planTotal} reps) — a set at ${ex.repHigh}, and ${Math.round(toBeat)}+ total at ${rec.weight} lbs, earns the next increase.`;

  const goal = timed
    ? `Hit every hold for ${planTotal} total seconds — ${targetTotal} earns a longer target next time.`
    : bodyweight
    ? `Hit every target for ${planTotal} total reps — ${targetTotal} earns a harder variation or added load.`
    : rec.kind === 'reanchor'
      ? `First session at ${rec.weight} lbs — this is an estimate from your log, not a test. Around ${planTotal} reps with 1–2 in reserve, and the coach corrects from what you actually hit.`
      : rec.kind === 'increase'
        ? `New load: ${rec.weight} lbs — around ${planTotal} reps today. A set at ${ex.repHigh} earns the next jump.`
        : rec.kind === 'hold'
          ? holdGoal
          : `Rebuild at ${rec.weight} lbs: ${planTotal} clean reps, then start climbing again.`;

  return { rec, sets, goal };
}
