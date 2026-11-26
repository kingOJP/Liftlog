// programStore.ts + legacyIds.ts — stored program, library, tombstones.
import { it } from 'vitest';
import { Fixture } from '../harness';
import {
  getStoredProgram, getProgramUpdatedAt, getExerciseLibrary, mergeExerciseLibrary, pickableExercises,
  ensureProgramExercisesInLibrary, getExerciseName, findExerciseByName, generateExerciseId, archiveExercise,
  deleteExerciseFromLibrary, addToExerciseLibrary, liftExerciseTombstones, clearRestoredExerciseIds,
  getDeletedExerciseIds, getRestoredExerciseIds, removeExerciseFromProgram,
} from '../../../src/data/programStore';
import type { LibraryExercise, WorkoutDay } from '../../../src/data/program';

const snapshot = () => {
  const out: Record<string, unknown> = {};
  for (const k of ['liftlog_program', 'liftlog_program_updated', 'liftlog_exercises', 'liftlog_deleted_exercises', 'liftlog_restored_exercises', 'liftlog_library_v3']) {
    const v = localStorage.getItem(k);
    try { out[k] = v == null ? null : JSON.parse(v); } catch { out[k] = v; }
  }
  return out;
};

const legacyProgram: WorkoutDay[] = [
  { id: 1, label: 'Push', muscleGroups: 'Chest', exercises: [
    { id: 'cable-lateral-raises-d1', name: 'Old Name', sets: 3, repLow: 12, repHigh: 15 },
    { id: 'cable-lateral-raises', name: 'Cable Lateral Raises', sets: 2 },
    { id: 'my-thing-1782325116469', name: 'My Thing', sets: 3, technique: 'paused' },
  ] },
  { id: 2, label: 'Pull', muscleGroups: 'Back', exercises: [{ id: 'face-pulls-d4', name: 'FP', sets: 3, main: true }], phases: ['accumulation'] },
];
const customLib: LibraryExercise[] = [
  { id: 'bench-press', name: 'Bench Press', updatedAt: 10 },
  { id: 'my-thing-1782325116469', name: 'My Thing', updatedAt: 20 },
  { id: 'zercher-squat-1782000000000', name: 'Zercher Squat', archived: true, updatedAt: 30 },
  { id: 'face-pulls-d2', name: 'Face Pulls (old)' },
];
const migrated = { liftlog_exercises: customLib, liftlog_library_v3: '1', liftlog_library_v2: '1', liftlog_deleted_exercises: ['squat', 'squat'] };

it('programStore fixture', () => {
  const f = new Fixture('programStore');
  f.record('empty program', 'getStoredProgram', [], () => ({ program: getStoredProgram(), clock: getProgramUpdatedAt(), after: snapshot() }));
  f.record('legacy program canonicalized', 'getStoredProgram', [], () => ({ program: getStoredProgram(), clock: getProgramUpdatedAt(), after: snapshot() }),
    { storage: { liftlog_program: legacyProgram, liftlog_program_updated: '123' } });
  f.record('corrupt clock', 'getStoredProgram', [], () => ({ program: getStoredProgram(), clock: getProgramUpdatedAt(), after: snapshot() }),
    { storage: { liftlog_program: [], liftlog_program_updated: 'nope' } });
  f.record('library migrate fresh', 'library', [], () => ({ lib: getExerciseLibrary(), deleted: [...getDeletedExerciseIds()], after: snapshot() }));
  f.record('library migrate legacy customs', 'library', [], () => ({ lib: getExerciseLibrary(), deleted: [...getDeletedExerciseIds()], after: snapshot() }),
    { storage: { liftlog_exercises: customLib, liftlog_deleted_exercises: ['bench-press'] } });
  f.record('library migrated', 'library', [], () => ({ lib: getExerciseLibrary(), deleted: [...getDeletedExerciseIds()], after: snapshot() }), { storage: migrated });
  const incoming: LibraryExercise[] = [
    { id: 'bench-press', name: 'Bench (server)', updatedAt: 5 }, { id: 'my-thing-1782325116469', name: 'Server Thing', updatedAt: 25 },
    { id: 'squat', name: 'Squat' }, { id: 'new-one', name: 'New One', updatedAt: 1 },
  ];
  f.record('merge library', 'mergeExerciseLibrary', [incoming], (inc: LibraryExercise[]) => ({ result: mergeExerciseLibrary(inc), after: snapshot() }), { storage: migrated });
  f.record('pickable', 'pickableExercises', [], pickableExercises, { storage: migrated });
  f.record('ensure program in library', 'ensureProgramExercisesInLibrary', [legacyProgram], (p: WorkoutDay[]) => { ensureProgramExercisesInLibrary(p); return snapshot(); }, { storage: migrated });
  for (const id of ['bench-press', 'my-thing-1782325116469', 'back-extensions-1782325116469', 'some-custom-lift-1782325116469', 'x', '-1782325116469', 'zercher-squat-1782000000000']) {
    f.record(`name ${id}`, 'getExerciseName', [id], getExerciseName, { storage: migrated });
  }
  for (const n of ['Bench Press', 'my thing', 'BACK  extensions!', '???', 'Unknown Lift', 'squat']) {
    f.record(`find ${n}`, 'findExerciseByName', [n], findExerciseByName, { storage: migrated });
  }
  f.record('generate id', 'generateExerciseId', ['Zercher Squat (heavy)'], generateExerciseId);
  f.record('archive', 'archiveExercise', ['bench-press', 77], (id: string, now: number) => { archiveExercise(id, now); return snapshot(); }, { storage: migrated });
  f.record('delete from library', 'deleteExerciseFromLibrary', ['my-thing-1782325116469'], (id: string) => { deleteExerciseFromLibrary(id); return snapshot(); }, { storage: migrated });
  f.record('re-add lifts tombstone', 'addToExerciseLibrary', [{ id: 'squat', name: 'Squat' }, 88], (e: LibraryExercise, now: number) => {
    addToExerciseLibrary(e, now); const a = snapshot(); clearRestoredExerciseIds(['squat']); return { a, b: snapshot(), restored: [...getRestoredExerciseIds()] };
  }, { storage: migrated });
  f.record('lift none', 'liftExerciseTombstones', [['nope']], (ids: string[]) => { liftExerciseTombstones(ids); return snapshot(); }, { storage: migrated });
  f.record('remove from program', 'removeExerciseFromProgram', ['face-pulls', legacyProgram], (id: string, p: WorkoutDay[]) => ({ out: removeExerciseFromProgram(id, p), after: snapshot() }));
  f.write();
});
