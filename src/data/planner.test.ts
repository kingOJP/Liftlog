import { describe, it, expect, beforeEach } from 'vitest';
import { buildSnapshot } from './analytics';
import type { TrainingSnapshot } from './analytics';
import type { Session, SetLog } from '../db/database';
import type { WorkoutDay } from './program';
import { EXERCISE_MAP } from './exercises';
import type { BlockRetrospective } from './plan';
import { buildPlanProposal, buildPhases, parseGuidance } from './planner';
import type { PlannerInput } from './planner';

beforeEach(() => localStorage.clear());

const NOW = new Date('2026-07-01T12:00:00').getTime();
const DAY = 86_400_000;

function input(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    goal: 'hypertrophy',
    daysPerWeek: 4,
    weeks: 6,
    includeDeload: true,
    openWithRecovery: false,
    startDate: '2026-07-06',
    notes: '',
    ...overrides,
  };
}

// n sessions of one exercise, oldest → newest, with per-session weights
function historyFor(exerciseId: string, weights: number[]): TrainingSnapshot {
  const sessions: Session[] = [];
  const setLogs: SetLog[] = [];
  weights.forEach((w, i) => {
    const completedAt = NOW - (weights.length - 1 - i) * 3 * DAY;
    sessions.push({ id: i + 1, dayId: 1, weekNumber: 1, startedAt: completedAt - 3_600_000, completedAt });
    for (let s = 1; s <= 3; s++) {
      setLogs.push({ id: i * 10 + s, sessionId: i + 1, exerciseId, setNumber: s, weight: w, reps: 10 });
    }
  });
  return buildSnapshot(sessions, setLogs);
}

function makeRetro(overrides: Partial<BlockRetrospective['carryover']> = {}): BlockRetrospective {
  return {
    blockId: 'b0', from: 0, to: NOW - DAY,
    sessionsCompleted: 12, sessionsPlanned: 12, adherencePct: 100, avgSessionMinutes: 60,
    strength: [], muscles: [], summary: [],
    carryover: {
      keepExerciseIds: [], reviewExerciseIds: [], underMuscles: [], overMuscles: [],
      ...overrides,
    },
  };
}

const currentProgram: WorkoutDay[] = [{
  id: 1, label: 'Day 1', muscleGroups: 'Chest',
  exercises: [
    { id: 'incline-barbell-press', name: 'Incline Barbell Press', sets: 4, repLow: 6, repHigh: 8 },
    { id: 'dumbbell-bench-press',  name: 'Dumbbell Bench Press',  sets: 3, repLow: 8, repHigh: 10 },
  ],
}];

describe('buildPhases', () => {
  it('lays out accumulation → intensification → deload for hypertrophy', () => {
    const { phases } = buildPhases(input());
    expect(phases).toHaveLength(6);
    expect(phases[phases.length - 1]).toBe('deload');
    expect(phases[0]).toBe('accumulation');
    expect(phases).toContain('intensification');
  });

  it('gives strength blocks a peak week', () => {
    const { phases } = buildPhases(input({ goal: 'strength' }));
    expect(phases[phases.length - 2]).toBe('peak');
    expect(phases[phases.length - 1]).toBe('deload');
  });

  it('opens with a recovery week when asked', () => {
    const { phases } = buildPhases(input({ openWithRecovery: true }));
    expect(phases[0]).toBe('recovery');
    expect(phases).toHaveLength(6);
  });

  it('drops an unearned deload and says why', () => {
    const { phases, warnings } = buildPhases(input({ weeks: 3, includeDeload: true }));
    expect(phases).not.toContain('deload');
    expect(warnings.some(w => w.toLowerCase().includes('deload'))).toBe(true);
  });
});

describe('buildPlanProposal', () => {
  it('generates one workout per training day with unique exercises', () => {
    const p = buildPlanProposal(input(), [], null);
    expect(p.days).toHaveLength(4);
    const ids = p.days.flatMap(d => d.exercises.map(e => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const day of p.days) expect(day.exercises.length).toBeGreaterThanOrEqual(4);
    // every exercise carries an explained decision
    for (const id of ids) {
      expect(p.decisions.find(d => d.exerciseId === id)?.reason).toBeTruthy();
    }
  });

  it('uses low reps on the main lifts for a strength goal', () => {
    const p = buildPlanProposal(input({ goal: 'strength' }), [], null);
    const main = p.days[0].exercises[0];
    expect(main.sets).toBe(4);
    expect(main.repHigh).toBeLessThanOrEqual(6);
  });

  it('admits low confidence without history and high with plenty', () => {
    expect(buildPlanProposal(input(), [], null).confidence.level).toBe('low');
    const rich = historyFor('incline-barbell-press', Array.from({ length: 15 }, (_, i) => 100 + i * 5));
    expect(buildPlanProposal(input(), currentProgram, rich).confidence.level).toBe('high');
  });

  it('keeps a current-program lift that is progressing', () => {
    const snapshot = historyFor('incline-barbell-press', [100, 110, 120]);
    const p = buildPlanProposal(input(), currentProgram, snapshot);
    const kept = p.decisions.find(d => d.exerciseId === 'incline-barbell-press');
    expect(kept?.status).toBe('kept');
    expect(kept?.reason.toLowerCase()).toContain('climbing');
  });

  it('rotates out a stalled lift and explains the replacement', () => {
    const retro = makeRetro({ reviewExerciseIds: ['dumbbell-bench-press'] });
    const p = buildPlanProposal(input(), currentProgram, null, retro);
    const ids = new Set(p.days.flatMap(d => d.exercises.map(e => e.id)));
    expect(ids.has('dumbbell-bench-press')).toBe(false);
    const replacement = p.decisions.find(d => d.status === 'replacement');
    expect(replacement?.replacesName).toBe('Dumbbell Bench Press');
    expect(replacement?.reason).toContain('stalled');
  });

  it('adds a set for a muscle that finished the last block under target', () => {
    const base = buildPlanProposal(input(), [], null);
    const bumped = buildPlanProposal(input(), [], null, makeRetro({ underMuscles: ['Chest'] }));
    const chestSets = (p: typeof base) => p.days
      .flatMap(d => d.exercises)
      .filter(e => EXERCISE_MAP.get(e.id)?.primaryMuscle === 'Chest')
      .reduce((s, e) => s + e.sets, 0);
    expect(chestSets(bumped)).toBe(chestSets(base) + 1);
  });

  it('honors equipment guidance from open-ended notes', () => {
    const p = buildPlanProposal(input({ notes: 'I don\'t have a barbell at my gym' }), [], null);
    for (const ex of p.days.flatMap(d => d.exercises)) {
      expect(EXERCISE_MAP.get(ex.id)?.weightType).not.toBe('Barbell');
    }
    expect(p.guidanceNotes.some(n => n.toLowerCase().includes('barbell'))).toBe(true);
  });

  it('projects weekly muscle volume for the review step', () => {
    const p = buildPlanProposal(input(), [], null);
    const chest = p.muscleWeeklySets.find(m => m.muscle === 'Chest');
    expect(chest).toBeDefined();
    expect(chest!.sets).toBeGreaterThanOrEqual(6);
  });
});

describe('parseGuidance', () => {
  it('reads injury mentions conservatively', () => {
    const g = parseGuidance('my left knee hurts on deep bends');
    expect(g.avoidPatterns.has('Squat')).toBe(true);
    expect(g.avoidPatterns.has('Lunge')).toBe(true);
    expect(g.notes.some(n => n.includes('Knee'))).toBe(true);
  });

  it('acknowledges notes it cannot act on', () => {
    const g = parseGuidance('I like training in the morning');
    expect(g.bannedWeightTypes.size).toBe(0);
    expect(g.notes).toHaveLength(1);
  });

  it('stays silent on empty notes', () => {
    expect(parseGuidance('  ').notes).toHaveLength(0);
  });
});
