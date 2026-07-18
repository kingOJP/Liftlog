import { describe, it, expect, beforeEach } from 'vitest';
import { QUICK_DAY_ID, buildQuickDayFromDraft, getResumableQuickDraft } from './quickWorkout';
import { saveDraftSession, clearDraftForDay, getResumableDraft, DRAFT_MAX_AGE_MS } from './draftSession';
import type { DraftSession } from './draftSession';

beforeEach(() => localStorage.clear());

const NOW = 1_750_000_000_000;

function quickDraft(overrides: Partial<DraftSession> = {}): DraftSession {
  return {
    dayId: QUICK_DAY_ID,
    startedAt: NOW - 30 * 60_000,
    savedAt: NOW - 20 * 60_000,
    sets: {
      'push-ups':   [{ weight: 0, reps: 15 }, { weight: 0, reps: 12 }],
      'goblet-squat': [{ weight: 40, reps: 10 }],
    },
    order: ['push-ups', 'goblet-squat'],
    ...overrides,
  };
}

describe('getResumableQuickDraft', () => {
  it('returns a fresh quick draft with logged sets', () => {
    saveDraftSession(quickDraft());
    expect(getResumableQuickDraft(NOW)?.dayId).toBe(QUICK_DAY_ID);
  });

  it('ignores drafts for program days', () => {
    saveDraftSession(quickDraft({ dayId: 2 }));
    expect(getResumableQuickDraft(NOW)).toBeNull();
  });

  it('ignores set-less drafts (nothing worth resuming)', () => {
    saveDraftSession(quickDraft({ sets: { 'push-ups': [] } }));
    expect(getResumableQuickDraft(NOW)).toBeNull();
  });

  it('ignores stale drafts (abandoned, not interrupted)', () => {
    saveDraftSession(quickDraft({ savedAt: NOW - DRAFT_MAX_AGE_MS - 1 }));
    expect(getResumableQuickDraft(NOW)).toBeNull();
  });
});

describe('buildQuickDayFromDraft', () => {
  it('rebuilds the quick day in trained order with library names', () => {
    const day = buildQuickDayFromDraft(quickDraft());
    expect(day.id).toBe(QUICK_DAY_ID);
    expect(day.exercises.map(e => e.id)).toEqual(['push-ups', 'goblet-squat']);
    expect(day.exercises[0].name).toBe('Push Ups'); // resolved from the library
  });

  it('includes set-holding exercises missing from the order array', () => {
    const day = buildQuickDayFromDraft(quickDraft({ order: undefined }));
    expect(new Set(day.exercises.map(e => e.id))).toEqual(new Set(['push-ups', 'goblet-squat']));
  });

  it('skips exercises whose sets were all deleted', () => {
    const day = buildQuickDayFromDraft(quickDraft({
      order: [],
      sets: { 'push-ups': [{ weight: 0, reps: 15 }], 'goblet-squat': [] },
    }));
    expect(day.exercises.map(e => e.id)).toEqual(['push-ups']);
  });

  it('humanizes ids the library no longer resolves', () => {
    const day = buildQuickDayFromDraft(quickDraft({
      order: ['jefferson-split-squats-1782324854942'],
      sets: { 'jefferson-split-squats-1782324854942': [{ weight: 50, reps: 8 }] },
    }));
    expect(day.exercises[0].name).toBe('Jefferson Split Squats');
  });
});

describe('clearDraftForDay', () => {
  it('clears only a draft belonging to the given day', () => {
    saveDraftSession(quickDraft({ dayId: 2 }));
    clearDraftForDay(QUICK_DAY_ID);
    expect(getResumableDraft(2, NOW)).not.toBeNull(); // program draft untouched

    saveDraftSession(quickDraft());
    clearDraftForDay(QUICK_DAY_ID);
    expect(getResumableDraft(QUICK_DAY_ID, NOW)).toBeNull();
  });

  it('drops a corrupt draft outright', () => {
    localStorage.setItem('liftlog_draft_session', '{broken');
    clearDraftForDay(QUICK_DAY_ID);
    expect(localStorage.getItem('liftlog_draft_session')).toBeNull();
  });
});
