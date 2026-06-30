import { EXERCISES, EXERCISE_MAP } from './exercises';
import { PROGRAM, type Exercise, type WorkoutDay } from './program';

const PROGRAM_KEY  = 'liftlog_program';
const LIBRARY_KEY  = 'liftlog_exercises';
const MIGRATION_V2 = 'liftlog_library_v2';
const MIGRATION_V3 = 'liftlog_library_v3';

// IDs that existed in old builds with -d1/-d2/-d4 suffixes; now unified
const STALE_IDS = new Set([
  'cable-lateral-raises-d1',
  'face-pulls-d2',
  'face-pulls-d4',
  'lat-pulldown-d2',
  'cable-pull-down-d2',
  'tricep-pushdowns-d4',
]);

// ── Program ─────────────────────────────────────────────────────────────────

export function getStoredProgram(): WorkoutDay[] {
  try {
    const raw = localStorage.getItem(PROGRAM_KEY);
    if (raw) return JSON.parse(raw) as WorkoutDay[];
  } catch { /* corrupt data — fall through */ }
  return PROGRAM;
}

export function saveStoredProgram(program: WorkoutDay[]): void {
  localStorage.setItem(PROGRAM_KEY, JSON.stringify(program));
}

// ── Exercise library ─────────────────────────────────────────────────────────

function buildDefaultLibrary(): Exercise[] {
  // Derive default sets/reps from PROGRAM where possible, else fall back to generic defaults
  const programDefaults = new Map<string, Pick<Exercise, 'sets' | 'repLow' | 'repHigh'>>();
  for (const day of PROGRAM) {
    for (const ex of day.exercises) {
      if (!programDefaults.has(ex.id)) {
        programDefaults.set(ex.id, { sets: ex.sets, repLow: ex.repLow, repHigh: ex.repHigh });
      }
    }
  }

  return EXERCISES.map(def => {
    const defaults = programDefaults.get(def.id) ?? { sets: 3, repLow: 8, repHigh: 12 };
    return { id: def.id, name: def.name, ...defaults };
  });
}

// One-time migration: remove stale/duplicate IDs and rebuild from master list,
// preserving any custom exercises the user added via DayEditView.
function migrateLibraryIfNeeded(): void {
  if (localStorage.getItem(MIGRATION_V3)) return;

  const existing: Exercise[] = (() => {
    try {
      const raw = localStorage.getItem(LIBRARY_KEY);
      return raw ? JSON.parse(raw) as Exercise[] : [];
    } catch { return []; }
  })();

  const masterIds = new Set(EXERCISES.map(e => e.id));
  const customExercises = existing.filter(e => !masterIds.has(e.id) && !STALE_IDS.has(e.id));

  saveExerciseLibrary([...buildDefaultLibrary(), ...customExercises]);
  localStorage.setItem(MIGRATION_V2, '1');
  localStorage.setItem(MIGRATION_V3, '1');
}

export function getExerciseLibrary(): Exercise[] {
  migrateLibraryIfNeeded();
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (raw) return JSON.parse(raw) as Exercise[];
  } catch { /* fall through */ }
  return buildDefaultLibrary();
}

export function saveExerciseLibrary(exercises: Exercise[]): void {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(exercises));
}

export function addToExerciseLibrary(exercise: Exercise): void {
  const lib = getExerciseLibrary();
  if (!lib.find(e => e.id === exercise.id)) {
    saveExerciseLibrary([...lib, exercise]);
  }
}

export function getExerciseName(id: string): string {
  // Master list first (canonical, always up to date), then fall back to library
  // (covers custom exercises added via DayEditView)
  return EXERCISE_MAP.get(id)?.name ?? getExerciseLibrary().find(e => e.id === id)?.name ?? id;
}

export function generateExerciseId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug}-${Date.now()}`;
}

export function archiveExercise(id: string): void {
  const lib = getExerciseLibrary();
  saveExerciseLibrary(lib.map(e => e.id === id ? { ...e, archived: true } : e));
}

export function deleteExerciseFromLibrary(id: string): void {
  saveExerciseLibrary(getExerciseLibrary().filter(e => e.id !== id));
}

// Removes an exercise from all program days and saves. Returns the updated program.
export function removeExerciseFromProgram(id: string, program: WorkoutDay[]): WorkoutDay[] {
  const updated = program.map(day => ({
    ...day,
    exercises: day.exercises.filter(e => e.id !== id),
  }));
  saveStoredProgram(updated);
  return updated;
}
