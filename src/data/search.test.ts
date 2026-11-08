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

  it('matches catalog aliases, so the names lifters use find the exercise', () => {
    expect(filterExercises([{ id: 'romanian-deadlifts', name: 'Romanian Deadlifts' }], 'rdl')).toHaveLength(1);
    expect(filterExercises([{ id: 'barbell-overhead-press', name: 'Barbell Overhead Press' }], 'ohp')).toHaveLength(1);
    expect(filterExercises([{ id: 'pec-deck-fly', name: 'Pec Deck Fly' }], 'butterfly')).toHaveLength(1);
    // A custom exercise has no aliases — only its own name matches.
    expect(filterExercises([{ id: 'my-lift-1782000000000', name: 'My Lift' }], 'rdl')).toHaveLength(0);
  });

  it('ignores spacing and hyphens inside a word', () => {
    expect(matchesExerciseQuery('Lat Pull Down', 'pulldown')).toBe(true);
    expect(matchesExerciseQuery('Pull Ups', 'pull-up')).toBe(true);
  });

  it('expands gym shorthand and an optional plural', () => {
    expect(matchesExerciseQuery('Incline Dumbbell Press', 'db inc')).toBe(true);
    expect(matchesExerciseQuery('Kettlebell Swing', 'kb swing')).toBe(true);
    expect(matchesExerciseQuery('Barbell Curl', 'curls')).toBe(true);
    expect(matchesExerciseQuery('Seated Cable Row', 'db row')).toBe(false);
  });

  it('matches within one name at a time, not across a name and an alias', () => {
    // "deadlift" is in the name, "rdl" in an alias — a query needing both
    // words in one place does not mix them.
    expect(matchesExerciseQuery('Romanian Deadlifts', 'romanian rdl', ['RDL'])).toBe(false);
  });
});

