import { describe, it, expect, beforeEach } from 'vitest';
import { buildSnapshot } from './analytics';
import type { Session, SetLog } from '../db/database';
import type { TrainingBlock } from './plan';
import { computeBlockRetrospective } from './retrospective';

beforeEach(() => localStorage.clear());

const DAY = 86_400_000;
const BLOCK_START = new Date('2026-06-01T00:00:00').getTime(); // a Monday
const NOW = new Date('2026-06-29T12:00:00').getTime();         // block just ended

function makeBlock(overrides: Partial<TrainingBlock> = {}): TrainingBlock {
  return {
    id: 'block-1',
    name: 'Block 1',
    focus: 'hypertrophy',
    startDate: '2026-06-01',
    phases: ['accumulation', 'accumulation', 'intensification', 'deload'],
    program: [
      {
        id: 1, label: 'Day 1', muscleGroups: 'Chest',
        exercises: [{ id: 'incline-barbell-press', name: 'Incline Barbell Press', sets: 3, repLow: 6, repHigh: 10 }],
      },
      {
        id: 2, label: 'Day 2', muscleGroups: 'Back',
        exercises: [{ id: 'lat-pull-down', name: 'Lat Pull Down', sets: 3, repLow: 10, repHigh: 12 }],
      },
    ],
    intent: '', progression: '', status: 'active', activatedAt: BLOCK_START,
    ...overrides,
  };
}

// One session per entry: [daysAfterStart, exerciseId, weight]
function makeSnapshot(entries: Array<[number, string, number]>) {
  const sessions: Session[] = [];
  const setLogs: SetLog[] = [];
  entries.forEach(([days, exerciseId, weight], i) => {
    const completedAt = BLOCK_START + days * DAY + 10 * 3_600_000;
    sessions.push({
      id: i + 1, dayId: 1, weekNumber: 1,
      startedAt: completedAt - 3_600_000, completedAt,
    });
    for (let s = 1; s <= 3; s++) {
      setLogs.push({ id: i * 10 + s, sessionId: i + 1, exerciseId, setNumber: s, weight, reps: 10 });
    }
  });
  return buildSnapshot(sessions, setLogs);
}

describe('computeBlockRetrospective', () => {
  it('measures adherence against the planned schedule', () => {
    // 2 days/week × 4 weeks = 8 planned; 6 completed
    const snapshot = makeSnapshot([
      [0, 'incline-barbell-press', 100], [3, 'lat-pull-down', 120],
      [7, 'incline-barbell-press', 105], [10, 'lat-pull-down', 120],
      [14, 'incline-barbell-press', 110], [21, 'incline-barbell-press', 115],
    ]);
    const retro = computeBlockRetrospective(makeBlock(), snapshot, NOW);
    expect(retro.sessionsPlanned).toBe(8);
    expect(retro.sessionsCompleted).toBe(6);
    expect(retro.adherencePct).toBe(75);
  });

  it('tracks per-exercise strength change and flags keepers', () => {
    const snapshot = makeSnapshot([
      [0, 'incline-barbell-press', 100],
      [7, 'incline-barbell-press', 105],
      [14, 'incline-barbell-press', 110],
      [21, 'incline-barbell-press', 115],
    ]);
    const retro = computeBlockRetrospective(makeBlock(), snapshot, NOW);
    const outcome = retro.strength.find(s => s.exerciseId === 'incline-barbell-press');
    expect(outcome).toBeDefined();
    expect(outcome!.changePct).toBeGreaterThan(10);
    expect(retro.carryover.keepExerciseIds).toContain('incline-barbell-press');
    expect(retro.summary.join(' ')).toContain('Incline Barbell Press');
  });

  it('flags a flat lift for rotation', () => {
    const snapshot = makeSnapshot([
      [0, 'incline-barbell-press', 100],
      [7, 'incline-barbell-press', 100],
      [14, 'incline-barbell-press', 100],
    ]);
    const retro = computeBlockRetrospective(makeBlock(), snapshot, NOW);
    expect(retro.carryover.reviewExerciseIds).toContain('incline-barbell-press');
    expect(retro.carryover.keepExerciseIds).not.toContain('incline-barbell-press');
  });

  it('reports under-target muscles only when the block programs them', () => {
    // Chest is in the program but barely trained → under. Quads untouched
    // and unprogrammed → not a laggard, just out of scope.
    const snapshot = makeSnapshot([
      [0, 'incline-barbell-press', 100],
      [14, 'incline-barbell-press', 105],
    ]);
    const retro = computeBlockRetrospective(makeBlock(), snapshot, NOW);
    expect(retro.carryover.underMuscles).toContain('Chest');
    expect(retro.carryover.underMuscles).not.toContain('Quads');
  });

  it('ignores sessions outside the block window', () => {
    const snapshot = makeSnapshot([
      [-7, 'incline-barbell-press', 90],   // before the block
      [0, 'incline-barbell-press', 100],
      [40, 'incline-barbell-press', 130],  // after the scheduled end
    ]);
    const retro = computeBlockRetrospective(makeBlock(), snapshot, NOW + 30 * DAY);
    expect(retro.sessionsCompleted).toBe(1);
  });

  it('skips the schedule comparison for open-ended blocks', () => {
    const snapshot = makeSnapshot([[0, 'incline-barbell-press', 100]]);
    const retro = computeBlockRetrospective(
      makeBlock({ phases: [], openEnded: true }), snapshot, NOW,
    );
    expect(retro.sessionsPlanned).toBeNull();
    expect(retro.adherencePct).toBeNull();
    expect(retro.summary.length).toBeGreaterThan(0);
  });

  it('handles an empty block honestly', () => {
    const retro = computeBlockRetrospective(makeBlock(), buildSnapshot([], []), NOW);
    expect(retro.sessionsCompleted).toBe(0);
    expect(retro.summary[0]).toMatch(/no workouts/i);
  });
});
