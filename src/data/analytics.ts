// Shared analytics core for everything that reads workout history.
// One place owns: the training snapshot (a single IndexedDB read), e1RM math,
// per-session set grouping, and muscle-involvement resolution. metrics.ts,
// insights.ts and the views build on these pure helpers, so the heavy lifting
// is testable without a browser database.

import { dumpIDB } from '../db/database';
import type { Session, SetLog } from '../db/database';
import type { MuscleGroup } from './taxonomy';
import { EXERCISES, EXERCISE_MAP, getExerciseMeta } from './exercises';
import { getExerciseLibrary } from './programStore';

// Secondary muscles count as a fraction of a direct ("hard") set
export const SECONDARY_SET_WEIGHT = 0.5;

// ~10–20 hard sets per muscle per week is the commonly cited effective range
// for hypertrophy. Shared by the coach planner, insights, metrics and heatmap.
export const SETS_TARGET_LOW = 10;
export const SETS_TARGET_HIGH = 20;

// ── Training snapshot ─────────────────────────────────────────────────────────

export interface TrainingSnapshot {
  /** Completed sessions, newest first */
  sessions: Session[];
  /** sessionId → its set logs */
  setsBySession: Map<number, SetLog[]>;
}

export function buildSnapshot(sessions: Session[], setLogs: SetLog[]): TrainingSnapshot {
  const completed = sessions
    .filter(s => s.completedAt != null)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  const setsBySession = new Map<number, SetLog[]>();
  for (const log of setLogs) {
    const arr = setsBySession.get(log.sessionId);
    if (arr) arr.push(log);
    else setsBySession.set(log.sessionId, [log]);
  }
  return { sessions: completed, setsBySession };
}

export async function loadTrainingSnapshot(): Promise<TrainingSnapshot> {
  const { sessions, setLogs } = await dumpIDB();
  return buildSnapshot(sessions, setLogs);
}

export function sessionTimestamp(s: Session): number {
  return s.completedAt ?? s.startedAt;
}

// ── Workout duration ──────────────────────────────────────────────────────────
// startedAt is captured when the workout is opened and completedAt is the time
// of the final logged set, so completedAt − startedAt is the session duration.
// Sessions from older builds stamped both at "Finish" (duration ≈ 0) — the
// validity window filters those out, along with left-open-overnight outliers.

const MIN_VALID_DURATION_MS = 10 * 60_000;       // anything shorter is a data artifact
const MAX_VALID_DURATION_MS = 4 * 3_600_000;     // anything longer was left running
const DURATION_SAMPLE_SESSIONS = 8;              // recent sessions per day to average

export function sessionDurationMs(s: Session): number | null {
  if (s.completedAt == null) return null;
  const d = s.completedAt - s.startedAt;
  return d >= MIN_VALID_DURATION_MS && d <= MAX_VALID_DURATION_MS ? d : null;
}

// Average workout duration per program day over the most recent valid sessions.
export function avgDurationByDay(snapshot: TrainingSnapshot): Map<number, number> {
  const byDay = new Map<number, number[]>();
  for (const s of snapshot.sessions) { // newest first
    const d = sessionDurationMs(s);
    if (d == null) continue;
    const arr = byDay.get(s.dayId) ?? [];
    if (arr.length < DURATION_SAMPLE_SESSIONS) {
      arr.push(d);
      byDay.set(s.dayId, arr);
    }
  }
  return new Map(
    [...byDay].map(([dayId, ds]) => [dayId, ds.reduce((a, b) => a + b, 0) / ds.length]),
  );
}

// ── Strength math ─────────────────────────────────────────────────────────────

// Epley one-rep-max estimate — the formula Strong/Hevy and most lifting apps use
export function epley1RM(weight: number, reps: number): number {
  return weight * (1 + reps / 30);
}

export interface E1rmPoint {
  ts: number;
  value: number;
}

// Best e1RM per exercise per session, as chronological (oldest-first) series.
export function e1rmSeries(snapshot: TrainingSnapshot): Map<string, E1rmPoint[]> {
  const series = new Map<string, E1rmPoint[]>();
  for (const session of snapshot.sessions) {
    const logs = snapshot.setsBySession.get(session.id!) ?? [];
    if (logs.length === 0) continue;
    const ts = sessionTimestamp(session);

    const bestPerExercise = new Map<string, number>();
    for (const s of logs) {
      const e1rm = epley1RM(s.weight, s.reps);
      if (e1rm > (bestPerExercise.get(s.exerciseId) ?? 0)) {
        bestPerExercise.set(s.exerciseId, e1rm);
      }
    }
    for (const [exId, value] of bestPerExercise) {
      const arr = series.get(exId);
      if (arr) arr.push({ ts, value });
      else series.set(exId, [{ ts, value }]);
    }
  }
  for (const pts of series.values()) pts.sort((a, b) => a.ts - b.ts);
  return series;
}

// ── Muscle involvement resolution ────────────────────────────────────────────

// Lowercase, strip punctuation, collapse whitespace — for name-based matching
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Build a name → master-def lookup so custom exercise IDs can still resolve
// their muscle involvement by name.
const nameToDef = new Map(EXERCISES.map(d => [normalizeName(d.name), d]));

export interface MuscleInvolvement {
  muscle: MuscleGroup;
  weight: number; // 1 for primary, SECONDARY_SET_WEIGHT for secondary
}

// Every muscle an exercise trains, with its fractional set weighting.
// Precedence: user override (getExerciseMeta) → master list → name match.
export function musclesForExercise(id: string): MuscleInvolvement[] {
  const meta = getExerciseMeta(id);
  let primary = meta.primaryMuscle;
  let secondaries: (MuscleGroup | null)[] = [
    meta.secondaryMuscle1, meta.secondaryMuscle2, meta.secondaryMuscle3,
  ];

  // Custom IDs with no override fall back to a name match against the master list
  if (!primary && !EXERCISE_MAP.has(id)) {
    const libName = getExerciseLibrary().find(e => e.id === id)?.name;
    const def = libName ? nameToDef.get(normalizeName(libName)) : undefined;
    if (def) {
      primary = def.primaryMuscle;
      secondaries = [...def.secondaryMuscles];
    }
  }

  const out: MuscleInvolvement[] = [];
  if (primary) out.push({ muscle: primary, weight: 1 });
  for (const s of secondaries) if (s) out.push({ muscle: s, weight: SECONDARY_SET_WEIGHT });
  return out;
}

export function primaryMuscleFor(id: string): MuscleGroup | null {
  return musclesForExercise(id).find(m => m.weight === 1)?.muscle ?? null;
}

// ── Muscle set accumulation ───────────────────────────────────────────────────
// THE set-counting model, shared by metrics, insights, the coach planner and
// the heatmap so every surface reports the same number: each logged set counts
// 1 toward its exercise's primary muscle and SECONDARY_SET_WEIGHT toward each
// secondary. Sets of an exercise with no primary muscle are "unmapped" — they
// surface as the "Other" bucket / unclassified warning instead of silently
// skewing a muscle's total.

export interface MuscleSetTotals {
  /** fractional hard sets per muscle across the included sessions */
  totals: Map<MuscleGroup, number>;
  /** whole sets belonging to exercises with no primary muscle */
  unmappedSets: number;
  unmappedExerciseIds: Set<string>;
}

export function muscleSetTotals(
  snapshot: TrainingSnapshot,
  include: (session: Session) => boolean = () => true,
): MuscleSetTotals {
  const totals = new Map<MuscleGroup, number>();
  let unmappedSets = 0;
  const unmappedExerciseIds = new Set<string>();
  const involvementCache = new Map<string, MuscleInvolvement[]>();

  for (const session of snapshot.sessions) {
    if (!include(session)) continue;
    for (const log of snapshot.setsBySession.get(session.id!) ?? []) {
      let involvement = involvementCache.get(log.exerciseId);
      if (!involvement) {
        involvement = musclesForExercise(log.exerciseId);
        involvementCache.set(log.exerciseId, involvement);
      }
      if (!involvement.some(m => m.weight === 1)) {
        unmappedSets++;
        unmappedExerciseIds.add(log.exerciseId);
        continue;
      }
      for (const { muscle, weight } of involvement) {
        totals.set(muscle, (totals.get(muscle) ?? 0) + weight);
      }
    }
  }
  return { totals, unmappedSets, unmappedExerciseIds };
}
