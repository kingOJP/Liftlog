import { describe, it, expect } from 'vitest';
import {
  blockEnded,
  blockEndTs,
  blockWeekIndex,
  currentPhase,
  productiveWeeks,
  validatePhases,
  nextMonday,
  parsePlanDate,
} from './plan';
import type { PhaseKind, TrainingBlock } from './plan';

function makeBlock(overrides: Partial<TrainingBlock> = {}): TrainingBlock {
  return {
    id: 'b1',
    name: 'Block 1',
    focus: 'hypertrophy',
    startDate: '2026-06-10', // a Wednesday — anchor snaps back to Mon 2026-06-08
    phases: ['accumulation', 'accumulation', 'intensification', 'deload'],
    program: [],
    intent: '',
    progression: '',
    status: 'active',
    activatedAt: 0,
    ...overrides,
  };
}

const ts = (s: string) => new Date(s).getTime();

describe('block week math', () => {
  it('snaps the anchor back to Monday and indexes weeks from it', () => {
    const block = makeBlock();
    expect(blockWeekIndex(block, ts('2026-06-08T09:00:00'))).toBe(0); // anchor Monday
    expect(blockWeekIndex(block, ts('2026-06-10T09:00:00'))).toBe(0); // the start date itself
    expect(blockWeekIndex(block, ts('2026-06-14T23:00:00'))).toBe(0); // Sunday, still week 1
    expect(blockWeekIndex(block, ts('2026-06-15T00:30:00'))).toBe(1); // Monday rollover
    expect(blockWeekIndex(block, ts('2026-06-07T12:00:00'))).toBe(-1); // before the block
  });

  it('maps the week index onto the phase array', () => {
    const block = makeBlock();
    expect(currentPhase(block, ts('2026-06-09T12:00:00'))).toBe('accumulation');
    expect(currentPhase(block, ts('2026-06-22T12:00:00'))).toBe('intensification'); // week 3
    expect(currentPhase(block, ts('2026-06-29T12:00:00'))).toBe('deload');          // week 4
    expect(currentPhase(block, ts('2026-07-06T12:00:00'))).toBeNull();              // ended
    expect(currentPhase(block, ts('2026-06-01T12:00:00'))).toBeNull();              // not started
  });

  it('detects the end of a scheduled block', () => {
    const block = makeBlock();
    expect(blockEnded(block, ts('2026-07-05T23:00:00'))).toBe(false); // last deload day
    expect(blockEnded(block, ts('2026-07-06T01:00:00'))).toBe(true);
    expect(blockEndTs(block)).toBe(ts('2026-07-06T00:00:00'));
  });

  it('treats open-ended blocks as perpetual accumulation', () => {
    const block = makeBlock({ phases: [], openEnded: true, startDate: '2026-01-05' });
    expect(currentPhase(block, ts('2026-06-09T12:00:00'))).toBe('accumulation');
    expect(blockEnded(block, ts('2030-01-01T12:00:00'))).toBe(false);
    expect(blockEndTs(block)).toBeNull();
  });
});

describe('validatePhases', () => {
  const acc = 'accumulation' as PhaseKind;

  it('accepts sound layouts', () => {
    expect(validatePhases([acc, acc, acc, 'deload'])).toBeNull();
    expect(validatePhases(['recovery', acc, acc, 'intensification', 'deload'])).toBeNull();
    expect(validatePhases([acc, acc, 'intensification'])).toBeNull(); // no deload is fine
  });

  it('rejects a recovery week anywhere but the opener', () => {
    expect(validatePhases([acc, 'recovery', acc])).toMatch(/recovery week/i);
  });

  it('rejects more than one deload', () => {
    expect(validatePhases([acc, acc, acc, 'deload', 'deload'])).toMatch(/one deload/i);
  });

  it('rejects a deload that is not the closing week', () => {
    expect(validatePhases([acc, acc, acc, 'deload', acc])).toMatch(/closes the block/i);
  });

  it('requires three productive weeks before a deload', () => {
    expect(validatePhases(['recovery', acc, acc, 'deload'])).toMatch(/productive weeks/i);
    expect(validatePhases([acc, acc, 'deload'])).toMatch(/productive weeks/i);
  });

  it('counts productive weeks without recovery and deload', () => {
    expect(productiveWeeks(['recovery', acc, acc, 'intensification', 'deload'])).toBe(3);
  });
});

describe('date helpers', () => {
  it('parses valid dates and rejects rollovers', () => {
    expect(parsePlanDate('2026-06-10')).not.toBeNull();
    expect(parsePlanDate('2026-13-10')).toBeNull();
    expect(parsePlanDate('junk')).toBeNull();
  });

  it('nextMonday lands on a Monday after today', () => {
    const value = nextMonday(new Date('2026-07-07T12:00:00')); // a Tuesday
    expect(value).toBe('2026-07-13');
    expect(parsePlanDate(value)!.getDay()).toBe(1);
  });
});
