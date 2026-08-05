import { describe, it, expect, beforeEach } from 'vitest';
import { buildSnapshot, headSetTotals } from './analytics';
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
