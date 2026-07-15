import { describe, it, expect, beforeEach } from 'vitest';
import { canonicalizeId } from './legacyIds';
import {
  getStoredProgram, getExerciseLibrary, saveExerciseLibrary,
  deleteExerciseFromLibrary, addToExerciseLibrary,
  getDeletedExerciseIds, addDeletedExerciseIds,
  mergeExerciseLibrary, ensureProgramExercisesInLibrary, getExerciseName,
  findExerciseByName,
} from './programStore';
import { getAllExerciseMeta, saveExerciseMeta, getExerciseMeta } from './exercises';
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
  it('returns a blank slate when nothing is stored (new accounts get no pre-populated workouts)', () => {
    expect(getStoredProgram()).toHaveLength(0);
  });

  it('survives corrupt stored JSON', () => {
    localStorage.setItem('liftlog_program', '{broken');
    expect(getStoredProgram()).toHaveLength(0);
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

describe('deleted-exercise tombstones', () => {
  it('deleting an exercise records a tombstone and removes it from the library', () => {
    deleteExerciseFromLibrary('face-pulls');
    expect(getDeletedExerciseIds().has('face-pulls')).toBe(true);
    expect(getExerciseLibrary().some(e => e.id === 'face-pulls')).toBe(false);
  });

  it('a deleted exercise cannot resurrect through a stale library write', () => {
    deleteExerciseFromLibrary('face-pulls');
    // Simulate a stale server/device copy re-adding it via full-replace sync
    saveExerciseLibrary([
      ...getExerciseLibrary(),
      { id: 'face-pulls', name: 'Face Pulls', sets: 3, repLow: 15, repHigh: 20 },
    ]);
    expect(getExerciseLibrary().some(e => e.id === 'face-pulls')).toBe(false);
  });

  it('a deleted exercise cannot resurrect through the default library rebuild', () => {
    addDeletedExerciseIds(['face-pulls']);
    localStorage.removeItem('liftlog_exercises'); // force rebuild from defaults
    expect(getExerciseLibrary().some(e => e.id === 'face-pulls')).toBe(false);
  });

  it('deleting an exercise drops its metadata override', () => {
    saveExerciseMeta('face-pulls', { ...getExerciseMeta('face-pulls'), equipment: 'Machine' });
    expect('face-pulls' in getAllExerciseMeta()).toBe(true);
    deleteExerciseFromLibrary('face-pulls');
    expect('face-pulls' in getAllExerciseMeta()).toBe(false);
  });

  it('a pull merge cannot resurrect a tombstoned exercise', () => {
    deleteExerciseFromLibrary('face-pulls');
    mergeExerciseLibrary([{ id: 'face-pulls', name: 'Face Pulls', sets: 3, repLow: 15, repHigh: 20 }]);
    expect(getExerciseLibrary().some(e => e.id === 'face-pulls')).toBe(false);
  });

  it('explicitly re-adding an exercise lifts its tombstone', () => {
    deleteExerciseFromLibrary('face-pulls');
    addToExerciseLibrary({ id: 'face-pulls', name: 'Face Pulls', sets: 3, repLow: 15, repHigh: 20 });
    expect(getDeletedExerciseIds().has('face-pulls')).toBe(false);
    expect(getExerciseLibrary().some(e => e.id === 'face-pulls')).toBe(true);
  });
});

describe('mergeExerciseLibrary — pull merge keeps local-only exercises', () => {
  const custom = { id: 'jefferson-split-squats-1782324854942', name: 'Jefferson Split Squats', sets: 3, repLow: 8, repHigh: 12 };

  it('keeps a local-only custom exercise when the server copy lacks it', () => {
    addToExerciseLibrary(custom);
    // Server library from before the custom exercise existed
    const serverCopy = getExerciseLibrary().filter(e => e.id !== custom.id);
    mergeExerciseLibrary(serverCopy);
    expect(getExerciseLibrary().some(e => e.id === custom.id)).toBe(true);
  });

  it('lets the incoming copy win per id', () => {
    addToExerciseLibrary(custom);
    mergeExerciseLibrary([{ ...custom, sets: 5 }]);
    expect(getExerciseLibrary().find(e => e.id === custom.id)?.sets).toBe(5);
  });

  it('adds server-only exercises', () => {
    mergeExerciseLibrary([custom]);
    expect(getExerciseLibrary().some(e => e.id === custom.id)).toBe(true);
  });
});

describe('ensureProgramExercisesInLibrary — repairs a gutted library', () => {
  it('rebuilds a missing library entry from the program slot', () => {
    const program: WorkoutDay[] = [{
      id: 1, label: 'Day 1', muscleGroups: 'Legs',
      exercises: [{ id: 'jefferson-split-squats-1782324854942', name: 'Jefferson Split Squats', sets: 3, repLow: 8, repHigh: 12 }],
    }];
    ensureProgramExercisesInLibrary(program);
    const entry = getExerciseLibrary().find(e => e.id === 'jefferson-split-squats-1782324854942');
    expect(entry?.name).toBe('Jefferson Split Squats');
  });

  it('does not resurrect a tombstoned exercise', () => {
    addDeletedExerciseIds(['gone-lift-1782324854942']);
    ensureProgramExercisesInLibrary([{
      id: 1, label: 'Day 1', muscleGroups: 'Legs',
      exercises: [{ id: 'gone-lift-1782324854942', name: 'Gone Lift', sets: 3, repLow: 8, repHigh: 12 }],
    }]);
    expect(getExerciseLibrary().some(e => e.id === 'gone-lift-1782324854942')).toBe(false);
  });
});

describe('getExerciseName — orphaned timestamped ids', () => {
  it('humanizes an id whose library entry was lost instead of showing the raw id', () => {
    expect(getExerciseName('jefferson-split-squats-1782324854942')).toBe('Jefferson Split Squats');
    expect(getExerciseName('dead-bugs-1782325691122')).toBe('Dead Bugs');
  });

  it('still prefers catalog and library names', () => {
    expect(getExerciseName('face-pulls')).toBe('Face Pulls');
    addToExerciseLibrary({ id: 'my-lift-1782324854942', name: 'My Fancy Lift', sets: 3, repLow: 8, repHigh: 12 });
    expect(getExerciseName('my-lift-1782324854942')).toBe('My Fancy Lift');
  });
});

describe('findExerciseByName', () => {
  it('matches a library exercise regardless of casing, punctuation and spacing', () => {
    const hit = findExerciseByName('  bench   press?? ');
    // No "bench press" in the default catalog — seed one as a custom entry
    expect(hit).toBeNull();
    addToExerciseLibrary({ id: 'bench-press-1700000000000', name: 'Bench Press', sets: 3, repLow: 8, repHigh: 12 });
    expect(findExerciseByName('BENCH press!')?.id).toBe('bench-press-1700000000000');
  });

  it('matches catalog exercises by name or id slug', () => {
    expect(findExerciseByName('Face Pulls')?.id).toBe('face-pulls');
    expect(findExerciseByName('face-pulls')?.id).toBe('face-pulls');
  });

  it('prefers the library entry (the id history is logged under) over the catalog', () => {
    // A custom duplicate of a catalog exercise shadows it by name
    addToExerciseLibrary({ id: 'face-pulls-1700000000001', name: 'Face  Pulls', sets: 4, repLow: 12, repHigh: 15 });
    // Library still contains the canonical face-pulls entry, which sorts first
    expect(findExerciseByName('Face Pulls')?.id).toBe('face-pulls');
  });

  it('returns null for unknown names and blank input', () => {
    expect(findExerciseByName('Jefferson Deficit Zercher Squat')).toBeNull();
    expect(findExerciseByName('   ')).toBeNull();
  });
});
