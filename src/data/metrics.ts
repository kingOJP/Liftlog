import { addWeeks, startOfWeek, weekStartLabel, weeksBetween } from './program';
import { getExerciseName } from './programStore';
import type { TrainingSnapshot } from './analytics';
import { e1rmSeries, muscleSetTotals, sessionTimestamp, sessionWeekStart } from './analytics';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MetricsSummary {
  totalWorkouts: number;
  totalVolume: number;
  thisWeekVolume: number;
  lastWeekVolume: number;
  deltaPct: number | null; // this week vs last week, null if no prior data
}

export interface WeeklyVolumePoint {
  /** Monday 00:00 of the calendar week, as a timestamp */
  weekStart: number;
  /** "7/27" — the Monday the week starts on */
  label: string;
  value: number;
  /** true for the week the user is training in right now */
  isCurrent: boolean;
}

export interface SeriesPoint {
  label: string;
  value: number;
}

export interface ExerciseSeries {
  exerciseId: string;
  name: string;
  /** best est. 1RM per session (strength trend) */
  points: SeriesPoint[];
  /** total volume load (Σ weight × reps) per session (work-capacity trend) */
  volumePoints: SeriesPoint[];
}

export interface MuscleSets {
  muscle: string;
  sets: number;
}

/** How many calendar weeks the volume chart looks back over. */
export const VOLUME_WEEKS = 8;

export interface Metrics {
  hasData: boolean;
  summary: MetricsSummary;
  /** Oldest → newest, one entry per calendar week (gaps included as zeroes) */
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

export function computeMetrics(snapshot: TrainingSnapshot, now = Date.now()): Metrics {
  const { sessions, setsBySession } = snapshot;
  const currentWeekStart = startOfWeek(now);

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
  // Bucketed by the Monday-anchored calendar week the workout actually happened
  // in (see sessionWeekStart) — never by the stored weekNumber, which is
  // relative to a program anchor that moves when a training block activates.
  const weekBuckets = new Map<number, number>();
  let totalVolume = 0;

  for (const session of sessions) {
    const logs = setsBySession.get(session.id!) ?? [];
    if (logs.length === 0) continue;

    let sessionVolume = 0;
    for (const s of logs) sessionVolume += s.weight * s.reps;
    totalVolume += sessionVolume;

    const weekStart = sessionWeekStart(session);
    weekBuckets.set(weekStart, (weekBuckets.get(weekStart) ?? 0) + sessionVolume);
  }

  // Weekly volume — a continuous timeline, oldest → newest, ending on the
  // current week (which is always shown, even at zero: "this week so far" is
  // the number the lifter is trying to beat). Weeks with no training show as
  // real gaps rather than being collapsed away, so the trend doesn't lie.
  const trainedWeeks = [...weekBuckets.keys()].filter(w => w <= currentWeekStart);
  const earliest = trainedWeeks.length > 0 ? Math.min(...trainedWeeks) : currentWeekStart;
  const windowStart = Math.max(earliest, addWeeks(currentWeekStart, -(VOLUME_WEEKS - 1)));

  const weeklyVolume: WeeklyVolumePoint[] = [];
  for (let i = 0; i <= weeksBetween(windowStart, currentWeekStart); i++) {
    const weekStart = addWeeks(windowStart, i);
    weeklyVolume.push({
      weekStart,
      label: weekStartLabel(weekStart),
      value: Math.round(weekBuckets.get(weekStart) ?? 0),
      isCurrent: weekStart === currentWeekStart,
    });
  }

  // Summary — this/last calendar week
  const thisWeekVolume = Math.round(weekBuckets.get(currentWeekStart) ?? 0);
  const lastWeekVolume = Math.round(weekBuckets.get(addWeeks(currentWeekStart, -1)) ?? 0);
  const deltaPct = lastWeekVolume > 0
    ? Math.round(((thisWeekVolume - lastWeekVolume) / lastWeekVolume) * 100)
    : null;

  // ── Per-exercise est. 1RM + volume-load time series — most-tracked first ──
  // Strength (intensity) and volume (work capacity) are separate trends: a
  // lift can add tonnage while e1RM holds, and vice versa. Both are shown.
  const volumeSeries = new Map<string, { ts: number; value: number }[]>();
  for (const session of sessions) {
    const logs = setsBySession.get(session.id!) ?? [];
    if (logs.length === 0) continue;
    const ts = sessionTimestamp(session);
    const byExercise = new Map<string, number>();
    for (const l of logs) byExercise.set(l.exerciseId, (byExercise.get(l.exerciseId) ?? 0) + l.weight * l.reps);
    for (const [exerciseId, value] of byExercise) {
      const arr = volumeSeries.get(exerciseId);
      if (arr) arr.push({ ts, value });
      else volumeSeries.set(exerciseId, [{ ts, value }]);
    }
  }
  for (const pts of volumeSeries.values()) pts.sort((a, b) => a.ts - b.ts);

  const exercises: ExerciseSeries[] = [...e1rmSeries(snapshot).entries()]
    .map(([exerciseId, pts]) => ({
      exerciseId,
      name: getExerciseName(exerciseId),
      points: pts.map(p => ({ label: shortDate(p.ts), value: Math.round(p.value) })),
      volumePoints: (volumeSeries.get(exerciseId) ?? [])
        .map(p => ({ label: shortDate(p.ts), value: Math.round(p.value) })),
    }))
    .sort((a, b) => b.points.length - a.points.length || a.name.localeCompare(b.name));

  // ── Sets per muscle group ──
  // Use the current program week; if it has no data, fall back to the latest
  // week that does, so the chart is never needlessly empty. Counting uses the
  // shared fractional model (primary = 1, secondary = 0.5) so this chart
  // agrees with the coach, insights and heatmap — and with the 10–20
  // hard-set target it's displayed against.
  const weeksWithData = [...weekBuckets.keys()].sort((a, b) => b - a);
  const muscleWeek = weekBuckets.has(currentWeekStart) ? currentWeekStart : (weeksWithData[0] ?? currentWeekStart);

  const week = muscleSetTotals(snapshot, s => sessionWeekStart(s) === muscleWeek);
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
    muscleWeekLabel: muscleWeek === currentWeekStart
      ? 'This week'
      : `Week of ${weekStartLabel(muscleWeek)}`,
    unclassifiedExercises,
  };
}
