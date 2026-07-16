import { describe, it, expect, beforeEach } from 'vitest';
import { getStoredProgram, saveStoredProgram } from './programStore';
import { getProgramStartValue, saveProgramStart } from './settings';
import { buildSnapshot } from './analytics';
import type { BlockRetrospective } from './plan';
import type { PlanProposal } from './planner';

// Stub loader — these tests exercise lifecycle, not history (no IDB in jsdom)
const emptySnapshot = () => Promise.resolve(buildSnapshot([], []));
import {
  activateProposal,
  canDeferActiveBlock,
  completeActiveBlock,
  deferActiveBlockToNextWeek,
  ensureWeekAnchor,
  getActiveBlockInfo,
  getActivePhase,
  getActivePlan,
  getLatestRetrospective,
  getPendingActivation,
  getPlanState,
  getProfileOrDefault,
  getTrainingProfile,
  hasOnboarded,
  mergeServerPlanState,
  reconcileActiveProgram,
  saveTrainingProfile,
  startPendingActivation,
} from './planStore';
import { defaultTrainingProfile } from './plan';

beforeEach(() => localStorage.clear());

// Noon on the start Monday — blockAnchor is midnight that day, so a proposal
// activated at this instant starts immediately (not deferred to pending).
const JUN1 = new Date('2026-06-01T12:00:00').getTime();
const JUL6 = new Date('2026-07-06T12:00:00').getTime();

function makeProposal(overrides: Partial<PlanProposal['input']> = {}): PlanProposal {
  return {
    input: {
      goal: 'hypertrophy', daysPerWeek: 1, weeks: 4, includeDeload: true,
      openWithRecovery: false, startDate: '2026-06-01', notes: '', experience: 'intermediate',
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

describe('deferActiveBlockToNextWeek (finish the week on the previous program)', () => {
  it('restores the previous program and reschedules the new block for next Monday', () => {
    // Block 1 (leg-press) activated, then Block 2 (bench) activated immediately.
    activateProposal(makeProposal(), null, JUN1);
    const block1 = getActiveBlockInfo()!.block;
    activateProposal(
      makeProposal({ startDate: '2026-07-06' }),
      makeRetro(block1.id), JUL6,
    );
    // Now Block 2 is live; change its program marker so we can tell them apart
    // (makeProposal always uses leg-press, so assert via block identity instead).
    const block2 = getActiveBlockInfo()!.block;
    expect(block2.id).not.toBe(block1.id);

    expect(canDeferActiveBlock()).toBe(true);
    const now = new Date('2026-07-08T12:00:00').getTime(); // mid-week
    expect(deferActiveBlockToNextWeek(now)).toBe(true);

    // Block 1 is active again; Block 2 is pending for next Monday (Jul 13)
    expect(getActiveBlockInfo()!.block.id).toBe(block1.id);
    const pending = getPendingActivation();
    expect(pending!.block.id).toBe(block2.id);
    expect(pending!.block.status).toBe('pending');
    expect(pending!.block.startDate).toBe('2026-07-13');
    // The restored block's retrospective (auto-made on activation) is cleared
    expect(getActiveBlockInfo()!.block.retrospective).toBeUndefined();
  });

  it('is unavailable when the only block is open-ended (nothing to fall back to)', () => {
    // Simulate a migrated foundation block
    activateProposal(makeProposal(), null, JUN1);
    // Only one block, no previous completed block → cannot defer
    expect(canDeferActiveBlock()).toBe(false);
    expect(deferActiveBlockToNextWeek()).toBe(false);
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

describe('automatic week anchor (no manual setting)', () => {
  it('re-anchors weeks to the block end when a block wraps up', () => {
    activateProposal(makeProposal(), null, JUN1);
    const wrapAt = new Date('2026-06-28T18:00:00').getTime();
    completeActiveBlock(makeRetro('x'), wrapAt);
    expect(getProgramStartValue()).toBe('2026-06-28');
  });

  it('ensureWeekAnchor follows the synced journey on a fresh device', () => {
    // Simulate a device that pulled the journey but never ran activation:
    // plan doc says a block is active from 2026-06-01, local anchor differs.
    activateProposal(makeProposal(), null, JUN1);
    saveProgramStart('2026-01-05'); // stale local anchor
    expect(ensureWeekAnchor()).toBe(true);
    expect(getProgramStartValue()).toBe('2026-06-01');
    // Already consistent → no-op
    expect(ensureWeekAnchor()).toBe(false);
  });

  it('ensureWeekAnchor uses the last block end between blocks', () => {
    activateProposal(makeProposal(), null, JUN1);
    completeActiveBlock(makeRetro('x'), new Date('2026-06-28T18:00:00').getTime());
    saveProgramStart('2026-01-05'); // drift it
    expect(ensureWeekAnchor()).toBe(true);
    expect(getProgramStartValue()).toBe('2026-06-28');
  });

  it('ensureWeekAnchor leaves the first-use stamp alone with no journey', () => {
    expect(ensureWeekAnchor()).toBe(false);
  });
});

describe('training profile persistence', () => {
  it('reports not-onboarded until a profile is saved, then persists it', () => {
    expect(hasOnboarded()).toBe(false);
    expect(getTrainingProfile()).toBeNull();
    expect(getProfileOrDefault().experience).toBe('beginner'); // sane default

    const p = { ...defaultTrainingProfile(), experience: 'intermediate' as const, daysPerWeek: 4, equipment: 'home-rack' as const, priorityMuscles: ['Chest' as const] };
    saveTrainingProfile(p, 5000);

    expect(hasOnboarded()).toBe(true);
    const stored = getTrainingProfile()!;
    expect(stored.experience).toBe('intermediate');
    expect(stored.daysPerWeek).toBe(4);
    expect(stored.equipment).toBe('home-rack');
    expect(stored.priorityMuscles).toEqual(['Chest']);
    expect(stored.updatedAt).toBe(5000);
    // bumps the document clock so it syncs
    expect(getPlanState().updatedAt).toBe(5000);
  });

  it('survives round-trips through the whole-document sync merge', () => {
    saveTrainingProfile({ ...defaultTrainingProfile(), experience: 'advanced' }, 1000);
    const doc = getPlanState();
    localStorage.clear();
    // a newer server document (carrying the profile) replaces local
    expect(mergeServerPlanState({ ...doc, updatedAt: 2000 })).toBe(true);
    expect(getTrainingProfile()?.experience).toBe('advanced');
  });
});

describe('reconcileActiveProgram (self-heal a wiped live program)', () => {
  it('restores the live program from the active block when it was wiped', async () => {
    activateProposal(makeProposal(), null, JUN1); // installs a 1-day program
    expect(getStoredProgram()).toHaveLength(1);

    // Simulate the wipe (bad sync / corrupted server row) — journey intact
    saveStoredProgram([]);
    expect(getStoredProgram()).toHaveLength(0);

    expect(reconcileActiveProgram()).toBe(true);
    expect(getStoredProgram()).toHaveLength(1);
    expect(getStoredProgram()[0].exercises[0].id).toBe('leg-press');
  });

  it('never touches a non-empty live program (can not undo real edits)', () => {
    activateProposal(makeProposal(), null, JUN1);
    saveStoredProgram([{ id: 9, label: 'Custom', muscleGroups: 'X', exercises: [] }]);
    expect(reconcileActiveProgram()).toBe(false);
    expect(getStoredProgram()[0].id).toBe(9);
  });

  it('is a no-op with no active block', () => {
    expect(reconcileActiveProgram()).toBe(false);
    expect(getStoredProgram()).toHaveLength(0);
  });
});
