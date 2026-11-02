import { describe, it, expect, beforeEach } from 'vitest';
import { buildSnapshot, headSetTotals, muscleSetTotals, e1rmSeries } from './analytics';
import { computeMetrics } from './metrics';
import type { Session, SetLog } from '../db/database';

beforeEach(() => localStorage.clear());

// Warm-up sets are logged and displayed but must never reach an analytical
// read. buildSnapshot keeps them out of setsBySession (the analytics input) and
// only in allSetsBySession (display).
describe('buildSnapshot warm-up handling', () => {
  const sessions: Session[] = [
    { id: 1, dayId: 1, weekNumber: 1, startedAt: 1_000, completedAt: 2_000 },
  ];
  const setLogs: SetLog[] = [
    { id: 1, sessionId: 1, exerciseId: 'dumbbell-bench-press', setNumber: 1, weight: 45,  reps: 15, warmup: true },
    { id: 2, sessionId: 1, exerciseId: 'dumbbell-bench-press', setNumber: 2, weight: 95,  reps: 10, warmup: true },
    { id: 3, sessionId: 1, exerciseId: 'dumbbell-bench-press', setNumber: 3, weight: 135, reps: 10 },
    { id: 4, sessionId: 1, exerciseId: 'dumbbell-bench-press', setNumber: 4, weight: 135, reps: 9 },
  ];

  it('excludes warm-ups from setsBySession but keeps them in allSetsBySession', () => {
    const snap = buildSnapshot(sessions, setLogs);
    expect(snap.setsBySession.get(1)?.map(s => s.weight)).toEqual([135, 135]);
    expect(snap.allSetsBySession.get(1)?.map(s => s.weight)).toEqual([45, 95, 135, 135]);
  });

  it('does not count warm-up volume or muscle sets in metrics', () => {
    const m = computeMetrics(buildSnapshot(sessions, setLogs), 1);
    // Only the two 135 working sets count: 135×10 + 135×9
    expect(m.summary.totalVolume).toBe(135 * 10 + 135 * 9);
    // Two working sets → Chest counts 2 (not 4)
    expect(m.muscleSets.find(s => s.muscle === 'Chest')?.sets).toBe(2);
  });

  it('a session of only warm-ups contributes nothing to analytics', () => {
    const warmOnly: SetLog[] = [
      { id: 1, sessionId: 1, exerciseId: 'dumbbell-bench-press', setNumber: 1, weight: 45, reps: 15, warmup: true },
    ];
    const snap = buildSnapshot(sessions, warmOnly);
    expect(snap.setsBySession.get(1)).toBeUndefined();
    expect(snap.allSetsBySession.get(1)).toHaveLength(1);
    const m = computeMetrics(snap, 1);
    expect(m.summary.totalVolume).toBe(0);
  });
});

describe('headSetTotals — Tier 3 muscle-head accumulation', () => {
  const headSessions: Session[] = [
    { id: 1, dayId: 1, weekNumber: 1, startedAt: 1_000, completedAt: 2_000 },
  ];

  it('credits a set to every catalogued head of its exercise', () => {
    const setLogs: SetLog[] = [
      // seated-calf-raises → Calves, Soleus only
      { id: 1, sessionId: 1, exerciseId: 'seated-calf-raises', setNumber: 1, weight: 90, reps: 12 },
      { id: 2, sessionId: 1, exerciseId: 'seated-calf-raises', setNumber: 2, weight: 90, reps: 12 },
      // standing-calf-raises → Calves, Gastrocnemius
      { id: 3, sessionId: 1, exerciseId: 'standing-calf-raises', setNumber: 1, weight: 135, reps: 10 },
    ];
    const totals = headSetTotals(buildSnapshot(headSessions, setLogs));
    expect(totals.byHead.get('Calves::Soleus')).toBe(2);
    expect(totals.byHead.get('Calves::Gastrocnemius')).toBe(1);
    expect(totals.unspecified.size).toBe(0);
  });

  it('buckets exercises with no catalogued head emphasis as unspecified', () => {
    const setLogs: SetLog[] = [
      { id: 1, sessionId: 1, exerciseId: 'barbell-back-squat', setNumber: 1, weight: 225, reps: 5 },
    ];
    const totals = headSetTotals(buildSnapshot(headSessions, setLogs));
    expect(totals.byHead.size).toBe(0);
    expect(totals.unspecified.get('Quads')).toBe(1);
  });
});

// Set variations: how a set was done changes what it counts for. An extension
// row (drop / rest-pause / partials) is the previous set carrying on, so it is
// half a set of volume and never a strength estimate; a grip shifts the muscle
// split the volume accounting reads.
describe('set variations in the volume and strength reads', () => {
  const sessions: Session[] = [
    { id: 1, dayId: 1, weekNumber: 1, startedAt: 1_000, completedAt: 2_000 },
  ];

  it('counts a drop set as half a set, not a new one', () => {
    const logs: SetLog[] = [
      { id: 1, sessionId: 1, exerciseId: 'cable-fly', setNumber: 1, weight: 40, reps: 12 },
      { id: 2, sessionId: 1, exerciseId: 'cable-fly', setNumber: 2, weight: 40, reps: 12 },
      { id: 3, sessionId: 1, exerciseId: 'cable-fly', setNumber: 3, weight: 30, reps: 10, technique: 'drop' },
      { id: 4, sessionId: 1, exerciseId: 'cable-fly', setNumber: 4, weight: 20, reps: 10, technique: 'drop' },
    ];
    const { totals } = muscleSetTotals(buildSnapshot(sessions, logs));
    expect(totals.get('Chest')).toBe(3);        // 1 + 1 + 0.5 + 0.5
    expect(totals.get('Delts')).toBe(1.5);      // secondary at half of that
  });

  it('reads a close-grip bench as more of a triceps exercise', () => {
    const plain: SetLog[] = [
      { id: 1, sessionId: 1, exerciseId: 'flat-barbell-bench-press', setNumber: 1, weight: 185, reps: 8 },
    ];
    const close: SetLog[] = [{ ...plain[0], grip: 'close' }];
    expect(muscleSetTotals(buildSnapshot(sessions, plain)).totals.get('Triceps')).toBe(0.5);
    expect(muscleSetTotals(buildSnapshot(sessions, close)).totals.get('Triceps')).toBe(0.75);
    // the prime mover is untouched either way
    expect(muscleSetTotals(buildSnapshot(sessions, close)).totals.get('Chest')).toBe(1);
  });

  it('keeps partials and drops out of the e1RM series', () => {
    const logs: SetLog[] = [
      { id: 1, sessionId: 1, exerciseId: 'flat-barbell-bench-press', setNumber: 1, weight: 185, reps: 8 },
      // a heavy partial would "estimate" a 1RM the lifter has never moved through a full range
      { id: 2, sessionId: 1, exerciseId: 'flat-barbell-bench-press', setNumber: 2, weight: 275, reps: 5, technique: 'partials' },
    ];
    const series = e1rmSeries(buildSnapshot(sessions, logs)).get('flat-barbell-bench-press')!;
    expect(series[0].value).toBeCloseTo(185 * (1 + 8 / 30));
  });

  it('a session of only drop rows still counts (as half sets) rather than vanishing', () => {
    const logs: SetLog[] = [
      { id: 1, sessionId: 1, exerciseId: 'cable-fly', setNumber: 1, weight: 30, reps: 10, technique: 'drop' },
    ];
    expect(muscleSetTotals(buildSnapshot(sessions, logs)).totals.get('Chest')).toBe(0.5);
  });
});
