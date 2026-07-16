import { EXERCISES, EXERCISE_MAP, catalogDefFor, deleteExerciseMeta } from './exercises';
import { LEGACY_ID_MAP, canonicalizeId } from './legacyIds';
import { PROGRAM, type Exercise, type WorkoutDay } from './program';

const PROGRAM_KEY  = 'liftlog_program';
const LIBRARY_KEY  = 'liftlog_exercises';
const DELETED_KEY  = 'liftlog_deleted_exercises';
const MIGRATION_V2 = 'liftlog_library_v2';
const MIGRATION_V3 = 'liftlog_library_v3';

// IDs that existed in old builds with -d1/-d2/-d4 suffixes; now unified
const STALE_IDS = new Set(Object.keys(LEGACY_ID_MAP));

// ── Program ─────────────────────────────────────────────────────────────────

export function getStoredProgram(): WorkoutDay[] {
  let stored: WorkoutDay[] | null = null;
  try {
    const raw = localStorage.getItem(PROGRAM_KEY);
    if (raw) stored = JSON.parse(raw) as WorkoutDay[];
  } catch { /* corrupt data — fall through */ }

  // New accounts start with a blank slate — no pre-populated workouts. Their
  // first program comes from the plan wizard (or a sync pull on an existing
  // account's new device). PROGRAM in program.ts is only a library seed now.
  if (stored == null) return [];

  // A stored program from an old build may still reference legacy -d1/-d2/-d4
  // exercise IDs. Canonicalize them on read (and persist the fix) so newly
  // logged workouts share IDs with existing history instead of spawning
  // duplicate, unclassified exercises.
  const { program, changed } = canonicalizeProgram(stored);
  if (changed) saveStoredProgram(program);
  return program;
}

// Remaps legacy exercise IDs (and their display names) to canonical ones,
// dropping any duplicate an exercise would collapse into within the same day.
function canonicalizeProgram(program: WorkoutDay[]): { program: WorkoutDay[]; changed: boolean } {
  let changed = false;
  const next = program.map(day => {
    const seen = new Set<string>();
    const exercises: Exercise[] = [];
    for (const ex of day.exercises) {
      const id = canonicalizeId(ex.id);
      if (id !== ex.id) changed = true;
      if (seen.has(id)) { changed = true; continue; } // remap collided with a sibling — merge
      seen.add(id);
      exercises.push(id === ex.id ? ex : { ...ex, id, name: EXERCISE_MAP.get(id)?.name ?? ex.name });
    }
    return { ...day, exercises };
  });
  return { program: next, changed };
}

export function saveStoredProgram(program: WorkoutDay[]): void {
  localStorage.setItem(PROGRAM_KEY, JSON.stringify(program));
}

// Drops the stored program entirely (account switch) — the next read returns
// the blank slate until the incoming account's sync pull restores theirs.
export function clearStoredProgram(): void {
  localStorage.removeItem(PROGRAM_KEY);
}

// Account switch: the exercise library and its tombstones are user-owned under
// the ownership model — they must not leak into (or delete from) the next
// account. The incoming account's sync pull restores theirs.
export function clearExerciseLibraryData(): void {
  localStorage.removeItem(LIBRARY_KEY);
  localStorage.removeItem(DELETED_KEY);
}

// ── Deleted-exercise tombstones ──────────────────────────────────────────────
// A deleted exercise must STAY deleted: the library used to resurrect through
// sync (a stale server/device copy re-adding it) and through the default
// library rebuild. Tombstones are per-user, synced, filtered on every read.

export function getDeletedExerciseIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_KEY);
    return new Set(raw ? JSON.parse(raw) as string[] : []);
  } catch {
    return new Set();
  }
}

function saveDeletedExerciseIds(ids: Set<string>): void {
  localStorage.setItem(DELETED_KEY, JSON.stringify([...ids]));
}

export function addDeletedExerciseIds(ids: string[]): void {
  if (ids.length === 0) return;
  const merged = getDeletedExerciseIds();
  for (const id of ids) merged.add(id);
  saveDeletedExerciseIds(merged);
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
  const deleted = getDeletedExerciseIds();
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (raw) return (JSON.parse(raw) as Exercise[]).filter(e => !deleted.has(e.id));
  } catch { /* fall through */ }
  return buildDefaultLibrary().filter(e => !deleted.has(e.id));
}

export function saveExerciseLibrary(exercises: Exercise[]): void {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(exercises));
}

export function addToExerciseLibrary(exercise: Exercise): void {
  // Explicitly re-adding an exercise lifts its tombstone
  const deleted = getDeletedExerciseIds();
  if (deleted.delete(exercise.id)) saveDeletedExerciseIds(deleted);

  const lib = getExerciseLibrary();
  if (!lib.find(e => e.id === exercise.id)) {
    saveExerciseLibrary([...lib, exercise]);
  }
}

// Merge an incoming (server) library into the local one. Per-id the incoming
// copy wins, but entries that exist ONLY locally are kept — they were added on
// this device and simply haven't pushed yet (or a stale device pushed a library
// from before they existed). A pull must never delete a local exercise; only
// tombstones delete. Returns the merged library it saved.
export function mergeExerciseLibrary(incoming: Exercise[]): Exercise[] {
  const deleted = getDeletedExerciseIds();
  const incomingIds = new Set(incoming.map(e => e.id));
  const localOnly = getExerciseLibrary().filter(e => !incomingIds.has(e.id));
  const merged = [...incoming, ...localOnly].filter(e => !deleted.has(e.id));
  saveExerciseLibrary(merged);
  return merged;
}

// Repair pass: every exercise the program references must resolve in the
// library, or history/metrics show raw IDs. Rebuilds missing entries from the
// program slot itself (id, name, sets, rep range). Heals libraries that were
// gutted by the old replace-on-pull sync.
export function ensureProgramExercisesInLibrary(program: WorkoutDay[]): void {
  const deleted = getDeletedExerciseIds();
  const lib = getExerciseLibrary();
  const known = new Set(lib.map(e => e.id));
  const missing: Exercise[] = [];
  for (const day of program) {
    for (const ex of day.exercises) {
      if (known.has(ex.id) || deleted.has(ex.id)) continue;
      known.add(ex.id);
      missing.push({ id: ex.id, name: ex.name, sets: ex.sets, repLow: ex.repLow, repHigh: ex.repHigh });
    }
  }
  if (missing.length > 0) saveExerciseLibrary([...lib, ...missing]);
}

export function getExerciseName(id: string): string {
  // Master list first (canonical, always up to date), then the library (custom
  // exercises added via DayEditView), then the catalog namesake of a timestamped
  // custom id (back-extensions-1782… → "Back Extensions").
  return EXERCISE_MAP.get(id)?.name
    ?? getExerciseLibrary().find(e => e.id === id)?.name
    ?? catalogDefFor(id)?.name
    ?? humanizeExerciseId(id);
}

// Last-resort display name for an orphaned id (a custom exercise whose library
// entry was lost): strip the Date.now() stamp and title-case the slug, so
// "jefferson-split-squats-1782324854942" renders as "Jefferson Split Squats"
// instead of the raw id.
function humanizeExerciseId(id: string): string {
  const slug = id.replace(/-\d{10,}$/, '');
  return slug
    .split('-')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || id;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function generateExerciseId(name: string): string {
  return `${slugify(name)}-${Date.now()}`;
}

// Resolve a typed exercise name to an existing exercise so "create" never
// mints a duplicate identity for something that already exists. Matching is
// by slug ("Bench  Press!" ≡ "bench press"), library first (the id the user's
// history is logged under wins), then the built-in catalog — a catalog match
// also revives a tombstoned entry once it's explicitly re-added.
export function findExerciseByName(name: string): Exercise | null {
  const slug = slugify(name);
  if (!slug) return null;
  const lib = getExerciseLibrary().find(e => slugify(e.name) === slug);
  if (lib) return lib;
  const def = EXERCISES.find(e => e.id === slug || slugify(e.name) === slug);
  if (def) {
    return { id: def.id, name: def.name, sets: 3, repLow: 8, repHigh: 12 };
  }
  return null;
}

export function archiveExercise(id: string): void {
  const lib = getExerciseLibrary();
  saveExerciseLibrary(lib.map(e => e.id === id ? { ...e, archived: true } : e));
}

export function deleteExerciseFromLibrary(id: string): void {
  addDeletedExerciseIds([id]);
  saveExerciseLibrary(getExerciseLibrary().filter(e => e.id !== id));
  deleteExerciseMeta(id);
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
