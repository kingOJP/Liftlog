// The app-layer prescription resolver: dosage.ts is pure, this is the bit that
// reads the user's stores and hands it the context.
//
// Every route an exercise can take into a workout — the plan wizard, the day
// editor, the mid-workout add panel, a quick workout — resolves through here,
// so a movement gets the same goal-aware dose however it arrives. There is no
// hardcoded rep range left anywhere on the client.

import type { Exercise } from './program';
import type { TrainingSnapshot } from './analytics';
import { profileFor } from './substitution';
import { effectiveExperience } from './experience';
import { getPlannedGoal, getProfileOrDefault } from './planStore';
import { resolvePrescription } from './dosage';
import type { DosageHistorySession, DosageSlot, RepPrescription } from './dosage';

/** How many past sessions the history-derived range is read from. */
const HISTORY_SESSIONS = 4;

/** This exercise's recent sessions, newest first, as the dosage model wants them. */
export function exerciseHistory(
  exerciseId: string,
  snapshot: TrainingSnapshot | null,
): DosageHistorySession[] {
  if (!snapshot) return [];
  const out: DosageHistorySession[] = [];
  for (const session of snapshot.sessions) { // newest first
    const sets = (snapshot.setsBySession.get(session.id!) ?? [])
      .filter(s => s.exerciseId === exerciseId)
      .map(s => ({ reps: s.reps }));
    if (sets.length > 0) out.push({ sets });
    if (out.length >= HISTORY_SESSIONS) break;
  }
  return out;
}

export interface PrescribeOptions {
  /** Display name, for exercises whose profile has to be resolved by name */
  name?: string;
  /** The slot it will occupy, when it has one */
  slot?: DosageSlot;
  /** Loaded snapshot, when the caller has one — enables the history fallback */
  snapshot?: TrainingSnapshot | null;
}

/**
 * What to prescribe for `exerciseId` right now. Null means the coach genuinely
 * has nothing to go on (no plan, no history with this movement) — the caller
 * should show no rep target rather than invent one.
 */
export function prescribeFor(
  exerciseId: string,
  opts: PrescribeOptions = {},
): RepPrescription | null {
  const snapshot = opts.snapshot ?? null;
  return resolvePrescription({
    profile: profileFor(exerciseId, opts.name),
    slot: opts.slot,
    goal: getPlannedGoal(),
    experience: effectiveExperience(getProfileOrDefault(), snapshot),
    history: exerciseHistory(exerciseId, snapshot),
  });
}

/**
 * Build a program slot for an exercise entering a day, dosed for the active
 * plan. `sets` falls back to 3 when nothing is prescribed — a set count is a
 * layout decision (how many rows to show), not a training prescription, so an
 * unprescribed slot still gets rows, just no rep target.
 */
export function slotFor(
  exerciseId: string,
  name: string,
  opts: PrescribeOptions = {},
): Exercise {
  const dose = prescribeFor(exerciseId, { ...opts, name });
  return {
    id: exerciseId,
    name,
    sets: dose?.sets ?? 3,
    ...(dose ? { repLow: dose.repLow, repHigh: dose.repHigh } : {}),
  };
}
