import { describe, it, expect, beforeEach } from 'vitest';
import { canonicalizeId } from './legacyIds';
import {
  getStoredProgram, getExerciseLibrary, saveExerciseLibrary,
  deleteExerciseFromLibrary, addToExerciseLibrary,
  getDeletedExerciseIds, addDeletedExerciseIds,
  mergeExerciseLibrary, ensureProgramExercisesInLibrary, getExerciseName,
  findExerciseByName, getRestoredExerciseIds, clearRestoredExerciseIds,
  saveStoredProgram, clearStoredProgram, getProgramUpdatedAt, pickableExercises,
} from './programStore';
import { getAllExerciseMeta, saveExerciseMeta, getExerciseMeta, EXERCISES } from './exercises';
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

  it('re-adding a deleted exercise records a restore for the server, cleared once it agrees', () => {
    deleteExerciseFromLibrary('face-pulls');
    addToExerciseLibrary({ id: 'face-pulls', name: 'Face Pulls' });
    expect(getRestoredExerciseIds()).toEqual(new Set(['face-pulls']));
    clearRestoredExerciseIds(['face-pulls']);
    expect(getRestoredExerciseIds().size).toBe(0);
  });

  it('stamps the program clock on every save and clears it with the program', () => {
    expect(getProgramUpdatedAt()).toBe(0);
    saveStoredProgram([], 4242);
    expect(getProgramUpdatedAt()).toBe(4242);
    clearStoredProgram();
    expect(getProgramUpdatedAt()).toBe(0);
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

  it('lets a newer incoming copy win per id', () => {
    addToExerciseLibrary(custom, 1000);
    mergeExerciseLibrary([{ ...custom, name: 'Renamed elsewhere', updatedAt: 2000 }]);
    expect(getExerciseLibrary().find(e => e.id === custom.id)?.name).toBe('Renamed elsewhere');
  });

  // Audit H4: the library was clock-less, so a pull carrying a stale copy
  // silently undid a rename made on this device.
  it('keeps a local entry that is newer than the incoming copy', () => {
    addToExerciseLibrary({ ...custom, name: 'Renamed here' }, 3000);
    mergeExerciseLibrary([{ ...custom, name: 'Stale server copy', updatedAt: 2000 }]);
    expect(getExerciseLibrary().find(e => e.id === custom.id)?.name).toBe('Renamed here');
  });

  it('lets an incoming copy win over an unstamped local one (pre-clock behaviour)', () => {
    localStorage.setItem('liftlog_exercises', JSON.stringify([custom]));
    mergeExerciseLibrary([{ ...custom, name: 'Server copy' }]);
    expect(getExerciseLibrary().find(e => e.id === custom.id)?.name).toBe('Server copy');
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

describe('pickableExercises', () => {
  it('offers the whole catalog, not just the library, so a newer catalog exercise is reachable', () => {
    localStorage.setItem('liftlog_library_v3', '1'); // skip the seeding migration
    saveExerciseLibrary([{ id: 'bench-press', name: 'Bench Press' }]);
    const ids = new Set(pickableExercises().map(e => e.id));
    for (const def of EXERCISES) expect(ids.has(def.id)).toBe(true);
  });

  it('lets a library entry shadow its catalog namesake, so history keeps one id', () => {
    const rdl = EXERCISES.find(e => e.id === 'romanian-deadlifts')!;
    localStorage.setItem('liftlog_library_v3', '1');
    saveExerciseLibrary([{ id: 'romanian-deadlifts-1782000000000', name: rdl.name }]);
    const matches = pickableExercises().filter(e => e.name === rdl.name);
    expect(matches).toEqual([{ id: 'romanian-deadlifts-1782000000000', name: rdl.name }]);
  });

  it('leaves out archived and tombstoned exercises, and sorts by name', () => {
    saveExerciseLibrary([{ id: 'my-move-1782000000000', name: 'My Move', archived: true }]);
    addDeletedExerciseIds(['romanian-deadlifts']);
    const list = pickableExercises();
    expect(list.some(e => e.id === 'my-move-1782000000000')).toBe(false);
    expect(list.some(e => e.id === 'romanian-deadlifts')).toBe(false);
    const names = list.map(e => e.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
