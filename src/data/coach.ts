// Adaptive programming engine — "the planner".
//
// computeProgramPlan() looks at recent training history and produces a small,
// conservative set of adjustments to FUTURE workouts. The stored program is
// never mutated: the plan is a pure function of (program, history), so it is
// deterministic, explainable, reversible (edit the day and the baseline is
// still there), recomputes as data accrues, and stays consistent across
// devices — history syncs, and the plan re-derives from it. WorkoutView
// overlays the plan on the day it renders (applyPlanToDay) and explains every
// change; MetricsView surfaces the same changes in the Coach section.
//
// Guardrails (the "conservative, evidence-based" starting point):
//   - no adaptation until MIN_SESSIONS_TO_ADAPT completed workouts exist
//   - at most MAX_SETS_ADDED / MAX_SETS_REMOVED sets change per week
//   - at most ±1 set per exercise vs the user's baseline
//   - a day is only touched once it has 2+ recent sessions (we know its
//     duration and that the user actually runs it)
//   - added sets must keep the day within +15% of its historical duration

import type { MuscleGroup } from './taxonomy';
import type { WorkoutDay, Exercise } from './program';
import type { PhaseKind } from './plan';
import type { TrainingSnapshot } from './analytics';
import {
  SETS_TARGET_LOW,
  SETS_TARGET_HIGH,
  avgDurationByDay,
  e1rmSeries,
  muscleSetTotals,
  musclesForExercise,
  sessionTimestamp,
} from './analytics';
import { EXERCISES } from './exercises';

// ── Tunables ──────────────────────────────────────────────────────────────────

export const MIN_SESSIONS_TO_ADAPT = 6;
const WINDOW_DAYS = 28;              // trailing window volume is measured over
const MAX_SETS_ADDED = 2;            // per plan (≈ per week) — gradual progression
const MAX_SETS_REMOVED = 2;
const MIN_EXERCISE_SETS = 2;         // never trim below
const MAX_EXERCISE_SETS = 5;         // never stack beyond
const MIN_DAY_SESSIONS = 2;          // recent sessions required before touching a day
const HIGH_VOLUME_BUFFER = 2;        // sets past the ceiling before we trim
const SUGGEST_GAP = 3;               // weekly-set gap that earns an add-exercise suggestion
export const MINUTES_PER_SET = 3;    // set + rest, for duration projections
const DURATION_TOLERANCE = 0.15;     // keep days within ±15% of their average

const DAY_MS = 86_400_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlanChange {
  dayId: number;
  dayLabel: string;
  exerciseId: string;
  exerciseName: string;
  kind: 'add-set' | 'remove-set';
  fromSets: number;
  toSets: number;
  muscle: MuscleGroup;
  reason: string;
}

export interface DayPlan {
  dayId: number;
  changes: PlanChange[];
  estMinutesDelta: number;
}

export interface ProgramPlan {
  /** false until enough history exists to adapt responsibly */
  ready: boolean;
  /** trailing per-week fractional hard sets per muscle */
  weeklyMuscleSets: Map<MuscleGroup, number>;
  days: Map<number, DayPlan>;
  changes: PlanChange[];
  /** structural gaps the planner can't fix by redistributing sets */
  suggestions: string[];
}

const EMPTY_PLAN: ProgramPlan = {
  ready: false,
  weeklyMuscleSets: new Map(),
  days: new Map(),
  changes: [],
  suggestions: [],
};

// ── Main ──────────────────────────────────────────────────────────────────────

export function computeProgramPlan(
  program: WorkoutDay[],
  snapshot: TrainingSnapshot,
  now = Date.now(),
  phase: PhaseKind | null = null,
): ProgramPlan {
  const { sessions } = snapshot;
  // A planned deload/recovery week is deliberately lighter — adding or
  // trimming sets there would fight the block's design.
  if (phase === 'deload' || phase === 'recovery') return EMPTY_PLAN;
  if (sessions.length < MIN_SESSIONS_TO_ADAPT || program.length === 0) return EMPTY_PLAN;

  const windowStart = now - WINDOW_DAYS * DAY_MS;
  const windowSessions = sessions.filter(s => sessionTimestamp(s) >= windowStart);
  if (windowSessions.length < MIN_DAY_SESSIONS) return EMPTY_PLAN;

  // Weekly volume rate per muscle over the trailing window. The divisor is the
  // actual span of data inside the window (min 1 week) so two weeks of history
  // aren't read as a four-week average.
  const oldestTs = Math.min(...windowSessions.map(sessionTimestamp));
  const weeks = Math.min(WINDOW_DAYS / 7, Math.max(1, (now - oldestTs) / (7 * DAY_MS)));

  const inWindow = (s: typeof sessions[number]) => sessionTimestamp(s) >= windowStart;
  const windowSets = muscleSetTotals(snapshot, inWindow).totals;
  const sessionsPerDay = new Map<number, number>();
  for (const session of windowSessions) {
    sessionsPerDay.set(session.dayId, (sessionsPerDay.get(session.dayId) ?? 0) + 1);
  }
  const weeklyMuscleSets = new Map<MuscleGroup, number>(
    [...windowSets].map(([m, sets]) => [m, sets / weeks]),
  );

  // Exercises whose e1RM is trending down — don't pile volume onto a
  // struggling lift.
  const declining = new Set<string>();
  for (const [exerciseId, pts] of e1rmSeries(snapshot)) {
    if (pts.length < 3) continue;
    const win = pts.slice(-3);
    if (win[win.length - 1].value < win[0].value * 0.97) declining.add(exerciseId);
  }

  const avgDuration = avgDurationByDay(snapshot);

  // Planned weekly sets each muscle gets from each program day (baseline).
  const daySetsForMuscle = (day: WorkoutDay, muscle: MuscleGroup): number => {
    let sets = 0;
    for (const ex of day.exercises) {
      const inv = musclesForExercise(ex.id).find(m => m.muscle === muscle);
      if (inv) sets += ex.sets * inv.weight;
    }
    return sets;
  };

  const changes: PlanChange[] = [];
  const suggestions: string[] = [];
  const addedMinutesByDay = new Map<number, number>();
  const changedExercises = new Set<string>(); // dayId:exerciseId — ±1 set max each

  // Program muscles: everything a program exercise directly targets.
  const programMuscles = new Set<MuscleGroup>();
  for (const day of program) {
    for (const ex of day.exercises) {
      const primary = musclesForExercise(ex.id).find(m => m.weight === 1);
      if (primary) programMuscles.add(primary.muscle);
    }
  }

  const dayEligible = (dayId: number) => (sessionsPerDay.get(dayId) ?? 0) >= MIN_DAY_SESSIONS;

  // A day can absorb another set only if it stays within +15% of its average
  // duration. Days without duration data pass — the global add cap keeps
  // changes conservative until durations accumulate.
  const durationHeadroom = (dayId: number): boolean => {
    const avg = avgDuration.get(dayId);
    if (avg == null) return true;
    const addedMin = (addedMinutesByDay.get(dayId) ?? 0) + MINUTES_PER_SET;
    return addedMin * 60_000 <= avg * DURATION_TOLERANCE;
  };

  // ── Under-target muscles: redistribute volume across future workouts ──
  const gaps = [...programMuscles]
    .map(muscle => ({ muscle, rate: weeklyMuscleSets.get(muscle) ?? 0 }))
    .filter(({ rate }) => rate < SETS_TARGET_LOW)
    .sort((a, b) => a.rate - b.rate);

  let added = 0;
  for (const { muscle, rate } of gaps) {
    if (added >= MAX_SETS_ADDED) break;

    // Candidate slots: every program exercise that trains this muscle, on a
    // day the user actually runs. Scored holistically — direct stimulus,
    // extra fatigue, overlap with already-high muscles, distribution across
    // movements, per-day frequency, and how the lift itself is trending.
    interface Candidate { day: WorkoutDay; ex: Exercise; score: number; primary: boolean }
    const candidates: Candidate[] = [];

    const setsPerCandidate = new Map<string, number>(); // exId → planned sets for this muscle
    for (const day of program) {
      for (const ex of day.exercises) {
        const inv = musclesForExercise(ex.id).find(m => m.muscle === muscle);
        if (inv) setsPerCandidate.set(ex.id, ex.sets * inv.weight);
      }
    }
    const maxMuscleSets = Math.max(0, ...setsPerCandidate.values());
    // The lightest eligible day that already trains this muscle — raising its
    // share nudges frequency up without inventing a new training slot.
    const muscleDayLoads = program
      .filter(d => dayEligible(d.id))
      .map(d => daySetsForMuscle(d, muscle))
      .filter(load => load > 0);
    const minDayLoad = muscleDayLoads.length > 0 ? Math.min(...muscleDayLoads) : 0;

    for (const day of program) {
      if (!dayEligible(day.id)) continue;
      if (!durationHeadroom(day.id)) continue;
      for (const ex of day.exercises) {
        const involvement = musclesForExercise(ex.id);
        const inv = involvement.find(m => m.muscle === muscle);
        if (!inv) continue;
        if (ex.sets >= MAX_EXERCISE_SETS) continue;
        if (changedExercises.has(`${day.id}:${ex.id}`)) continue;

        // Direct work beats secondary spillover
        let score = inv.weight;
        const others = involvement.filter(m => m.muscle !== muscle);
        // Prefer lower-fatigue slots: fewer additional muscles dragged along
        score -= others.length * 0.1;
        // Never push a muscle that's already at/over the ceiling
        if (others.some(o => (weeklyMuscleSets.get(o.muscle) ?? 0) >= SETS_TARGET_HIGH)) {
          score -= 0.5;
        }
        // Spread volume across movements instead of stacking the workhorse
        if (setsPerCandidate.get(ex.id) === maxMuscleSets && maxMuscleSets > 0) score -= 0.3;
        if (ex.sets >= 4) score -= 0.2;
        // Don't add volume to a lift that's losing strength
        if (declining.has(ex.id)) score -= 0.3;
        // Mild bonus for raising frequency on the muscle's lightest day
        if (daySetsForMuscle(day, muscle) === minDayLoad) score += 0.15;

        candidates.push({ day, ex, score, primary: inv.weight === 1 });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    if (!best) {
      // No slot can absorb the volume — a structural gap. Suggest a concrete
      // exercise instead of silently ignoring it (or nagging the user).
      if (SETS_TARGET_LOW - rate >= SUGGEST_GAP) {
        const inProgram = new Set(program.flatMap(d => d.exercises.map(e => e.id)));
        const pick = EXERCISES.find(e => e.primaryMuscle === muscle && !inProgram.has(e.id));
        if (pick) {
          const shortestDay = [...program].sort(
            (a, b) => a.exercises.reduce((s, e) => s + e.sets, 0) - b.exercises.reduce((s, e) => s + e.sets, 0),
          )[0];
          suggestions.push(
            `${muscle} is averaging ${fmtRate(rate)} weekly sets with no good slot to add more — consider adding ${pick.name} to ${shortestDay.label}.`,
          );
        }
      }
      continue;
    }

    const why = best.primary
      ? `it trains ${muscle} directly with little extra fatigue`
      : `it works ${muscle} alongside its main target, so the set does double duty`;
    changes.push({
      dayId: best.day.id,
      dayLabel: best.day.label,
      exerciseId: best.ex.id,
      exerciseName: best.ex.name,
      kind: 'add-set',
      fromSets: best.ex.sets,
      toSets: best.ex.sets + 1,
      muscle,
      reason: `${muscle} is averaging ${fmtRate(rate)} weekly sets — below the ${SETS_TARGET_LOW}–${SETS_TARGET_HIGH} target. One set added here because ${why}.`,
    });
    changedExercises.add(`${best.day.id}:${best.ex.id}`);
    addedMinutesByDay.set(best.day.id, (addedMinutesByDay.get(best.day.id) ?? 0) + MINUTES_PER_SET);
    added++;
  }

  // ── Over-target muscles: trim junk volume to protect recovery ──
  const overs = [...weeklyMuscleSets]
    .filter(([, rate]) => rate > SETS_TARGET_HIGH + HIGH_VOLUME_BUFFER)
    .sort((a, b) => b[1] - a[1]);

  let removed = 0;
  for (const [muscle, rate] of overs) {
    if (removed >= MAX_SETS_REMOVED) break;

    // Trim from the exercise doing the most direct sets for this muscle —
    // the marginal set there is the most redundant one.
    let best: { day: WorkoutDay; ex: Exercise } | null = null;
    for (const day of program) {
      if (!dayEligible(day.id)) continue;
      for (const ex of day.exercises) {
        if (ex.sets <= MIN_EXERCISE_SETS) continue;
        if (changedExercises.has(`${day.id}:${ex.id}`)) continue;
        const primary = musclesForExercise(ex.id).find(m => m.weight === 1);
        if (primary?.muscle !== muscle) continue;
        if (!best || ex.sets > best.ex.sets) best = { day, ex };
      }
    }
    if (!best) continue;

    changes.push({
      dayId: best.day.id,
      dayLabel: best.day.label,
      exerciseId: best.ex.id,
      exerciseName: best.ex.name,
      kind: 'remove-set',
      fromSets: best.ex.sets,
      toSets: best.ex.sets - 1,
      muscle,
      reason: `${muscle} is averaging ${fmtRate(rate)} weekly sets — past the ${SETS_TARGET_HIGH}-set ceiling, extra sets cost more recovery than they build. One set trimmed to keep quality high.`,
    });
    changedExercises.add(`${best.day.id}:${best.ex.id}`);
    addedMinutesByDay.set(best.day.id, (addedMinutesByDay.get(best.day.id) ?? 0) - MINUTES_PER_SET);
    removed++;
  }

  const days = new Map<number, DayPlan>();
  for (const change of changes) {
    const dp = days.get(change.dayId) ?? { dayId: change.dayId, changes: [], estMinutesDelta: 0 };
    dp.changes.push(change);
    dp.estMinutesDelta += (change.kind === 'add-set' ? 1 : -1) * MINUTES_PER_SET;
    days.set(change.dayId, dp);
  }

  return { ready: true, weeklyMuscleSets, days, changes, suggestions };
}

// The day as the user will actually train it: baseline exercises with the
// plan's set adjustments applied.
export function applyPlanToDay(day: WorkoutDay, plan: ProgramPlan): WorkoutDay {
  const dayPlan = plan.days.get(day.id);
  if (!dayPlan || dayPlan.changes.length === 0) return day;
  const byExercise = new Map(dayPlan.changes.map(c => [c.exerciseId, c.toSets]));
  return {
    ...day,
    exercises: day.exercises.map(ex => {
      const toSets = byExercise.get(ex.id);
      return toSets == null ? ex : { ...ex, sets: toSets };
    }),
  };
}

function fmtRate(rate: number): string {
  const rounded = Math.round(rate * 2) / 2;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
