import { describe, it, expect, beforeEach } from 'vitest';
import { buildSnapshot } from './analytics';
import { computeCoaching } from './insights';
import type { Session, SetLog } from '../db/database';
import type { WorkoutDay } from './program';

beforeEach(() => localStorage.clear());

const NOW = new Date('2026-07-01T12:00:00').getTime();
const DAY = 86_400_000;

const program: WorkoutDay[] = [
  {
    id: 1, label: 'Day 1', muscleGroups: 'Chest',
    exercises: [{ id: 'dumbbell-bench-press', name: 'Dumbbell Bench Press', sets: 3, repLow: 8, repHigh: 10 }],
  },
  {
    id: 2, label: 'Day 2', muscleGroups: 'Back',
    exercises: [{ id: 'lat-pull-down', name: 'Lat Pull Down', sets: 3, repLow: 10, repHigh: 12 }],
  },
];

// Three bench sessions at identical loads — a textbook plateau.
function flatBenchSessions(): { sessions: Session[]; setLogs: SetLog[] } {
  const sessions: Session[] = [1, 2, 3].map(i => ({
    id: i, dayId: 1, weekNumber: i,
    startedAt: NOW - (4 - i) * 5 * DAY, completedAt: NOW - (4 - i) * 5 * DAY + 3_600_000,
  }));
  const setLogs: SetLog[] = sessions.flatMap((s, i) => [
    { id: i * 2 + 1, sessionId: s.id!, exerciseId: 'dumbbell-bench-press', setNumber: 1, weight: 100, reps: 10 },
    { id: i * 2 + 2, sessionId: s.id!, exerciseId: 'dumbbell-bench-press', setNumber: 2, weight: 100, reps: 9 },
  ]);
  return { sessions, setLogs };
}

describe('computeCoaching', () => {
  it('reports no data when nothing is logged, but still suggests a next day', () => {
    const c = computeCoaching(program, buildSnapshot([], []), 1, NOW);
    expect(c.hasData).toBe(false);
    expect(c.nextDay).not.toBeNull();
    expect(c.plan.ready).toBe(false);
  });

  it('never nags about under-trained muscles — the planner handles volume', () => {
    const { sessions, setLogs } = flatBenchSessions();
    const c = computeCoaching(program, buildSnapshot(sessions, setLogs), 3, NOW);
    // Chest volume is still measured and reported...
    const chest = c.muscleVolume.find(v => v.muscle === 'Chest')!;
    expect(chest.status).toBe('low');
    // ...but no insight tells the user to go add sets themselves.
    const all = [...c.highlights, ...c.opportunities];
    expect(all.some(i => /under-?trained/i.test(i.title + i.detail))).toBe(false);
  });

  it('surfaces a plateau as an opportunity — no PRs and flat strength/volume', () => {
    const { sessions, setLogs } = flatBenchSessions();
    const c = computeCoaching(program, buildSnapshot(sessions, setLogs), 3, NOW);
    const p = c.progress.find(x => x.exerciseId === 'dumbbell-bench-press')!;
    expect(p.status).toBe('stalled');
    expect(p.weightPRs + p.repPRs).toBe(0);
    const plateau = c.opportunities.find(i => i.kind === 'plateau');
    expect(plateau).toBeDefined();
    expect(plateau!.title).toContain('Dumbbell Bench Press');
  });

  it('surfaces a strength decline as the top opportunity', () => {
    const sessions: Session[] = [1, 2, 3].map(i => ({
      id: i, dayId: 1, weekNumber: 1,
      startedAt: NOW - (4 - i) * 5 * DAY, completedAt: NOW - (4 - i) * 5 * DAY + 3_600_000,
    }));
    const setLogs: SetLog[] = sessions.map((s, i) => ({
      id: i + 1, sessionId: s.id!, exerciseId: 'dumbbell-bench-press',
      setNumber: 1, weight: 100 - i * 10, reps: 10,
    }));
    const c = computeCoaching(program, buildSnapshot(sessions, setLogs), 1, NOW);
    expect(c.opportunities[0].kind).toBe('trend-down');
    expect(c.opportunities[0].detail).toMatch(/recovery/i);
  });

  it('highlights a climbing lift and a fresh PR', () => {
    const sessions: Session[] = [1, 2, 3].map(i => ({
      id: i, dayId: 1, weekNumber: 1,
      startedAt: NOW - (4 - i) * 2 * DAY, completedAt: NOW - (4 - i) * 2 * DAY + 3_600_000,
    }));
    const setLogs: SetLog[] = sessions.map((s, i) => ({
      id: i + 1, sessionId: s.id!, exerciseId: 'dumbbell-bench-press',
      setNumber: 1, weight: 100 + i * 10, reps: 10,
    }));
    const c = computeCoaching(program, buildSnapshot(sessions, setLogs), 1, NOW);
    const p = c.progress.find(x => x.exerciseId === 'dumbbell-bench-press')!;
    expect(p.status).toBe('progressing');
    expect(p.weightPRs).toBeGreaterThan(0);
    expect(c.highlights.some(i => i.kind === 'pr')).toBe(true);
    expect(c.highlights.some(i => i.kind === 'trend-up')).toBe(true);
  });

  it('caps highlights and opportunities at three each', () => {
    const { sessions, setLogs } = flatBenchSessions();
    const c = computeCoaching(program, buildSnapshot(sessions, setLogs), 3, NOW);
    expect(c.highlights.length).toBeLessThanOrEqual(3);
    expect(c.opportunities.length).toBeLessThanOrEqual(3);
  });

  it('suggests the day that has gone longest without training', () => {
    const { sessions, setLogs } = flatBenchSessions(); // only day 1 ever trained
    const c = computeCoaching(program, buildSnapshot(sessions, setLogs), 3, NOW);
    expect(c.nextDay?.dayId).toBe(2);
    expect(c.nextDay?.lastTrained).toBeNull();
  });
});
