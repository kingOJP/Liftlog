import { describe, it, expect } from 'vitest';
import { calculateRecommendation } from './recommendations';
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
