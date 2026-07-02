import type { MuscleGroup } from './taxonomy';
import { getWeekNumber } from './program';
import type { WorkoutDay } from './program';
import { getExerciseName } from './programStore';
import type { TrainingSnapshot } from './analytics';
import { e1rmSeries, musclesForExercise } from './analytics';

// ── Tunables (hypertrophy research) ────────────────────────────────────────────
// ~10–20 hard sets per muscle per week is the commonly cited effective range.
export const SETS_TARGET_LOW = 10;
export const SETS_TARGET_HIGH = 20;
const TREND_WINDOW = 3;        // sessions compared for a strength trend
const TREND_THRESHOLD = 3;     // % change that counts as up / down (else flat)
const RECENT_SESSIONS = 2;     // don't nag about a muscle trained this recently
const MAX_MUSCLE_RECS = 4;     // cap on "under-trained muscle" nudges

// ── Types ───────────────────────────────────────────────────────────────────────

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

export type InsightKind = 'volume-low' | 'volume-high' | 'plateau' | 'progress';

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
  insights: Insight[];
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
): Coaching {
  const { sessions, setsBySession } = snapshot;

  const empty: Coaching = {
    hasData: false,
    weekLabel: '',
    nextDay: nextDayFromProgram(program, sessions),
    muscleVolume: [],
    trends: [],
    insights: [],
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

  // Muscles the program directly targets (so we only nudge for trained muscles)
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
  const trends: ExerciseTrend[] = [];
  for (const [exerciseId, pts] of e1rmSeries(snapshot)) {
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

  // Muscles trained in the last couple of sessions — we won't nag to add more
  // volume for something that was just hit; the lifter is already on it.
  const recentlyWorked = new Set<MuscleGroup>();
  for (const session of sessions.slice(0, RECENT_SESSIONS)) {
    for (const s of setsBySession.get(session.id!) ?? []) {
      for (const { muscle } of musclesForExercise(s.exerciseId)) recentlyWorked.add(muscle);
    }
  }

  // ── Build the prioritized recommendation list ──
  const insights: Insight[] = [];

  // Under-trained-muscle nudges: only for program muscles not worked in the
  // last RECENT_SESSIONS sessions, most under-trained first, capped so the
  // Coach stays focused instead of listing every muscle.
  const lowMuscleInsights: Insight[] = [];
  for (const mv of muscleVolume) {
    if (!mv.inProgram) continue;
    if (mv.status === 'low') {
      if (recentlyWorked.has(mv.muscle)) continue;
      const gap = SETS_TARGET_LOW - mv.sets;
      lowMuscleInsights.push({
        kind: 'volume-low',
        priority: 100 + gap,
        title: `${mv.muscle} is under-trained`,
        detail: `${formatSets(mv.sets)} of ${SETS_TARGET_LOW}+ weekly sets — add about ${Math.ceil(gap)} more.`,
      });
    } else if (mv.status === 'high') {
      insights.push({
        kind: 'volume-high',
        priority: 40,
        title: `${mv.muscle} volume is high`,
        detail: `${formatSets(mv.sets)} weekly sets — past ${SETS_TARGET_HIGH}, watch for junk volume and recovery.`,
      });
    }
  }
  lowMuscleInsights.sort((a, b) => b.priority - a.priority);
  insights.push(...lowMuscleInsights.slice(0, MAX_MUSCLE_RECS));

  const programExerciseIds = new Set(program.flatMap(d => d.exercises.map(e => e.id)));

  for (const t of trends) {
    if (!programExerciseIds.has(t.exerciseId)) continue;
    if (t.dir === 'flat') {
      insights.push({
        kind: 'plateau',
        priority: 80,
        title: `${t.name} has stalled`,
        detail: `No strength gain across ${t.sessions} sessions — try a light deload week or push for more reps.`,
      });
    } else if (t.dir === 'down') {
      insights.push({
        kind: 'plateau',
        priority: 90,
        title: `${t.name} is trending down`,
        detail: `Est. 1RM down ${Math.abs(Math.round(t.changePct))}% lately — check recovery, sleep, and form.`,
      });
    }
  }

  const progressing = trends.filter(t => t.dir === 'up' && programExerciseIds.has(t.exerciseId)).slice(0, 2);
  for (const t of progressing) {
    insights.push({
      kind: 'progress',
      priority: 20,
      title: `${t.name} is climbing`,
      detail: `Est. 1RM up ${Math.round(t.changePct)}% over your last ${t.sessions} sessions — keep it up.`,
    });
  }

  insights.sort((a, b) => b.priority - a.priority);

  return {
    hasData: true,
    weekLabel,
    nextDay: nextDayFromProgram(program, sessions),
    muscleVolume,
    trends,
    insights: insights.slice(0, 6),
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
