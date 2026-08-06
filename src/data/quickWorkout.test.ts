// src/data/quickWorkout.ts — the reserved-day-id convention.
//
// Small, but it encodes a rule the rest of the app depends on silently: a
// quick workout is logged as a session like any other, and the only thing
// keeping it off the dashboard (and out of collision with a real program day)
// is its negative id.

import { describe, it, expect } from 'vitest';
import { QUICK_DAY_ID, isQuickWorkout, buildQuickWorkoutDay } from './quickWorkout';

describe('the reserved quick-workout day id', () => {
  it('is negative, so it can never collide with a program day', () => {
    expect(QUICK_DAY_ID).toBeLessThan(0);
  });

  it('recognises itself and nothing else', () => {
    expect(isQuickWorkout(QUICK_DAY_ID)).toBe(true);
    expect(isQuickWorkout(1)).toBe(false);
    expect(isQuickWorkout(-1)).toBe(false); // a different reserved id, not this one
  });
});

describe('buildQuickWorkoutDay', () => {
  const exercises = [{ id: 'bench-press', name: 'Bench Press', sets: 3, repLow: 8, repHigh: 12 }];

  it('wraps the picked exercises in a day under the reserved id', () => {
    expect(buildQuickWorkoutDay(exercises)).toEqual({
      id: QUICK_DAY_ID,
      label: 'Quick Workout',
      muscleGroups: 'One-off session',
      exercises,
    });
  });

  it('carries the slots through untouched — the picker already dosed them', () => {
    expect(buildQuickWorkoutDay(exercises).exercises[0]).toBe(exercises[0]);
  });

  it('handles an empty pick without inventing anything', () => {
    expect(buildQuickWorkoutDay([]).exercises).toEqual([]);
  });
});
