// The per-exercise history the prescription engine reads, built like for like.
//
// calculateRecommendation/buildSetPlan take an exercise's recent sessions as a
// list of (weight, reps) sets. Two things about set variations have to be
// settled BEFORE that list exists, and this module settles them:
//
//   1. Extension rows (drops, rest-pause bursts, partials) are never in it.
//      They were done on a muscle that had already failed; as sets they would
//      drag the working weight down (two drops at 80 outvote one set at 100)
//      and read as missed reps.
//   2. The engine compares sessions done the SAME WAY. A paused 225 × 5 is not
//      a touch-and-go 225 × 5, and a wide-grip pulldown is not a close-grip
//      one. So the history is the sessions whose sets match the variation the
//      lifter is about to do — the slot's prescribed variation, or failing
//      that, whatever they did last time (which is also what the card
//      pre-selects, so the prescription and the row agree).
//
// When nothing in the log matches (the first paused session ever), the
// engine still has to say something, so the history falls back to the plain
// sets and the caller is told (`borrowed`) so the goal line can say "expect
// fewer reps" rather than pretending the number was earned under that style.

import type { Exercise } from './program';
import type { TrainingSnapshot } from './analytics';
import { sessionTimestamp } from './analytics';
import type { ExerciseSession } from './recommendations';
import type { SetLog } from '../db/database';
import type { SetVariation } from './variations';
import { hasVariation, isExtension, sameVariation, styleOf, variationKey } from './variations';

/** The way the lifter is expected to do this exercise today. */
export function expectedVariation(ex: Pick<Exercise, 'id' | 'technique' | 'grip'>, snapshot: TrainingSnapshot | null): SetVariation {
  // A prescribed variation on the slot wins outright.
  if (ex.technique != null || ex.grip != null) return styleOf({ technique: ex.technique, grip: ex.grip });
  if (!snapshot) return {};
  // Otherwise, the way the last session was done — the dominant style of its
  // numbered sets. A one-off experiment is one tap to clear on the card.
  for (const session of snapshot.sessions) { // newest first
    const sets = (snapshot.setsBySession.get(session.id!) ?? [])
      .filter(s => s.exerciseId === ex.id && !isExtension(s.technique));
    if (sets.length === 0) continue;
    return dominantVariation(sets);
  }
  return {};
}

function dominantVariation(sets: SetLog[]): SetVariation {
  const counts = new Map<string, { n: number; v: SetVariation }>();
  for (const s of sets) {
    const v = styleOf(s);
    const k = variationKey(v);
    const entry = counts.get(k);
    if (entry) entry.n += 1;
    else counts.set(k, { n: 1, v });
  }
  let best: { n: number; v: SetVariation } | null = null;
  for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
  return best?.v ?? {};
}

export interface ExerciseHistory {
  /** newest first, at most `depth` sessions */
  history: ExerciseSession[];
  /** true when no session matched the variation and plain sets were used instead */
  borrowed: boolean;
}

/**
 * The exercise's recent sessions as the engine wants them: numbered sets only,
 * filtered to the given variation, newest first, capped at `depth`.
 * `positions` is snapshotPositions(snapshot) — the exercise's slot within each
 * workout, for the engine's freshness read.
 */
export function exerciseHistory(
  snapshot: TrainingSnapshot,
  exerciseId: string,
  depth: number,
  positions: Map<number, Map<string, number>>,
  variation: SetVariation,
): ExerciseHistory {
  const matched = collect(snapshot, exerciseId, depth, positions, s => sameVariation(s, variation));
  if (matched.length > 0 || !hasVariation(variation)) return { history: matched, borrowed: false };
  // First time this way: borrow the plain sets so the lifter gets a number.
  // (With nothing to borrow either, it is simply a first session.)
  const plain = collect(snapshot, exerciseId, depth, positions, () => true);
  return { history: plain, borrowed: plain.length > 0 };
}

function collect(
  snapshot: TrainingSnapshot,
  exerciseId: string,
  depth: number,
  positions: Map<number, Map<string, number>>,
  keep: (s: SetLog) => boolean,
): ExerciseSession[] {
  const history: ExerciseSession[] = [];
  for (const session of snapshot.sessions) { // newest first
    const exSets = (snapshot.setsBySession.get(session.id!) ?? [])
      .filter(s => s.exerciseId === exerciseId && !isExtension(s.technique) && keep(s))
      .sort((a, b) => a.setNumber - b.setNumber)
      .map(s => ({
        weight: s.weight, reps: s.reps,
        ...(s.repLow != null && s.repHigh != null ? { repLow: s.repLow, repHigh: s.repHigh } : {}),
      }));
    if (exSets.length > 0) {
      history.push({
        completedAt: sessionTimestamp(session),
        sets: exSets,
        position: positions.get(session.id!)?.get(exerciseId) ?? null,
      });
    }
    if (history.length >= depth) break;
  }
  return history;
}
