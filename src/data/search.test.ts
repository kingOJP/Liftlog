import { describe, it, expect } from 'vitest';
import { filterExercises, matchesExerciseQuery } from './search';

describe('exercise search', () => {
  it('matches every typed word anywhere in the name, in any order', () => {
    expect(matchesExerciseQuery('Incline Dumbbell Press', 'dumbbell inc')).toBe(true);
    expect(matchesExerciseQuery('Seated Cable Row', 'row cable')).toBe(true);
    expect(matchesExerciseQuery('Seated Cable Row', 'row barbell')).toBe(false);
  });

  it('is case-insensitive and ignores extra whitespace', () => {
    expect(matchesExerciseQuery('Face Pulls', '  FACE   pull ')).toBe(true);
  });

  it('matches everything on an empty query', () => {
    const list = [{ name: 'A' }, { name: 'B' }];
    expect(filterExercises(list, '')).toEqual(list);
    expect(filterExercises(list, '   ')).toEqual(list);
  });
});
