// In-workout draft persistence. Sets live in WorkoutView React state until
// "Finish Workout" — an app kill or Safari tab eviction mid-session used to
// lose everything. WorkoutView writes the draft here on every set change and
// clears it at finish; reopening the same day restores it.
//
// localStorage (not IndexedDB) on purpose: a draft is one small object with a
// single writer, and synchronous writes can't be lost to an interrupted async
// transaction during a kill. One slot suffices — you're only ever mid-workout
// on one day at a time — but the slot is PROTECTED: a draft that holds logged
// sets is never overwritten by merely opening another workout (the audit's
// "log 3 sets on Day 2, tap Back, glance at Day 3 → Day 2 is gone"). The
// caller asks `conflictingDraft()` first and lets the user resume or discard.
//
// The draft also carries the WorkoutDay snapshot it was logged against, so a
// quick or shared workout (which lives only in React state) can be resumed
// after a kill exactly like a program day, and so a program day the coach or a
// sync replaced mid-workout can still be finished as it was started.

import type { WorkoutDay } from './program';

export type DraftOrigin = 'program' | 'quick' | 'shared';

export interface DraftSession {
  dayId: number;
  /** When the workout view was opened — preserved so duration stays correct */
  startedAt: number;
  savedAt: number;
  sets: Record<string, Array<{ weight: number; reps: number; warmup?: boolean }>>;
  /** exercise ids in the order they were first trained (order tracking) */
  order?: string[];
  /** the day as it was when the workout started (v2 drafts; absent on older ones) */
  day?: WorkoutDay;
  /** where the day came from — decides how a resume re-opens it */
  origin?: DraftOrigin;
  /** exercises added mid-workout (so a resumed quick/shared session keeps them) */
  added?: WorkoutDay['exercises'];
  /** the session note as typed so far */
  note?: string;
}

const KEY = 'liftlog_draft_session';

// A draft older than this is a workout that was abandoned, not interrupted.
export const DRAFT_MAX_AGE_MS = 12 * 3_600_000;

export function saveDraftSession(draft: DraftSession): void {
  localStorage.setItem(KEY, JSON.stringify(draft));
}

export function clearDraftSession(): void {
  localStorage.removeItem(KEY);
}

function readDraft(now: number): DraftSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as DraftSession;
    if (now - draft.savedAt > DRAFT_MAX_AGE_MS) return null;
    return draft;
  } catch {
    return null;
  }
}

// The draft for this day, if one exists and is fresh enough to resume. A draft
// with no sets yet is still resumable — a *started* workout is stored from the
// moment the view opens, so an app kill before the first set keeps its start
// time (and duration tracking) intact.
export function getResumableDraft(dayId: number, now = Date.now()): DraftSession | null {
  const draft = readDraft(now);
  return draft && draft.dayId === dayId ? draft : null;
}

/**
 * Any fresh draft that holds logged sets, whatever day it belongs to — what
 * the Dashboard's "Resume unfinished workout" card shows.
 */
export function getUnfinishedWorkout(now = Date.now()): DraftSession | null {
  const draft = readDraft(now);
  return draftHasSets(draft) ? draft : null;
}

/**
 * A draft with logged sets for a DIFFERENT day than the one about to open.
 * Opening would overwrite it, so the caller must resolve it first.
 */
export function conflictingDraft(dayId: number, now = Date.now()): DraftSession | null {
  const draft = getUnfinishedWorkout(now);
  return draft && draft.dayId !== dayId ? draft : null;
}

// Whether a draft actually contains logged sets (drives the restore banner —
// restoring just a start time isn't worth announcing).
export function draftHasSets(draft: DraftSession | null): boolean {
  return draft != null && Object.values(draft.sets).some(s => s.length > 0);
}

export function draftSetCount(draft: DraftSession | null): number {
  return draft ? Object.values(draft.sets).reduce((n, s) => n + s.length, 0) : 0;
}
