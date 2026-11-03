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
//   • WHAT IT TAKES. "How long until I squat 300?" is not a question this app
//     answers — a date computed from a self-reported training level is a guess
//     wearing a number. What a coach can say is what the climb consists of:
//     the lift itself two or three times a week, variations that attack the
//     weak position (paused, deficit, front rack), and a read of the log that
//     says WHICH weakness. That read is `techniqueRead`: a lifter whose 5–8-rep
//     strength implies a max well above anything they have shown for a single
//     or a triple is leaving it in the bottom position, not in the engine.
//
//   • THE BLOCK ESTIMATE. Once a block is actually designed — its length, how
//     often the lift is trained — the question becomes bounded enough to
//     answer as a range: what this block is built to deliver. Rate of strength
//     gain is reasonably established (ACSM 2009: untrained ~40% in six months,
//     ~1.3%/week compounding; intermediate ~16%, ~0.55%; advanced ~10%/year,
//     ~0.18%), the lifter's own logged trend is used ahead of it where there is
//     one, and frequency and the block's goal scale it. Never a date.
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

/**
 * A lift the athlete is working on. One per exercise. The target is optional:
 * the record means "build this lift", and the number only decides how an
 * end-of-block estimate is framed against it.
 */
export interface StrengthGoal {
  exerciseId: string;
  /** lbs — optional */
  targetWeight?: number;
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
// ~20 days: three weekly sessions, with the wobble of real training times.
const TREND_MIN_SPAN_WEEKS = 2.85;
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

// ── What it takes ─────────────────────────────────────────────────────────────

export interface LiftVariation {
  /** catalog exercise id */
  id: string;
  /** why this variation earns a slot alongside the lift, in coach voice */
  why: string;
}

/**
 * The training partners of the big lifts: variations that load the position
 * where a max is usually lost. Each is a catalog exercise in its own right
 * (strength.test.ts checks every id resolves) — a paused rep is ~10% lighter
 * and must never share a history with the parent lift. Order matters: the
 * first entry is the variation a second weekly session gets.
 */
export const VARIATIONS: Record<string, LiftVariation[]> = {
  'barbell-back-squat': [
    { id: 'paused-back-squat', why: 'A dead stop in the hole removes the bounce — it builds the bottom position, where a heavy squat is actually lost.' },
    { id: 'front-squat', why: 'An upright torso and a loaded brace: the front rack punishes a chest that drops, so the back squat stops folding.' },
  ],
  'flat-barbell-bench-press': [
    { id: 'paused-bench-press', why: 'Pressing from a motionless bar builds the off-the-chest drive that a touch-and-go rep hides.' },
    { id: 'close-grip-bench-press', why: 'Tricep lockout strength — the second half of a heavy bench is a close-grip press.' },
  ],
  'conventional-deadlift': [
    { id: 'paused-deadlift', why: 'A pause below the knee trains the position where the back rounds and the bar drifts — the usual reason a pull stalls.' },
    { id: 'deficit-deadlift', why: 'Pulling from a deficit makes the floor the hardest part, so the first inch of a max never is.' },
  ],
  'barbell-overhead-press': [
    { id: 'seated-db-overhead-press', why: 'Strict seated pressing removes the legs and the lean — pure shoulder and tricep strength through the sticking point.' },
    { id: 'close-grip-bench-press', why: 'Lockout strength for the top half of the press, trained heavier than the press itself allows.' },
  ],
};

/** The variations catalogued for a lift (empty for lifts without any). */
export function variationsFor(exerciseId: string): LiftVariation[] {
  return VARIATIONS[exerciseId] ?? [];
}

/**
 * Days a program trains a lift — the lift itself or any of its catalogued
 * variations — i.e. its weekly frequency. A day counts once however many of
 * them it holds.
 */
export function supportingFrequency(program: WorkoutDay[], exerciseId: string): number {
  const family = new Set([exerciseId, ...variationsFor(exerciseId).map(v => v.id)]);
  return program.filter(d => d.exercises.some(e => family.has(e.id))).length;
}

/** Days of the program that train a lift or one of its variations, with what each holds. */
export function supportingDays(program: WorkoutDay[], exerciseId: string): { day: WorkoutDay; ids: string[] }[] {
  const family = new Set([exerciseId, ...variationsFor(exerciseId).map(v => v.id)]);
  return program
    .map(day => ({ day, ids: day.exercises.filter(e => family.has(e.id)).map(e => e.id) }))
    .filter(x => x.ids.length > 0);
}

/** The recommended weekly frequency band for building a lift's max. */
export const RECOMMENDED_FREQUENCY = { low: 2, high: 3 };

export interface WhatItTakes {
  /** the frequency line */
  frequency: string;
  /** variations with their rationale, in the order the planner uses them */
  variations: LiftVariation[];
  /** how the variations are meant to be used */
  variationsNote: string;
  /** supporting work the planner already provides, in one line */
  accessories: string;
}

/**
 * The plain-language answer to "what would it take to move this max?" — the
 * part of coaching that doesn't need a number. Frequency comes from the
 * literature on strength (skill practice: the lift itself 2–3× a week beats
 * one heavy day), variations from VARIATIONS, and the rest is what every
 * strength block in this app already does around a main lift.
 */
export function whatItTakes(exerciseId: string, lift = 'this lift'): WhatItTakes {
  const variations = variationsFor(exerciseId);
  return {
    frequency: `Train ${lift} ${RECOMMENDED_FREQUENCY.low}–${RECOMMENDED_FREQUENCY.high} times a week. A max is a skill as much as a strength — one heavy day a week is practice too rare to improve at.`,
    variations,
    variationsNote: variations.length > 0
      ? 'The extra sessions are not more of the same: a variation loads the position where the lift is weakest, at a weight the weak position can actually handle.'
      : 'No catalogued variation for this lift — the second session repeats it at a lighter, higher-rep dose.',
    accessories: 'Keep the block\'s assistance work: the muscles that hold position under a max (upper back, trunk, hamstrings) are trained by the slots around the main lift, not by the main lift.',
  };
}

// ── Technique read ────────────────────────────────────────────────────────────
// Rep strength versus heavy strength. Epley maps a hard set of 5–8 to a 1RM
// estimate; the lifter has also, somewhere, shown what they can do for a
// single, a double or a triple (or tested a max). When the estimate from rep
// work runs well past the heavy evidence, the engine is there and the
// positions are not — the fix is technical, not more horsepower. When the
// heavy evidence runs past the rep estimate, the lifter grinds singles well
// and lacks the volume base underneath them.

/** Rep counts that read as "rep strength" — the double-progression working zone. */
const REP_STRENGTH_RANGE = { low: 4, high: 8 };
/** Rep counts that read as "heavy strength" — a single, double or triple. */
const HEAVY_MAX_REPS = 3;
/** Gap past which the two kinds of strength clearly disagree. Epley itself is
 *  good to a few percent across 1–8 reps, so anything inside this is noise. */
const TECHNIQUE_GAP_PCT = 8;

export type TechniqueKind = 'technique' | 'volume' | 'balanced' | 'no-heavy' | 'insufficient';

export interface TechniqueRead {
  kind: TechniqueKind;
  /** best e1RM from 4–8-rep sets, lbs; 0 when none */
  repStrength: number;
  /** the set it came from */
  repSet: { weight: number; reps: number } | null;
  /** heavy evidence, lbs: a tested max or the best e1RM from ≤3-rep sets; 0 when none */
  heavyStrength: number;
  heavyBasis: 'tested' | 'log' | null;
  /** (repStrength − heavyStrength) / heavyStrength × 100 */
  gapPct: number | null;
  headline: string;
  detail: string;
  /** what to work on, lift-specific where the catalog knows the lift */
  suggestions: string[];
}

/** Lift-specific technical work, in the order a coach would prescribe it. */
const TECHNIQUE_WORK: Record<string, string[]> = {
  'barbell-back-squat': [
    'Paused squats: a full two-count in the hole, 10–15% lighter — the bottom position is where the max is lost.',
    'Bottom-half work: pin squats or squats from a box set just below parallel, driving out of a dead stop.',
    'Bracing before the descent, not during it — a big breath into the belt, then sit down into it.',
  ],
  'flat-barbell-bench-press': [
    'Paused bench: let the bar settle on the chest for a two-count, then press — it builds the drive a touch-and-go rep fakes.',
    'Bottom-half work: Spoto press (stop an inch off the chest) or a light board/pin press from the sticking point.',
    'Leg drive and a pinned upper back: set the arch and the shoulder blades before the unrack, not after.',
  ],
  'conventional-deadlift': [
    'Paused deadlifts: a two-count just below the knee, 10–20% lighter — hold the back flat and the bar on the shins.',
    'Deficit pulls from a low block: the floor becomes the easy part of a max.',
    'Wedge into the bar before it moves: lats locked, slack pulled out, hips in the right place at the start.',
  ],
  'barbell-overhead-press': [
    'Strict pressing from a dead stop at the shoulders — no dip, no lean.',
    'Pin presses from forehead height for the sticking point, heavier than the full press allows.',
    'Glutes squeezed and ribs down: the leak in an overhead press is almost always the lower back.',
  ],
};

const GENERIC_TECHNIQUE_WORK = [
  'Paused reps: stop at the hardest point of the lift for a two-count, 10–15% lighter.',
  'Partial reps from a dead stop at your weak position (pins, a box, or a block).',
  'Rehearse the set-up — bracing and position before the first rep decide the heaviest one.',
];

function bestE1rmIn(
  snapshot: TrainingSnapshot,
  exerciseId: string,
  minReps: number,
  maxReps: number,
  since: number,
): { e1rm: number; weight: number; reps: number } | null {
  let best: { e1rm: number; weight: number; reps: number } | null = null;
  for (const session of snapshot.sessions) {
    if (sessionTimestamp(session) < since) continue;
    for (const s of snapshot.setsBySession.get(session.id!) ?? []) {
      if (s.exerciseId !== exerciseId || s.weight <= 0 || s.reps < minReps || s.reps > maxReps) continue;
      const e1rm = epley1RM(s.weight, s.reps);
      if (!best || e1rm > best.e1rm) best = { e1rm, weight: s.weight, reps: s.reps };
    }
  }
  return best;
}

/** How far back the technique read looks: strength today, not a year ago. */
const TECHNIQUE_WINDOW_WEEKS = 16;

/**
 * Compare what the lifter's rep work implies with what they have actually
 * shown heavy, and say what to work on. Null when there is nothing logged for
 * the lift at all.
 */
export function techniqueRead(
  snapshot: TrainingSnapshot,
  exerciseId: string,
  stored: OneRepMax | null,
  now = Date.now(),
): TechniqueRead | null {
  const since = now - TECHNIQUE_WINDOW_WEEKS * WEEK_MS;
  const rep = bestE1rmIn(snapshot, exerciseId, REP_STRENGTH_RANGE.low, REP_STRENGTH_RANGE.high, since);
  const heavyLog = bestE1rmIn(snapshot, exerciseId, 1, HEAVY_MAX_REPS, since);
  const tested = stored && stored.source === 'tested' && stored.weight > 0 ? stored.weight : 0;
  const suggestions = TECHNIQUE_WORK[exerciseId] ?? GENERIC_TECHNIQUE_WORK;

  if (!rep && !heavyLog && !tested) {
    if (!bestLoggedMax(snapshot, exerciseId)) return null;
    return {
      kind: 'insufficient', repStrength: 0, repSet: null, heavyStrength: 0, heavyBasis: null, gapPct: null,
      headline: 'Not enough to read yet',
      detail: 'The last few months hold no sets of 4–8 reps and nothing heavy — log a working block and a heavy single or triple and the coach can compare the two.',
      suggestions: [],
    };
  }

  // Heavy evidence: the better of a tested max and a logged single/double/triple.
  let heavy = 0;
  let heavyBasis: TechniqueRead['heavyBasis'] = null;
  if (heavyLog && heavyLog.e1rm > heavy) { heavy = heavyLog.e1rm; heavyBasis = 'log'; }
  if (tested > heavy) { heavy = tested; heavyBasis = 'tested'; }

  if (!rep) {
    return {
      kind: 'insufficient', repStrength: 0, repSet: null, heavyStrength: Math.round(heavy), heavyBasis, gapPct: null,
      headline: 'Heavy singles, no rep base to compare',
      detail: 'You have heavy evidence but no recent sets of 4–8 reps. A block of 4–6s under the max shows whether the engine or the positions are the limiter.',
      suggestions: [],
    };
  }
  if (heavy === 0) {
    return {
      kind: 'no-heavy', repStrength: Math.round(rep.e1rm), repSet: { weight: rep.weight, reps: rep.reps }, heavyStrength: 0, heavyBasis: null, gapPct: null,
      headline: `Rep work says ~${Math.round(rep.e1rm)} — nothing heavy to check it against`,
      detail: `${rep.weight} × ${rep.reps} estimates a max around ${Math.round(rep.e1rm)}, but nothing in the last ${TECHNIQUE_WINDOW_WEEKS} weeks was a single, double or triple. Work up to a heavy triple one session: it shows whether that estimate is real or lives only in the rep range.`,
      suggestions: ['Work up to a heavy triple (2–3 reps in reserve is fine) and log it.', ...suggestions.slice(0, 1)],
    };
  }

  const gapPct = ((rep.e1rm - heavy) / heavy) * 100;
  const base = {
    repStrength: Math.round(rep.e1rm), repSet: { weight: rep.weight, reps: rep.reps },
    heavyStrength: Math.round(heavy), heavyBasis, gapPct,
  };
  const heavyWord = heavyBasis === 'tested' ? 'your tested max' : 'your heaviest single/triple';
  if (gapPct >= TECHNIQUE_GAP_PCT) {
    return {
      ...base, kind: 'technique',
      headline: 'The engine is ahead of the positions',
      detail: `${rep.weight} × ${rep.reps} implies about ${Math.round(rep.e1rm)}, yet ${heavyWord} puts you at ${Math.round(heavy)} — ${Math.round(gapPct)}% less. Strength that shows up for 5–8 reps but vanishes under a near-max load is almost always lost in a position (the bottom, the set-up, the brace), not in the muscles.`,
      suggestions,
    };
  }
  if (gapPct <= -TECHNIQUE_GAP_PCT) {
    return {
      ...base, kind: 'volume',
      headline: 'Strong singles, thin rep base',
      detail: `${heavyWord[0].toUpperCase()}${heavyWord.slice(1)} (${Math.round(heavy)}) runs ${Math.round(-gapPct)}% past what your rep work implies (${rep.weight} × ${rep.reps} ≈ ${Math.round(rep.e1rm)}). You grind heavy well; the base under it is what needs building.`,
      suggestions: [
        'More working sets at 70–80%: sets of 5–8 that climb week to week — the max follows the volume.',
        'Two sessions a week on the lift, only one of them heavy.',
        'Resist testing: a block of rep PRs moves the single more than another single does.',
      ],
    };
  }
  return {
    ...base, kind: 'balanced',
    headline: 'Rep strength and heavy strength agree',
    detail: `${rep.weight} × ${rep.reps} implies about ${Math.round(rep.e1rm)} and ${heavyWord} is ${Math.round(heavy)} — within a few percent. No technical leak to chase; the climb is frequency and progressive loading.`,
    suggestions: suggestions.slice(0, 1),
  };
}

// ── The block estimate ────────────────────────────────────────────────────────

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

// How far the lifter's own observed rate may pull the estimate away from the
// expected rate for their training age. A beginner on linear progression
// really can beat the book for a while; nobody sustains four times it.
const OBSERVED_RATE_MIN_SCALE = 0.5;
const OBSERVED_RATE_MAX_SCALE = 2.0;
// With a flat or falling recent trend, project at this share of the expected
// rate: the plateau is real, but so is the block designed to break it.
const FLAT_TREND_SCALE = 0.5;
// The range around the central estimate. Strength gain is noisy enough that
// one number would be false precision; a band is what a coach would say.
const BLOCK_BAND = { low: 0.6, high: 1.3 };

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

/**
 * Weekly frequency on the lift scales the rate: a max is a skill, and skill
 * practice once a week is too rare to improve at. Modest on purpose — the
 * frequency literature equates volume, and the gain is real but not large.
 */
export const FREQUENCY_RATE_SCALE: Record<number, number> = { 1: 0.8, 2: 1.0, 3: 1.15 };

export interface BlockProjectionInput {
  /** the max the block starts from, lbs */
  current: number;
  /** productive (non-easy) weeks in the block */
  weeks: number;
  /** days a week the lift or a variation is trained */
  frequency: number;
  experience: ExperienceLevel;
  goal: Goal;
  /** the lifter's own recent rate on this lift, when there is one */
  trend: StrengthTrend | null;
  /** the target, when one was set — only decides how the range is framed */
  target?: number | null;
}

export interface BlockProjection {
  current: number;
  weeks: number;
  frequency: number;
  /** the range the block is built to deliver, lbs */
  low: number;
  mid: number;
  high: number;
  /** the rate the estimate used, % of current per week */
  ratePctPerWeek: number;
  basis: 'observed' | 'expected' | 'tempered';
  /** how a set target compares with the range */
  target: { weight: number; verdict: 'inside' | 'beyond' | 'reached' } | null;
  notes: string[];
}

/**
 * What a block is built to deliver on a lift: the max it projects to at the
 * end, as a range. Bounded by things the athlete actually chose — the block's
 * length and how often the lift is trained — and read from their own logged
 * trend where there is one, so a self-reported level is the fallback, not the
 * foundation. Not a date, and not a promise: the band is the honest width.
 */
export function projectBlock(input: BlockProjectionInput): BlockProjection {
  const { current, weeks, experience, goal, trend } = input;
  const frequency = Math.min(3, Math.max(1, Math.round(input.frequency)));
  const notes: string[] = [];

  const expected = EXPECTED_WEEKLY_GAIN_PCT[experience];
  let rate = expected;
  let basis: BlockProjection['basis'] = 'expected';
  if (trend) {
    if (trend.ratePctPerWeek > 0) {
      rate = Math.min(expected * OBSERVED_RATE_MAX_SCALE, Math.max(expected * OBSERVED_RATE_MIN_SCALE, trend.ratePctPerWeek));
      basis = 'observed';
    } else {
      rate = expected * FLAT_TREND_SCALE;
      basis = 'tempered';
      notes.push('Your est. 1RM has been flat recently, so this assumes the block breaks the plateau at a modest pace rather than resuming the old one.');
    }
  } else {
    notes.push(`Read from the typical rate for ${experience === 'intermediate' || experience === 'advanced' ? 'an' : 'a'} ${experience} lifter — once this lift has a few sessions logged, the estimate uses your own pace instead.`);
  }
  rate *= GOAL_RATE_SCALE[goal] * (FREQUENCY_RATE_SCALE[frequency] ?? 1);
  if (goal === 'fat-loss') notes.push('In a fat-loss block strength is defended, not built — expect the low end.');
  if (goal === 'sport-support') notes.push('Lifting in support of a sport holds strength rather than chasing it — expect the low end.');
  if (frequency === 1) notes.push('Trained once a week the lift gets little skill practice; a second day, even a light variation, is the cheapest improvement to this estimate.');

  const growth = Math.pow(1 + rate / 100, Math.max(0, weeks));
  const mid = current * growth;
  const low = current * Math.pow(1 + (rate * BLOCK_BAND.low) / 100, Math.max(0, weeks));
  const high = current * Math.pow(1 + (rate * BLOCK_BAND.high) / 100, Math.max(0, weeks));
  const round5 = (x: number) => Math.round(x / 5) * 5;

  let target: BlockProjection['target'] = null;
  if (input.target != null && input.target > 0) {
    const t = input.target;
    const verdict = t <= current ? 'reached' : t <= high ? 'inside' : 'beyond';
    target = { weight: t, verdict };
    if (verdict === 'beyond') {
      const blocksNeeded = rate > 0 ? Math.ceil(Math.log(t / current) / Math.log(growth)) : null;
      notes.push(blocksNeeded != null && blocksNeeded <= 6
        ? `${t} is past what one block of this length is built for — roughly ${blocksNeeded} blocks like it, if the pace holds.`
        : `${t} is a long way past what one block delivers; treat it as the direction and let the blocks add up.`);
    }
  }

  return {
    current, weeks, frequency,
    low: round5(low), mid: round5(mid), high: round5(high),
    ratePctPerWeek: rate, basis, target, notes,
  };
}

/** The share of the way from a starting max to a target, 0–1. */
export function goalProgress(startMax: number, current: number, target: number): number {
  if (target <= startMax) return 1;
  return Math.min(1, Math.max(0, (current - startMax) / (target - startMax)));
}
