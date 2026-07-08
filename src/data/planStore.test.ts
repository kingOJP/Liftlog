import { describe, it, expect, beforeEach } from 'vitest';
import { getStoredProgram } from './programStore';
import { getProgramStartValue } from './settings';
import { buildSnapshot } from './analytics';
import type { BlockRetrospective } from './plan';
import type { PlanProposal } from './planner';

// Stub loader — these tests exercise lifecycle, not history (no IDB in jsdom)
const emptySnapshot = () => Promise.resolve(buildSnapshot([], []));
import {
  activateProposal,
  completeActiveBlock,
  getActiveBlockInfo,
  getActivePhase,
  getActivePlan,
  getLatestRetrospective,
  getPendingActivation,
  getPlanState,
  mergeServerPlanState,
  startPendingActivation,
} from './planStore';

beforeEach(() => localStorage.clear());

// Noon on the start Monday — blockAnchor is midnight that day, so a proposal
// activated at this instant starts immediately (not deferred to pending).
const JUN1 = new Date('2026-06-01T12:00:00').getTime();
const JUL6 = new Date('2026-07-06T12:00:00').getTime();

function makeProposal(overrides: Partial<PlanProposal['input']> = {}): PlanProposal {
  return {
    input: {
      goal: 'hypertrophy', daysPerWeek: 1, weeks: 4, includeDeload: true,
      openWithRecovery: false, startDate: '2026-06-01', notes: '',
      ...overrides,
    },
    confidence: { level: 'low', sessions: 0, detail: '' },
    splitName: 'Test', splitReason: '',
    phases: ['accumulation', 'accumulation', 'accumulation', 'deload'],
    phaseNotes: [],
    days: [{
      id: 1, label: 'Day 1', muscleGroups: 'Legs',
      exercises: [{ id: 'leg-press', name: 'Leg Press', sets: 3, repLow: 8, repHigh: 12 }],
    }],
    decisions: [], guidanceNotes: [], muscleWeeklySets: [],
    intent: 'intent', progression: 'progression', warnings: [],
  };
}

function makeRetro(blockId: string): BlockRetrospective {
  return {
    blockId, from: 0, to: 1, sessionsCompleted: 0, sessionsPlanned: null,
    adherencePct: null, avgSessionMinutes: null, strength: [], muscles: [],
    summary: [], carryover: { keepExerciseIds: [], reviewExerciseIds: [], underMuscles: [], overMuscles: [] },
  };
}

describe('activateProposal (immediate — start date is today or nothing running)', () => {
  it('creates an active plan and block, and installs the program', () => {
    const { started, plan } = activateProposal(makeProposal(), null, JUN1);
    expect(started).toBe(true);
    expect(plan!.status).toBe('active');
    expect(plan!.blocks).toHaveLength(1);
    expect(plan!.blocks[0].status).toBe('active');
    // The block's program is now the live program, weeks anchor to its start
    expect(getStoredProgram()[0].exercises[0].id).toBe('leg-press');
    expect(getProgramStartValue()).toBe('2026-06-01');
  });

  it('appends a block to the active plan when the goal is unchanged', () => {
    activateProposal(makeProposal(), null, JUN1);
    const info = getActiveBlockInfo()!;
    const { started, plan } = activateProposal(
      makeProposal({ startDate: '2026-07-06' }), makeRetro(info.block.id), JUL6,
    );

    expect(started).toBe(true);
    expect(getPlanState().plans).toHaveLength(1);
    expect(plan!.blocks).toHaveLength(2);
    expect(plan!.blocks[0].status).toBe('completed');
    expect(plan!.blocks[0].retrospective?.blockId).toBe(info.block.id);
    expect(plan!.blocks[1].status).toBe('active');
  });

  it('starts a new plan on a goal transition, completing the old one', () => {
    activateProposal(makeProposal(), null, JUN1);
    activateProposal(makeProposal({ goal: 'strength', startDate: '2026-07-06' }), null, JUL6);

    const state = getPlanState();
    expect(state.plans).toHaveLength(2);
    expect(state.plans[0].status).toBe('completed');
    expect(state.plans[0].blocks[0].status).toBe('completed');
    expect(getActivePlan()?.goal).toBe('strength');
  });
});

describe('activateProposal (scheduled — future start while a block runs)', () => {
  it('defers the new block to a pending activation, leaving the current program in place', () => {
    activateProposal(makeProposal(), null, JUN1);
    const running = getActiveBlockInfo()!.block;

    // Approve a block for a future Monday, "now" still inside the running block
    const midBlock = new Date('2026-06-10T12:00:00').getTime();
    const { started, plan } = activateProposal(
      makeProposal({ startDate: '2026-06-29' }), null, midBlock,
    );

    expect(started).toBe(false);
    expect(plan).toBeNull();
    // Current block still active, program unchanged
    expect(getActiveBlockInfo()!.block.id).toBe(running.id);
    const pending = getPendingActivation();
    expect(pending).not.toBeNull();
    expect(pending!.block.status).toBe('pending');
    expect(pending!.block.startDate).toBe('2026-06-29');
  });

  it('commits the pending block once its start date arrives, reviewing the outgoing block', async () => {
    activateProposal(makeProposal(), null, JUN1);
    const midBlock = new Date('2026-06-10T12:00:00').getTime();
    activateProposal(makeProposal({ startDate: '2026-06-29' }), null, midBlock);

    // Before the start date: nothing happens
    expect(await startPendingActivation(new Date('2026-06-20T12:00:00').getTime(), { loadSnapshot: emptySnapshot })).toBe(false);
    expect(getPendingActivation()).not.toBeNull();

    // On/after the start date: commits, installs the new program
    const afterStart = new Date('2026-06-29T12:00:00').getTime();
    expect(await startPendingActivation(afterStart, { loadSnapshot: emptySnapshot })).toBe(true);
    expect(getPendingActivation()).toBeNull();
    expect(getActiveBlockInfo()!.block.startDate).toBe('2026-06-29');
    expect(getProgramStartValue()).toBe('2026-06-29');
  });

  it('replaces an un-started pending block when the user re-plans', () => {
    activateProposal(makeProposal(), null, JUN1);
    const midBlock = new Date('2026-06-10T12:00:00').getTime();
    activateProposal(makeProposal({ startDate: '2026-06-29' }), null, midBlock);
    activateProposal(makeProposal({ startDate: '2026-07-06' }), null, midBlock);

    const pending = getPendingActivation();
    expect(pending!.block.startDate).toBe('2026-07-06');
    // Only one pending block, and still just one active plan/block
    expect(getPlanState().plans[0].blocks.filter(b => b.status === 'active')).toHaveLength(1);
  });
});

describe('phase resolution', () => {
  it('reports the active phase for the current week', () => {
    activateProposal(makeProposal(), null, JUN1); // starts Mon 2026-06-01
    expect(getActivePhase(new Date('2026-06-03T12:00:00').getTime())).toBe('accumulation');
    expect(getActivePhase(new Date('2026-06-25T12:00:00').getTime())).toBe('deload');
    expect(getActivePhase(new Date('2026-08-01T12:00:00').getTime())).toBeNull(); // ended
  });

  it('returns null with no plan at all', () => {
    expect(getActivePhase()).toBeNull();
  });
});

describe('completeActiveBlock', () => {
  it('stores the retrospective and leaves the plan active', () => {
    activateProposal(makeProposal(), null, JUN1);
    const block = getActiveBlockInfo()!.block;
    completeActiveBlock(makeRetro(block.id), 5000);

    expect(getActiveBlockInfo()).toBeNull();
    expect(getActivePlan()).not.toBeNull();
    expect(getLatestRetrospective()?.blockId).toBe(block.id);
  });
});

describe('mergeServerPlanState', () => {
  it('takes a newer server document and ignores an older one', () => {
    activateProposal(makeProposal(), null, 1000);
    const local = getPlanState();

    const older = { ...local, updatedAt: 500, plans: [] };
    expect(mergeServerPlanState(older)).toBe(false);
    expect(getPlanState().plans).toHaveLength(1);

    const newer = { ...local, updatedAt: local.updatedAt + 1, plans: [] };
    expect(mergeServerPlanState(newer)).toBe(true);
    expect(getPlanState().plans).toHaveLength(0);
  });

  it('rejects malformed documents', () => {
    expect(mergeServerPlanState(null)).toBe(false);
    expect(mergeServerPlanState({ version: 2, plans: [], updatedAt: 1 })).toBe(false);
    expect(mergeServerPlanState({ version: 1, plans: 'junk', updatedAt: 1 })).toBe(false);
  });
});
