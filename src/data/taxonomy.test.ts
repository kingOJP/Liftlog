import { describe, it, expect } from 'vitest';
import {
  MUSCLE_GROUPS, MUSCLE_REGIONS, regionFor,
  MOVEMENT_PATTERNS, MOVEMENT_CATEGORIES, patternCategoryFor,
} from './taxonomy';

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

describe('movement pattern tiers', () => {
  it('every movement pattern resolves to exactly one category', () => {
    for (const pattern of MOVEMENT_PATTERNS) {
      expect(MOVEMENT_CATEGORIES).toContain(patternCategoryFor(pattern));
    }
  });

  it('splits horizontal and vertical pressing into Push, not the same pattern', () => {
    expect(MOVEMENT_PATTERNS).toContain('Horizontal Press');
    expect(MOVEMENT_PATTERNS).toContain('Vertical Press');
    expect(MOVEMENT_PATTERNS).not.toContain('Press');
    expect(patternCategoryFor('Horizontal Press')).toBe('Push');
    expect(patternCategoryFor('Vertical Press')).toBe('Push');
  });

  it('groups hip-dominant patterns under Hinge', () => {
    expect(patternCategoryFor('Hip Hinge')).toBe('Hinge');
    expect(patternCategoryFor('Hip Thrust')).toBe('Hinge');
  });

  it('groups single-joint accessory patterns under Isolation', () => {
    for (const pattern of ['Curl', 'Tricep Extension', 'Lateral Raise', 'Leg Extension', 'Calf Raise'] as const) {
      expect(patternCategoryFor(pattern)).toBe('Isolation');
    }
  });

  it('keeps MOVEMENT_PATTERNS alphabetical', () => {
    expect(MOVEMENT_PATTERNS).toEqual([...MOVEMENT_PATTERNS].sort());
  });
});
