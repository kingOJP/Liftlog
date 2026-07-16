import { deleteExerciseMeta } from './exercises';
import type { Exercise, WorkoutDay } from './program';
import {
  getExerciseLibrary, saveExerciseLibrary,
  getStoredProgram, saveStoredProgram, getExerciseName,
} from './programStore';
import { remapSetLogExerciseIds } from '../db/database';

// ── Exercise merges ──────────────────────────────────────────────────────────
// An admin can merge one exercise into another ("Incline DB Press-1782…" was a
// duplicate of "Incline Dumbbell Press"): the merge is recorded server-side as
// a from→to id mapping (D1 exercise_merges, audited) and served to every
// client on pull, exactly like the compiled-in LEGACY_ID_MAP but dynamic.
// Each client applies the map to ITS OWN data — set logs (history), the
// program, the library — so all history lands under the surviving id and the
// remap propagates through the normal merge sync. The map itself is
// application-owned: replaced wholesale on every pull, never edited locally.

const MERGES_KEY = 'liftlog_exercise_merges';

/** fromId → toId. May chain (a→b, b→c); resolve transitively. */
export type MergeMap = Record<string, string>;

export function getExerciseMerges(): MergeMap {
  try {
    const raw = localStorage.getItem(MERGES_KEY);
    return raw ? JSON.parse(raw) as MergeMap : {};
  } catch {
    return {};
  }
}

export function saveExerciseMerges(map: MergeMap): void {
  localStorage.setItem(MERGES_KEY, JSON.stringify(map));
}

/** Follow the merge chain to the surviving id (cycle-guarded). */
export function resolveMergedId(id: string, map: MergeMap): string {
  const seen = new Set<string>();
  let cur = id;
  while (map[cur] && map[cur] !== cur && !seen.has(cur)) {
    seen.add(cur);
    cur = map[cur];
  }
  return cur;
}

/**
 * Reduce a (possibly chained) merge map to direct from→final-id entries,
 * dropping self-loops. Every consumer works off this flattened view.
 */
export function flattenMerges(map: MergeMap): MergeMap {
  const flat: MergeMap = {};
  for (const from of Object.keys(map)) {
    const to = resolveMergedId(from, map);
    if (to !== from) flat[from] = to;
  }
  return flat;
}

/**
 * Remap merged-away exercise ids in a program, collapsing a slot into an
 * existing sibling when the remap would duplicate it within the same day.
 * Pure — mirrors programStore's legacy-id canonicalization.
 */
export function mergeProgramIds(
  program: WorkoutDay[],
  flat: MergeMap,
  nameFor: (id: string) => string,
): { program: WorkoutDay[]; changed: boolean } {
  let changed = false;
  const next = program.map(day => {
    const seen = new Set<string>();
    const exercises: Exercise[] = [];
    for (const ex of day.exercises) {
      const id = flat[ex.id] ?? ex.id;
      if (id !== ex.id) changed = true;
      if (seen.has(id)) { changed = true; continue; }
      seen.add(id);
      exercises.push(id === ex.id ? ex : { ...ex, id, name: nameFor(id) });
    }
    return { ...day, exercises };
  });
  return { program: next, changed };
}

/**
 * Remap a library: merged-from entries disappear; the surviving id is ensured
 * present (carrying over the merged entry's sets/rep-range when it wasn't).
 * Pure.
 */
export function mergeLibraryIds(
  library: Exercise[],
  flat: MergeMap,
  nameFor: (id: string) => string,
): { library: Exercise[]; changed: boolean } {
  let changed = false;
  const byId = new Map(library.map(e => [e.id, e]));
  const out: Exercise[] = [];
  const emitted = new Set<string>();
  for (const e of library) {
    const id = flat[e.id] ?? e.id;
    if (emitted.has(id)) { changed = true; continue; }
    emitted.add(id);
    if (id === e.id) { out.push(e); continue; }
    changed = true;
    // Survivor already in the library elsewhere — keep that copy, drop this one
    const survivor = byId.get(id);
    out.push(survivor ?? { ...e, id, name: nameFor(id) });
  }
  return { library: out, changed };
}

/**
 * Apply the stored merge map to everything on this device: set-log history
 * (bumping affected sessions so the remap syncs), the stored program, the
 * exercise library, and metadata overrides for merged-away ids (the
 * survivor's metadata wins). Returns true if anything changed.
 */
export async function applyExerciseMerges(): Promise<boolean> {
  const flat = flattenMerges(getExerciseMerges());
  if (Object.keys(flat).length === 0) return false;

  let changed = (await remapSetLogExerciseIds(flat)) > 0;

  const prog = mergeProgramIds(getStoredProgram(), flat, getExerciseName);
  if (prog.changed) { saveStoredProgram(prog.program); changed = true; }

  const lib = mergeLibraryIds(getExerciseLibrary(), flat, getExerciseName);
  if (lib.changed) { saveExerciseLibrary(lib.library); changed = true; }

  for (const from of Object.keys(flat)) deleteExerciseMeta(from);

  return changed;
}
