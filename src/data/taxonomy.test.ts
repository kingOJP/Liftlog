import { describe, it, expect } from 'vitest';
import { MUSCLE_GROUPS, MUSCLE_REGIONS, regionFor } from './taxonomy';

describe('muscle taxonomy tiers', () => {
  it('every muscle group resolves to exactly one region', () => {
    for (const muscle of MUSCLE_GROUPS) {
      expect(MUSCLE_REGIONS).toContain(regionFor(muscle));
    }
  });

  it('groups Obliques and Abs under Core', () => {
    expect(regionFor('Abs')).toBe('Core');
    expect(regionFor('Obliques')).toBe('Core');
  });

  it('groups the back muscles under Back', () => {
    for (const muscle of ['Lats', 'Upper Back', 'Lower Back', 'Traps'] as const) {
      expect(regionFor(muscle)).toBe('Back');
    }
  });

  it('keeps MUSCLE_GROUPS alphabetical', () => {
    expect(MUSCLE_GROUPS).toEqual([...MUSCLE_GROUPS].sort());
  });
});
