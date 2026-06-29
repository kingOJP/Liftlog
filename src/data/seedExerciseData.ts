import {
  getExerciseMuscles, saveExerciseMuscles,
  getExerciseDetails, saveExerciseDetails,
} from '../db/database';
import { EXERCISE_MUSCLES_SEED, EXERCISE_DETAILS_SEED, PRIMARY_MUSCLE_BY_NAME } from './exerciseSeed';
import { getExerciseLibrary } from './programStore';

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Populate IndexedDB muscle/detail records from the static seed for any exercise
// that has no record yet, so the exercise editor, the metrics muscle breakdown,
// and the "missing primary muscle" flag all read the SAME data. Without this the
// editor (which reads IndexedDB) shows "Not set" while metrics silently classify
// the exercise from the in-code seed.
//
// Idempotent and non-destructive: existing records are never overwritten, so it's
// safe to run on every startup. Returns the number of muscle records written.
export async function seedExerciseData(): Promise<number> {
  let written = 0;

  // 1) Canonical seed entries, keyed by built-in exercise id
  for (const m of EXERCISE_MUSCLES_SEED) {
    if (!(await getExerciseMuscles(m.exerciseId))) {
      await saveExerciseMuscles(m);
      written++;
    }
  }
  for (const d of EXERCISE_DETAILS_SEED) {
    if (!(await getExerciseDetails(d.exerciseId))) {
      await saveExerciseDetails(d);
    }
  }

  // 2) Custom exercises (unique timestamped ids) matched by name, so the primary
  //    muscle they're already counted under in metrics also shows in the editor.
  for (const ex of getExerciseLibrary()) {
    const primary = PRIMARY_MUSCLE_BY_NAME[normalizeName(ex.name)];
    if (!primary) continue;
    if (await getExerciseMuscles(ex.id)) continue;
    await saveExerciseMuscles({
      exerciseId: ex.id,
      primaryMuscle: primary,
      secondaryMuscle1: null,
      secondaryMuscle2: null,
      secondaryMuscle3: null,
    });
    written++;
  }

  return written;
}
