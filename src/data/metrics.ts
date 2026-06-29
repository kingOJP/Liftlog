import { dumpIDB } from '../db/database';
import { getWeekNumber } from './program';
import { getExerciseName } from './programStore';
import { EXERCISE_MUSCLES_SEED } from './exerciseSeed';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MetricsSummary {
  totalWorkouts: number;
  totalVolume: number;
  thisWeekVolume: number;
  lastWeekVolume: number;
  deltaPct: number | null; // this week vs last week, null if no prior data
}

export interface WeeklyVolumePoint {
  week: number;
  label: string;
  value: number;
}

export interface SeriesPoint {
  label: string;
  value: number;
}

export interface ExerciseSeries {
  exerciseId: string;
  name: string;
  points: SeriesPoint[];
}

export interface MuscleSets {
  muscle: string;
  sets: number;
}

export interface Metrics {
  hasData: boolean;
  summary: MetricsSummary;
  weeklyVolume: WeeklyVolumePoint[];
  exercises: ExerciseSeries[];     // most-tracked first (for the default selection)
  muscleSets: MuscleSets[];
  muscleWeekLabel: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Epley one-rep-max estimate — the formula Strong/Hevy and most lifting apps use
function epley1RM(weight: number, reps: number): number {
  return Math.round(weight * (1 + reps / 30));
}

function shortDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
}

// Static map of exerciseId → primary muscle, from the seed. User-set metadata
// (from IndexedDB) is overlaid on top so custom exercises are still counted.
function buildMuscleMap(
  overrides: { exerciseId: string; primaryMuscle: string | null }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of EXERCISE_MUSCLES_SEED) {
    if (m.primaryMuscle) map.set(m.exerciseId, m.primaryMuscle);
  }
  for (const m of overrides) {
    if (m.primaryMuscle) map.set(m.exerciseId, m.primaryMuscle);
  }
  return map;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function computeMetrics(): Promise<Metrics> {
  const { sessions, setLogs, exerciseMuscles } = await dumpIDB();

  const completed = sessions.filter(s => s.completedAt != null);

  const empty: Metrics = {
    hasData: false,
    summary: { totalWorkouts: 0, totalVolume: 0, thisWeekVolume: 0, lastWeekVolume: 0, deltaPct: null },
    weeklyVolume: [],
    exercises: [],
    muscleSets: [],
    muscleWeekLabel: '',
  };
  if (completed.length === 0 || setLogs.length === 0) return empty;

  // Group set logs by session for fast lookup
  const setsBySession = new Map<number, typeof setLogs>();
  for (const log of setLogs) {
    const arr = setsBySession.get(log.sessionId);
    if (arr) arr.push(log);
    else setsBySession.set(log.sessionId, [log]);
  }

  const muscleMap = buildMuscleMap(exerciseMuscles);

  // ── Weekly volume + totals ──
  const weekBuckets = new Map<number, { value: number; latestTs: number }>();
  let totalVolume = 0;

  // ── Per-exercise est. 1RM time series ──
  // exerciseId → array of { ts, e1rm } (one best-set point per session)
  const e1rmByExercise = new Map<string, { ts: number; value: number }[]>();

  for (const session of completed) {
    const logs = setsBySession.get(session.id!) ?? [];
    if (logs.length === 0) continue;
    const ts = session.completedAt ?? session.startedAt;

    let sessionVolume = 0;
    const bestPerExercise = new Map<string, number>();

    for (const s of logs) {
      sessionVolume += s.weight * s.reps;
      const e1rm = epley1RM(s.weight, s.reps);
      const prev = bestPerExercise.get(s.exerciseId) ?? 0;
      if (e1rm > prev) bestPerExercise.set(s.exerciseId, e1rm);
    }

    totalVolume += sessionVolume;

    const bucket = weekBuckets.get(session.weekNumber);
    if (bucket) {
      bucket.value += sessionVolume;
      if (ts > bucket.latestTs) bucket.latestTs = ts;
    } else {
      weekBuckets.set(session.weekNumber, { value: sessionVolume, latestTs: ts });
    }

    for (const [exId, e1rm] of bestPerExercise) {
      const arr = e1rmByExercise.get(exId);
      if (arr) arr.push({ ts, value: e1rm });
      else e1rmByExercise.set(exId, [{ ts, value: e1rm }]);
    }
  }

  // Weekly volume — sorted ascending, last 8 weeks
  const weeklyVolume: WeeklyVolumePoint[] = [...weekBuckets.entries()]
    .map(([week, b]) => ({ week, label: shortDate(b.latestTs), value: Math.round(b.value) }))
    .sort((a, b) => a.week - b.week)
    .slice(-8);

  // Summary — this/last program week
  const currentWeek = getWeekNumber();
  const thisWeekVolume = Math.round(weekBuckets.get(currentWeek)?.value ?? 0);
  const lastWeekVolume = Math.round(weekBuckets.get(currentWeek - 1)?.value ?? 0);
  const deltaPct = lastWeekVolume > 0
    ? Math.round(((thisWeekVolume - lastWeekVolume) / lastWeekVolume) * 100)
    : null;

  // Exercises — chronological points, most-tracked first
  const exercises: ExerciseSeries[] = [...e1rmByExercise.entries()]
    .map(([exerciseId, pts]) => ({
      exerciseId,
      name: getExerciseName(exerciseId),
      points: pts
        .sort((a, b) => a.ts - b.ts)
        .map(p => ({ label: shortDate(p.ts), value: p.value })),
    }))
    .sort((a, b) => b.points.length - a.points.length || a.name.localeCompare(b.name));

  // ── Sets per muscle group ──
  // Use the current program week; if it has no data, fall back to the latest
  // week that does, so the chart is never needlessly empty.
  const weeksWithData = [...weekBuckets.keys()].sort((a, b) => b - a);
  const muscleWeek = weekBuckets.has(currentWeek) ? currentWeek : (weeksWithData[0] ?? currentWeek);

  const muscleCounts = new Map<string, number>();
  for (const session of completed) {
    if (session.weekNumber !== muscleWeek) continue;
    for (const s of setsBySession.get(session.id!) ?? []) {
      const muscle = muscleMap.get(s.exerciseId) ?? 'Other';
      muscleCounts.set(muscle, (muscleCounts.get(muscle) ?? 0) + 1);
    }
  }
  const muscleSets: MuscleSets[] = [...muscleCounts.entries()]
    .map(([muscle, sets]) => ({ muscle, sets }))
    .sort((a, b) => b.sets - a.sets);

  return {
    hasData: true,
    summary: {
      totalWorkouts: completed.length,
      totalVolume: Math.round(totalVolume),
      thisWeekVolume,
      lastWeekVolume,
      deltaPct,
    },
    weeklyVolume,
    exercises,
    muscleSets,
    muscleWeekLabel: muscleWeek === currentWeek ? 'This week' : shortDate(weekBuckets.get(muscleWeek)!.latestTs),
  };
}
