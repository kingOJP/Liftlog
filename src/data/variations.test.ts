import { describe, it, expect } from 'vitest';
import {
  adjustInvolvement, setCredit, countsForStrength, isExtension, styleOf, sameVariation,
  variationLabel, variationKey, gripOptionsFor, techniqueOptionsFor, extensionOptionsFor,
  EXTENSION_SET_CREDIT, SET_TECHNIQUES, GRIPS, TECHNIQUE_INFO, GRIP_INFO,
} from './variations';
import type { Involvement } from './variations';

const bench: Involvement[] = [
  { muscle: 'Chest', weight: 1 }, { muscle: 'Delts', weight: 0.5 }, { muscle: 'Triceps', weight: 0.5 },
];
const deadlift: Involvement[] = [
  { muscle: 'Glutes', weight: 1 }, { muscle: 'Hamstrings', weight: 0.5 },
  { muscle: 'Lower Back', weight: 0.5 }, { muscle: 'Traps', weight: 0.5 },
];
const pulldown: Involvement[] = [
  { muscle: 'Lats', weight: 1 }, { muscle: 'Upper Back', weight: 0.5 }, { muscle: 'Biceps', weight: 0.5 },
];

describe('muscle emphasis shifts', () => {
  it('a close grip makes a press more of a triceps exercise without changing what it is', () => {
    const out = adjustInvolvement(bench, 'Horizontal Press', { grip: 'close' });
    expect(out.find(m => m.muscle === 'Chest')?.weight).toBe(1);
    expect(out.find(m => m.muscle === 'Triceps')?.weight).toBe(0.75);
    expect(out.find(m => m.muscle === 'Delts')?.weight).toBe(0.5);
  });

  it('a wide grip takes the biceps out of a pulldown', () => {
    const out = adjustInvolvement(pulldown, 'Pull Down', { grip: 'wide' });
    expect(out.find(m => m.muscle === 'Biceps')?.weight).toBe(0.25);
    expect(out.find(m => m.muscle === 'Lats')?.weight).toBe(1);
  });

  it('a deficit deadlift brings the quads in and asks more of the lower back', () => {
    const out = adjustInvolvement(deadlift, 'Hip Hinge', { technique: 'deficit' });
    expect(out.find(m => m.muscle === 'Quads')?.weight).toBe(0.5);
    expect(out.find(m => m.muscle === 'Lower Back')?.weight).toBe(0.75);
  });

  it('never promotes a secondary to primary — weight 1 stays the unique prime-mover marker', () => {
    const out = adjustInvolvement(
      [{ muscle: 'Chest', weight: 1 }, { muscle: 'Triceps', weight: 0.75 }],
      'Horizontal Press', { grip: 'close' },
    );
    expect(out.filter(m => m.weight === 1).map(m => m.muscle)).toEqual(['Chest']);
    expect(out.find(m => m.muscle === 'Triceps')?.weight).toBe(0.75);
  });

  it('never touches the primary even when the table names it', () => {
    // A triceps-primary exercise filed as a horizontal press (user override):
    // the close-grip triceps bump must not stack on the prime mover.
    const out = adjustInvolvement([{ muscle: 'Triceps', weight: 1 }], 'Horizontal Press', { grip: 'close' });
    expect(out).toEqual([{ muscle: 'Triceps', weight: 1 }]);
  });

  it('drops a muscle whose weight falls to zero', () => {
    const out = adjustInvolvement(
      [{ muscle: 'Chest', weight: 1 }, { muscle: 'Triceps', weight: 0.25 }],
      'Horizontal Press', { grip: 'wide' },
    );
    expect(out.some(m => m.muscle === 'Triceps')).toBe(false);
  });

  it('is the identity for a plain set, an irrelevant grip, or an unknown pattern', () => {
    expect(adjustInvolvement(bench, 'Horizontal Press', {})).toBe(bench);
    expect(adjustInvolvement(bench, 'Horizontal Press', null)).toBe(bench);
    expect(adjustInvolvement(bench, 'Squat', { grip: 'close' })).toBe(bench);
    expect(adjustInvolvement(bench, null, { grip: 'close' })).toBe(bench);
    // paused reps are harder, not different muscles
    expect(adjustInvolvement(bench, 'Horizontal Press', { technique: 'paused' })).toBe(bench);
  });

  it('does not mutate the base involvement', () => {
    const copy = bench.map(m => ({ ...m }));
    adjustInvolvement(bench, 'Horizontal Press', { grip: 'close' });
    expect(bench).toEqual(copy);
  });
});

describe('set credit and strength eligibility', () => {
  it('counts an extension row as half a set and everything else as one', () => {
    expect(setCredit('drop')).toBe(EXTENSION_SET_CREDIT);
    expect(setCredit('rest-pause')).toBe(0.5);
    expect(setCredit('partials')).toBe(0.5);
    expect(setCredit('paused')).toBe(1);
    expect(setCredit(undefined)).toBe(1);
    expect(setCredit('something-newer')).toBe(1); // an unknown tag is a plain set, never a discount
  });

  it('keeps drops, rest-pause bursts and partials out of e1RM but reads paused and tempo sets', () => {
    expect(countsForStrength('drop')).toBe(false);
    expect(countsForStrength('partials')).toBe(false);
    expect(countsForStrength('paused')).toBe(true);
    expect(countsForStrength('tempo')).toBe(true);
    expect(countsForStrength(undefined)).toBe(true);
  });

  it('classifies every technique as a rep style or an extension', () => {
    for (const t of SET_TECHNIQUES) {
      expect(typeof isExtension(t)).toBe('boolean');
      expect(TECHNIQUE_INFO[t].label.length).toBeGreaterThan(0);
    }
    for (const g of GRIPS) expect(GRIP_INFO[g].short.length).toBeGreaterThan(0);
  });
});

describe('style comparison', () => {
  it('compares rep style and grip, ignoring extensions and unknown values', () => {
    expect(sameVariation({ technique: 'paused', grip: 'close' }, { technique: 'paused', grip: 'close' })).toBe(true);
    expect(sameVariation({ technique: 'paused' }, {})).toBe(false);
    expect(sameVariation({ grip: 'wide' }, { grip: 'close' })).toBe(false);
    // an extension is not a style — a drop row of a plain set is a plain-set style
    expect(sameVariation({ technique: 'drop' }, {})).toBe(true);
    expect(styleOf({ technique: 'something-newer', grip: 'odd' })).toEqual({});
    expect(variationKey({})).toBe('');
    expect(variationKey({ technique: 'paused', grip: 'close' })).toBe('paused|close');
  });

  it('labels a set the way a lifter would say it', () => {
    expect(variationLabel({ technique: 'paused', grip: 'close' })).toBe('paused · close grip');
    expect(variationLabel({ grip: 'underhand' })).toBe('underhand');
    expect(variationLabel({})).toBeNull();
  });
});

describe('which options a movement offers', () => {
  it('offers grips only where grip is a variable', () => {
    expect(gripOptionsFor('Row')).toContain('underhand');
    expect(gripOptionsFor('Horizontal Press')).toEqual(['close', 'wide', 'neutral']);
    expect(gripOptionsFor('Squat')).toEqual([]);
    expect(gripOptionsFor(null)).toEqual([]);
  });

  it('offers deficit only where a block changes the lift, and nothing for timed holds', () => {
    expect(techniqueOptionsFor('Hip Hinge')).toContain('deficit');
    expect(techniqueOptionsFor('Curl')).toEqual(['paused', 'tempo']);
    expect(techniqueOptionsFor('Plank', 'seconds')).toEqual([]);
    expect(extensionOptionsFor('seconds')).toEqual([]);
    expect(extensionOptionsFor()).toEqual(['drop', 'rest-pause', 'partials']);
  });
});
