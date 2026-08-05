import { describe, it, expect } from 'vitest';
import {
  compositeScore, deadband, pctChange, fullMarksFor, stallWindowFor,
  holdsInsteadOfDeload, GOAL_SIGNAL_WEIGHTS, FULL_MARKS,
  PROGRESS_SCORE, STALL_SCORE,
} from './progression';
import type { Goal } from './plan';

const flat = { e1rmChangePct: 0, volumeChangePct: 0, prEvents: 0 };

describe('deadband', () => {
  it('reads a wobble inside the noise floor as no change', () => {
    // Session-to-session performance moves a few percent on sleep and food
    // alone. Cutting someone's load off a 1% dip would be programming to noise.
    expect(deadband(2)).toBe(0);
    expect(deadband(-2)).toBe(0);
    expect(deadband(7)).toBe(7);
    expect(deadband(-7)).toBe(-7);
    expect(deadband(null)).toBeNull();
  });
});

describe('pctChange', () => {
  it('measures the change, and declines to divide by nothing', () => {
    expect(pctChange(100, 110)).toBeCloseTo(10);
    expect(pctChange(100, 90)).toBeCloseTo(-10);
    expect(pctChange(0, 50)).toBeNull();
  });
});

describe('compositeScore', () => {
  it('scores a flat window at zero for goals that need progress', () => {
    expect(compositeScore(flat, 'hypertrophy')).toBe(0);
    expect(compositeScore(flat, 'strength')).toBe(0);
  });

  it('weights the signals by what the athlete is training for', () => {
    // Same window: volume up 10%, est. 1RM flat. A hypertrophy block should
    // care much more about that than a strength block does.
    const volumeOnly = { e1rmChangePct: 0, volumeChangePct: 10, prEvents: 0 };
    const hyp = compositeScore(volumeOnly, 'hypertrophy');
    const str = compositeScore(volumeOnly, 'strength');
    expect(hyp).toBeGreaterThan(str);
    expect(hyp).toBeCloseTo(GOAL_SIGNAL_WEIGHTS.hypertrophy.volume);

    // And the mirror: est. 1RM up 5%, volume flat.
    const strengthOnly = { e1rmChangePct: 5, volumeChangePct: 0, prEvents: 0 };
    expect(compositeScore(strengthOnly, 'strength'))
      .toBeGreaterThan(compositeScore(strengthOnly, 'hypertrophy'));
  });

  it('scores holding as a win where adding strength is not the point', () => {
    // In a deficit, or supporting a sport, defending the numbers IS the
    // objective — a flat est. 1RM must not read as a stall.
    for (const goal of ['fat-loss', 'sport-support'] as Goal[]) {
      expect(compositeScore(flat, goal)).toBeGreaterThan(0);
    }
    expect(compositeScore(flat, 'general')).toBe(0);
  });

  it('redistributes the weight of a missing signal', () => {
    // Bodyweight work has no est. 1RM. The volume and PR terms must carry the
    // whole verdict rather than the absent term scoring zero against it.
    const noE1rm = { e1rmChangePct: null, volumeChangePct: 10, prEvents: 2 };
    expect(compositeScore(noE1rm, 'hypertrophy')).toBeCloseTo(1);
  });

  it('caps each signal at full marks so one outlier cannot carry the verdict', () => {
    const huge = { e1rmChangePct: 500, volumeChangePct: 500, prEvents: 50 };
    expect(compositeScore(huge, 'general')).toBeLessThanOrEqual(1);
  });

  it('judges progress against what the training age should deliver', () => {
    // A 5% volume gain is half a window's work for an intermediate, a plateau
    // for a novice who should be adding reps every session, and a strong block
    // for an advanced lifter.
    const modest = { e1rmChangePct: 0, volumeChangePct: 5, prEvents: 0 };
    const beginner = compositeScore(modest, 'hypertrophy', 'beginner');
    const intermediate = compositeScore(modest, 'hypertrophy', 'intermediate');
    const advanced = compositeScore(modest, 'hypertrophy', 'advanced');
    expect(beginner).toBeLessThan(intermediate);
    expect(intermediate).toBeLessThan(advanced);
    expect(advanced).toBeGreaterThan(PROGRESS_SCORE);
    expect(beginner).toBeLessThanOrEqual(STALL_SCORE);
  });
});

describe('fullMarksFor', () => {
  it('anchors on the intermediate and scales with training age', () => {
    expect(fullMarksFor('intermediate')).toEqual(FULL_MARKS);
    expect(fullMarksFor()).toEqual(FULL_MARKS);
    expect(fullMarksFor('beginner').volumePct).toBeGreaterThan(FULL_MARKS.volumePct);
    expect(fullMarksFor('advanced').volumePct).toBeLessThan(FULL_MARKS.volumePct);
  });
});

describe('stallWindowFor', () => {
  it('gives an advanced lifter longer before calling a plateau', () => {
    expect(stallWindowFor('advanced')).toBeGreaterThan(stallWindowFor('intermediate'));
    // Novices are not given a shorter one: their numbers bounce on technique
    // alone, and two sessions of that is not evidence of anything.
    expect(stallWindowFor('beginner')).toBe(stallWindowFor('intermediate'));
  });
});

describe('holdsInsteadOfDeload', () => {
  it('cuts load only where cutting it is the right answer', () => {
    expect(holdsInsteadOfDeload('fat-loss', 'intermediate')).toBe(true);
    expect(holdsInsteadOfDeload('sport-support', 'intermediate')).toBe(true);
    expect(holdsInsteadOfDeload('hypertrophy', 'beginner')).toBe(true);
    expect(holdsInsteadOfDeload('hypertrophy', 'intermediate')).toBe(false);
    expect(holdsInsteadOfDeload('strength', 'advanced')).toBe(false);
  });
});
