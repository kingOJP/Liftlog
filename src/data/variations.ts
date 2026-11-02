// Set variations: HOW a set was done, as opposed to WHICH movement it was.
//
// Two independent dimensions ride on every logged set (and, optionally, on a
// program slot as the prescribed default):
//
//   technique — a rep STYLE that applies to the whole set (paused, tempo,
//               deficit), or an EXTENSION tacked onto the end of a set (a drop,
//               a rest-pause burst, partials after full reps run out)
//   grip      — hand position: close / wide / neutral / underhand / overhand /
//               mixed
//
// Why they matter to the engines, in three sentences. A paused 225 × 5 and a
// touch-and-go 225 × 5 are not the same number, so progression has to compare
// like with like. A drop set is one extended set, not three new ones, so it
// cannot count as three hard sets of weekly volume. And a close-grip bench is
// half a triceps exercise, a wide-grip pulldown is less of a biceps exercise
// and a deficit deadlift starts as a quarter-squat — small, well-known
// emphasis shifts the volume accounting should see rather than ignore.
//
// Everything here is compiled catalog data and pure arithmetic — no stores,
// no DOM — on the same footing as difficulty and muscle heads. The shift table
// is keyed by MOVEMENT PATTERN, not exercise, because a grip changes a row the
// same way whichever row it is.

import type { MovementPattern, MuscleGroup, MeasureUnit } from './taxonomy';

export type SetTechnique = 'paused' | 'tempo' | 'deficit' | 'drop' | 'rest-pause' | 'partials';
export type Grip = 'close' | 'wide' | 'neutral' | 'underhand' | 'overhand' | 'mixed';

/** Styles that change how every rep of a numbered set is performed. */
export const REP_STYLES: SetTechnique[] = ['paused', 'tempo', 'deficit'];
/**
 * Continuations of the set before them. An extension row is never a numbered
 * working set: it doesn't consume a prescribed set, it counts for half a set
 * of volume, and the progression and e1RM engines don't read it — the work
 * was done on muscles that had already failed once.
 */
export const SET_EXTENSIONS: SetTechnique[] = ['drop', 'rest-pause', 'partials'];
export const SET_TECHNIQUES: SetTechnique[] = [...REP_STYLES, ...SET_EXTENSIONS];
export const GRIPS: Grip[] = ['close', 'wide', 'neutral', 'underhand', 'overhand', 'mixed'];

export interface SetVariation {
  technique?: SetTechnique;
  grip?: Grip;
}

export const TECHNIQUE_INFO: Record<SetTechnique, { label: string; short: string; blurb: string }> = {
  paused:       { label: 'Paused',     short: 'paused',     blurb: 'A dead stop at the bottom — no stretch reflex, so the same load buys fewer reps.' },
  tempo:        { label: 'Tempo',      short: 'tempo',      blurb: 'A slow, controlled lowering (3–4 s down) — more time under tension per rep.' },
  deficit:      { label: 'Deficit',    short: 'deficit',    blurb: 'From a plate or block — a longer range of motion and a harder start.' },
  drop:         { label: 'Drop set',   short: 'drop',       blurb: 'Straight into a lighter weight with no rest — a continuation of the set before it.' },
  'rest-pause': { label: 'Rest-pause', short: 'rest-pause', blurb: 'A short breath (10–20 s) and more reps at the same weight.' },
  partials:     { label: 'Partials',   short: 'partials',   blurb: 'Reps through part of the range, usually once full reps run out.' },
};

export const GRIP_INFO: Record<Grip, { label: string; short: string }> = {
  close:     { label: 'Close',     short: 'close grip' },
  wide:      { label: 'Wide',      short: 'wide grip' },
  neutral:   { label: 'Neutral',   short: 'neutral grip' },
  underhand: { label: 'Underhand', short: 'underhand' },
  overhand:  { label: 'Overhand',  short: 'overhand' },
  mixed:     { label: 'Mixed',     short: 'mixed grip' },
};

export function isExtension(technique: SetTechnique | null | undefined): boolean {
  return technique != null && SET_EXTENSIONS.includes(technique);
}

export function isRepStyle(technique: SetTechnique | null | undefined): boolean {
  return technique != null && REP_STYLES.includes(technique);
}

export function isSetTechnique(v: unknown): v is SetTechnique {
  return typeof v === 'string' && (SET_TECHNIQUES as string[]).includes(v);
}

export function isGrip(v: unknown): v is Grip {
  return typeof v === 'string' && (GRIPS as string[]).includes(v);
}

/**
 * The rep-style part of a logged set's variation — what the prescription and
 * progress engines compare on. Extensions are stripped (they are not a style
 * of doing the set; they are more set), unknown strings from a newer client
 * are dropped rather than trusted.
 */
export function styleOf(set: { technique?: string; grip?: string } | SetVariation): SetVariation {
  const technique = isSetTechnique(set.technique) && isRepStyle(set.technique) ? set.technique : undefined;
  const grip = isGrip(set.grip) ? set.grip : undefined;
  return { ...(technique ? { technique } : {}), ...(grip ? { grip } : {}) };
}

/** "paused|close" — a stable cache / comparison key; "" for a plain straight set. */
export function variationKey(v: SetVariation | null | undefined): string {
  if (!v) return '';
  return `${v.technique ?? ''}|${v.grip ?? ''}`.replace(/^\|$/, '');
}

export function sameVariation(a: SetVariation | null | undefined, b: SetVariation | null | undefined): boolean {
  return variationKey(styleOf(a ?? {})) === variationKey(styleOf(b ?? {}));
}

export function hasVariation(v: SetVariation | null | undefined): boolean {
  return !!v && (v.technique != null || v.grip != null);
}

/** "paused · close grip" — the tag shown on a logged set; null for a plain set. */
export function variationLabel(v: SetVariation | null | undefined): string | null {
  if (!v) return null;
  const parts: string[] = [];
  if (v.technique) parts.push(TECHNIQUE_INFO[v.technique].short);
  if (v.grip) parts.push(GRIP_INFO[v.grip].short);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// ── Volume accounting ────────────────────────────────────────────────────────

/**
 * How much of a hard set an extension row is worth. A drop set is one long set
 * with the load reduced partway, not a fresh set from a rested muscle; the
 * drop-set literature finds hypertrophy per *set-equivalent* in the same
 * range as straight sets, and counts a drop set as one set with several drops.
 * Crediting each drop as a whole set would turn 3 sets + 3 drops into six hard
 * sets of weekly volume and send the coach trimming a program that was fine.
 * Half splits the difference honestly: the extra work is real, it just isn't
 * a new set.
 */
export const EXTENSION_SET_CREDIT = 0.5;

export function setCredit(technique: SetTechnique | string | null | undefined): number {
  return isSetTechnique(technique) && isExtension(technique) ? EXTENSION_SET_CREDIT : 1;
}

/**
 * Whether a set's reps can anchor a strength estimate. Extensions are
 * performed on a muscle that has already failed once (a drop, a rest-pause
 * burst) or through part of the range (partials — a heavy partial would
 * overstate a 1RM badly), so none of them is read for e1RM. Paused and tempo
 * reps ARE read: they give a lower estimate, which is a conservative one.
 */
export function countsForStrength(technique: SetTechnique | string | null | undefined): boolean {
  return !(isSetTechnique(technique) && isExtension(technique));
}

// ── Which options make sense where ───────────────────────────────────────────

const GRIP_OPTIONS: Partial<Record<MovementPattern, Grip[]>> = {
  'Horizontal Press': ['close', 'wide', 'neutral'],
  'Vertical Press':   ['close', 'wide', 'neutral'],
  Row:                ['close', 'wide', 'neutral', 'underhand', 'overhand'],
  'Pull Down':        ['close', 'wide', 'neutral', 'underhand', 'overhand'],
  'Pull Up':          ['close', 'wide', 'neutral', 'underhand', 'overhand'],
  Curl:               ['close', 'wide', 'neutral', 'overhand'],
  'Hip Hinge':        ['overhand', 'mixed'],
  Shrug:              ['wide'],
  'Tricep Extension': ['underhand'],
};

/** Grips worth offering for a movement — empty when grip is not a variable (squats, calves, holds). */
export function gripOptionsFor(pattern: MovementPattern | null | undefined): Grip[] {
  return pattern ? (GRIP_OPTIONS[pattern] ?? []) : [];
}

const DEFICIT_PATTERNS: MovementPattern[] = ['Hip Hinge', 'Lunge', 'Horizontal Press'];

/**
 * Rep styles worth offering: paused and tempo for any rep-counted movement,
 * deficit only where standing on a block changes the lift (deadlifts, lunges,
 * push-ups). A timed hold has no reps to pause or slow, so it gets none.
 */
export function techniqueOptionsFor(pattern: MovementPattern | null | undefined, unit: MeasureUnit = 'reps'): SetTechnique[] {
  if (unit === 'seconds') return [];
  const out: SetTechnique[] = ['paused', 'tempo'];
  if (pattern && DEFICIT_PATTERNS.includes(pattern)) out.push('deficit');
  return out;
}

/** Extensions worth offering — none for timed work (there is no "drop" on a plank). */
export function extensionOptionsFor(unit: MeasureUnit = 'reps'): SetTechnique[] {
  return unit === 'seconds' ? [] : [...SET_EXTENSIONS];
}

// ── Muscle emphasis shifts ───────────────────────────────────────────────────
// Deltas to a muscle's fractional set weight (1 = primary, 0.5 = secondary).
// Rules of the table, so it stays a *shift* and never a reclassification:
//
//   • The primary muscle is never touched. A close-grip bench is still a chest
//     press; the lifter chose the exercise for its prime mover.
//   • A secondary can climb to at most SHIFT_CAP (0.75 — "nearly direct") and
//     fall to 0 (dropped). Weight 1 stays the unique marker of the primary,
//     which the coach planner and the unmapped-exercise check rely on.
//   • A muscle the base classification doesn't list can be added (deficit
//     deadlift → quads) and enters at its delta.
//
// Grounding, briefly: narrowing a press grip shifts load from pec to triceps
// (and widening does the reverse); supinating or narrowing a pull lets the
// biceps and lats contribute more while a wide pronated grip isolates the
// upper back / lats and takes the biceps out; a hammer (neutral) curl is a
// brachioradialis exercise; a double-overhand pull is grip-limited; a deficit
// pull starts from more knee flexion with a longer lever on the lower back.

interface Shift { muscle: MuscleGroup; delta: number }

const SHIFT_CAP = 0.75;

const GRIP_SHIFTS: Partial<Record<MovementPattern, Partial<Record<Grip, Shift[]>>>> = {
  'Horizontal Press': {
    close:   [{ muscle: 'Triceps', delta: +0.25 }],
    neutral: [{ muscle: 'Triceps', delta: +0.25 }],
    wide:    [{ muscle: 'Triceps', delta: -0.25 }],
  },
  'Vertical Press': {
    close:   [{ muscle: 'Triceps', delta: +0.25 }],
    neutral: [{ muscle: 'Triceps', delta: +0.25 }],
    wide:    [{ muscle: 'Triceps', delta: -0.25 }],
  },
  Row: {
    underhand: [{ muscle: 'Lats', delta: +0.25 }, { muscle: 'Biceps', delta: +0.25 }],
    close:     [{ muscle: 'Lats', delta: +0.25 }],
    neutral:   [{ muscle: 'Lats', delta: +0.25 }],
    wide:      [{ muscle: 'Lats', delta: -0.25 }, { muscle: 'Delts', delta: +0.25 }],
  },
  'Pull Down': {
    wide:      [{ muscle: 'Biceps', delta: -0.25 }],
    close:     [{ muscle: 'Biceps', delta: +0.25 }],
    neutral:   [{ muscle: 'Biceps', delta: +0.25 }],
    underhand: [{ muscle: 'Biceps', delta: +0.25 }],
  },
  'Pull Up': {
    wide:      [{ muscle: 'Biceps', delta: -0.25 }],
    close:     [{ muscle: 'Biceps', delta: +0.25 }],
    neutral:   [{ muscle: 'Biceps', delta: +0.25 }],
    underhand: [{ muscle: 'Biceps', delta: +0.25 }],
  },
  Curl: {
    neutral:  [{ muscle: 'Forearms', delta: +0.5 }],
    overhand: [{ muscle: 'Forearms', delta: +0.5 }],
  },
  'Hip Hinge': {
    overhand: [{ muscle: 'Forearms', delta: +0.5 }],
  },
  Shrug: {
    wide: [{ muscle: 'Upper Back', delta: +0.25 }],
  },
};

const TECHNIQUE_SHIFTS: Partial<Record<MovementPattern, Partial<Record<SetTechnique, Shift[]>>>> = {
  'Hip Hinge': {
    deficit: [{ muscle: 'Quads', delta: +0.5 }, { muscle: 'Lower Back', delta: +0.25 }],
  },
  Lunge: {
    deficit: [{ muscle: 'Glutes', delta: +0.25 }],
  },
};

export interface Involvement { muscle: MuscleGroup; weight: number }

/**
 * Apply a variation's emphasis shift to an exercise's base muscle
 * involvement. Pure: the base array is never mutated, and with no applicable
 * shift the result is the base as given (same order, same weights).
 */
export function adjustInvolvement<T extends Involvement>(
  base: T[],
  pattern: MovementPattern | null | undefined,
  variation: SetVariation | null | undefined,
): Involvement[] {
  if (!pattern || !variation) return base;
  const shifts: Shift[] = [
    ...(variation.grip ? GRIP_SHIFTS[pattern]?.[variation.grip] ?? [] : []),
    ...(variation.technique ? TECHNIQUE_SHIFTS[pattern]?.[variation.technique] ?? [] : []),
  ];
  if (shifts.length === 0) return base;

  const primary = base.find(m => m.weight === 1)?.muscle ?? null;
  const out: Involvement[] = base.map(m => ({ muscle: m.muscle, weight: m.weight }));
  for (const { muscle, delta } of shifts) {
    if (muscle === primary) continue; // the prime mover is what the exercise IS
    const existing = out.find(m => m.muscle === muscle);
    if (existing) {
      existing.weight = Math.min(SHIFT_CAP, Math.max(0, existing.weight + delta));
    } else if (delta > 0) {
      out.push({ muscle, weight: Math.min(SHIFT_CAP, delta) });
    }
  }
  return out.filter(m => m.weight > 0);
}
