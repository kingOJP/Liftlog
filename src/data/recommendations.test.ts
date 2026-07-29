import { describe, it, expect } from 'vitest';
import { buildSetPlan, calculateRecommendation } from './recommendations';
import type { ExerciseSession } from './recommendations';

const exercise = { sets: 3, repLow: 8, repHigh: 12 };

function session(sets: Array<[weight: number, reps: number]>, completedAt = 0): ExerciseSession {
  return { completedAt, sets: sets.map(([weight, reps]) => ({ weight, reps })) };
}

describe('calculateRecommendation', () => {
  it('returns null with no history', () => {
    expect(calculateRecommendation([], exercise)).toBeNull();
    expect(calculateRecommendation([session([])], exercise)).toBeNull();
  });

  it('recommends an increase when every working set hits the top of the range', () => {
    const rec = calculateRecommendation([session([[100, 12], [100, 12], [100, 13]])], exercise);
    expect(rec).toMatchObject({ weight: 105, direction: 'up', kind: 'increase' });
  });

  it('scales the increment to ~2.5% for heavy lifts', () => {
    const rec = calculateRecommendation([session([[400, 12], [400, 12], [400, 12]])], exercise);
    expect(rec).toMatchObject({ weight: 410, kind: 'increase' });
  });

  it('holds when reps are inside the range (double progression)', () => {
    const rec = calculateRecommendation([session([[100, 10], [100, 9], [100, 8]])], exercise);
    expect(rec).toMatchObject({ weight: 100, direction: 'hold', kind: 'hold' });
    expect(rec!.reason).toContain('3×12');
  });

  it('does not increase when the top of range was hit on an incomplete set count', () => {
    const rec = calculateRecommendation([session([[100, 12], [100, 12]])], exercise);
    expect(rec).toMatchObject({ weight: 100, kind: 'hold' });
    expect(rec!.reason).toContain('all 3 sets');
  });

  it('reduces the load when reps fall under the range', () => {
    const rec = calculateRecommendation([session([[100, 6], [100, 6], [100, 5]])], exercise);
    expect(rec).toMatchObject({ weight: 95, direction: 'down', kind: 'decrease' });
  });

  it('ignores warm-up sets when picking the working weight', () => {
    // 60 lb warm-up, then 3 working sets at 100 — the mode wins
    const rec = calculateRecommendation(
      [session([[60, 15], [100, 12], [100, 12], [100, 12]])],
      exercise,
    );
    expect(rec).toMatchObject({ weight: 105, kind: 'increase' });
  });

  it('suggests a deload after 3 stalled sessions at the same weight', () => {
    const history = [
      session([[100, 9], [100, 9], [100, 8]], 3),
      session([[100, 9], [100, 8], [100, 8]], 2),
      session([[100, 9], [100, 9], [100, 8]], 1),
    ];
    const rec = calculateRecommendation(history, exercise);
    expect(rec).toMatchObject({ weight: 90, direction: 'down', kind: 'deload' });
  });

  it('does not deload while strength is still climbing at the same weight', () => {
    const history = [
      session([[100, 11], [100, 10], [100, 10]], 3), // best e1RM clearly above oldest
      session([[100, 10], [100, 9], [100, 8]], 2),
      session([[100, 9], [100, 8], [100, 8]], 1),
    ];
    const rec = calculateRecommendation(history, exercise);
    expect(rec).toMatchObject({ kind: 'hold', weight: 100 });
  });

  it('prefers an increase over a deload when the last session finally beats the range', () => {
    const history = [
      session([[100, 12], [100, 12], [100, 12]], 3),
      session([[100, 12], [100, 11], [100, 10]], 2),
      session([[100, 12], [100, 12], [100, 11]], 1),
    ];
    const rec = calculateRecommendation(history, exercise);
    expect(rec).toMatchObject({ kind: 'increase', weight: 105 });
  });

  it('never recommends below 5 lbs', () => {
    const rec = calculateRecommendation([session([[5, 4], [5, 4], [5, 4]])], exercise);
    expect(rec!.weight).toBeGreaterThanOrEqual(5);
  });
});

describe('calculateRecommendation — bodyweight (rep progression)', () => {
  it('raises the rep goal when every set beats the top of the range', () => {
    const rec = calculateRecommendation(
      [session([[0, 12], [0, 13], [0, 12]])], exercise, 'Bodyweight',
    );
    expect(rec).toMatchObject({ weight: 0, targetReps: 13, direction: 'up', kind: 'increase' });
  });

  it('chases one more rep while inside the range', () => {
    const rec = calculateRecommendation(
      [session([[0, 10], [0, 9], [0, 8]])], exercise, 'Bodyweight',
    );
    expect(rec).toMatchObject({ weight: 0, targetReps: 9, direction: 'hold', kind: 'hold' });
  });

  it('caps the in-range rep goal at the top of the range', () => {
    const rec = calculateRecommendation(
      [session([[0, 12], [0, 12], [0, 11]])], exercise, 'Bodyweight',
    );
    expect(rec!.targetReps).toBe(12);
  });

  it('resets to the bottom of the range when reps fall under it', () => {
    const rec = calculateRecommendation(
      [session([[0, 6], [0, 6], [0, 5]])], exercise, 'Bodyweight',
    );
    expect(rec).toMatchObject({ targetReps: 8, direction: 'down', kind: 'decrease' });
  });

  it('suggests a rep deload after 3 sessions with no total-rep progress', () => {
    const history = [
      session([[0, 9], [0, 9], [0, 8]], 3),
      session([[0, 9], [0, 9], [0, 9]], 2),
      session([[0, 10], [0, 9], [0, 8]], 1),
    ];
    const rec = calculateRecommendation(history, exercise, 'Bodyweight');
    expect(rec).toMatchObject({ targetReps: 8, direction: 'down', kind: 'deload' });
  });

  it('does not deload while total reps are still climbing', () => {
    const history = [
      session([[0, 11], [0, 10], [0, 10]], 3),
      session([[0, 10], [0, 9], [0, 9]], 2),
      session([[0, 9], [0, 9], [0, 8]], 1),
    ];
    const rec = calculateRecommendation(history, exercise, 'Bodyweight');
    expect(rec).toMatchObject({ kind: 'hold', targetReps: 11 });
  });

  it('uses the normal weight engine when a bodyweight exercise is loaded', () => {
    // Weighted pull-ups with a 25 lb belt — progress load, not reps. A belt
    // takes 2.5 lb plates, so the increment microloads rather than jumping 20%.
    const rec = calculateRecommendation(
      [session([[25, 12], [25, 12], [25, 12]])], exercise, 'Bodyweight',
    );
    expect(rec).toMatchObject({ weight: 27.5, kind: 'increase' });
    expect(rec!.targetReps).toBeUndefined();
  });
});

describe('planned phase overrides', () => {
  it('prescribes ~10% off during a scheduled deload week, whatever the trend', () => {
    // Last session beat the rep range — normally an increase
    const rec = calculateRecommendation(
      [session([[100, 12], [100, 12], [100, 12]])], exercise, null, 'deload',
    );
    expect(rec).toMatchObject({ weight: 90, direction: 'down', kind: 'deload' });
    expect(rec!.reason).toMatch(/deload week/i);
  });

  it('treats a recovery week the same way with its own framing', () => {
    const rec = calculateRecommendation(
      [session([[100, 10], [100, 9], [100, 9]])], exercise, null, 'recovery',
    );
    expect(rec).toMatchObject({ weight: 90, kind: 'deload' });
    expect(rec!.reason).toMatch(/recovery week/i);
  });

  it('backs bodyweight work off to the bottom of the rep range', () => {
    const rec = calculateRecommendation(
      [session([[0, 12], [0, 12], [0, 12]])], exercise, 'Bodyweight', 'deload',
    );
    expect(rec).toMatchObject({ weight: 0, targetReps: 8, kind: 'deload' });
  });

  it('changes nothing during productive phases', () => {
    const rec = calculateRecommendation(
      [session([[100, 12], [100, 12], [100, 12]])], exercise, null, 'accumulation',
    );
    expect(rec).toMatchObject({ weight: 105, kind: 'increase' });
  });
});

describe('exercise-order freshness', () => {
  // history is newest-first; add a position to each session
  const at = (pos: number, sets: Array<[number, number]>, ts = 0): ExerciseSession =>
    ({ completedAt: ts, position: pos, sets: sets.map(([weight, reps]) => ({ weight, reps })) });

  it('ignores a fatigued late-slot session as the baseline', () => {
    // Usual slot 0, climbing. Latest session ran at slot 3 with a dip — the
    // recommendation should build off the fresh session, not the tired one.
    const history = [
      at(3, [[95, 6], [95, 6], [95, 6]], 4),   // newest: fatigued, late slot
      at(0, [[100, 12], [100, 12], [100, 12]], 3),
      at(0, [[100, 11], [100, 11], [100, 11]], 2),
    ];
    const rec = calculateRecommendation(history, exercise);
    // Baseline is the fresh 100×12 session → earns an increase, not a decrease
    expect(rec).toMatchObject({ kind: 'increase' });
    expect(rec!.reason).toMatch(/later in your workout/i);
  });

  it('does not read a late-slot dip as an under-range decrease', () => {
    // A tired late-slot session with low reps would normally trigger a
    // decrease; the two fresh in-range sessions are the real baseline → hold.
    const history = [
      at(3, [[90, 6], [90, 6], [90, 6]], 5),      // newest: late slot, low reps
      at(0, [[100, 10], [100, 10], [100, 10]], 4),
      at(0, [[100, 10], [100, 10], [100, 10]], 3),
    ];
    const rec = calculateRecommendation(history, exercise);
    expect(rec!.kind).toBe('hold');
    expect(rec!.reason).toMatch(/later in your workout/i);
  });
});

describe('calculateRecommendation — rep-total progression', () => {
  it('adds load on the rep TOTAL, not a perfect set-by-set score', () => {
    // 13/12/11 = 36 reps, the same work as 3×12. The old per-set rule would
    // hold this lifter at 100 lbs forever because one set fell a rep short.
    const rec = calculateRecommendation([session([[100, 13], [100, 12], [100, 11]])], exercise);
    expect(rec).toMatchObject({ kind: 'increase', weight: 105 });
    expect(rec!.reason).toContain('36 reps');
  });

  it('still holds when the rep total is genuinely short', () => {
    // 11/10/10 = 31 of 36
    const rec = calculateRecommendation([session([[100, 11], [100, 10], [100, 10]])], exercise);
    expect(rec).toMatchObject({ kind: 'hold', weight: 100 });
  });

  it('takes a double jump when the load is clearly too light', () => {
    // Averaging 14 reps in an 8–12 range — that weight is a warm-up
    const rec = calculateRecommendation([session([[100, 15], [100, 14], [100, 14]])], exercise);
    expect(rec).toMatchObject({ kind: 'increase', weight: 110 });
    expect(rec!.reason).toMatch(/too light/i);
  });

  it('adds load when est. 1RM breaks out at an unchanged weight near the top of the range', () => {
    const history = [
      session([[100, 12], [100, 11], [100, 11]], 3),   // 34 reps — short of 36
      session([[100, 10], [100, 10], [100, 9]], 2),
      session([[100, 10], [100, 9], [100, 9]], 1),
    ];
    const rec = calculateRecommendation(history, exercise);
    expect(rec).toMatchObject({ kind: 'increase', weight: 105 });
    expect(rec!.reason).toMatch(/est\. 1RM up/i);
  });

  it('microloads light cable/machine work instead of jumping 30%', () => {
    const rec = calculateRecommendation(
      [session([[20, 20], [20, 20], [20, 20]])],
      { sets: 3, repLow: 16, repHigh: 20 },
      'Machine',
    );
    expect(rec).toMatchObject({ kind: 'increase', weight: 22.5 });
  });

  it('keeps 5 lb jumps on dumbbells — the rack has no half-plates', () => {
    const rec = calculateRecommendation(
      [session([[20, 20], [20, 20], [20, 20]])],
      { sets: 3, repLow: 16, repHigh: 20 },
      'Dumbbell',
    );
    expect(rec).toMatchObject({ kind: 'increase', weight: 25 });
  });
});

describe('buildSetPlan', () => {
  it('prescribes one row per programmed set at the recommended load', () => {
    const plan = buildSetPlan([session([[100, 10], [100, 9], [100, 9]])], exercise);
    expect(plan.sets).toHaveLength(3);
    expect(plan.sets.map(s => s.setNumber)).toEqual([1, 2, 3]);
    expect(plan.sets.every(s => s.weight === 100)).toBe(true);
  });

  it('targets descending reps, fitted to the lifter\'s own drop-off', () => {
    // This lifter reliably loses 2 reps by set 3 at their working weight
    const history = [
      session([[100, 10], [100, 9], [100, 8]], 2),
      session([[100, 10], [100, 9], [100, 8]], 1),
    ];
    const plan = buildSetPlan(history, exercise);
    // Set 1 chases one more rep than last time; the drop-off carries down
    expect(plan.sets.map(s => s.targetReps)).toEqual([11, 10, 9]);
  });

  it('falls back to a decay model for sets the lifter has never reached', () => {
    // Only ever done one set — sets 2 and 3 have no observed drop-off
    const plan = buildSetPlan([session([[100, 10]])], exercise);
    const targets = plan.sets.map(s => s.targetReps);
    expect(targets[0]).toBeGreaterThanOrEqual(targets[1]);
    expect(targets[1]).toBeGreaterThanOrEqual(targets[2]);
  });

  it('never targets outside the programmed rep range', () => {
    const plan = buildSetPlan([session([[100, 12], [100, 12], [100, 4]])], exercise);
    for (const s of plan.sets) {
      expect(s.targetReps).toBeGreaterThanOrEqual(exercise.repLow);
      expect(s.targetReps).toBeLessThanOrEqual(exercise.repHigh);
    }
  });

  it('aims at the bottom of the range after a load increase', () => {
    const plan = buildSetPlan([session([[100, 12], [100, 12], [100, 12]])], exercise);
    expect(plan.rec!.kind).toBe('increase');
    expect(plan.sets.every(s => s.weight === 105 && s.targetReps === exercise.repLow)).toBe(true);
  });

  it('prescribes rep targets with no weight for a never-trained exercise', () => {
    const plan = buildSetPlan([], exercise);
    expect(plan.rec).toBeNull();
    expect(plan.sets).toHaveLength(3);
    expect(plan.sets.every(s => s.weight === null && s.targetReps === exercise.repLow)).toBe(true);
    expect(plan.goal).toMatch(/first time/i);
  });

  it('follows the coach-adjusted set count, not the last session\'s', () => {
    const plan = buildSetPlan(
      [session([[100, 10], [100, 9]])],
      { ...exercise, sets: 5 },
    );
    expect(plan.sets).toHaveLength(5);
  });

  it('flattens targets during a planned deload week', () => {
    const plan = buildSetPlan(
      [session([[100, 10], [100, 9], [100, 9]])], exercise, null, 'deload',
    );
    expect(plan.sets.every(s => s.weight === 90 && s.targetReps === exercise.repLow)).toBe(true);
    expect(plan.goal).toMatch(/reserve/i);
  });

  it('prescribes bodyweight work at 0 lbs with rep targets', () => {
    const plan = buildSetPlan(
      [session([[0, 10], [0, 9], [0, 8]])], exercise, 'Bodyweight',
    );
    expect(plan.sets.every(s => s.weight === 0)).toBe(true);
    expect(plan.sets[0].targetReps).toBeGreaterThanOrEqual(plan.sets[2].targetReps);
  });
});
