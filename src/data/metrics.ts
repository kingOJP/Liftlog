import { getWeekNumber } from './program';
import { getExerciseName } from './programStore';
import type { TrainingSnapshot } from './analytics';
import { e1rmSeries, muscleSetTotals, sessionTimestamp } from './analytics';

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
  unclassifiedExercises: string[]; // logged exercises with no primary muscle (the "Other" bucket)
}

function shortDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function computeMetrics(snapshot: TrainingSnapshot, currentWeek = getWeekNumber()): Metrics {
  const { sessions, setsBySession } = snapshot;

  const empty: Metrics = {
    hasData: false,
    summary: { totalWorkouts: 0, totalVolume: 0, thisWeekVolume: 0, lastWeekVolume: 0, deltaPct: null },
    weeklyVolume: [],
    exercises: [],
    muscleSets: [],
    muscleWeekLabel: '',
    unclassifiedExercises: [],
  };
  if (sessions.length === 0 || setsBySession.size === 0) return empty;

  // ── Weekly volume + totals ──
  const weekBuckets = new Map<number, { value: number; latestTs: number }>();
  let totalVolume = 0;

  for (const session of sessions) {
    const logs = setsBySession.get(session.id!) ?? [];
    if (logs.length === 0) continue;
    const ts = sessionTimestamp(session);

    let sessionVolume = 0;
    for (const s of logs) sessionVolume += s.weight * s.reps;
    totalVolume += sessionVolume;

    const bucket = weekBuckets.get(session.weekNumber);
    if (bucket) {
      bucket.value += sessionVolume;
      if (ts > bucket.latestTs) bucket.latestTs = ts;
    } else {
      weekBuckets.set(session.weekNumber, { value: sessionVolume, latestTs: ts });
    }
  }

  // Weekly volume — sorted ascending, last 8 weeks
  const weeklyVolume: WeeklyVolumePoint[] = [...weekBuckets.entries()]
    .map(([week, b]) => ({ week, label: shortDate(b.latestTs), value: Math.round(b.value) }))
    .sort((a, b) => a.week - b.week)
    .slice(-8);

  // Summary — this/last program week
  const thisWeekVolume = Math.round(weekBuckets.get(currentWeek)?.value ?? 0);
  const lastWeekVolume = Math.round(weekBuckets.get(currentWeek - 1)?.value ?? 0);
  const deltaPct = lastWeekVolume > 0
    ? Math.round(((thisWeekVolume - lastWeekVolume) / lastWeekVolume) * 100)
    : null;

  // ── Per-exercise est. 1RM time series — most-tracked first ──
  const exercises: ExerciseSeries[] = [...e1rmSeries(snapshot).entries()]
    .map(([exerciseId, pts]) => ({
      exerciseId,
      name: getExerciseName(exerciseId),
      points: pts.map(p => ({ label: shortDate(p.ts), value: Math.round(p.value) })),
    }))
    .sort((a, b) => b.points.length - a.points.length || a.name.localeCompare(b.name));

  // ── Sets per muscle group ──
  // Use the current program week; if it has no data, fall back to the latest
  // week that does, so the chart is never needlessly empty. Counting uses the
  // shared fractional model (primary = 1, secondary = 0.5) so this chart
  // agrees with the coach, insights and heatmap — and with the 10–20
  // hard-set target it's displayed against.
  const weeksWithData = [...weekBuckets.keys()].sort((a, b) => b - a);
  const muscleWeek = weekBuckets.has(currentWeek) ? currentWeek : (weeksWithData[0] ?? currentWeek);

  const week = muscleSetTotals(snapshot, s => s.weekNumber === muscleWeek);
  const muscleSets: MuscleSets[] = [...week.totals.entries()]
    .map(([muscle, sets]) => ({ muscle: muscle as string, sets: Math.round(sets * 2) / 2 }));
  if (week.unmappedSets > 0) muscleSets.push({ muscle: 'Other', sets: week.unmappedSets });
  muscleSets.sort((a, b) => b.sets - a.sets);

  // Logged exercises with no primary muscle (all-time) — their sets fall into
  // the "Other" bucket, so tell the user which ones need classifying.
  const unclassifiedExercises = [...muscleSetTotals(snapshot).unmappedExerciseIds]
    .map(id => getExerciseName(id))
    .sort((a, b) => a.localeCompare(b));

  return {
    hasData: true,
    summary: {
      totalWorkouts: sessions.length,
      totalVolume: Math.round(totalVolume),
      thisWeekVolume,
      lastWeekVolume,
      deltaPct,
    },
    weeklyVolume,
    exercises,
    muscleSets,
    muscleWeekLabel: muscleWeek === currentWeek ? 'This week' : shortDate(weekBuckets.get(muscleWeek)!.latestTs),
    unclassifiedExercises,
  };
}
