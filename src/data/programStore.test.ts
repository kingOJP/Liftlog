import { describe, it, expect, beforeEach } from 'vitest';
import { canonicalizeId } from './legacyIds';
import { getStoredProgram } from './programStore';
import type { WorkoutDay } from './program';

beforeEach(() => localStorage.clear());

describe('canonicalizeId', () => {
  it('remaps legacy -d1/-d2/-d4 ids', () => {
    expect(canonicalizeId('face-pulls-d2')).toBe('face-pulls');
    expect(canonicalizeId('lat-pulldown-d2')).toBe('lat-pull-down');
  });

  it('passes canonical ids through', () => {
    expect(canonicalizeId('face-pulls')).toBe('face-pulls');
    expect(canonicalizeId('my-custom-123')).toBe('my-custom-123');
  });
});

describe('getStoredProgram', () => {
  it('returns the default program when nothing is stored', () => {
    const program = getStoredProgram();
    expect(program).toHaveLength(4);
    expect(program[0].exercises.length).toBeGreaterThan(0);
  });

  it('survives corrupt stored JSON', () => {
    localStorage.setItem('liftlog_program', '{broken');
    expect(getStoredProgram()).toHaveLength(4);
  });

  it('canonicalizes legacy exercise ids in the stored program and persists the fix', () => {
    const legacy: WorkoutDay[] = [{
      id: 1,
      label: 'Day 1',
      muscleGroups: 'Back',
      exercises: [
        { id: 'face-pulls-d2', name: 'Face Pulls (old)', sets: 3, repLow: 15, repHigh: 20 },
      ],
    }];
    localStorage.setItem('liftlog_program', JSON.stringify(legacy));

    const program = getStoredProgram();
    expect(program[0].exercises[0].id).toBe('face-pulls');
    // Display name refreshed from the master list
    expect(program[0].exercises[0].name).toBe('Face Pulls');
    // And the fix was written back
    const persisted = JSON.parse(localStorage.getItem('liftlog_program')!) as WorkoutDay[];
    expect(persisted[0].exercises[0].id).toBe('face-pulls');
  });

  it('merges a legacy id with its canonical sibling instead of duplicating it', () => {
    const legacy: WorkoutDay[] = [{
      id: 1,
      label: 'Day 1',
      muscleGroups: 'Back',
      exercises: [
        { id: 'face-pulls',    name: 'Face Pulls', sets: 3, repLow: 15, repHigh: 20 },
        { id: 'face-pulls-d2', name: 'Face Pulls', sets: 3, repLow: 15, repHigh: 20 },
      ],
    }];
    localStorage.setItem('liftlog_program', JSON.stringify(legacy));

    const program = getStoredProgram();
    expect(program[0].exercises).toHaveLength(1);
    expect(program[0].exercises[0].id).toBe('face-pulls');
  });
});
