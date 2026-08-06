// src/data/prescribe.ts — the store-reading wrapper around dosage.ts.
//
// dosage.ts is pure and well covered; this file is the part that reads the
// user's plan, profile and history and hands them over. It had no coverage,
// which matters because it is the single funnel every route into a workout
// goes through — the day editor, the mid-workout add panel, quick workouts,
// the planner. A bug here reinstates exactly the invented 3 × 8–12 the
// prescription rework existed to remove.

import { describe, it, expect, beforeEach } from 'vitest';
import { prescribeFor, slotFor, exerciseHistory } from './prescribe';
import { buildSnapshot } from './analytics';
import { activateProposal, saveTrainingProfile } from './planStore';
import { defaultTrainingProfile } from './plan';
import type { Goal } from './plan';
import type { PlanProposal } from './planner';
import type { Session, SetLog } from '../db/database';

beforeEach(() => localStorage.clear());

const NOW = new Date('2026-06-01T12:00:00').getTime();

/** Put a real plan in place so getPlannedGoal() resolves. */
function planFor(goal: Goal): void {
  const proposal = {
    input: {
      goal, daysPerWeek: 3, weeks: 4, includeDeload: false, openWithRecovery: false,
      startDate: '2026-06-01', notes: '', experience: 'intermediate',
    },
    confidence: { level: 'low', sessions: 0, detail: '' },
    splitName: 'Test', splitReason: '',
    phases: ['accumulation', 'accumulation', 'accumulation', 'accumulation'],
    phaseNotes: [],
    days: [{ id: 1, label: 'Day 1', muscleGroups: 'Legs', exercises: [] }],
    decisions: [], guidanceNotes: [], muscleWeeklySets: [],
    intent: '', progression: '', warnings: [],
  } as unknown as PlanProposal;
  activateProposal(proposal, null, NOW);
}

/** A snapshot in which `exerciseId` was trained `sessions` times at `reps`. */
function historyOf(exerciseId: string, reps: number[], sessions = 3) {
  const sessionRows: Session[] = [];
  const setLogs: SetLog[] = [];
  let logId = 0;
  for (let s = 0; s < sessions; s++) {
    const id = s + 1;
    sessionRows.push({ id, dayId: 1, weekNumber: 1, startedAt: s * 1_000, completedAt: s * 1_000 + 100 });
    reps.forEach((r, i) => {
      setLogs.push({ id: ++logId, sessionId: id, exerciseId, setNumber: i + 1, weight: 100, reps: r });
    });
  }
  return buildSnapshot(sessionRows, setLogs);
}

describe('the cascade, from the app layer', () => {
  it('doses from the active plan\'s goal', () => {
    planFor('strength');
    saveTrainingProfile({ ...defaultTrainingProfile(), experience: 'advanced', trainingAgeMonths: 60 });
    const strength = prescribeFor('barbell-back-squat', { name: 'Barbell Back Squat', slot: { main: true } });

    planFor('hypertrophy');
    const hypertrophy = prescribeFor('barbell-back-squat', { name: 'Barbell Back Squat', slot: { main: true } });

    expect(strength).not.toBeNull();
    expect(hypertrophy).not.toBeNull();
    // Same movement, different plan, different dose — the whole point.
    expect(strength!.repHigh!).toBeLessThan(hypertrophy!.repHigh!);
  });

  it('falls back to what the lifter actually does when there is no plan', () => {
    const snapshot = historyOf('cable-lateral-raises', [18, 17, 16]);
    const dose = prescribeFor('cable-lateral-raises', {
      name: 'Cable Lateral Raises', snapshot,
    });
    expect(dose).not.toBeNull();
    // Read off the log — not a hypertrophy default of 8–12.
    expect(dose!.repLow).toBeGreaterThan(12);
  });

  // The regression this whole subsystem exists to prevent: a barbell deadlift
  // must never silently inherit a cable row's dose.
  it('prescribes nothing when there is no plan and no history', () => {
    expect(prescribeFor('barbell-deadlift', { name: 'Barbell Deadlift' })).toBeNull();
    expect(prescribeFor('never-heard-of-it-1700000000000', { name: 'Mystery' })).toBeNull();
  });

  it('prefers the plan over history when both exist', () => {
    planFor('strength');
    saveTrainingProfile({ ...defaultTrainingProfile(), experience: 'advanced', trainingAgeMonths: 60 });
    const snapshot = historyOf('barbell-back-squat', [18, 17, 16]);
    const dose = prescribeFor('barbell-back-squat', {
      name: 'Barbell Back Squat', slot: { main: true }, snapshot,
    });
    // The strength block decides, not the high-rep era that preceded it.
    expect(dose!.repHigh).toBeLessThan(12);
  });

  it('applies the beginner floor read from the stored profile', () => {
    planFor('strength');
    saveTrainingProfile({ ...defaultTrainingProfile(), experience: 'beginner' });
    const dose = prescribeFor('barbell-back-squat', { name: 'Barbell Back Squat', slot: { main: true } });
    // No near-maximal work while technique is still the constraint.
    expect(dose!.repLow).toBeGreaterThanOrEqual(8);
  });

  it('treats an account that never onboarded as a beginner', () => {
    planFor('strength');
    const dose = prescribeFor('barbell-back-squat', { name: 'Barbell Back Squat', slot: { main: true } });
    expect(dose!.repLow).toBeGreaterThanOrEqual(8);
  });
});

describe('slotFor — building the program slot', () => {
  it('carries the resolved dose onto the slot', () => {
    planFor('hypertrophy');
    const slot = slotFor('leg-press', 'Leg Press');
    expect(slot).toMatchObject({ id: 'leg-press', name: 'Leg Press' });
    expect(slot.sets).toBeGreaterThan(0);
    expect(slot.repLow).toBeGreaterThan(0);
    expect(slot.repHigh!).toBeGreaterThan(slot.repLow!);
  });

  // A set count is a layout decision (how many rows to render); a rep range is
  // a prescription. With nothing to prescribe from, the slot gets rows and no
  // targets — never an invented range.
  it('gives rows but no rep range when nothing can be prescribed', () => {
    const slot = slotFor('barbell-deadlift', 'Barbell Deadlift');
    expect(slot.sets).toBe(3);
    expect(slot.repLow).toBeUndefined();
    expect(slot.repHigh).toBeUndefined();
  });

  it('doses a main slot differently from an accessory one', () => {
    planFor('strength');
    saveTrainingProfile({ ...defaultTrainingProfile(), experience: 'advanced', trainingAgeMonths: 60 });
    const main = slotFor('barbell-back-squat', 'Barbell Back Squat', { slot: { main: true } });
    const accessory = slotFor('barbell-back-squat', 'Barbell Back Squat', { slot: { main: false } });
    expect(main.repHigh).toBeLessThanOrEqual(accessory.repHigh!);
  });
});

describe('exerciseHistory — what the history fallback reads', () => {
  it('returns nothing without a snapshot', () => {
    expect(exerciseHistory('anything', null)).toEqual([]);
  });

  it('picks out only the requested exercise\'s sets', () => {
    const sessions: Session[] = [{ id: 1, dayId: 1, weekNumber: 1, startedAt: 0, completedAt: 100 }];
    const setLogs: SetLog[] = [
      { id: 1, sessionId: 1, exerciseId: 'squat', setNumber: 1, weight: 100, reps: 5 },
      { id: 2, sessionId: 1, exerciseId: 'bench', setNumber: 1, weight: 100, reps: 10 },
    ];
    expect(exerciseHistory('squat', buildSnapshot(sessions, setLogs)))
      .toEqual([{ sets: [{ reps: 5 }] }]);
  });

  it('caps at the four most recent sessions containing it', () => {
    expect(exerciseHistory('squat', historyOf('squat', [5], 9))).toHaveLength(4);
  });

  it('skips sessions the exercise does not appear in', () => {
    const sessions: Session[] = [
      { id: 1, dayId: 1, weekNumber: 1, startedAt: 0, completedAt: 100 },
      { id: 2, dayId: 1, weekNumber: 1, startedAt: 200, completedAt: 300 },
    ];
    const setLogs: SetLog[] = [
      { id: 1, sessionId: 1, exerciseId: 'squat', setNumber: 1, weight: 100, reps: 5 },
      { id: 2, sessionId: 2, exerciseId: 'bench', setNumber: 1, weight: 100, reps: 10 },
    ];
    expect(exerciseHistory('squat', buildSnapshot(sessions, setLogs))).toHaveLength(1);
  });
});
