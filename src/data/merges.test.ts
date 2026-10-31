import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  getExerciseMerges, saveExerciseMerges, resolveMergedId, flattenMerges,
  mergeProgramIds, mergeLibraryIds, applyExerciseMerges,
} from './merges';
import {
  addToExerciseLibrary, deleteExerciseFromLibrary, getExerciseLibrary, getDeletedExerciseIds,
  getRestoredExerciseIds, saveStoredProgram, getStoredProgram,
} from './programStore';
import { getExerciseMeta, saveExerciseMeta } from './exercises';
import { clearIDB, createSession, addSetLog, dumpIDB } from '../db/database';
import type { MergeMap } from './merges';
import type { Exercise, WorkoutDay } from './program';

beforeEach(() => localStorage.clear());

const nameFor = (id: string) => `Name(${id})`;

describe('merge map storage', () => {
  it('round-trips and survives corrupt data', () => {
    saveExerciseMerges({ a: 'b' });
    expect(getExerciseMerges()).toEqual({ a: 'b' });
    localStorage.setItem('liftlog_exercise_merges', '{broken');
    expect(getExerciseMerges()).toEqual({});
  });

  it('reports whether the stored map actually changed', () => {
    expect(saveExerciseMerges({ a: 'b' })).toBe(true);
    expect(saveExerciseMerges({ a: 'b' })).toBe(false);
    expect(saveExerciseMerges({ a: 'c' })).toBe(true);
  });
});

describe('applyExerciseMerges — the whole device', () => {
  beforeEach(async () => { await clearIDB(); });

  const CUSTOM = 'incline-dumbbell-press-1700000000000';

  // Audit H3: "deleted the catalog exercise, made my own" is the likeliest
  // duplicate an admin merges. The survivor was tombstoned, so the remapped
  // program slot pointed at an id every read filtered out.
  it('revives a tombstoned survivor when the merge moves data onto it', async () => {
    deleteExerciseFromLibrary('incline-dumbbell-press');
    addToExerciseLibrary({ id: CUSTOM, name: 'Incline DB Press' });
    saveStoredProgram([{ id: 1, label: 'Push', muscleGroups: 'Chest',
      exercises: [{ id: CUSTOM, name: 'Incline DB Press', sets: 3, repLow: 8, repHigh: 12 }] }]);
    const sid = await createSession(1, 1, 1_000);
    await addSetLog(sid, CUSTOM, 1, 50, 10, 0);

    saveExerciseMerges({ [CUSTOM]: 'incline-dumbbell-press' });
    expect(await applyExerciseMerges()).toBe(true);

    expect(getDeletedExerciseIds().has('incline-dumbbell-press')).toBe(false);
    expect(getRestoredExerciseIds().has('incline-dumbbell-press')).toBe(true);
    expect(getStoredProgram()[0].exercises[0].id).toBe('incline-dumbbell-press');
    expect(getExerciseLibrary().some(e => e.id === 'incline-dumbbell-press')).toBe(true);
    expect((await dumpIDB()).setLogs[0].exerciseId).toBe('incline-dumbbell-press');
  });

  it('leaves a tombstone alone when this device holds nothing under the merged id', async () => {
    deleteExerciseFromLibrary('incline-dumbbell-press');
    saveExerciseMerges({ [CUSTOM]: 'incline-dumbbell-press' });
    await applyExerciseMerges();
    expect(getDeletedExerciseIds().has('incline-dumbbell-press')).toBe(true);
  });

  // Audit M12: custom A (classified) merged into custom B (unclassified) came
  // out unclassified — A's override was deleted, B never had one.
  it('carries the merged exercise\'s metadata onto a survivor that has none', async () => {
    const a = 'pec-fly-machine-1700000000001';
    const b = 'pec-fly-1700000000002';
    addToExerciseLibrary({ id: a, name: 'Pec Fly Machine' });
    addToExerciseLibrary({ id: b, name: 'Pec Fly' });
    saveExerciseMeta(a, { ...getExerciseMeta(a), primaryMuscle: 'Chest', equipment: 'Machine' });

    saveExerciseMerges({ [a]: b });
    await applyExerciseMerges();
    expect(getExerciseMeta(b)).toMatchObject({ primaryMuscle: 'Chest', equipment: 'Machine' });
    expect(getExerciseLibrary().some(e => e.id === a)).toBe(false);
  });

  it('keeps the survivor\'s own metadata when it has some', async () => {
    const a = 'pec-fly-machine-1700000000001';
    const b = 'pec-fly-1700000000002';
    addToExerciseLibrary({ id: a, name: 'Pec Fly Machine' });
    addToExerciseLibrary({ id: b, name: 'Pec Fly' });
    saveExerciseMeta(a, { ...getExerciseMeta(a), primaryMuscle: 'Chest' });
    saveExerciseMeta(b, { ...getExerciseMeta(b), primaryMuscle: 'Delts' });

    saveExerciseMerges({ [a]: b });
    await applyExerciseMerges();
    expect(getExerciseMeta(b).primaryMuscle).toBe('Delts');
  });
});

describe('resolveMergedId / flattenMerges', () => {
  it('resolves chains transitively', () => {
    const map: MergeMap = { a: 'b', b: 'c' };
    expect(resolveMergedId('a', map)).toBe('c');
    expect(resolveMergedId('b', map)).toBe('c');
    expect(resolveMergedId('c', map)).toBe('c');
    expect(flattenMerges(map)).toEqual({ a: 'c', b: 'c' });
  });

  it('is safe against cycles and self-loops', () => {
    expect(resolveMergedId('a', { a: 'b', b: 'a' })).toBe('a'); // stops, no hang
    expect(flattenMerges({ a: 'a' })).toEqual({});
  });
});

const day = (exercises: Exercise[]): WorkoutDay =>
  ({ id: 1, label: 'Day 1', muscleGroups: 'Test', exercises });
const ex = (id: string): Exercise => ({ id, name: id, sets: 3, repLow: 8, repHigh: 12 });

describe('mergeProgramIds', () => {
  it('remaps merged ids and refreshes the display name', () => {
    const { program, changed } = mergeProgramIds([day([ex('old')])], { old: 'new' }, nameFor);
    expect(changed).toBe(true);
    expect(program[0].exercises[0]).toMatchObject({ id: 'new', name: 'Name(new)' });
  });

  it('collapses a remap that collides with a sibling in the same day', () => {
    const { program, changed } = mergeProgramIds(
      [day([ex('keep'), ex('dupe')])], { dupe: 'keep' }, nameFor,
    );
    expect(changed).toBe(true);
    expect(program[0].exercises.map(e => e.id)).toEqual(['keep']);
  });

  it('reports no change for an untouched program', () => {
    const { changed } = mergeProgramIds([day([ex('a')])], { x: 'y' }, nameFor);
    expect(changed).toBe(false);
  });
});

describe('mergeLibraryIds', () => {
  it('drops the merged-from entry when the survivor already exists', () => {
    const { library, changed } = mergeLibraryIds(
      [ex('survivor'), ex('dupe')], { dupe: 'survivor' }, nameFor,
    );
    expect(changed).toBe(true);
    expect(library.map(e => e.id)).toEqual(['survivor']);
  });

  it('renames the entry to the survivor when the survivor is missing', () => {
    const { library } = mergeLibraryIds([ex('dupe')], { dupe: 'survivor' }, nameFor);
    expect(library).toHaveLength(1);
    expect(library[0]).toMatchObject({ id: 'survivor', name: 'Name(survivor)' });
    // Programming carried over from the merged entry
    expect(library[0].sets).toBe(3);
  });

  it('keeps the survivor copy when the merged-from entry appears first', () => {
    const survivor = { ...ex('survivor'), sets: 5 };
    const { library } = mergeLibraryIds([ex('dupe'), survivor], { dupe: 'survivor' }, nameFor);
    expect(library).toHaveLength(1);
    expect(library[0].sets).toBe(5);
  });
});
