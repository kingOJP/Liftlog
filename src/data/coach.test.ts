import { describe, it, expect, beforeEach } from 'vitest';
import { buildSnapshot } from './analytics';
import { computeProgramPlan, applyPlanToDay, MIN_SESSIONS_TO_ADAPT } from './coach';
import type { Session, SetLog } from '../db/database';
import type { WorkoutDay } from './program';

beforeEach(() => localStorage.clear());

const NOW = new Date('2026-07-01T12:00:00').getTime();
const DAY = 86_400_000;

// Day 1: two quad movements — leg-extension (isolation) and leg-press
// (compound with glute/hamstring spillover).
const legDay: WorkoutDay = {
  id: 1, label: 'Day 1', muscleGroups: 'Legs',
  exercises: [
    { id: 'leg-extension', name: 'Leg Extension', sets: 3, repLow: 12, repHigh: 15 },
    { id: 'leg-press',     name: 'Leg Press',     sets: 4, repLow: 8,  repHigh: 12 },
  ],
};

// N recent day-1 sessions (spread ~3 days apart), each logging `setsPerSession`
// sets of `exerciseId`. Durations are a valid 1 hour unless overridden.
function makeSessions(
  n: number,
  exerciseId: string,
  setsPerSession: number,
  durationMs = 3_600_000,
): { sessions: Session[]; setLogs: SetLog[] } {
  const sessions: Session[] = [];
  const setLogs: SetLog[] = [];
  for (let i = 0; i < n; i++) {
    const completedAt = NOW - i * 3 * DAY;
    sessions.push({ id: i + 1, dayId: 1, weekNumber: 1, startedAt: completedAt - durationMs, completedAt });
    for (let s = 1; s <= setsPerSession; s++) {
      setLogs.push({
        id: i * 20 + s, sessionId: i + 1, exerciseId,
        setNumber: s, weight: 100, reps: 10,
      });
    }
  }
  return { sessions, setLogs };
}

describe('computeProgramPlan', () => {
  it('does not adapt until enough history exists', () => {
    const { sessions, setLogs } = makeSessions(MIN_SESSIONS_TO_ADAPT - 1, 'leg-extension', 2);
    const plan = computeProgramPlan([legDay], buildSnapshot(sessions, setLogs), NOW);
    expect(plan.ready).toBe(false);
    expect(plan.changes).toHaveLength(0);
  });

  it('adds a set for an under-target muscle, preferring the lower-fatigue slot', () => {
    // 6 sessions × 2 quad sets ≈ 5.6 weekly sets — well under the 10-set floor.
    const { sessions, setLogs } = makeSessions(6, 'leg-extension', 2);
    const plan = computeProgramPlan([legDay], buildSnapshot(sessions, setLogs), NOW);

    expect(plan.ready).toBe(true);
    expect(plan.changes).toHaveLength(1);
    const change = plan.changes[0];
    expect(change.kind).toBe('add-set');
    // The isolation movement wins: no secondary-muscle fatigue, fewer sets
    // already stacked on it than the compound.
    expect(change.exerciseId).toBe('leg-extension');
    expect(change.fromSets).toBe(3);
    expect(change.toSets).toBe(4);
    expect(change.muscle).toBe('Quads');
    expect(change.reason).toContain('Quads');
  });

  it('trims a set when a muscle is far past the volume ceiling', () => {
    // 10 quad sets per session ≈ 28 weekly sets — past 20 + buffer.
    const { sessions, setLogs } = makeSessions(6, 'leg-extension', 10);
    const plan = computeProgramPlan([legDay], buildSnapshot(sessions, setLogs), NOW);

    const trims = plan.changes.filter(c => c.kind === 'remove-set');
    expect(trims).toHaveLength(1);
    // Trimmed from the exercise doing the most direct quad sets (leg-press, 4)
    expect(trims[0].exerciseId).toBe('leg-press');
    expect(trims[0].toSets).toBe(3);
  });

  it('stands down during a planned deload or recovery week', () => {
    // Same under-target scenario that normally earns an add-set
    const { sessions, setLogs } = makeSessions(6, 'leg-extension', 2);
    const snapshot = buildSnapshot(sessions, setLogs);
    for (const phase of ['deload', 'recovery'] as const) {
      const plan = computeProgramPlan([legDay], snapshot, NOW, phase);
      expect(plan.ready).toBe(false);
      expect(plan.changes).toHaveLength(0);
    }
  });

  it('respects the workout-duration constraint when adding sets', () => {
    // Same volume gap as the add-set case, but historical sessions are only
    // 15 minutes — a 3-minute set exceeds the +15% duration headroom.
    const { sessions, setLogs } = makeSessions(6, 'leg-extension', 2, 15 * 60_000);
    const plan = computeProgramPlan([legDay], buildSnapshot(sessions, setLogs), NOW);

    expect(plan.ready).toBe(true);
    expect(plan.changes.filter(c => c.kind === 'add-set')).toHaveLength(0);
  });

  it('caps additions at two sets per plan', () => {
    const multiDay: WorkoutDay = {
      id: 1, label: 'Day 1', muscleGroups: 'Mixed',
      exercises: [
        { id: 'cable-lateral-raises', name: 'Cable Lateral Raises', sets: 2, repLow: 16, repHigh: 20 }, // Delts
        { id: 'seated-calf-raises',   name: 'Seated Calf Raises',   sets: 2, repLow: 20, repHigh: 25 }, // Calves
        { id: 'leg-extension',        name: 'Leg Extension',        sets: 2, repLow: 12, repHigh: 15 }, // Quads
      ],
    };
    // Every muscle badly under target → three candidate gaps, capped at two adds.
    const sessions: Session[] = [];
    const setLogs: SetLog[] = [];
    for (let i = 0; i < 6; i++) {
      const completedAt = NOW - i * 3 * DAY;
      sessions.push({ id: i + 1, dayId: 1, weekNumber: 1, startedAt: completedAt - 3_600_000, completedAt });
      for (const [j, exId] of ['cable-lateral-raises', 'seated-calf-raises', 'leg-extension'].entries()) {
        setLogs.push({ id: i * 10 + j + 1, sessionId: i + 1, exerciseId: exId, setNumber: 1, weight: 50, reps: 12 });
      }
    }
    const plan = computeProgramPlan([multiDay], buildSnapshot(sessions, setLogs), NOW);
    expect(plan.changes.filter(c => c.kind === 'add-set')).toHaveLength(2);
  });

  it('ignores stale history outside the trailing window', () => {
    // Plenty of sessions, but all of them months old → nothing to adapt from.
    const { sessions, setLogs } = makeSessions(8, 'leg-extension', 2);
    const old = sessions.map(s => ({
      ...s,
      startedAt: s.startedAt - 90 * DAY,
      completedAt: (s.completedAt ?? 0) - 90 * DAY,
    }));
    const plan = computeProgramPlan([legDay], buildSnapshot(old, setLogs), NOW);
    expect(plan.ready).toBe(false);
    expect(plan.changes).toHaveLength(0);
  });
});

describe('applyPlanToDay', () => {
  it('overlays planned set counts without touching other exercises', () => {
    const { sessions, setLogs } = makeSessions(6, 'leg-extension', 2);
    const plan = computeProgramPlan([legDay], buildSnapshot(sessions, setLogs), NOW);
    const adjusted = applyPlanToDay(legDay, plan);

    expect(adjusted.exercises.find(e => e.id === 'leg-extension')?.sets).toBe(4);
    expect(adjusted.exercises.find(e => e.id === 'leg-press')?.sets).toBe(4);
    // The baseline day object is untouched
    expect(legDay.exercises.find(e => e.id === 'leg-extension')?.sets).toBe(3);
  });

  it('returns the day unchanged when the plan has nothing for it', () => {
    const plan = computeProgramPlan([legDay], buildSnapshot([], []), NOW);
    expect(applyPlanToDay(legDay, plan)).toBe(legDay);
  });
});
