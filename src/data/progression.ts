// The shared vocabulary of "is this working?" — one definition of progress, and
// one set of numbers behind it.
//
// The app had two. `progress.ts` blended est. 1RM, volume load and PR events
// with goal-dependent weights and called the result progressing/stalled, and
// every engine that reviews training — insights, the planner, retrospectives,
// substitution — read it. The recommendation engine, the one that actually
// decides what to put on the bar, ran its own private rep-only test, so the
// Metrics screen could call a lift steady while the next workout deloaded it.
//
// This module owns what they disagreed about: the signals, their weights, and
// the thresholds. It is pure arithmetic over plain numbers — no snapshot, no
// stores, no IndexedDB — so both engines can import it without either one
// pulling the other's dependencies in behind it.
//
// Two things are worth knowing about the metric itself.
//
// VOLUME IS THE PROGRESSION VARIABLE, BUT RAW TONNAGE IS NOT THE METRIC.
// Σ weight × reps has three properties that make it a poor trigger on its own:
// it FALLS after every successful load increase (3×12 at 100 lbs is 3600;
// earning the jump to 110 and getting 3×9 is 2970, so a tonnage rule deloads a
// lifter for progressing); it UNDER-CREDITS heavy work (100×12 = 1200 beats
// 110×10 = 1100, though the second is the stronger set by every 1RM estimate);
// and it is trivially inflated by junk volume (5×20 at 50 lbs outscores 3×5 at
// 150). So volume is compared at a FIXED LOAD — where it reduces to a rep total
// and every one of those problems disappears — and anything that has to reason
// ACROSS load changes uses the composite below, where volume and intensity are
// weighted against each other by what the athlete is training for.
//
// PROGRESS IS RELATIVE TO WHAT THE ATHLETE SHOULD MANAGE. A 2% gain is a
// plateau for a novice and a good month for an advanced lifter, so "full marks"
// scales with training age on the same ratios as the weekly load cap
// (recommendations.ts): novices are held to a higher standard because they can
// meet it, and an advanced lifter's slow climb stops reading as a stall.

import type { Goal, ExperienceLevel } from './plan';

/** How much each signal counts toward the verdict. */
export interface SignalWeights {
  e1rm: number;
  volume: number;
  prs: number;
}

// Signal weights per goal — the coach's judgement of what matters most.
// strength: moving more weight IS the goal. hypertrophy: volume and rep PRs
// drive growth. fat-loss: defending volume/strength in a deficit is winning
// (holding e1RM scores positive, see `holdingCounts`). athletic/general:
// balanced.
export const GOAL_SIGNAL_WEIGHTS: Record<Goal, SignalWeights> = {
  strength:    { e1rm: 0.55, volume: 0.20, prs: 0.25 },
  hypertrophy: { e1rm: 0.30, volume: 0.40, prs: 0.30 },
  'fat-loss':  { e1rm: 0.30, volume: 0.50, prs: 0.20 },
  athletic:    { e1rm: 0.45, volume: 0.30, prs: 0.25 },
  general:     { e1rm: 0.34, volume: 0.33, prs: 0.33 },
  // Supporting another sport: strength per unit of fatigue is the whole point,
  // so e1RM and PRs carry the verdict. Rising tonnage is explicitly *not* the
  // goal here — extra volume is a cost paid out of the sport's recovery.
  'sport-support': { e1rm: 0.50, volume: 0.15, prs: 0.35 },
};

/** The change that earns a full +1 on each signal. */
export interface FullMarks {
  e1rmPct: number;
  volumePct: number;
  prEvents: number;
}

/**
 * The intermediate lifter is the anchor, and these are the numbers the app has
 * always used: +5% est. 1RM or +10% volume load across the window is a clear
 * win, two PR events is a clear win.
 */
export const FULL_MARKS: FullMarks = { e1rmPct: 5, volumePct: 10, prEvents: 2 };

// Same ratios as WEEKLY_LOAD_CAP: a novice consolidates roughly twice the rate
// an intermediate does, an advanced lifter roughly half. Applied to the bar for
// "full marks", not to the score, so the *standard* moves with training age
// rather than the measurement.
const EXPERIENCE_SCALE: Record<ExperienceLevel, number> = {
  beginner: 2,
  intermediate: 1,
  advanced: 0.5,
};

export function fullMarksFor(experience?: ExperienceLevel | null): FullMarks {
  const scale = experience ? EXPERIENCE_SCALE[experience] : 1;
  return {
    e1rmPct: FULL_MARKS.e1rmPct * scale,
    volumePct: FULL_MARKS.volumePct * scale,
    prEvents: FULL_MARKS.prEvents,
  };
}

/**
 * Session-to-session variation in strength performance runs a few percent on
 * sleep, food and stress alone. Changes inside this band are measurement noise
 * and are read as no change at all, so a decision as consequential as cutting
 * someone's load is never made on a 1% wobble.
 */
export const NOISE_FLOOR_PCT = 3;

/** A percentage change with the noise band flattened to zero. */
export function deadband(pct: number | null, floor = NOISE_FLOOR_PCT): number | null {
  if (pct == null) return null;
  return Math.abs(pct) < floor ? 0 : pct;
}

/** Percentage change, or null when there's no meaningful baseline. */
export function pctChange(from: number, to: number): number | null {
  if (from <= 0) return null;
  return ((to - from) / from) * 100;
}

// Composite score bands. Shared so "stalled" means the same thing on the
// Metrics screen and in the next workout's prescription.
export const PROGRESS_SCORE = 0.22;
export const DECLINE_SCORE = -0.22;
/** Below this, with nothing else to show for the window, is a stall. */
export const STALL_SCORE = 0.1;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** What happened over the window, in the three terms the score is built from. */
export interface ProgressSignals {
  /** null when est. 1RM is meaningless here — bodyweight work, or high-rep sets */
  e1rmChangePct: number | null;
  /** tonnage for loaded work, total reps for bodyweight; null when unknown */
  volumeChangePct: number | null;
  /** weight/rep PRs, or sessions that set a new high inside the window */
  prEvents: number;
}

/**
 * Where training aimed at adding strength is not the point — dieting, or
 * lifting to support a sport whose own volume is climbing — merely HOLDING the
 * numbers is a win, and a flat est. 1RM scores mildly positive rather than
 * reading as a stall. Without this a race build looks like a block of stalled
 * lifts and fires deloads nobody needs.
 */
function holdingCounts(goal: Goal): boolean {
  return goal === 'fat-loss' || goal === 'sport-support';
}

/**
 * The −1…+1 composite. Each signal is scored against what full marks would look
 * like for this athlete, then weighted by what they're training for; missing
 * signals (no est. 1RM on bodyweight work) have their weight redistributed
 * across the rest rather than counting as zero.
 */
export function compositeScore(
  signals: ProgressSignals,
  goal: Goal,
  experience?: ExperienceLevel | null,
): number {
  const weights = GOAL_SIGNAL_WEIGHTS[goal];
  const marks = fullMarksFor(experience);

  let e1rmComponent = signals.e1rmChangePct == null
    ? null
    : clamp(signals.e1rmChangePct / marks.e1rmPct, -1, 1);
  if (holdingCounts(goal) && signals.e1rmChangePct != null && Math.abs(signals.e1rmChangePct) <= 2) {
    e1rmComponent = Math.max(e1rmComponent ?? 0, 0.35);
  }
  const volumeComponent = signals.volumeChangePct == null
    ? null
    : clamp(signals.volumeChangePct / marks.volumePct, -1, 1);
  const prComponent = clamp(signals.prEvents / marks.prEvents, 0, 1);

  let score = 0;
  let weightSum = 0;
  if (e1rmComponent != null) { score += e1rmComponent * weights.e1rm; weightSum += weights.e1rm; }
  if (volumeComponent != null) { score += volumeComponent * weights.volume; weightSum += weights.volume; }
  score += prComponent * weights.prs; weightSum += weights.prs;
  return weightSum > 0 ? score / weightSum : 0;
}

/**
 * Sessions of flat performance that add up to a plateau worth acting on.
 *
 * Advanced lifters get a longer window: they progress across a block rather
 * than session to session, so judging them on three sessions manufactures
 * plateaus out of normal training. Novices are not given a *shorter* one —
 * their numbers bounce around on technique alone, and two sessions of that is
 * not evidence of anything.
 */
export function stallWindowFor(experience: ExperienceLevel = 'intermediate'): number {
  return experience === 'advanced' ? 4 : 3;
}

/**
 * Who repeats the load instead of cutting it when the plateau is real.
 *
 * In a deficit a plateau reflects energy availability, not accumulated fatigue,
 * and the objective is retaining muscle — cutting the load gives away the
 * stimulus that defends it. Supporting a sport is the same argument with a
 * different cause: the fatigue is coming from the swim, bike and run, and the
 * lifting is what's holding strength together. And a novice who stops adding
 * reps usually needs another rep at the same weight, not a lighter one; the
 * whole beginner path in this app is linear progression, not autoregulation.
 */
export function holdsInsteadOfDeload(goal: Goal, experience?: ExperienceLevel | null): boolean {
  return holdingCounts(goal) || experience === 'beginner';
}
