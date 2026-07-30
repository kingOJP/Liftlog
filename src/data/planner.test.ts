import { describe, it, expect, beforeEach } from 'vitest';
import { buildSnapshot } from './analytics';
import type { TrainingSnapshot } from './analytics';
import type { Session, SetLog } from '../db/database';
import type { WorkoutDay } from './program';
import { EXERCISE_MAP } from './exercises';
import type { BlockRetrospective } from './plan';
import { validatePhases } from './plan';
import { buildPlanProposal, buildPhases, parseGuidance, stimulusChange } from './planner';
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
    experience: 'intermediate',
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

describe('experience-aware planning', () => {
  const flat = (id: string) => EXERCISE_MAP.get(id);

  it('never programs sub-6 rep ranges for a beginner', () => {
    const p = buildPlanProposal(input({ experience: 'beginner', goal: 'strength', daysPerWeek: 3 }), [], null);
    for (const day of p.days) {
      for (const ex of day.exercises) {
        expect(ex.repLow).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('keeps a beginner off skill-heavy advanced lifts they have not earned', () => {
    const p = buildPlanProposal(input({ experience: 'beginner', daysPerWeek: 3 }), [], null);
    const ids = new Set(p.days.flatMap(d => d.exercises.map(e => e.id)));
    expect(ids.has('conventional-deadlift')).toBe(false);
    expect(ids.has('barbell-back-squat')).toBe(false);
    // ...and fills quad/hamstring slots with beginner-appropriate movements
    const legIds = [...ids].filter(id => flat(id)?.primaryMuscle === 'Quads');
    expect(legIds.length).toBeGreaterThan(0);
  });

  it('lets an advanced lifter get the barbell compounds', () => {
    const p = buildPlanProposal(input({ experience: 'advanced', daysPerWeek: 4 }), [], null);
    const ids = new Set(p.days.flatMap(d => d.exercises.map(e => e.id)));
    // A barbell squat or deadlift should appear somewhere for an advanced plan
    expect(ids.has('barbell-back-squat') || ids.has('conventional-deadlift')).toBe(true);
  });

  it('caps a beginner at a full-body/upper-lower split and warns on high frequency', () => {
    const p = buildPlanProposal(input({ experience: 'beginner', daysPerWeek: 6 }), [], null);
    expect(p.days.length).toBeLessThanOrEqual(4);
    expect(p.warnings.some(w => /beginner/i.test(w))).toBe(true);
  });

  it('gives lower total weekly volume to a beginner than an advanced lifter', () => {
    const beginner = buildPlanProposal(input({ experience: 'beginner', daysPerWeek: 3 }), [], null);
    const advanced = buildPlanProposal(input({ experience: 'advanced', daysPerWeek: 3 }), [], null);
    const totalSets = (p: typeof beginner) => p.days.flatMap(d => d.exercises).reduce((s, e) => s + e.sets, 0);
    expect(totalSets(beginner)).toBeLessThan(totalSets(advanced));
  });

  it('biases extra volume toward flagged priority muscles', () => {
    const base = buildPlanProposal(input({ daysPerWeek: 3 }), [], null);
    const primed = buildPlanProposal(input({ daysPerWeek: 3, priorityMuscles: ['Chest'] }), [], null);
    const chestSets = (p: typeof base) => p.days.flatMap(d => d.exercises)
      .filter(e => EXERCISE_MAP.get(e.id)?.primaryMuscle === 'Chest')
      .reduce((s, e) => s + e.sets, 0);
    expect(chestSets(primed)).toBe(chestSets(base) + 1);
  });

  it('honors structured dumbbells-only equipment access', () => {
    const p = buildPlanProposal(input({ equipmentAccess: 'dumbbells-only', daysPerWeek: 3 }), [], null);
    for (const ex of p.days.flatMap(d => d.exercises)) {
      const wt = EXERCISE_MAP.get(ex.id)?.weightType;
      expect(wt === 'Barbell' || wt === 'Machine').toBe(false);
    }
    expect(p.guidanceNotes.some(n => /dumbbell/i.test(n))).toBe(true);
  });
});

// ── Introductory weeks ────────────────────────────────────────────────────────
// The rule is about *novelty*, not training age: an unaccustomed movement or rep
// range causes disproportionate soreness on its first exposure (the repeated-bout
// effect), and one easy week spends that cheaply. Novices additionally need time
// on task before load matters at all.
describe('introductory weeks', () => {
  const beginner = input({ experience: 'beginner', weeks: 6, includeDeload: false });

  it('opens a beginner block with an intro week', () => {
    const { phases } = buildPhases(beginner);
    expect(phases[0]).toBe('intro');
    expect(phases).toHaveLength(6);
  });

  it('gives a beginner two intro weeks when the block is long enough', () => {
    const { phases } = buildPhases({ ...beginner, weeks: 10 });
    expect(phases.slice(0, 2)).toEqual(['intro', 'intro']);
  });

  it('leaves an experienced lifter on a familiar program alone', () => {
    const { phases } = buildPhases(input({ experience: 'intermediate' }));
    expect(phases).not.toContain('intro');
  });

  it('earns an intro week when the goal — and so the rep ranges — changed', () => {
    const { phases, notes } = buildPhases(
      input({ experience: 'advanced' }), null,
      { newExerciseShare: 0, goalChanged: true },
    );
    expect(phases[0]).toBe('intro');
    expect(notes.join(' ')).toMatch(/rep ranges/i);
  });

  it('earns an intro week when most of the lifts are new', () => {
    const { phases, notes } = buildPhases(
      input({ experience: 'advanced' }), null,
      { newExerciseShare: 0.8, goalChanged: false },
    );
    expect(phases[0]).toBe('intro');
    expect(notes.join(' ')).toMatch(/new to you/i);
  });

  it('does not stack an intro week on top of a recovery opener', () => {
    const { phases } = buildPhases(
      input({ experience: 'beginner', openWithRecovery: true }), null,
      { newExerciseShare: 1, goalChanged: true },
    );
    expect(phases.filter(p => p === 'intro')).toHaveLength(0);
    expect(phases[0]).toBe('recovery');
  });

  it('still honours the requested block length', () => {
    for (const weeks of [4, 5, 6, 8]) {
      const { phases } = buildPhases({ ...beginner, weeks });
      expect(phases, `${weeks}`).toHaveLength(weeks);
    }
  });

  it('produces layouts the phase guardrails accept', () => {
    for (const experience of ['beginner', 'intermediate', 'advanced'] as const) {
      for (const weeks of [3, 4, 5, 6, 8, 10, 12]) {
        for (const includeDeload of [true, false]) {
          for (const openWithRecovery of [true, false]) {
            const { phases } = buildPhases(
              input({ experience, weeks, includeDeload, openWithRecovery }), null,
              { newExerciseShare: 1, goalChanged: true },
            );
            expect(
              validatePhases(phases),
              `${experience}/${weeks}/${includeDeload}/${openWithRecovery}`,
            ).toBeNull();
          }
        }
      }
    }
  });

  it('does not count intro weeks toward earning a deload', () => {
    // 6 weeks, beginner (1 intro), deload requested → 4 productive weeks, which
    // still earns it. At 4 weeks it should not.
    const short = buildPhases(input({ experience: 'beginner', weeks: 4, includeDeload: true }));
    expect(short.phases).not.toContain('deload');
    expect(short.warnings.join(' ')).toMatch(/deload/i);
  });

  it('measures novelty against the current program, not in the abstract', () => {
    const current: WorkoutDay[] = [{
      id: 1, label: 'Day 1', muscleGroups: 'Legs',
      exercises: [{ id: 'leg-press', name: 'Leg Press', sets: 3, repLow: 8, repHigh: 12 }],
    }];
    const proposed: WorkoutDay[] = [{
      id: 1, label: 'Day 1', muscleGroups: 'Legs',
      exercises: [
        { id: 'leg-press', name: 'Leg Press', sets: 3, repLow: 8, repHigh: 12 },
        { id: 'hack-squat', name: 'Hack Squat', sets: 3, repLow: 8, repHigh: 12 },
      ],
    }];
    expect(stimulusChange(proposed, current, 'hypertrophy', 'hypertrophy').newExerciseShare).toBe(0.5);
    expect(stimulusChange(proposed, [], 'hypertrophy', 'hypertrophy').newExerciseShare).toBe(0);
    expect(stimulusChange(proposed, current, 'strength', 'hypertrophy').goalChanged).toBe(true);
  });

  it('tells a beginner what an intro week actually asks of them', () => {
    const p = buildPlanProposal(
      input({ experience: 'beginner', weeks: 6, includeDeload: false }), [], null, null,
    );
    expect(p.phases[0]).toBe('intro');
    expect(p.progression).toMatch(/4–5 more reps/);
  });
});
