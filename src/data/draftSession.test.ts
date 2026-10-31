import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveDraftSession, getResumableDraft, clearDraftSession, draftHasSets, DRAFT_MAX_AGE_MS,
} from './draftSession';
import type { DraftSession } from './draftSession';

beforeEach(() => localStorage.clear());

const NOW = 1_750_000_000_000;

function draft(overrides: Partial<DraftSession> = {}): DraftSession {
  return {
    dayId: 2,
    startedAt: NOW - 20 * 60_000,
    savedAt: NOW - 10 * 60_000,
    sets: { 'face-pulls': [{ weight: 50, reps: 15 }] },
    ...overrides,
  };
}

describe('draft session persistence', () => {
  it('round-trips a draft for the same day', () => {
    saveDraftSession(draft());
    const restored = getResumableDraft(2, NOW);
    expect(restored?.sets['face-pulls']).toEqual([{ weight: 50, reps: 15 }]);
    expect(restored?.startedAt).toBe(NOW - 20 * 60_000);
  });

  it('does not resume a draft for a different day', () => {
    saveDraftSession(draft({ dayId: 1 }));
    expect(getResumableDraft(2, NOW)).toBeNull();
  });

  it('does not resume a stale draft (abandoned, not interrupted)', () => {
    saveDraftSession(draft({ savedAt: NOW - DRAFT_MAX_AGE_MS - 1 }));
    expect(getResumableDraft(2, NOW)).toBeNull();
  });

  it('resumes a set-less draft (started workout keeps its start time) but flags it as empty', () => {
    saveDraftSession(draft({ sets: { 'face-pulls': [] } }));
    const restored = getResumableDraft(2, NOW);
    expect(restored?.startedAt).toBe(NOW - 20 * 60_000);
    expect(draftHasSets(restored)).toBe(false);
    expect(draftHasSets(draft())).toBe(true);
  });

  it('clearDraftSession removes the draft', () => {
    saveDraftSession(draft());
    clearDraftSession();
    expect(getResumableDraft(2, NOW)).toBeNull();
  });

  it('survives corrupt stored JSON', () => {
    localStorage.setItem('liftlog_draft_session', '{broken');
    expect(getResumableDraft(2, NOW)).toBeNull();
  });
});

// ── Draft protection (audit H1) ──────────────────────────────────────────────

import { conflictingDraft, getUnfinishedWorkout, draftSetCount } from './draftSession';

describe('a draft with logged sets is protected from being overwritten', () => {
  it('is reported as a conflict when a different day opens', () => {
    saveDraftSession(draft({ dayId: 2 }));
    expect(conflictingDraft(3, NOW)?.dayId).toBe(2);
  });

  it('is not a conflict for the same day — that is a resume', () => {
    saveDraftSession(draft({ dayId: 2 }));
    expect(conflictingDraft(2, NOW)).toBeNull();
  });

  it('a draft with no sets never blocks anything', () => {
    saveDraftSession(draft({ dayId: 2, sets: {} }));
    expect(conflictingDraft(3, NOW)).toBeNull();
    expect(getUnfinishedWorkout(NOW)).toBeNull();
  });

  it('an expired draft is neither a conflict nor resumable', () => {
    saveDraftSession(draft({ savedAt: NOW - DRAFT_MAX_AGE_MS - 1 }));
    expect(conflictingDraft(3, NOW)).toBeNull();
    expect(getUnfinishedWorkout(NOW)).toBeNull();
  });

  it('carries the day snapshot and origin so a quick workout can be resumed after a kill', () => {
    const day = { id: -2, label: 'Quick Workout', muscleGroups: 'One-off', exercises: [{ id: 'squat', name: 'Squat', sets: 5 }] };
    saveDraftSession(draft({ dayId: -2, day, origin: 'quick', added: [{ id: 'dips', name: 'Dips', sets: 3 }] }));
    const d = getUnfinishedWorkout(NOW)!;
    expect(d.day).toEqual(day);
    expect(d.origin).toBe('quick');
    expect(d.added).toHaveLength(1);
    expect(draftSetCount(d)).toBe(1);
  });
});
