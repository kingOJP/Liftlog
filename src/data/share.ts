import type { Exercise, WorkoutDay } from './program';
import { addToExerciseLibrary, findExerciseByName, generateExerciseId } from './programStore';

// ── Workout sharing ──────────────────────────────────────────────────────────
// A workout day is shared as a QR code containing a URL with the workout
// encoded in the fragment (`/#share=<base64url-json>`): the native phone
// camera opens it, no server storage is involved, and the payload never even
// reaches the server (fragments aren't sent in requests). The payload carries
// the workout's *design* — exercise names, sets, rep ranges — and never
// weights: the recipient's own recommendation engine prescribes weights from
// THEIR training history, so the workout automatically fits their level.
//
// On import, exercise names are resolved against the recipient's library and
// the built-in catalog (findExerciseByName) so a shared "Bench Press" lands on
// the id their history is already logged under; only genuinely unknown
// exercises mint a new id.

/** dayId recorded on sessions logged from a shared workout that was never
 *  added to the program. Never collides with real program day ids (positive). */
export const SHARED_DAY_ID = -1;

const PENDING_KEY = 'liftlog_pending_share';

export interface SharedExercise {
  name: string;
  sets: number;
  repLow: number;
  repHigh: number;
}

export interface SharedWorkout {
  /** the sharer's label for the day, e.g. "Day 2" */
  label: string;
  muscleGroups: string;
  exercises: SharedExercise[];
}

// Compact wire form (short keys, exercises as tuples) to keep the QR small.
interface WirePayload {
  v: 1;
  l: string;
  g: string;
  x: Array<[string, number, number, number]>; // [name, sets, repLow, repHigh]
}

// Standard base64 helpers can't hold arbitrary unicode; go through UTF-8 and
// use the URL-safe alphabet so the payload survives inside a fragment.
function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeWorkoutShare(day: WorkoutDay): string {
  const payload: WirePayload = {
    v: 1,
    l: day.label,
    g: day.muscleGroups,
    x: day.exercises.map(e => [e.name, e.sets, e.repLow, e.repHigh]),
  };
  return toBase64Url(JSON.stringify(payload));
}

export function decodeWorkoutShare(encoded: string): SharedWorkout | null {
  try {
    const p = JSON.parse(fromBase64Url(encoded)) as WirePayload;
    if (p.v !== 1 || typeof p.l !== 'string' || typeof p.g !== 'string' ||
        !Array.isArray(p.x) || p.x.length === 0 || p.x.length > 30) {
      return null;
    }
    const exercises: SharedExercise[] = [];
    for (const row of p.x) {
      if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[0].trim() ||
          typeof row[1] !== 'number' || typeof row[2] !== 'number' ||
          typeof row[3] !== 'number') {
        return null;
      }
      exercises.push({
        name: row[0].trim().slice(0, 80),
        sets: clampInt(row[1], 1, 10),
        repLow: clampInt(row[2], 1, 100),
        repHigh: clampInt(row[3], 1, 100),
      });
    }
    return { label: p.l.slice(0, 60), muscleGroups: p.g.slice(0, 80), exercises };
  } catch {
    return null;
  }
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

export function buildShareUrl(day: WorkoutDay, origin = window.location.origin): string {
  return `${origin}/#share=${encodeWorkoutShare(day)}`;
}

// ── Receiving a share ────────────────────────────────────────────────────────

/**
 * If the current URL carries a share fragment, stash the payload and clean
 * the URL. Stashing (rather than holding it in memory) lets the import
 * survive the OAuth redirect when the recipient isn't signed in yet.
 * Runs on every App mount; idempotent.
 */
export function captureShareFromUrl(): void {
  const m = window.location.hash.match(/^#share=([A-Za-z0-9_-]+)$/);
  if (!m) return;
  // Only keep payloads that decode — a corrupt QR shouldn't wedge the app in
  // an import screen it can't render.
  if (decodeWorkoutShare(m[1])) localStorage.setItem(PENDING_KEY, m[1]);
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

export function getPendingSharedWorkout(): SharedWorkout | null {
  const raw = localStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  const shared = decodeWorkoutShare(raw);
  if (!shared) localStorage.removeItem(PENDING_KEY);
  return shared;
}

export function clearPendingShare(): void {
  localStorage.removeItem(PENDING_KEY);
}

// ── Importing into the recipient's account ───────────────────────────────────

export interface ResolvedSharedExercise {
  exercise: Exercise;
  /** true when the name matched an exercise the recipient already has */
  existing: boolean;
}

/**
 * Resolve shared exercises against the recipient's library/catalog. Pure
 * lookup — nothing is persisted (new ids are minted but only saved by
 * acceptSharedWorkout, so previewing a share writes nothing).
 */
export function resolveSharedExercises(shared: SharedWorkout): ResolvedSharedExercise[] {
  return shared.exercises.map(se => {
    const match = findExerciseByName(se.name);
    if (match) {
      // The slot's programming (sets/rep range) comes from the share; the
      // identity (id + canonical name) from the recipient's own exercise.
      return {
        existing: true,
        exercise: { id: match.id, name: match.name, sets: se.sets, repLow: se.repLow, repHigh: se.repHigh },
      };
    }
    return {
      existing: false,
      exercise: { id: generateExerciseId(se.name), name: se.name, sets: se.sets, repLow: se.repLow, repHigh: se.repHigh },
    };
  });
}

/**
 * Materialize a shared workout as a WorkoutDay owned by the recipient: every
 * exercise joins their library (lifting tombstones; no-op if already there)
 * so history, metrics and metadata editing resolve it.
 */
export function acceptSharedWorkout(shared: SharedWorkout, dayId: number, label?: string): WorkoutDay {
  const resolved = resolveSharedExercises(shared);
  const exercises: Exercise[] = [];
  const seen = new Set<string>();
  for (const r of resolved) {
    if (seen.has(r.exercise.id)) continue; // two shared names resolving to one exercise
    seen.add(r.exercise.id);
    addToExerciseLibrary(r.exercise);
    exercises.push(r.exercise);
  }
  return {
    id: dayId,
    label: label ?? shared.label,
    muscleGroups: shared.muscleGroups,
    exercises,
  };
}
