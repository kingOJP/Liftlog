import { describe, it, expect, beforeEach } from 'vitest';
import { buildSnapshot } from './analytics';
import { computeCoaching } from './insights';
import type { Session, SetLog } from '../db/database';
import type { WorkoutDay } from './program';

beforeEach(() => localStorage.clear());

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

function flatBenchSessions(): { sessions: Session[]; setLogs: SetLog[] } {
  const sessions: Session[] = [1, 2, 3].map(i => ({
    id: i, dayId: 1, weekNumber: i, startedAt: i * 1000, completedAt: i * 1000 + 500,
  }));
  const setLogs: SetLog[] = sessions.flatMap((s, i) => [
    { id: i * 2 + 1, sessionId: s.id!, exerciseId: 'dumbbell-bench-press', setNumber: 1, weight: 100, reps: 10 },
    { id: i * 2 + 2, sessionId: s.id!, exerciseId: 'dumbbell-bench-press', setNumber: 2, weight: 100, reps: 9 },
  ]);
  return { sessions, setLogs };
}

describe('computeCoaching', () => {
  it('reports no data when nothing is logged, but still suggests a next day', () => {
    const c = computeCoaching(program, buildSnapshot([], []), 1);
    expect(c.hasData).toBe(false);
    expect(c.nextDay).not.toBeNull();
  });

  it('flags under-trained program muscles, but not ones worked in the last 2 sessions', () => {
    const { sessions, setLogs } = flatBenchSessions();
    const c = computeCoaching(program, buildSnapshot(sessions, setLogs), 3);
    // Chest is under target volume...
    const chest = c.muscleVolume.find(v => v.muscle === 'Chest')!;
    expect(chest.sets).toBe(2);
    expect(chest.status).toBe('low');
    // ...but it was just trained, so we don't nag to add more.
    expect(c.insights.some(i => i.kind === 'volume-low' && i.title.startsWith('Chest'))).toBe(false);
    // Lats is a program muscle that was never trained → flagged.
    expect(c.insights.some(i => i.kind === 'volume-low' && i.title.startsWith('Lats'))).toBe(true);
  });

  it('caps under-trained muscle nudges at four', () => {
    const bigProgram: WorkoutDay[] = [{
      id: 1, label: 'Day 1', muscleGroups: 'Full body',
      exercises: [
        { id: 'incline-barbell-press', name: 'Incline Barbell Press', sets: 3, repLow: 6, repHigh: 8 },  // Chest
        { id: 'lat-pull-down',         name: 'Lat Pull Down',         sets: 3, repLow: 10, repHigh: 12 }, // Lats
        { id: 'leg-press',             name: 'Leg Press',             sets: 3, repLow: 8, repHigh: 12 },  // Quads
        { id: 'romanian-deadlifts',    name: 'Romanian Deadlifts',    sets: 3, repLow: 8, repHigh: 12 },  // Hamstrings
        { id: 'seated-calf-raises',    name: 'Seated Calf Raises',    sets: 3, repLow: 20, repHigh: 25 }, // Calves
        { id: 'hip-thrusts',           name: 'Hip Thrusts',           sets: 3, repLow: 10, repHigh: 12 }, // Glutes
      ],
    }];
    // One session training an unrelated muscle (Biceps) → hasData, and none of
    // the six program muscles were worked recently.
    const sessions: Session[] = [{ id: 1, dayId: 1, weekNumber: 1, startedAt: 1, completedAt: 2 }];
    const setLogs: SetLog[] = [
      { id: 1, sessionId: 1, exerciseId: 'hammer-curls', setNumber: 1, weight: 20, reps: 12 },
    ];
    const c = computeCoaching(bigProgram, buildSnapshot(sessions, setLogs), 1);
    const lows = c.insights.filter(i => i.kind === 'volume-low');
    expect(lows).toHaveLength(4);
  });

  it('detects a plateau across three flat sessions', () => {
    const { sessions, setLogs } = flatBenchSessions();
    const c = computeCoaching(program, buildSnapshot(sessions, setLogs), 3);
    const trend = c.trends.find(t => t.exerciseId === 'dumbbell-bench-press')!;
    expect(trend.dir).toBe('flat');
    expect(c.insights.some(i => i.kind === 'plateau')).toBe(true);
  });

  it('suggests the day that has gone longest without training', () => {
    const { sessions, setLogs } = flatBenchSessions(); // only day 1 ever trained
    const c = computeCoaching(program, buildSnapshot(sessions, setLogs), 3);
    expect(c.nextDay?.dayId).toBe(2);
    expect(c.nextDay?.lastTrained).toBeNull();
  });

  it('marks a rising e1RM as an up-trend', () => {
    const sessions: Session[] = [1, 2, 3].map(i => ({
      id: i, dayId: 1, weekNumber: 1, startedAt: i * 1000, completedAt: i * 1000 + 500,
    }));
    const setLogs: SetLog[] = sessions.map((s, i) => ({
      id: i + 1, sessionId: s.id!, exerciseId: 'dumbbell-bench-press',
      setNumber: 1, weight: 100 + i * 10, reps: 10,
    }));
    const c = computeCoaching(program, buildSnapshot(sessions, setLogs), 1);
    const trend = c.trends.find(t => t.exerciseId === 'dumbbell-bench-press')!;
    expect(trend.dir).toBe('up');
    expect(c.insights.some(i => i.kind === 'progress')).toBe(true);
  });
});
