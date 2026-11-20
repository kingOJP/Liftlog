import { addWeeks, shortDateLabel, startOfWeek, weekStartLabel, weeksBetween } from './program';
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

/** How many calendar weeks the volume chart looks back over. */
export const VOLUME_WEEKS = 8;

export interface Metrics {
  hasData: boolean;
  summary: MetricsSummary;
  /** Oldest → newest, one entry per calendar week (gaps included as zeroes) */
  weeklyVolume: WeeklyVolumePoint[];
  exercises: ExerciseSeries[];     // most-tracked first (for the default selection)
  unclassifiedExercises: string[]; // logged exercises with no primary muscle — off the heatmap
}

const shortDate = shortDateLabel;

// ── Range summary ─────────────────────────────────────────────────────────────

export interface RangeSummary {
  /** sessions with logged sets inside the window */
  workouts: number;
  /** Σ weight × reps inside the window */
  volume: number;
  /** the same, over the window of equal length immediately before it */
  prevVolume: number;
  /** volume vs prevVolume, whole percent; null when there is nothing before */
  deltaPct: number | null;
}

/**
 * Totals for an arbitrary time window, compared with the equal-length window
 * before it. A trailing window is compared like for like — unlike "this week
 * so far vs all of last week", which reads as a drop every Monday.
 */
export function computeRangeSummary(snapshot: TrainingSnapshot, from: number, to: number): RangeSummary {
  const prevFrom = from - (to - from);
  let workouts = 0;
  let volume = 0;
  let prevVolume = 0;
  for (const session of snapshot.sessions) {
    const logs = snapshot.setsBySession.get(session.id!) ?? [];
    if (logs.length === 0) continue;
    const ts = sessionTimestamp(session);
    let sessionVolume = 0;
    for (const s of logs) sessionVolume += s.weight * s.reps;
    if (ts >= from && ts <= to) { workouts++; volume += sessionVolume; }
    else if (ts >= prevFrom && ts < from) prevVolume += sessionVolume;
  }
  return {
    workouts,
    volume: Math.round(volume),
    prevVolume: Math.round(prevVolume),
    deltaPct: prevVolume > 0 ? Math.round(((volume - prevVolume) / prevVolume) * 100) : null,
  };
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

  // Logged exercises with no primary muscle (all-time) — their sets can't be
  // placed on a muscle, so tell the user which ones need classifying.
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
    unclassifiedExercises,
  };
}
