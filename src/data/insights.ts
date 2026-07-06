// Coaching insights — the concise dashboard the Coach surfaces.
//
// Instead of a stream of notifications, computeCoaching() produces:
//   - highlights:     up to 3 positive trends worth reinforcing (PRs, climbing
//                     lifts, rising volume, consistency)
//   - opportunities:  up to 3 diagnostic insights with the biggest expected
//                     payoff (strength declines, plateaus, recovery risk,
//                     structural program gaps)
//   - plan:           the adaptive programming plan (coach.ts). Under-trained
//                     muscles are no longer "notified" — the planner
//                     redistributes volume across future workouts instead, and
//                     the plan's changes carry their own plain-language reasons.

import type { MuscleGroup } from './taxonomy';
import { getWeekNumber } from './program';
import type { WorkoutDay } from './program';
import { getExerciseName } from './programStore';
import type { TrainingSnapshot } from './analytics';
import {
  SETS_TARGET_LOW,
  SETS_TARGET_HIGH,
  e1rmSeries,
  musclesForExercise,
  sessionTimestamp,
} from './analytics';
import { computeProgramPlan } from './coach';
import type { ProgramPlan } from './coach';

// Re-exported for existing consumers (MetricsView renders the target range)
export { SETS_TARGET_LOW, SETS_TARGET_HIGH };

// ── Tunables ──────────────────────────────────────────────────────────────────
const TREND_WINDOW = 3;        // sessions compared for a strength trend
const TREND_THRESHOLD = 3;     // % change that counts as up / down (else flat)
const MAX_HIGHLIGHTS = 3;
const MAX_OPPORTUNITIES = 3;
const PR_RECENT_DAYS = 10;     // a PR is only a highlight while it's fresh
const VOLUME_UP_PCT = 5;       // week-over-week volume gain worth celebrating
const DAY_MS = 86_400_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export type VolumeStatus = 'low' | 'optimal' | 'high';

export interface MuscleVolume {
  muscle: MuscleGroup;
  sets: number;           // fractional weekly sets (rounded to 0.5)
  status: VolumeStatus;
  inProgram: boolean;     // is this muscle a primary target of the current program?
}

export type TrendDir = 'up' | 'flat' | 'down';

export interface ExerciseTrend {
  exerciseId: string;
  name: string;
  dir: TrendDir;
  changePct: number;
  sessions: number;
}

export type InsightKind =
  | 'pr' | 'trend-up' | 'volume-up' | 'consistency'          // highlights
  | 'trend-down' | 'plateau' | 'volume-high' | 'program-gap'; // opportunities

export interface Insight {
  kind: InsightKind;
  priority: number;       // higher = surface first
  title: string;
  detail: string;
}

export interface NextDay {
  dayId: number;
  label: string;
  muscleGroups: string;
  lastTrained: number | null;   // ms timestamp, null if never
}

export interface Coaching {
  hasData: boolean;
  weekLabel: string;
  nextDay: NextDay | null;
  muscleVolume: MuscleVolume[];
  trends: ExerciseTrend[];
  highlights: Insight[];
  opportunities: Insight[];
  plan: ProgramPlan;
}

function volumeStatus(sets: number): VolumeStatus {
  if (sets < SETS_TARGET_LOW) return 'low';
  if (sets > SETS_TARGET_HIGH) return 'high';
  return 'optimal';
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function computeCoaching(
  program: WorkoutDay[],
  snapshot: TrainingSnapshot,
  currentWeek = getWeekNumber(),
  now = Date.now(),
): Coaching {
  const { sessions, setsBySession } = snapshot;
  const plan = computeProgramPlan(program, snapshot, now);

  const empty: Coaching = {
    hasData: false,
    weekLabel: '',
    nextDay: nextDayFromProgram(program, sessions),
    muscleVolume: [],
    trends: [],
    highlights: [],
    opportunities: [],
    plan,
  };
  if (sessions.length === 0 || setsBySession.size === 0) return empty;

  // Which week are we coaching? Current program week, else the latest with data.
  const weeksWithData = [...new Set(sessions.map(s => s.weekNumber))].sort((a, b) => b - a);
  const coachWeek = weeksWithData.includes(currentWeek) ? currentWeek : (weeksWithData[0] ?? currentWeek);
  const weekLabel = coachWeek === currentWeek ? 'This week' : `Week ${coachWeek}`;

  // ── Fractional set volume per muscle for the coaching week ──
  const volumeMap = new Map<MuscleGroup, number>();
  for (const session of sessions) {
    if (session.weekNumber !== coachWeek) continue;
    for (const s of setsBySession.get(session.id!) ?? []) {
      for (const { muscle, weight } of musclesForExercise(s.exerciseId)) {
        volumeMap.set(muscle, (volumeMap.get(muscle) ?? 0) + weight);
      }
    }
  }

  // Muscles the program directly targets
  const programMuscles = new Set<MuscleGroup>();
  for (const day of program) {
    for (const ex of day.exercises) {
      const m = musclesForExercise(ex.id)[0]?.muscle;
      if (m) programMuscles.add(m);
    }
  }

  const muscleVolume: MuscleVolume[] = [...new Set([...volumeMap.keys(), ...programMuscles])]
    .map(muscle => {
      const sets = Math.round((volumeMap.get(muscle) ?? 0) * 2) / 2;
      return { muscle, sets, status: volumeStatus(sets), inProgram: programMuscles.has(muscle) };
    })
    .sort((a, b) => b.sets - a.sets);

  // ── Per-exercise strength trend (best Epley e1RM per session) ──
  const series = e1rmSeries(snapshot);
  const trends: ExerciseTrend[] = [];
  for (const [exerciseId, pts] of series) {
    if (pts.length < TREND_WINDOW) continue;
    const window = pts.slice(-TREND_WINDOW);
    const first = window[0].value;
    const last = window[window.length - 1].value;
    const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
    const dir: TrendDir =
      changePct > TREND_THRESHOLD ? 'up' : changePct < -TREND_THRESHOLD ? 'down' : 'flat';
    trends.push({ exerciseId, name: getExerciseName(exerciseId), dir, changePct, sessions: pts.length });
  }
  trends.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

  const programExerciseIds = new Set(program.flatMap(d => d.exercises.map(e => e.id)));

  // ── Highlights: the strongest recent improvements ──
  const highlights: Insight[] = [];

  // Fresh personal records: the latest e1RM point is an all-time best.
  for (const [exerciseId, pts] of series) {
    if (pts.length < 2 || !programExerciseIds.has(exerciseId)) continue;
    const last = pts[pts.length - 1];
    if (now - last.ts > PR_RECENT_DAYS * DAY_MS) continue;
    const previousBest = Math.max(...pts.slice(0, -1).map(p => p.value));
    if (last.value > previousBest * 1.005) {
      const gainPct = Math.round(((last.value - previousBest) / previousBest) * 100);
      highlights.push({
        kind: 'pr',
        priority: 100 + gainPct,
        title: `New ${getExerciseName(exerciseId)} PR`,
        detail: `Est. 1RM hit ${Math.round(last.value)} lbs${gainPct >= 1 ? ` — ${gainPct}% over your previous best` : ''}. That's the progression working.`,
      });
    }
  }

  // Climbing lifts
  for (const t of trends) {
    if (t.dir !== 'up' || !programExerciseIds.has(t.exerciseId)) continue;
    highlights.push({
      kind: 'trend-up',
      priority: 80 + t.changePct,
      title: `${t.name} is climbing`,
      detail: `Est. 1RM up ${Math.round(t.changePct)}% over your last ${TREND_WINDOW} sessions — keep riding this progression.`,
    });
  }

  // Week-over-week volume gain
  const weekVolume = new Map<number, number>();
  for (const session of sessions) {
    let v = 0;
    for (const s of setsBySession.get(session.id!) ?? []) v += s.weight * s.reps;
    weekVolume.set(session.weekNumber, (weekVolume.get(session.weekNumber) ?? 0) + v);
  }
  const thisWeekVol = weekVolume.get(coachWeek) ?? 0;
  const lastWeekVol = weekVolume.get(coachWeek - 1) ?? 0;
  if (lastWeekVol > 0 && thisWeekVol > lastWeekVol * (1 + VOLUME_UP_PCT / 100)) {
    const pct = Math.round(((thisWeekVol - lastWeekVol) / lastWeekVol) * 100);
    highlights.push({
      kind: 'volume-up',
      priority: 60,
      title: 'Training volume is rising',
      detail: `${weekLabel}'s total volume is up ${pct}% on last week — progressive overload in action.`,
    });
  }

  // Consistency: sessions in the trailing 7 days
  const recentCount = sessions.filter(s => now - sessionTimestamp(s) <= 7 * DAY_MS).length;
  if (recentCount >= Math.min(program.length, 3)) {
    highlights.push({
      kind: 'consistency',
      priority: 50,
      title: `${recentCount} workouts in the last 7 days`,
      detail: 'Showing up is the biggest driver of long-term progress — this streak is doing more than any single set.',
    });
  }

  // ── Opportunities: the changes with the biggest expected payoff ──
  const opportunities: Insight[] = [];

  for (const t of trends) {
    if (!programExerciseIds.has(t.exerciseId)) continue;
    if (t.dir === 'down') {
      opportunities.push({
        kind: 'trend-down',
        priority: 90 + Math.abs(t.changePct),
        title: `${t.name} strength has declined`,
        detail: `Est. 1RM is down ${Math.abs(Math.round(t.changePct))}% over your last ${TREND_WINDOW} sessions. Prioritize recovery — sleep and food — and hold volume at target rather than pushing load.`,
      });
    } else if (t.dir === 'flat') {
      opportunities.push({
        kind: 'plateau',
        priority: 70,
        title: `${t.name} has stalled`,
        detail: `No strength change across ${TREND_WINDOW} sessions at the same load. If it doesn't move next session, the coach will recommend a deload — that's the plan working, not a setback.`,
      });
    }
  }

  for (const mv of muscleVolume) {
    if (mv.status === 'high' && mv.inProgram) {
      opportunities.push({
        kind: 'volume-high',
        priority: 60 + (mv.sets - SETS_TARGET_HIGH),
        title: `${mv.muscle} volume is running hot`,
        detail: `${formatSets(mv.sets)} weekly sets — past the ${SETS_TARGET_HIGH}-set ceiling, extra sets mostly cost recovery. The coach will trim volume here if it persists.`,
      });
    }
  }

  // Structural gaps the planner couldn't fix by redistributing sets
  for (const suggestion of plan.suggestions) {
    opportunities.push({
      kind: 'program-gap',
      priority: 65,
      title: 'Program gap',
      detail: suggestion,
    });
  }

  highlights.sort((a, b) => b.priority - a.priority);
  opportunities.sort((a, b) => b.priority - a.priority);

  return {
    hasData: true,
    weekLabel,
    nextDay: nextDayFromProgram(program, sessions),
    muscleVolume,
    trends,
    highlights: highlights.slice(0, MAX_HIGHLIGHTS),
    opportunities: opportunities.slice(0, MAX_OPPORTUNITIES),
    plan,
  };
}

// Suggest the program day that has gone longest without being trained.
function nextDayFromProgram(
  program: WorkoutDay[],
  completed: { dayId: number; completedAt?: number }[],
): NextDay | null {
  if (program.length === 0) return null;
  const lastByDay = new Map<number, number>();
  for (const s of completed) {
    const ts = s.completedAt ?? 0;
    if (ts > (lastByDay.get(s.dayId) ?? 0)) lastByDay.set(s.dayId, ts);
  }
  const ranked = [...program].sort(
    (a, b) => (lastByDay.get(a.id) ?? 0) - (lastByDay.get(b.id) ?? 0),
  );
  const day = ranked[0];
  return {
    dayId: day.id,
    label: day.label,
    muscleGroups: day.muscleGroups,
    lastTrained: lastByDay.get(day.id) ?? null,
  };
}

function formatSets(sets: number): string {
  return Number.isInteger(sets) ? `${sets}` : sets.toFixed(1);
}
