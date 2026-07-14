import { describe, it, expect, beforeEach } from 'vitest';
import { buildSnapshot } from './analytics';
import type { Session, SetLog } from '../db/database';
import { difficultyFor, prerequisitesFor } from './exercises';
import { inferExperience, effectiveExperience, experienceSuggestion } from './experience';
import { defaultTrainingProfile } from './plan';
import type { TrainingProfile } from './plan';

beforeEach(() => localStorage.clear());

const DAY = 86_400_000;
const NOW = new Date('2026-07-01T12:00:00').getTime();

// Build a snapshot of `n` sessions, `weeksBack` spread, each logging the given
// exercise ids with real load.
function history(entries: { exerciseId: string; sessions: number }[], weeksBack: number): ReturnType<typeof buildSnapshot> {
  const sessions: Session[] = [];
  const setLogs: SetLog[] = [];
  const total = Math.max(...entries.map(e => e.sessions));
  let sid = 1, lid = 1;
  for (let i = 0; i < total; i++) {
    // spread sessions evenly across the window, oldest first
    const completedAt = NOW - weeksBack * 7 * DAY + Math.round((i / Math.max(1, total - 1)) * weeksBack * 7 * DAY);
    const id = sid++;
    sessions.push({ id, dayId: 1, weekNumber: 1, startedAt: completedAt - 3_600_000, completedAt });
    for (const e of entries) {
      if (i < e.sessions) {
        for (let s = 1; s <= 3; s++) setLogs.push({ id: lid++, sessionId: id, exerciseId: e.exerciseId, setNumber: s, weight: 135, reps: 8, order: 0 });
      }
    }
  }
  return buildSnapshot(sessions, setLogs);
}

function profile(overrides: Partial<TrainingProfile> = {}): TrainingProfile {
  return { ...defaultTrainingProfile(), ...overrides };
}

describe('difficulty catalog', () => {
  it('tags machines/cables as beginner and skill-heavy barbell lifts as advanced', () => {
    expect(difficultyFor('leg-press')).toBe('beginner');
    expect(difficultyFor('lat-pull-down')).toBe('beginner');
    expect(difficultyFor('conventional-deadlift')).toBe('advanced');
    expect(difficultyFor('barbell-back-squat')).toBe('advanced');
    // unlisted compound defaults to intermediate
    expect(difficultyFor('dumbbell-bench-press')).toBe('intermediate');
  });

  it('exposes prerequisites for advanced lifts and resolves timestamped ids', () => {
    expect(prerequisitesFor('conventional-deadlift')).toContain('romanian-deadlifts');
    expect(difficultyFor('barbell-back-squat-1782325116469')).toBe('advanced');
  });
});

describe('inferExperience', () => {
  it('returns beginner with no history', () => {
    expect(inferExperience(buildSnapshot([], []), NOW).level).toBe('beginner');
  });

  it('stays beginner for a handful of light machine sessions', () => {
    const snap = history([{ exerciseId: 'leg-press', sessions: 5 }], 3);
    expect(inferExperience(snap, NOW).level).toBe('beginner');
  });

  it('reaches intermediate with consistent training over time', () => {
    const snap = history([{ exerciseId: 'dumbbell-bench-press', sessions: 14 }], 10);
    expect(inferExperience(snap, NOW).level).toBe('intermediate');
  });

  it('reaches advanced when consistently handling multiple advanced lifts', () => {
    const snap = history([
      { exerciseId: 'conventional-deadlift', sessions: 32 },
      { exerciseId: 'barbell-back-squat', sessions: 32 },
      { exerciseId: 'dumbbell-bench-press', sessions: 32 },
    ], 26);
    const inf = inferExperience(snap, NOW);
    expect(inf.masteredAdvanced).toBeGreaterThanOrEqual(2);
    expect(inf.level).toBe('advanced');
  });
});

describe('effectiveExperience + suggestion', () => {
  it('never plans below the self-reported level', () => {
    const snap = history([{ exerciseId: 'leg-press', sessions: 3 }], 2);
    // Self-reports advanced but data is thin → keep advanced (no downgrade)
    expect(effectiveExperience(profile({ experience: 'advanced' }), snap)).toBe('advanced');
  });

  it('upgrades a self-reported beginner whose data says intermediate', () => {
    const snap = history([{ exerciseId: 'dumbbell-bench-press', sessions: 14 }], 10);
    expect(effectiveExperience(profile({ experience: 'beginner' }), snap)).toBe('intermediate');
    const s = experienceSuggestion(profile({ experience: 'beginner' }), snap, NOW);
    expect(s).not.toBeNull();
    expect(s!.to).toBe('intermediate');
  });

  it('offers no suggestion when the profile already matches the data', () => {
    const snap = history([{ exerciseId: 'dumbbell-bench-press', sessions: 14 }], 10);
    expect(experienceSuggestion(profile({ experience: 'intermediate' }), snap, NOW)).toBeNull();
  });
});
