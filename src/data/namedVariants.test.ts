import { describe, it, expect } from 'vitest';
import { applyNamedVariant, namedVariantDetail, namedVariantFor } from './namedVariants';
import { musclesForSet } from './analytics';
import type { Exercise } from './program';

describe('named variants', () => {
  it('resolves the names lifters type, aliases and all, to a base exercise plus a modifier', () => {
    expect(namedVariantFor('wide grip lat pulldown')).toMatchObject({ exerciseId: 'lat-pull-down', grip: 'wide' });
    expect(namedVariantFor('V-Bar Pulldown')).toMatchObject({ exerciseId: 'lat-pull-down', grip: 'close' });
    expect(namedVariantFor('Pendlay Row')).toMatchObject({ exerciseId: 'barbell-rows', technique: 'paused' });
    expect(namedVariantFor('Lat Pulldown')).toBeNull(); // the plain exercise is an alias, not a variant
  });

  it('pins the modifier on a dosed slot without touching the dose', () => {
    const slot: Exercise = { id: 'barbell-back-squat', name: 'Barbell Back Squat', sets: 4, repLow: 3, repHigh: 5, rangeSource: 'plan' };
    const paused = applyNamedVariant(slot, namedVariantFor('Paused Squat')!);
    expect(paused).toEqual({ ...slot, technique: 'paused' });
    expect(slot.technique).toBeUndefined();
  });

  it('describes itself as the base exercise and the modifier', () => {
    expect(namedVariantDetail(namedVariantFor('Yates Row')!)).toBe('Barbell Rows · underhand');
  });

  it('gets its emphasis shift from the variation table, not from a separate catalog entry', () => {
    const plain = musclesForSet('lat-pull-down', {});
    const wide = musclesForSet('lat-pull-down', { grip: namedVariantFor('Wide Grip Lat Pulldown')!.grip });
    const biceps = (ms: { muscle: string; weight: number }[]) => ms.find(m => m.muscle === 'Biceps')?.weight ?? 0;
    expect(biceps(wide)).toBeLessThan(biceps(plain));
  });
});
