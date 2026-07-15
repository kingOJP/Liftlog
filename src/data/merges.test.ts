import { describe, it, expect, beforeEach } from 'vitest';
import {
  getExerciseMerges, saveExerciseMerges, resolveMergedId, flattenMerges,
  mergeProgramIds, mergeLibraryIds,
} from './merges';
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
