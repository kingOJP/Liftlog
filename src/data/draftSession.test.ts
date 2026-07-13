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
