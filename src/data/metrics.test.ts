import { describe, it, expect, beforeEach } from 'vitest';
import { buildSnapshot } from './analytics';
import { computeMetrics } from './metrics';
import type { Session, SetLog } from '../db/database';

beforeEach(() => localStorage.clear());

// Wednesday 29 July 2026. The Monday of this week is 27 July.
const NOW = new Date(2026, 6, 29, 12, 0, 0).getTime();
const DAY = 86_400_000;
const at = (dayOfMonth: number, hour = 18) => new Date(2026, 6, dayOfMonth, hour).getTime();

function makeData() {
  const sessions: Session[] = [
    // Last week (Mon 20 July) — deliberately stamped with a *higher* weekNumber
    // than the current-week session, the way a re-anchored program leaves them.
    { id: 1, dayId: 1, weekNumber: 9, startedAt: at(22), completedAt: at(22) + 3_600_000 },
    // This week (Mon 27 July)
    { id: 2, dayId: 2, weekNumber: 1, startedAt: at(28), completedAt: at(28) + 3_600_000 },
    { id: 3, dayId: 3, weekNumber: 1, startedAt: at(29) }, // in progress — must be ignored
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
    const m = computeMetrics(buildSnapshot([], []), NOW);
    expect(m.hasData).toBe(false);
  });

  it('counts only completed sessions and sums volume correctly', () => {
    const m = computeMetrics(makeData(), NOW);
    expect(m.summary.totalWorkouts).toBe(2);
    // (100×10 + 100×8) + (105×10 + 50×12) = 1800 + 1650
    expect(m.summary.totalVolume).toBe(3450);
    expect(m.summary.thisWeekVolume).toBe(1650);
    expect(m.summary.lastWeekVolume).toBe(1800);
    expect(m.summary.deltaPct).toBe(Math.round(((1650 - 1800) / 1800) * 100));
  });

  it('builds a rounded Epley e1RM series per exercise', () => {
    const m = computeMetrics(makeData(), NOW);
    const bench = m.exercises.find(e => e.exerciseId === 'dumbbell-bench-press')!;
    expect(bench.points.map(p => p.value)).toEqual([
      Math.round(100 * (1 + 10 / 30)),
      Math.round(105 * (1 + 10 / 30)),
    ]);
  });

  it('counts fractional muscle sets (primary 1, secondary 0.5) and flags unclassified exercises', () => {
    const m = computeMetrics(makeData(), NOW);
    const find = (muscle: string) => m.muscleSets.find(s => s.muscle === muscle)?.sets;
    // This week: one bench set — Chest primary, Delts + Triceps secondary
    expect(find('Chest')).toBe(1);
    expect(find('Delts')).toBe(0.5);
    expect(find('Triceps')).toBe(0.5);
    expect(find('Other')).toBe(1);   // the mystery exercise
    // Orphaned ids are humanized for display (getExerciseName fallback)
    expect(m.unclassifiedExercises).toEqual(['Mystery Exercise 1']);
  });

  it('credits secondary volume from compounds — a push day counts real triceps sets', () => {
    // 4 incline press (Triceps secondary) + 3 pushdowns (Triceps primary)
    const sessions: Session[] = [
      { id: 1, dayId: 1, weekNumber: 1, startedAt: at(28), completedAt: at(28) + 3_600_000 },
    ];
    const setLogs: SetLog[] = [
      ...[1, 2, 3, 4].map(s => ({
        id: s, sessionId: 1, exerciseId: 'incline-barbell-press', setNumber: s, weight: 135, reps: 8,
      })),
      ...[1, 2, 3].map(s => ({
        id: 4 + s, sessionId: 1, exerciseId: 'tricep-cable-pushdown', setNumber: s, weight: 50, reps: 12,
      })),
    ];
    const m = computeMetrics(buildSnapshot(sessions, setLogs), NOW);
    const triceps = m.muscleSets.find(s => s.muscle === 'Triceps');
    expect(triceps?.sets).toBe(4 * 0.5 + 3);  // 5 fractional hard sets
  });

  it('falls back to the latest week with data when the current week is empty', () => {
    // Three weeks on from the logged data — nothing this week
    const m = computeMetrics(makeData(), NOW + 21 * DAY);
    expect(m.summary.thisWeekVolume).toBe(0);
    expect(m.muscleWeekLabel).not.toBe('This week');
    expect(m.muscleSets.length).toBeGreaterThan(0);
  });
});

describe('computeMetrics — weekly volume chart', () => {
  it('buckets sessions by the calendar week they happened in, not the stored weekNumber', () => {
    // Session 1's weekNumber (9) is higher than session 2's (1) even though it
    // is a week older — exactly what re-anchoring the program leaves behind.
    // Ordering must follow the calendar, not the stored numbers.
    const m = computeMetrics(makeData(), NOW);
    expect(m.weeklyVolume.map(w => w.label)).toEqual(['7/20', '7/27']);
    expect(m.weeklyVolume.map(w => w.value)).toEqual([1800, 1650]);
  });

  it('orders weeks oldest → newest and highlights the current one', () => {
    const m = computeMetrics(makeData(), NOW);
    const starts = m.weeklyVolume.map(w => w.weekStart);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(m.weeklyVolume.filter(w => w.isCurrent)).toHaveLength(1);
    expect(m.weeklyVolume[m.weeklyVolume.length - 1].isCurrent).toBe(true);
    expect(m.weeklyVolume[m.weeklyVolume.length - 1].label).toBe('7/27');
  });

  it('always ends on the current week, even with nothing logged in it', () => {
    const sessions: Session[] = [
      { id: 1, dayId: 1, weekNumber: 1, startedAt: at(15), completedAt: at(15) + 3_600_000 },
    ];
    const setLogs: SetLog[] = [
      { id: 1, sessionId: 1, exerciseId: 'dumbbell-bench-press', setNumber: 1, weight: 100, reps: 10 },
    ];
    const m = computeMetrics(buildSnapshot(sessions, setLogs), NOW);
    const last = m.weeklyVolume[m.weeklyVolume.length - 1];
    expect(last.label).toBe('7/27');
    expect(last.value).toBe(0);
    expect(last.isCurrent).toBe(true);
  });

  it('shows untrained weeks as real gaps rather than collapsing the timeline', () => {
    // Trained 15 July (week of 7/13), then nothing until this week
    const sessions: Session[] = [
      { id: 1, dayId: 1, weekNumber: 1, startedAt: at(15), completedAt: at(15) + 3_600_000 },
      { id: 2, dayId: 1, weekNumber: 2, startedAt: at(28), completedAt: at(28) + 3_600_000 },
    ];
    const setLogs: SetLog[] = [
      { id: 1, sessionId: 1, exerciseId: 'dumbbell-bench-press', setNumber: 1, weight: 100, reps: 10 },
      { id: 2, sessionId: 2, exerciseId: 'dumbbell-bench-press', setNumber: 1, weight: 100, reps: 10 },
    ];
    const m = computeMetrics(buildSnapshot(sessions, setLogs), NOW);
    expect(m.weeklyVolume.map(w => w.label)).toEqual(['7/13', '7/20', '7/27']);
    expect(m.weeklyVolume.map(w => w.value)).toEqual([1000, 0, 1000]);
  });

  it('caps the chart at the last 8 calendar weeks', () => {
    const sessions: Session[] = Array.from({ length: 14 }, (_, i) => ({
      id: i + 1, dayId: 1, weekNumber: i + 1,
      startedAt: NOW - (13 - i) * 7 * DAY,
      completedAt: NOW - (13 - i) * 7 * DAY + 3_600_000,
    }));
    const setLogs: SetLog[] = sessions.map((s, i) => ({
      id: i + 1, sessionId: s.id!, exerciseId: 'dumbbell-bench-press',
      setNumber: 1, weight: 100, reps: 10,
    }));
    const m = computeMetrics(buildSnapshot(sessions, setLogs), NOW);
    expect(m.weeklyVolume).toHaveLength(8);
    expect(m.weeklyVolume[7].isCurrent).toBe(true);
  });
});
