import { describe, it, expect, beforeEach } from 'vitest';
import { buildSnapshot } from './analytics';
import { computeMetrics } from './metrics';
import type { Session, SetLog } from '../db/database';

beforeEach(() => localStorage.clear());

function makeData() {
  const sessions: Session[] = [
    { id: 1, dayId: 1, weekNumber: 1, startedAt: 1_000, completedAt: 2_000 },
    { id: 2, dayId: 2, weekNumber: 2, startedAt: 700_000_000, completedAt: 700_001_000 },
    { id: 3, dayId: 3, weekNumber: 2, startedAt: 700_100_000 }, // in progress — must be ignored
  ];
  const setLogs: SetLog[] = [
    { id: 1, sessionId: 1, exerciseId: 'dumbbell-bench-press', setNumber: 1, weight: 100, reps: 10 },
    { id: 2, sessionId: 1, exerciseId: 'dumbbell-bench-press', setNumber: 2, weight: 100, reps: 8 },
    { id: 3, sessionId: 2, exerciseId: 'dumbbell-bench-press', setNumber: 1, weight: 105, reps: 10 },
    { id: 4, sessionId: 2, exerciseId: 'mystery-exercise-1',   setNumber: 1, weight: 50,  reps: 12 },
    { id: 5, sessionId: 3, exerciseId: 'dumbbell-bench-press', setNumber: 1, weight: 999, reps: 10 },
  ];
  return buildSnapshot(sessions, setLogs);
}

describe('computeMetrics', () => {
  it('reports no data for an empty snapshot', () => {
    const m = computeMetrics(buildSnapshot([], []), 1);
    expect(m.hasData).toBe(false);
  });

  it('counts only completed sessions and sums volume correctly', () => {
    const m = computeMetrics(makeData(), 2);
    expect(m.summary.totalWorkouts).toBe(2);
    // (100×10 + 100×8) + (105×10 + 50×12) = 1800 + 1650
    expect(m.summary.totalVolume).toBe(3450);
    expect(m.summary.thisWeekVolume).toBe(1650);
    expect(m.summary.lastWeekVolume).toBe(1800);
    expect(m.summary.deltaPct).toBe(Math.round(((1650 - 1800) / 1800) * 100));
  });

  it('builds a rounded Epley e1RM series per exercise', () => {
    const m = computeMetrics(makeData(), 2);
    const bench = m.exercises.find(e => e.exerciseId === 'dumbbell-bench-press')!;
    expect(bench.points.map(p => p.value)).toEqual([
      Math.round(100 * (1 + 10 / 30)),
      Math.round(105 * (1 + 10 / 30)),
    ]);
  });

  it('counts fractional muscle sets (primary 1, secondary 0.5) and flags unclassified exercises', () => {
    const m = computeMetrics(makeData(), 2);
    const find = (muscle: string) => m.muscleSets.find(s => s.muscle === muscle)?.sets;
    // week 2: one bench set — Chest primary, Delts + Triceps secondary
    expect(find('Chest')).toBe(1);
    expect(find('Delts')).toBe(0.5);
    expect(find('Triceps')).toBe(0.5);
    expect(find('Other')).toBe(1);   // the mystery exercise
    // Orphaned ids are humanized for display (getExerciseName fallback)
    expect(m.unclassifiedExercises).toEqual(['Mystery Exercise 1']);
  });

  it('credits secondary volume from compounds — a push day counts real triceps sets', () => {
    // 4 incline press (Triceps secondary) + 3 pushdowns (Triceps primary)
    const sessions: Session[] = [{ id: 1, dayId: 1, weekNumber: 1, startedAt: 1_000, completedAt: 2_000 }];
    const setLogs: SetLog[] = [
      ...[1, 2, 3, 4].map(s => ({
        id: s, sessionId: 1, exerciseId: 'incline-barbell-press', setNumber: s, weight: 135, reps: 8,
      })),
      ...[1, 2, 3].map(s => ({
        id: 4 + s, sessionId: 1, exerciseId: 'tricep-cable-pushdown', setNumber: s, weight: 50, reps: 12,
      })),
    ];
    const m = computeMetrics(buildSnapshot(sessions, setLogs), 1);
    const triceps = m.muscleSets.find(s => s.muscle === 'Triceps');
    expect(triceps?.sets).toBe(4 * 0.5 + 3);  // 5 fractional hard sets
  });

  it('falls back to the latest week with data when the current week is empty', () => {
    const m = computeMetrics(makeData(), 7);
    expect(m.summary.thisWeekVolume).toBe(0);
    expect(m.muscleWeekLabel).not.toBe('This week');
    expect(m.muscleSets.length).toBeGreaterThan(0);
  });
});
