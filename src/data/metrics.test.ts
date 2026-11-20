import { describe, it, expect, beforeEach } from 'vitest';
import { buildSnapshot } from './analytics';
import { computeMetrics, computeRangeSummary } from './metrics';
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

  it('names the logged exercises that have no primary muscle', () => {
    const m = computeMetrics(makeData(), NOW);
    // Orphaned ids are humanized for display (getExerciseName fallback)
    expect(m.unclassifiedExercises).toEqual(['Mystery Exercise 1']);
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

describe('computeRangeSummary', () => {
  // One 1,000 lb session `daysAgo` back each.
  const sessionsAt = (...daysAgo: number[]) => {
    const sessions: Session[] = daysAgo.map((d, i) => ({
      id: i + 1, dayId: 1, weekNumber: 1,
      startedAt: NOW - d * DAY, completedAt: NOW - d * DAY + 3_600_000,
    }));
    const setLogs: SetLog[] = sessions.map((s, i) => ({
      id: i + 1, sessionId: s.id!, exerciseId: 'dumbbell-bench-press',
      setNumber: 1, weight: 100, reps: 10,
    }));
    return buildSnapshot(sessions, setLogs);
  };

  it('totals the window and compares it with the equal-length window before', () => {
    // 3 sessions in the last 30 days, 2 in the 30 before, 1 older than both.
    const snap = sessionsAt(1, 10, 25, 35, 50, 70);
    const r = computeRangeSummary(snap, NOW - 30 * DAY, NOW);
    expect(r.workouts).toBe(3);
    expect(r.volume).toBe(3000);
    expect(r.prevVolume).toBe(2000);
    expect(r.deltaPct).toBe(50);
  });

  it('reports no delta when nothing was logged in the window before', () => {
    // Otherwise a lifter's first month reads as an infinite improvement.
    const r = computeRangeSummary(sessionsAt(1, 3), NOW - 7 * DAY, NOW);
    expect(r.workouts).toBe(2);
    expect(r.deltaPct).toBeNull();
  });

  it('reports a full drop, not "no data", for an empty window after a trained one', () => {
    const r = computeRangeSummary(sessionsAt(10), NOW - 7 * DAY, NOW);
    expect(r.workouts).toBe(0);
    expect(r.volume).toBe(0);
    expect(r.deltaPct).toBe(-100);
  });
});
