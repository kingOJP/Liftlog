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
import type { Goal, PhaseKind } from './plan';
import { getWeekNumber } from './program';
import type { WorkoutDay } from './program';
import type { TrainingSnapshot } from './analytics';
import {
  SETS_TARGET_LOW,
  SETS_TARGET_HIGH,
  muscleSetTotals,
  primaryMuscleFor,
  sessionTimestamp,
} from './analytics';
import { assessSnapshot, MIN_TREND_SESSIONS } from './progress';
import type { ExerciseProgress } from './progress';
import { computeProgramPlan } from './coach';
import type { ProgramPlan } from './coach';

// Re-exported for existing consumers (MetricsView renders the target range)
export { SETS_TARGET_LOW, SETS_TARGET_HIGH };

// ── Tunables ──────────────────────────────────────────────────────────────────
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
  /** multi-signal per-exercise assessment (progress.ts), most-trained first */
  progress: ExerciseProgress[];
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
  phase: PhaseKind | null = null,
  goal: Goal = 'general',
): Coaching {
  const { sessions, setsBySession } = snapshot;
  const plan = computeProgramPlan(program, snapshot, now, phase);

  const empty: Coaching = {
    hasData: false,
    weekLabel: '',
    nextDay: nextDayFromProgram(program, sessions),
    muscleVolume: [],
    progress: [],
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
  const volumeMap = muscleSetTotals(snapshot, s => s.weekNumber === coachWeek).totals;

  // Muscles the program directly targets
  const programMuscles = new Set<MuscleGroup>();
  for (const day of program) {
    for (const ex of day.exercises) {
      const m = primaryMuscleFor(ex.id);
      if (m) programMuscles.add(m);
    }
  }

  const muscleVolume: MuscleVolume[] = [...new Set([...volumeMap.keys(), ...programMuscles])]
    .map(muscle => {
      const sets = Math.round((volumeMap.get(muscle) ?? 0) * 2) / 2;
      return { muscle, sets, status: volumeStatus(sets), inProgram: programMuscles.has(muscle) };
    })
    .sort((a, b) => b.sets - a.sets);

  // ── Per-exercise progress: the multi-signal assessment (progress.ts) ──
  // e1RM trend + volume-load trend + weight/rep PRs, blended with
  // goal-dependent weights, with exercise-order freshness discounting.
  const assessments = assessSnapshot(snapshot, goal);
  const progress = [...assessments.values()]
    .sort((a, b) => b.totalSessions - a.totalSessions || a.name.localeCompare(b.name));

  const programExerciseIds = new Set(program.flatMap(d => d.exercises.map(e => e.id)));

  // ── Highlights: the strongest recent improvements ──
  const highlights: Insight[] = [];

  // Fresh personal records — weight PRs and rep PRs both count.
  for (const p of progress) {
    if (!programExerciseIds.has(p.exerciseId)) continue;
    const freshPRs = p.recentPRs.filter(pr => now - pr.ts <= PR_RECENT_DAYS * DAY_MS);
    if (freshPRs.length === 0) continue;
    highlights.push({
      kind: 'pr',
      priority: 100 + freshPRs.length,
      title: `New ${p.name} PR`,
      detail: `${freshPRs[0].label}${freshPRs.length > 1 ? ` — plus ${freshPRs.length - 1} more` : ''}. That's the progression working.`,
    });
  }

  // Progressing lifts — the composite says it's moving, the evidence says why
  for (const p of progress) {
    if (p.status !== 'progressing' || !programExerciseIds.has(p.exerciseId)) continue;
    highlights.push({
      kind: 'trend-up',
      priority: 80 + p.score * 20,
      title: `${p.name} is climbing`,
      detail: `${capitalize(p.evidence.slice(0, 2).join('; '))} — keep riding this progression.`,
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

  for (const p of progress) {
    if (!programExerciseIds.has(p.exerciseId) || p.totalSessions < MIN_TREND_SESSIONS) continue;
    if (p.status === 'declining') {
      opportunities.push({
        kind: 'trend-down',
        priority: 90 + Math.abs(p.score) * 20,
        title: `${p.name} is trending down`,
        detail: `${capitalize(p.evidence.slice(0, 2).join('; '))}. Prioritize recovery — sleep and food — and hold volume at target rather than pushing load.`,
      });
    } else if (p.status === 'stalled') {
      opportunities.push({
        kind: 'plateau',
        priority: 70,
        title: `${p.name} has stalled`,
        detail: `No weight or rep PRs and ${p.evidence.slice(0, 2).join(', ')} across your last ${p.sessions} sessions. If it doesn't move next session, the coach will recommend a deload — that's the plan working, not a setback.`,
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
    progress,
    highlights: highlights.slice(0, MAX_HIGHLIGHTS),
    opportunities: opportunities.slice(0, MAX_OPPORTUNITIES),
    plan,
  };
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

// Suggest the next day in program order: the one after the most recently
// trained program day, wrapping around. Chronological cycling ("did Day 2 →
// next up is Day 3") beats ranking by time-since-trained, which could jump
// ahead to a later day just because its last session — maybe in a previous
// block — was older than the days actually up next.
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

  // Most recently trained day that still exists in the program (one-off
  // shared workouts and days removed by a re-plan don't advance the cycle)
  let latestIdx = -1;
  let latestTs = 0;
  program.forEach((d, i) => {
    const ts = lastByDay.get(d.id) ?? 0;
    if (ts > latestTs) { latestTs = ts; latestIdx = i; }
  });

  const day = latestIdx >= 0 ? program[(latestIdx + 1) % program.length] : program[0];
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
