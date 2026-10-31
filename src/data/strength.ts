// Strength records and goals — the one-rep max as a first-class input.
//
// Everything else the engines read is an ESTIMATE: a set of 185 × 9 implies a
// 1RM of about 240 by Epley, give or take the formula's error and the lifter's
// fibre type. A tested max is a MEASUREMENT. This module owns what the app does
// with one once the lifter enters it:
//
//   • PERCENTAGES. A rep range is a prescription; a 1RM turns it into a load.
//     The load–rep relationship the recommendation engine already runs on
//     (Epley solved for weight, shaded for several sets rather than one) maps
//     "3 × 8–12" onto "68–75% of max", which is how a coach writes a program and
//     how the exercise card can show what the prescribed weight MEANS.
//
//   • EVIDENCE. The log keeps producing estimates after the test. When the best
//     valid estimate climbs past the stored max, the lifter has got stronger
//     since they tested — the Strength screen says so and offers to update, but
//     never silently overwrites a measurement with an inference.
//
//   • PROJECTION. "How long until I squat 300?" has an honest answer with error
//     bars, not a date. Rate of strength gain is one of the better-established
//     quantities in the literature: untrained lifters add roughly 40% to their
//     strength over the first six months (ACSM 2009 position stand — ~1.3% a
//     week compounding), intermediates about 16% (~0.55%), and advanced lifters
//     perhaps 10% a year (~0.18%). The projection reads the lifter's OWN recent
//     trend first, bounded by those rates so one good fortnight can't promise a
//     300 lb squat by Christmas, and tempered by the goal (a deficit holds
//     strength rather than building it).
//
// Pure functions of plain inputs and a TrainingSnapshot, like every other
// engine in data/. Persistence lives in planStore.ts (the records ride the
// synced journey document); the UI lives in StrengthView.

import type { TrainingSnapshot } from './analytics';
import { epley1RM, sessionTimestamp } from './analytics';
import type { ExperienceLevel, Goal } from './plan';
import type { WeightType } from './taxonomy';
import type { Exercise, WorkoutDay } from './program';
import { E1RM_VALID_REPS, REANCHOR_SAFETY, loadForReps, loadFromMax } from './recommendations';

// ── Records ───────────────────────────────────────────────────────────────────

export type MaxSource = 'tested' | 'estimated';

/** The lifter's known one-rep max for one exercise. One per exercise. */
export interface OneRepMax {
  exerciseId: string;
  /** lbs */
  weight: number;
  /** tested = a real single (or a known max); estimated = a self-estimate or adopted from the log */
  source: MaxSource;
  /** yyyy-mm-dd the max was set, for staleness */
  date: string;
  /** when the record was written — the recommendation engine compares this to the latest session */
  updatedAt: number;
}

/** A target one-rep max for one exercise. One per exercise. */
export interface StrengthGoal {
  exerciseId: string;
  /** lbs */
  targetWeight: number;
  createdAt: number;
}

/** The strength section of the journey document. */
export interface StrengthState {
  maxes: OneRepMax[];
  goals: StrengthGoal[];
}

export function emptyStrengthState(): StrengthState {
  return { maxes: [], goals: [] };
}

// ── %1RM math ─────────────────────────────────────────────────────────────────

/**
 * The share of a 1RM that `reps` is a limit set at, by Epley: 1/(1 + reps/30).
 * 5 reps → 86%, 8 → 79%, 10 → 75%, 12 → 71%. Standard %1RM tables land within a
 * couple of points of these across the 1–12 range the formula is fitted on.
 */
export function pctOfMaxForReps(reps: number): number {
  return 1 / (1 + reps / 30);
}

/** A load as a percentage of a max, rounded. */
export function pctOfMax(load: number, oneRepMax: number): number {
  return oneRepMax > 0 ? Math.round((load / oneRepMax) * 100) : 0;
}

export interface PercentBand {
  /** % of max at the top of the range (the lighter end), shaded for working sets */
  low: number;
  /** % of max at the bottom of the range */
  high: number;
}

/**
 * What a rep range means as a share of the max: the prescribed working load
 * sits at `low` (several sets at repHigh) and the range tops out at `high`
 * (a hard set of repLow). Shaded by REANCHOR_SAFETY for the same reason the
 * engine shades its re-anchor — three sets at a rep count live below one
 * all-out set at it.
 */
export function percentBandFor(slot: Pick<Exercise, 'repLow' | 'repHigh'>): PercentBand | null {
  if (slot.repLow == null || slot.repHigh == null) return null;
  return {
    low: Math.round(pctOfMaxForReps(slot.repHigh) * REANCHOR_SAFETY * 100),
    high: Math.round(pctOfMaxForReps(slot.repLow) * REANCHOR_SAFETY * 100),
  };
}

export interface LoadBand {
  /** the working load the engine would prescribe (snapped to the equipment) */
  working: number;
  /** load at the bottom of the range, unsnapped guidance */
  top: number;
  pct: PercentBand;
}

/** The loads a max prescribes for a slot — the "% table" for one line of the program. */
export function loadBandFor(
  oneRepMax: number,
  slot: Pick<Exercise, 'repLow' | 'repHigh'>,
  weightType?: WeightType | null,
): LoadBand | null {
  const pct = percentBandFor(slot);
  if (!pct || oneRepMax <= 0 || slot.repLow == null || slot.repHigh == null) return null;
  return {
    working: loadFromMax(oneRepMax, slot.repHigh, weightType),
    top: Math.round(loadForReps(oneRepMax, slot.repLow) * REANCHOR_SAFETY),
    pct,
  };
}

/** Every slot in the program that carries this exercise, with its load band. */
export function programLoadsFor(
  exerciseId: string,
  oneRepMax: number,
  program: WorkoutDay[],
  weightType?: WeightType | null,
): { day: WorkoutDay; slot: Exercise; band: LoadBand | null }[] {
  const out: { day: WorkoutDay; slot: Exercise; band: LoadBand | null }[] = [];
  for (const day of program) {
    for (const slot of day.exercises) {
      if (slot.id !== exerciseId) continue;
      out.push({ day, slot, band: loadBandFor(oneRepMax, slot, weightType) });
    }
  }
  return out;
}

// ── Log-derived evidence ──────────────────────────────────────────────────────

export interface LoggedMax {
  /** best Epley estimate from sets inside the formula's valid range */
  e1rm: number;
  /** the set it came from */
  weight: number;
  reps: number;
  ts: number;
}

/**
 * The strongest thing the log says about this lift: the best estimated 1RM
 * from sets of ≤ E1RM_VALID_REPS reps (a 20-rep set produces a number too,
 * just not a useful one). A logged single IS a max — it comes through here at
 * reps = 1 with e1rm ≈ weight × 1.03.
 */
export function bestLoggedMax(snapshot: TrainingSnapshot, exerciseId: string): LoggedMax | null {
  let best: LoggedMax | null = null;
  for (const session of snapshot.sessions) {
    const ts = sessionTimestamp(session);
    for (const s of snapshot.setsBySession.get(session.id!) ?? []) {
      if (s.exerciseId !== exerciseId || s.weight <= 0 || s.reps <= 0 || s.reps > E1RM_VALID_REPS) continue;
      const e1rm = epley1RM(s.weight, s.reps);
      if (!best || e1rm > best.e1rm) best = { e1rm, weight: s.weight, reps: s.reps, ts };
    }
  }
  return best;
}

/** Best valid e1RM per session for one exercise, oldest first. */
export function e1rmSeriesFor(snapshot: TrainingSnapshot, exerciseId: string): { ts: number; e1rm: number }[] {
  const points: { ts: number; e1rm: number }[] = [];
  for (const session of snapshot.sessions) {
    let best = 0;
    for (const s of snapshot.setsBySession.get(session.id!) ?? []) {
      if (s.exerciseId !== exerciseId || s.weight <= 0 || s.reps <= 0 || s.reps > E1RM_VALID_REPS) continue;
      best = Math.max(best, epley1RM(s.weight, s.reps));
    }
    if (best > 0) points.push({ ts: sessionTimestamp(session), e1rm: best });
  }
  return points.sort((a, b) => a.ts - b.ts);
}

/** Sessions the trend is read from, and how far back it may reach. */
export const TREND_WINDOW_WEEKS = 12;
const TREND_MIN_POINTS = 3;
const TREND_MIN_SPAN_WEEKS = 3;
const WEEK_MS = 7 * 86_400_000;

export interface StrengthTrend {
  /** % of the current e1RM gained per week, from a least-squares fit */
  ratePctPerWeek: number;
  points: number;
  spanWeeks: number;
}

/**
 * The lifter's recent rate of strength gain on this lift — a least-squares line
 * through the best e1RM of each session in the trailing TREND_WINDOW_WEEKS,
 * expressed as % of the current level per week. Null when there isn't enough
 * to fit (fewer than three sessions, or all inside a fortnight): two points
 * always make a line, and a line through two points is not a trend.
 */
export function strengthTrend(
  snapshot: TrainingSnapshot,
  exerciseId: string,
  now = Date.now(),
): StrengthTrend | null {
  const cutoff = now - TREND_WINDOW_WEEKS * WEEK_MS;
  const pts = e1rmSeriesFor(snapshot, exerciseId).filter(p => p.ts >= cutoff);
  if (pts.length < TREND_MIN_POINTS) return null;
  const spanWeeks = (pts[pts.length - 1].ts - pts[0].ts) / WEEK_MS;
  if (spanWeeks < TREND_MIN_SPAN_WEEKS) return null;

  const xs = pts.map(p => (p.ts - pts[0].ts) / WEEK_MS);
  const ys = pts.map(p => p.e1rm);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den; // lbs per week
  const level = my + slope * (xs[xs.length - 1] - mx); // fitted current e1RM
  if (level <= 0) return null;
  return { ratePctPerWeek: (slope / level) * 100, points: pts.length, spanWeeks };
}

// ── The current best estimate of the max ──────────────────────────────────────

export type MaxBasis = 'tested' | 'entered' | 'log';

export interface CurrentMax {
  value: number;
  basis: MaxBasis;
  ts: number;
  /** the stored max has been beaten by what the log shows since it was set */
  logExceedsStored: boolean;
}

/**
 * What the app currently believes the max is. The stored record stands — a
 * test is a test — unless the log has produced a HIGHER estimate SINCE it was
 * set, in which case the lifter has demonstrably got stronger and the newer,
 * higher number is the honest one (flagged so the UI can offer to update the
 * record). A lower estimate never overrides a stored max: sub-max sets don't
 * disprove a single.
 */
export function currentMax(stored: OneRepMax | null, logged: LoggedMax | null): CurrentMax | null {
  if (stored && stored.weight > 0) {
    const exceeded = logged != null && logged.ts > stored.updatedAt && logged.e1rm > stored.weight;
    return exceeded
      ? { value: Math.round(logged!.e1rm), basis: 'log', ts: logged!.ts, logExceedsStored: true }
      : { value: stored.weight, basis: stored.source === 'tested' ? 'tested' : 'entered', ts: stored.updatedAt, logExceedsStored: false };
  }
  if (logged) return { value: Math.round(logged.e1rm), basis: 'log', ts: logged.ts, logExceedsStored: false };
  return null;
}

// ── Goal projection ───────────────────────────────────────────────────────────

/**
 * Expected rate of 1RM gain by training age, % per week (compounding). From
 * the ACSM (2009) progression position stand's summary of strength gains:
 * ~40% in the first ~6 months untrained, ~16% intermediate, ~10%/yr advanced.
 */
export const EXPECTED_WEEKLY_GAIN_PCT: Record<ExperienceLevel, number> = {
  beginner: 1.3,
  intermediate: 0.55,
  advanced: 0.18,
};

// How far the lifter's own observed rate may pull the projection away from the
// expected rate for their training age. A beginner on linear progression
// really can beat the book for a while; nobody sustains four times it.
const OBSERVED_RATE_MIN_SCALE = 0.5;
const OBSERVED_RATE_MAX_SCALE = 2.0;
// With a flat or falling recent trend, project at this share of the expected
// rate: the plateau is real, but so is the deload/replan that follows it.
const FLAT_TREND_SCALE = 0.5;
// Error band on the ETA. Strength gain is noisy enough that quoting one date
// would be false precision; the band is what a coach would actually say.
const ETA_BAND = { fast: 1.4, slow: 0.7 };
// Beyond this the projection stops being a plan and becomes a guess.
export const PROJECTION_HORIZON_WEEKS = 104;

/** How the goal being trained for changes what strength gain to expect. */
export const GOAL_RATE_SCALE: Record<Goal, number> = {
  strength: 1.15,
  hypertrophy: 1.0,
  general: 0.9,
  athletic: 1.0,
  // Energy availability is the limiter in a deficit; holding is the win.
  'fat-loss': 0.3,
  // Strength is defended, not chased, and the sport takes the recovery.
  'sport-support': 0.5,
};

export type GoalFeasibility = 'reached' | 'close' | 'realistic' | 'ambitious' | 'long-shot';

export interface GoalProjection {
  current: number;
  target: number;
  /** % the max has to climb */
  gapPct: number;
  /** progress toward the goal, 0–1, from where the lifter started tracking */
  feasibility: GoalFeasibility;
  /** central estimate; null when it's past the horizon */
  weeks: number | null;
  /** fast / slow bounds of the estimate */
  weeksFast: number | null;
  weeksSlow: number | null;
  /** central ETA as a timestamp; null past the horizon */
  etaTs: number | null;
  /** the rate the projection used, % of current per week */
  ratePctPerWeek: number;
  basis: 'observed' | 'expected' | 'tempered';
  /** plain-language caveats, in order of importance */
  notes: string[];
}

export interface ProjectionInput {
  current: number;
  target: number;
  experience: ExperienceLevel;
  goal: Goal;
  /** the lifter's own recent rate on this lift, when there is one */
  trend: StrengthTrend | null;
  now?: number;
}

function weeksAt(gapRatio: number, ratePct: number): number | null {
  if (ratePct <= 0) return null;
  const weeks = Math.log(gapRatio) / Math.log(1 + ratePct / 100);
  return weeks > PROJECTION_HORIZON_WEEKS ? null : Math.ceil(weeks);
}

/**
 * How long a 1RM goal should take, and how sure the coach is about it.
 *
 * The rate comes from the lifter's own trend when there is one, clamped to a
 * plausible multiple of the expected rate for their training age; from the
 * expected rate alone when there isn't; and from a tempered expected rate when
 * the trend is flat or falling. The goal scales it last — a deficit or a race
 * build is not when strength PRs happen, and the projection should say so
 * rather than quietly quoting a hypertrophy timeline.
 */
export function projectGoal(input: ProjectionInput): GoalProjection {
  const { current, target, experience, goal, trend } = input;
  const now = input.now ?? Date.now();
  const notes: string[] = [];
  const gapPct = current > 0 ? ((target - current) / current) * 100 : 0;

  const expected = EXPECTED_WEEKLY_GAIN_PCT[experience];
  let rate = expected;
  let basis: GoalProjection['basis'] = 'expected';

  if (trend) {
    if (trend.ratePctPerWeek > 0) {
      rate = Math.min(expected * OBSERVED_RATE_MAX_SCALE, Math.max(expected * OBSERVED_RATE_MIN_SCALE, trend.ratePctPerWeek));
      basis = 'observed';
      if (trend.ratePctPerWeek > rate) {
        notes.push(`Your recent pace (${trend.ratePctPerWeek.toFixed(1)}%/week) is faster than most ${experience} lifters sustain — the estimate assumes it settles.`);
      }
    } else {
      rate = expected * FLAT_TREND_SCALE;
      basis = 'tempered';
      notes.push(`Your est. 1RM has been flat over the last ${Math.round(trend.spanWeeks)} weeks — the estimate assumes progress resumes at half the usual pace once the plateau breaks.`);
    }
  } else {
    notes.push(`Not enough recent sessions to read your own pace yet — this uses the typical rate for ${experience === 'intermediate' || experience === 'advanced' ? 'an' : 'a'} ${experience} lifter.`);
  }

  const goalScale = GOAL_RATE_SCALE[goal];
  rate *= goalScale;
  if (goal === 'fat-loss') {
    notes.push('You\'re in a fat-loss block: strength is defended, not built, in a deficit. Plan a strength or muscle block to chase this number.');
  } else if (goal === 'sport-support') {
    notes.push('Your lifting is supporting another sport, so the coach holds strength rather than chasing it — expect this to take longer than a dedicated strength block.');
  }

  if (current <= 0) {
    return {
      current, target, gapPct: 0, feasibility: 'long-shot', weeks: null, weeksFast: null, weeksSlow: null,
      etaTs: null, ratePctPerWeek: rate, basis,
      notes: ['Enter a current 1RM (or log a few sessions) and the coach can estimate a timeline.'],
    };
  }
  if (target <= current) {
    return {
      current, target, gapPct, feasibility: 'reached', weeks: 0, weeksFast: 0, weeksSlow: 0,
      etaTs: now, ratePctPerWeek: rate, basis,
      notes: ['You\'re already there — set a new target, or test it and log the single.'],
    };
  }

  const ratio = target / current;
  const weeks = weeksAt(ratio, rate);
  const weeksFast = weeksAt(ratio, rate * ETA_BAND.fast);
  const weeksSlow = weeksAt(ratio, rate * ETA_BAND.slow);

  let feasibility: GoalFeasibility;
  if (weeks == null) {
    feasibility = 'long-shot';
    notes.push(`At this pace that's more than ${PROJECTION_HORIZON_WEEKS / 52 | 0} years out. A nearer milestone keeps the goal doing its job.`);
  } else if (gapPct <= 3) feasibility = 'close';
  else if (weeks <= 16) feasibility = 'realistic';
  else if (weeks <= 40) feasibility = 'ambitious';
  else {
    feasibility = 'long-shot';
    notes.push('A long way out — consider a milestone on the way (the next 5–10%) so progress stays visible.');
  }

  return {
    current, target, gapPct, feasibility,
    weeks, weeksFast, weeksSlow,
    etaTs: weeks == null ? null : now + weeks * WEEK_MS,
    ratePctPerWeek: rate,
    basis,
    notes,
  };
}

export const FEASIBILITY_LABEL: Record<GoalFeasibility, string> = {
  reached: 'Reached',
  close: 'Within reach',
  realistic: 'Realistic',
  ambitious: 'Ambitious',
  'long-shot': 'Long shot',
};

/** "~14 weeks (10–20)" or "more than two years" — the ETA as a coach would say it. */
export function etaLabel(p: GoalProjection): string {
  if (p.feasibility === 'reached') return 'already there';
  if (p.weeks == null) return 'more than two years at this pace';
  const fast = p.weeksFast ?? p.weeks;
  const slow = p.weeksSlow ?? p.weeks;
  const band = fast === slow ? '' : ` (${fast}–${slow == null ? '100+' : slow})`;
  return `~${p.weeks} week${p.weeks === 1 ? '' : 's'}${band}`;
}

/** The share of the way from a starting max to the target, 0–1. */
export function goalProgress(startMax: number, current: number, target: number): number {
  if (target <= startMax) return 1;
  return Math.min(1, Math.max(0, (current - startMax) / (target - startMax)));
}
