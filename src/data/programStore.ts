import { EXERCISES, EXERCISE_MAP, catalogDefFor, deleteExerciseMeta } from './exercises';
import { LEGACY_ID_MAP, canonicalizeId } from './legacyIds';
import { type Exercise, type LibraryExercise, type WorkoutDay } from './program';

const PROGRAM_KEY  = 'liftlog_program';
const PROGRAM_CLOCK_KEY = 'liftlog_program_updated';
const LIBRARY_KEY  = 'liftlog_exercises';
const DELETED_KEY  = 'liftlog_deleted_exercises';
const RESTORED_KEY = 'liftlog_restored_exercises';
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

/**
 * Save the program and stamp its clock. Every local edit stamps `now`; a sync
 * pull adopting the server's copy passes the server's clock instead, so the
 * two devices agree on how new the document is. Sync compares clocks on both
 * ends before writing — the program used to be clock-less, and a background
 * pull landing after a day edit silently reverted it (audit H4).
 */
export function saveStoredProgram(program: WorkoutDay[], now = Date.now()): void {
  localStorage.setItem(PROGRAM_KEY, JSON.stringify(program));
  localStorage.setItem(PROGRAM_CLOCK_KEY, String(now));
}

/** Clock of the last program edit on this device; 0 when never stamped. */
export function getProgramUpdatedAt(): number {
  const n = Number(localStorage.getItem(PROGRAM_CLOCK_KEY) ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Drops the stored program entirely (account switch) — the next read returns
// the blank slate until the incoming account's sync pull restores theirs.
export function clearStoredProgram(): void {
  localStorage.removeItem(PROGRAM_KEY);
  localStorage.removeItem(PROGRAM_CLOCK_KEY);
}

// Account switch: the exercise library and its tombstones are user-owned under
// the ownership model — they must not leak into (or delete from) the next
// account. The incoming account's sync pull restores theirs.
export function clearExerciseLibraryData(): void {
  localStorage.removeItem(LIBRARY_KEY);
  localStorage.removeItem(DELETED_KEY);
  localStorage.removeItem(RESTORED_KEY);
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

// ── Restored exercises ───────────────────────────────────────────────────────
// Lifting a tombstone locally is not enough: the server keeps the user's
// tombstones forever (so no stale device can resurrect a deletion), and the
// next pull would simply hand the tombstone back. A restore therefore has to
// be told to the server explicitly. Restored ids are remembered here until a
// pull confirms the server no longer reports them deleted; meanwhile a pull
// never re-applies a tombstone this device knowingly lifted.

export function getRestoredExerciseIds(): Set<string> {
  try {
    const raw = localStorage.getItem(RESTORED_KEY);
    return new Set(raw ? JSON.parse(raw) as string[] : []);
  } catch {
    return new Set();
  }
}

function saveRestoredExerciseIds(ids: Set<string>): void {
  if (ids.size === 0) localStorage.removeItem(RESTORED_KEY);
  else localStorage.setItem(RESTORED_KEY, JSON.stringify([...ids]));
}

/** Lift tombstones: the exercises are usable again and the server is told. */
export function liftExerciseTombstones(ids: string[]): void {
  const deleted = getDeletedExerciseIds();
  const lifted = ids.filter(id => deleted.delete(id));
  if (lifted.length === 0) return;
  saveDeletedExerciseIds(deleted);
  const restored = getRestoredExerciseIds();
  for (const id of lifted) restored.add(id);
  saveRestoredExerciseIds(restored);
}

/** A pull confirmed the server dropped these tombstones — nothing left to tell it. */
export function clearRestoredExerciseIds(ids: Iterable<string>): void {
  const restored = getRestoredExerciseIds();
  let changed = false;
  for (const id of ids) changed = restored.delete(id) || changed;
  if (changed) saveRestoredExerciseIds(restored);
}

// ── Exercise library ─────────────────────────────────────────────────────────

// The library is movement identity only. It used to seed sets/reps from the
// hardcoded PROGRAM, falling back to 3 × 8–12 for anything PROGRAM didn't list —
// which is how a conventional deadlift ended up prescribed like a cable row.
// Dosage now comes from data/dosage.ts at the point of use.
function buildDefaultLibrary(): LibraryExercise[] {
  return EXERCISES.map(def => ({ id: def.id, name: def.name }));
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

export function getExerciseLibrary(): LibraryExercise[] {
  migrateLibraryIfNeeded();
  const deleted = getDeletedExerciseIds();
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (raw) return (JSON.parse(raw) as LibraryExercise[]).filter(e => !deleted.has(e.id));
  } catch { /* fall through */ }
  return buildDefaultLibrary().filter(e => !deleted.has(e.id));
}

export function saveExerciseLibrary(exercises: LibraryExercise[]): void {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(exercises));
}

export function addToExerciseLibrary(exercise: LibraryExercise, now = Date.now()): void {
  // Explicitly re-adding an exercise lifts its tombstone (and tells the server)
  liftExerciseTombstones([exercise.id]);

  const lib = getExerciseLibrary();
  if (!lib.find(e => e.id === exercise.id)) {
    saveExerciseLibrary([...lib, { ...exercise, updatedAt: exercise.updatedAt ?? now }]);
  }
}

// Merge an incoming (server) library into the local one. Per id the newer
// copy wins (an unstamped copy yields to a stamped one; two unstamped copies
// let the incoming one win, as before clocks), and entries that exist ONLY
// locally are kept — they were added on this device and simply haven't pushed
// yet (or a stale device pushed a library from before they existed). A pull
// must never delete a local exercise; only tombstones delete. Returns the
// merged library it saved.
export function mergeExerciseLibrary(incoming: LibraryExercise[]): LibraryExercise[] {
  const deleted = getDeletedExerciseIds();
  const local = getExerciseLibrary();
  const localById = new Map(local.map(e => [e.id, e]));
  const incomingIds = new Set(incoming.map(e => e.id));
  const merged = incoming.map(inc => {
    const loc = localById.get(inc.id);
    return loc && (loc.updatedAt ?? 0) > (inc.updatedAt ?? 0) ? loc : inc;
  });
  const localOnly = local.filter(e => !incomingIds.has(e.id));
  const result = [...merged, ...localOnly].filter(e => !deleted.has(e.id));
  saveExerciseLibrary(result);
  return result;
}

// Repair pass: every exercise the program references must resolve in the
// library, or history/metrics show raw IDs. Rebuilds missing entries from the
// program slot itself (id, name, sets, rep range). Heals libraries that were
// gutted by the old replace-on-pull sync.
export function ensureProgramExercisesInLibrary(program: WorkoutDay[]): void {
  const deleted = getDeletedExerciseIds();
  const lib = getExerciseLibrary();
  const known = new Set(lib.map(e => e.id));
  const missing: LibraryExercise[] = [];
  for (const day of program) {
    for (const ex of day.exercises) {
      if (known.has(ex.id) || deleted.has(ex.id)) continue;
      known.add(ex.id);
      missing.push({ id: ex.id, name: ex.name, updatedAt: Date.now() });
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
export function findExerciseByName(name: string): LibraryExercise | null {
  const slug = slugify(name);
  if (!slug) return null;
  const lib = getExerciseLibrary().find(e => slugify(e.name) === slug);
  if (lib) return lib;
  const def = EXERCISES.find(e => e.id === slug || slugify(e.name) === slug);
  if (def) return { id: def.id, name: def.name };
  return null;
}

export function archiveExercise(id: string, now = Date.now()): void {
  const lib = getExerciseLibrary();
  saveExerciseLibrary(lib.map(e => e.id === id ? { ...e, archived: true, updatedAt: now } : e));
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
