import { describe, it, expect, beforeEach } from 'vitest';
import { buildSnapshot } from './analytics';
import { suggestReplacements, candidateProfiles, profileFor } from './substitution';
import type { WorkoutDay } from './program';
import type { Session, SetLog } from '../db/database';

beforeEach(() => localStorage.clear());

const NOW = new Date('2026-07-01T12:00:00').getTime();
const DAY = 86_400_000;

const chestDay: WorkoutDay = {
  id: 1, label: 'Day 1', muscleGroups: 'Chest',
  exercises: [
    { id: 'incline-barbell-press', name: 'Incline Barbell Press', sets: 4, repLow: 6,  repHigh: 8  },
    { id: 'dumbbell-bench-press',  name: 'Dumbbell Bench Press',  sets: 3, repLow: 8,  repHigh: 10 },
    { id: 'cable-fly',             name: 'Cable Fly',             sets: 3, repLow: 12, repHigh: 15 },
  ],
};
const target = chestDay.exercises[1]; // Dumbbell Bench Press

// n sessions of one exercise, newest first, weights per session (oldest last).
function makeSnapshot(exerciseId: string, weights: number[]) {
  const sessions: Session[] = [];
  const setLogs: SetLog[] = [];
  weights.forEach((weight, i) => {
    const completedAt = NOW - i * 3 * DAY;
    sessions.push({ id: i + 1, dayId: 1, weekNumber: 1, startedAt: completedAt - 3_600_000, completedAt });
    for (let s = 1; s <= 3; s++) {
      setLogs.push({ id: i * 10 + s, sessionId: i + 1, exerciseId, setNumber: s, weight, reps: 10 });
    }
  });
  return buildSnapshot(sessions, setLogs);
}

describe('suggestReplacements', () => {
  it('returns at most 3 suggestions that all train the target primary muscle', () => {
    const suggestions = suggestReplacements(target, chestDay, null, 3, NOW);

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(3);
    for (const s of suggestions) {
      const muscles = [s.exercise.primaryMuscle, ...s.exercise.secondaryMuscles];
      expect(muscles).toContain('Chest');
      expect(s.reasons.length).toBeGreaterThan(0);
    }
  });

  it('never suggests the target itself or exercises already in the day', () => {
    const suggestions = suggestReplacements(target, chestDay, null, 10, NOW);
    const dayIds = new Set(chestDay.exercises.map(e => e.id));
    for (const s of suggestions) expect(dayIds.has(s.exercise.id)).toBe(false);
  });

  it('penalizes movement patterns the rest of the day already covers', () => {
    // The day already has a Press (incline) and a Fly (cable) — a fresh
    // pattern like Dips should outrank another barbell press.
    const suggestions = suggestReplacements(target, chestDay, null, 10, NOW);
    const byId = new Map(suggestions.map(s => [s.exercise.id, s]));

    const dips = byId.get('weighted-dips');
    const flatBench = byId.get('flat-barbell-bench-press');
    expect(dips).toBeDefined();
    expect(flatBench).toBeDefined();
    expect(dips!.score).toBeGreaterThan(flatBench!.score);
    expect(flatBench!.cautions.join(' ')).toMatch(/Press pattern already/);
  });

  it('skips the same lift under a different name', () => {
    const tricepsDay: WorkoutDay = {
      id: 1, label: 'Day 1', muscleGroups: 'Triceps',
      exercises: [
        { id: 'tricep-cable-pushdown', name: 'Tricep Cable Pushdown', sets: 3, repLow: 12, repHigh: 15 },
      ],
    };
    const suggestions = suggestReplacements(tricepsDay.exercises[0], tricepsDay, null, 10, NOW);
    // 'Cable Pushdown' is the same movement as 'Tricep Cable Pushdown'
    expect(suggestions.some(s => s.exercise.id === 'cable-pushdown')).toBe(false);
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it('prefers exercises the user has trained before and says so', () => {
    const flyDay: WorkoutDay = {
      id: 1, label: 'Day 1', muscleGroups: 'Chest',
      exercises: [{ id: 'cable-fly', name: 'Cable Fly', sets: 3, repLow: 12, repHigh: 15 }],
    };
    // Rising strength history on the pec deck
    const snapshot = makeSnapshot('pec-deck-fly', [120, 110, 100]);
    const suggestions = suggestReplacements(flyDay.exercises[0], flyDay, snapshot, 10, NOW);
    const byId = new Map(suggestions.map(s => [s.exercise.id, s]));

    const pecDeck = byId.get('pec-deck-fly');
    const dumbbellFly = byId.get('dumbbell-fly');
    expect(pecDeck).toBeDefined();
    expect(pecDeck!.reasons.join(' ')).toMatch(/trained it before/);
    expect(pecDeck!.reasons.join(' ')).toMatch(/trending up/);
    if (dumbbellFly) expect(pecDeck!.score).toBeGreaterThan(dumbbellFly.score);
  });

  it('flags a candidate whose strength has been declining', () => {
    const flyDay: WorkoutDay = {
      id: 1, label: 'Day 1', muscleGroups: 'Chest',
      exercises: [{ id: 'cable-fly', name: 'Cable Fly', sets: 3, repLow: 12, repHigh: 15 }],
    };
    // Falling e1RM on the pec deck (newest first: 80 < 100)
    const snapshot = makeSnapshot('pec-deck-fly', [80, 90, 100]);
    const suggestions = suggestReplacements(flyDay.exercises[0], flyDay, snapshot, 20, NOW);
    const pecDeck = suggestions.find(s => s.exercise.id === 'pec-deck-fly');
    expect(pecDeck).toBeDefined();
    expect(pecDeck!.cautions.join(' ')).toMatch(/declining/);
  });

  it('warns when a suggestion needs equipment the user has never trained with', () => {
    const suggestions = suggestReplacements(target, chestDay, null, 10, NOW);
    const dips = suggestions.find(s => s.exercise.id === 'weighted-dips');
    expect(dips).toBeDefined();
    // Day uses Bench + Cable Machine only — a dip station is new equipment
    expect(dips!.cautions.join(' ')).toMatch(/dip station/i);
  });

  it('returns nothing for an exercise with no resolvable muscle metadata', () => {
    const day: WorkoutDay = {
      id: 1, label: 'Day 1', muscleGroups: 'Misc',
      exercises: [{ id: 'mystery-1234', name: 'Mystery Movement', sets: 3, repLow: 8, repHigh: 12 }],
    };
    expect(suggestReplacements(day.exercises[0], day, null, 3, NOW)).toHaveLength(0);
  });
});

describe('candidateProfiles', () => {
  it('lets a custom library exercise shadow its catalog twin by name', () => {
    localStorage.setItem('liftlog_library_v3', '1');
    localStorage.setItem('liftlog_exercises', JSON.stringify([
      { id: 'my-squat-99', name: 'Barbell Back Squat', sets: 3, repLow: 8, repHigh: 12 },
    ]));

    const ids = new Set(candidateProfiles().map(p => p.id));
    expect(ids.has('my-squat-99')).toBe(true);       // the user's entry wins…
    expect(ids.has('barbell-back-squat')).toBe(false); // …the catalog twin is deduped
  });

  it('excludes tombstoned exercises', () => {
    localStorage.setItem('liftlog_deleted_exercises', JSON.stringify(['weighted-dips']));
    const ids = new Set(candidateProfiles().map(p => p.id));
    expect(ids.has('weighted-dips')).toBe(false);
  });
});

describe('profileFor', () => {
  it('resolves custom exercises by name match against the catalog', () => {
    const p = profileFor('my-squat-99', 'Barbell Back Squat');
    expect(p.primaryMuscle).toBe('Quads');
    expect(p.workoutType).toBe('Squat');
    expect(p.mechanics).toBe('compound');
  });

  it('derives isolation mechanics for single-joint patterns', () => {
    expect(profileFor('cable-lateral-raises').mechanics).toBe('isolation');
    expect(profileFor('leg-press').mechanics).toBe('compound');
  });
});
