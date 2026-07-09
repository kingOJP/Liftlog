// Block retrospectives — "what did this block actually buy you?"
//
// computeBlockRetrospective() reviews a training block the way a coach would
// at the end of a mesocycle: adherence, strength movement per lift, weekly
// volume per muscle, and a short written summary. Its `carryover` section is
// the machine-readable half — the next planner run consumes it, which is how
// every completed block makes the next one better.
//
// Pure function of (block, TrainingSnapshot); stored on the block at
// completion so the review is stable even as history keeps growing.

import type { MuscleGroup } from './taxonomy';
import type { TrainingSnapshot } from './analytics';
import {
  SETS_TARGET_LOW,
  SETS_TARGET_HIGH,
  muscleSetTotals,
  sessionDurationMs,
  sessionTimestamp,
} from './analytics';
import { getExerciseName } from './programStore';
import { primaryMuscleFor } from './analytics';
import { assessExercise, exercisePointSeries, MIN_TREND_SESSIONS } from './progress';
import type { BlockRetrospective, ExerciseOutcome, MuscleOutcome, TrainingBlock } from './plan';
import { blockAnchor, blockEndTs } from './plan';

const WEEK_MS = 7 * 86_400_000;
const MIN_SESSIONS_FOR_TREND = MIN_TREND_SESSIONS;

export function computeBlockRetrospective(
  block: TrainingBlock,
  snapshot: TrainingSnapshot,
  now = Date.now(),
): BlockRetrospective {
  const from = blockAnchor(block).getTime();
  const scheduledEnd = blockEndTs(block);
  const to = Math.min(now, scheduledEnd ?? now);

  const inWindow = snapshot.sessions.filter(s => {
    const ts = sessionTimestamp(s);
    return ts >= from && ts <= to;
  });
  const include = (s: (typeof inWindow)[number]) => {
    const ts = sessionTimestamp(s);
    return ts >= from && ts <= to;
  };

  // Weeks actually elapsed (capped at the block's scheduled length)
  const weeks = Math.max(1 / 7, Math.min((to - from) / WEEK_MS, block.openEnded ? Infinity : block.phases.length));

  const daysPerWeek = block.program.length;
  const sessionsPlanned = block.openEnded ? null : Math.round(daysPerWeek * weeks);
  const adherencePct = sessionsPlanned == null || sessionsPlanned === 0
    ? null
    : Math.min(100, Math.round((inWindow.length / sessionsPlanned) * 100));

  const durations = inWindow.map(sessionDurationMs).filter((d): d is number => d != null);
  const avgSessionMinutes = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 60_000)
    : null;

  // ── Strength & progress: the multi-signal assessment across the block ──
  // Each lift is judged by the block's own goal (block.focus): e1RM trend,
  // volume-load trend, and PR events — not e1RM alone. The whole block is the
  // window (first vs last session inside it), with exercise-order freshness
  // discounting applied to the endpoints.
  const strength: ExerciseOutcome[] = [];
  let blockPRs = 0;
  for (const [exerciseId, points] of exercisePointSeries(snapshot, include)) {
    if (points.length < 2) continue;
    const assessment = assessExercise(exerciseId, points, block.focus, undefined, Infinity);
    const first = points[0];
    const end = points[points.length - 1];
    const prCount = points.reduce((n, p) => n + (p.weightPR ? 1 : 0) + (p.repPR ? 1 : 0), 0);
    blockPRs += prCount;
    strength.push({
      exerciseId,
      name: getExerciseName(exerciseId),
      startE1rm: Math.round(first.bestE1rm),
      endE1rm: Math.round(end.bestE1rm),
      changePct: assessment.e1rmChangePct ?? assessment.volumeChangePct ?? 0,
      sessions: points.length,
      status: assessment.status,
      volumeChangePct: assessment.volumeChangePct,
      prCount,
    });
  }
  strength.sort((a, b) => b.changePct - a.changePct);

  // ── Volume: weekly hard-set rate per muscle across the block ──
  const totals = muscleSetTotals(snapshot, include).totals;
  const muscles: MuscleOutcome[] = [...totals]
    .map(([muscle, sets]) => {
      const weeklySets = Math.round((sets / weeks) * 2) / 2;
      const status: MuscleOutcome['status'] =
        weeklySets < SETS_TARGET_LOW ? 'low' : weeklySets > SETS_TARGET_HIGH ? 'high' : 'optimal';
      return { muscle, weeklySets, status };
    })
    .sort((a, b) => b.weeklySets - a.weeklySets);

  // ── Carryover signals for the next planning cycle ──
  // Verdicts come from the multi-signal status: progressing lifts earned their
  // spot; stalled/declining ones are rotation candidates. Steady lifts (small
  // gains, recent PRs) are neither — no reason to reward or rotate them.
  const trended = strength.filter(s => s.sessions >= MIN_SESSIONS_FOR_TREND);
  const keepExerciseIds = trended.filter(s => s.status === 'progressing').map(s => s.exerciseId);
  const reviewExerciseIds = trended
    .filter(s => s.status === 'stalled' || s.status === 'declining')
    .map(s => s.exerciseId);

  // Under-target only counts for muscles the block actually programmed —
  // an untrained muscle isn't a lagging one, it's out of scope.
  const programMuscles = new Set<MuscleGroup>();
  for (const day of block.program) {
    for (const ex of day.exercises) {
      const m = primaryMuscleFor(ex.id);
      if (m) programMuscles.add(m);
    }
  }
  const underMuscles = muscles
    .filter(m => m.status === 'low' && programMuscles.has(m.muscle))
    .map(m => m.muscle);
  const overMuscles = muscles.filter(m => m.status === 'high').map(m => m.muscle);

  const summary = buildSummary({
    block, sessions: inWindow.length, sessionsPlanned, adherencePct,
    strength: trended, muscles, underMuscles, keepCount: keepExerciseIds.length,
    reviewNames: trended
      .filter(s => s.status === 'stalled' || s.status === 'declining')
      .map(s => s.name),
    blockPRs,
  });

  return {
    blockId: block.id,
    from,
    to,
    sessionsCompleted: inWindow.length,
    sessionsPlanned,
    adherencePct,
    avgSessionMinutes,
    strength,
    muscles,
    summary,
    carryover: { keepExerciseIds, reviewExerciseIds, underMuscles, overMuscles },
  };
}

function buildSummary(args: {
  block: TrainingBlock;
  sessions: number;
  sessionsPlanned: number | null;
  adherencePct: number | null;
  strength: ExerciseOutcome[];
  muscles: MuscleOutcome[];
  underMuscles: MuscleGroup[];
  keepCount: number;
  reviewNames: string[];
  blockPRs: number;
}): string[] {
  const { sessions, sessionsPlanned, adherencePct, strength, muscles, underMuscles, reviewNames, blockPRs } = args;
  const out: string[] = [];

  if (sessions === 0) {
    out.push('No workouts were logged during this block, so there\'s nothing to evaluate — the next plan starts from your earlier history.');
    return out;
  }

  // Adherence
  if (adherencePct == null) {
    out.push(`You logged ${sessions} workout${sessions === 1 ? '' : 's'} across this block.`);
  } else if (adherencePct >= 90) {
    out.push(`Adherence was excellent — ${sessions} of ${sessionsPlanned} planned sessions. Consistency like this is doing more for you than any programming tweak could.`);
  } else if (adherencePct >= 70) {
    out.push(`Adherence was solid — ${sessions} of ${sessionsPlanned} planned sessions. A few misses don't dent a block; keep the streak going.`);
  } else {
    out.push(`Adherence was the limiter — ${sessions} of ${sessionsPlanned} planned sessions. Before changing the program, it's worth asking whether the schedule fits your life; the best plan is the one that happens.`);
  }

  // Strength & PRs — the multi-signal read, not just e1RM
  if (strength.length > 0) {
    const avg = strength.reduce((s, x) => s + x.changePct, 0) / strength.length;
    const best = strength[0];
    const decliners = strength.filter(s => s.status === 'declining');
    const prLine = blockPRs > 0 ? ` You set ${blockPRs} PR${blockPRs === 1 ? '' : 's'} (weight and rep records) along the way.` : '';
    if (avg >= 3) {
      out.push(`Strength moved the right way: estimated 1RMs averaged ${avg >= 0 ? '+' : ''}${avg.toFixed(1)}% across ${strength.length} tracked lifts, led by ${best.name} at +${best.changePct.toFixed(1)}%.${prLine}`);
    } else if (avg > 0 || blockPRs > 0) {
      out.push(`Strength inched forward — ${avg.toFixed(1)}% on average across ${strength.length} tracked lifts.${prLine} Slow blocks happen; volume quality and sleep are the usual levers.`);
    } else {
      out.push(`Strength was flat to down (${avg.toFixed(1)}% average across ${strength.length} lifts) — a sign of accumulated fatigue or life stress. The next block opens easier on purpose.`);
    }
    if (decliners.length > 0 && avg >= 3) {
      out.push(`Not everything cooperated: ${decliners.map(d => d.name).slice(0, 3).join(', ')} lost ground and ${decliners.length === 1 ? 'is' : 'are'} flagged for rotation.`);
    }
  }

  // Volume
  const optimal = muscles.filter(m => m.status === 'optimal').length;
  if (muscles.length > 0) {
    let volumeLine = `${optimal} of ${muscles.length} trained muscles landed in the 10–20 weekly-set band.`;
    if (underMuscles.length > 0) {
      volumeLine += ` ${underMuscles.slice(0, 3).join(', ')} came in under target — the next block adds a set there.`;
    }
    out.push(volumeLine);
  }

  // Rotation
  if (reviewNames.length > 0) {
    out.push(`Up for rotation next block: ${reviewNames.slice(0, 3).join(', ')} — stalled lifts respond to a movement change better than to stubbornness.`);
  }

  return out;
}
