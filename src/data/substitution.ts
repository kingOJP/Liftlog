// Exercise Intelligence — the substitution engine.
//
// suggestReplacements() answers "what should I swap this exercise for?" the way
// a coach would: keep the training intent of the slot (same primary muscle,
// similar movement), avoid making the workout redundant (don't duplicate a
// pattern the day already has), respect the user's context (equipment they
// actually train with, lifts they already know, muscles that are over/under
// their weekly volume target), and explain every recommendation in plain
// language.
//
// Architecture notes:
//   - Pure functions over (exercise, day, TrainingSnapshot) — no storage
//     writes, fully unit-testable, same pattern as coach.ts/recommendations.ts.
//   - The candidate pool is the internal repository: the user's exercise
//     library first (their entries win name collisions so logged history is
//     preserved), then the curated master catalog in exercises.ts. New
//     knowledge enters the system by vetting exercises into that catalog —
//     ExerciseProfile is the normalized shape any future source (external
//     APIs, AI generation, coach-curated collections) must produce, so adding
//     a source means adding a profile producer, not touching the ranker.
//   - Downstream coaching adapts automatically: the coach planner and the
//     recommendation engine are pure functions of (program, history), so once
//     a swap is saved to the program nothing needs to be "notified".

import type { MuscleGroup, WorkoutType, Equipment, WeightType } from './taxonomy';
import type { Exercise, WorkoutDay } from './program';
import type { TrainingSnapshot } from './analytics';
import {
  SETS_TARGET_LOW,
  SETS_TARGET_HIGH,
  muscleSetTotals,
  normalizeName,
  sessionTimestamp,
} from './analytics';
import { assessSnapshot, progressDirections } from './progress';
import { EXERCISES, EXERCISE_MAP, catalogDefFor, difficultyFor, getExerciseMeta, prerequisitesFor } from './exercises';
import type { ExerciseDifficulty } from './exercises';
import { getExerciseLibrary, getDeletedExerciseIds } from './programStore';

// ── Exercise profiles ─────────────────────────────────────────────────────────
// The normalized, fully-resolved view of an exercise the ranker works with.
// Metadata precedence matches analytics.musclesForExercise: user override →
// master catalog → name match against the catalog (for custom library entries).

export type Mechanics = 'compound' | 'isolation';

export interface ExerciseProfile {
  id: string;
  name: string;
  primaryMuscle: MuscleGroup | null;
  secondaryMuscles: MuscleGroup[];
  workoutType: WorkoutType | null;
  equipment: Equipment | null;
  weightType: WeightType | null;
  mechanics: Mechanics;
  /** intrinsic skill/risk tier (exercises.ts) — drives beginner-safe selection */
  difficulty: ExerciseDifficulty;
  /** exercise ids that should be trained before this one (advanced lifts) */
  prerequisites: string[];
}

// Multi-joint movement patterns — used to derive compound/isolation rather
// than hand-maintaining a flag on every catalog row.
const COMPOUND_PATTERNS = new Set<WorkoutType>([
  'Dip', 'Hip Hinge', 'Hip Thrust', 'Leg Press', 'Lunge', 'Press',
  'Pull Down', 'Pull Up', 'Row', 'Squat',
]);

const nameToDef = new Map(EXERCISES.map(d => [normalizeName(d.name), d]));

export function profileFor(id: string, fallbackName?: string): ExerciseProfile {
  const meta = getExerciseMeta(id);
  let primary = meta.primaryMuscle;
  let secondaries = [meta.secondaryMuscle1, meta.secondaryMuscle2, meta.secondaryMuscle3];
  let workoutType = meta.workoutType;
  let equipment = meta.equipment;
  let weightType = meta.weightType;

  // Custom IDs with no metadata fall back to a name match against the catalog
  if (!primary && !EXERCISE_MAP.has(id)) {
    const name = fallbackName ?? getExerciseLibrary().find(e => e.id === id)?.name;
    const def = name ? nameToDef.get(normalizeName(name)) : undefined;
    if (def) {
      primary = def.primaryMuscle;
      secondaries = [...def.secondaryMuscles];
      workoutType ??= def.workoutType;
      equipment ??= def.equipment;
      weightType ??= def.weightType;
    }
  }

  const name = EXERCISE_MAP.get(id)?.name ?? fallbackName ?? catalogDefFor(id)?.name ?? id;
  const secs = secondaries.filter((m): m is MuscleGroup => m != null);
  return {
    id,
    name,
    primaryMuscle: primary,
    secondaryMuscles: secs,
    workoutType,
    equipment,
    weightType,
    mechanics: workoutType && COMPOUND_PATTERNS.has(workoutType) ? 'compound' : 'isolation',
    difficulty: difficultyFor(id),
    prerequisites: prerequisitesFor(id),
  };
}

// The internal repository, deduped: the user's library first (a custom entry
// that duplicates a catalog exercise by name shadows it, keeping the ID the
// user's history is logged under), then catalog exercises not already present.
// Tombstoned (deleted) and archived exercises never surface, and exercises
// with no resolvable primary muscle can't be reasoned about so are skipped.
export function candidateProfiles(): ExerciseProfile[] {
  const deleted = getDeletedExerciseIds();
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const out: ExerciseProfile[] = [];

  for (const ex of getExerciseLibrary()) {
    if (ex.archived) continue;
    seenIds.add(ex.id);
    seenNames.add(normalizeName(ex.name));
    const p = profileFor(ex.id, ex.name);
    if (p.primaryMuscle) out.push(p);
  }
  for (const def of EXERCISES) {
    if (deleted.has(def.id) || seenIds.has(def.id)) continue;
    if (seenNames.has(normalizeName(def.name))) continue;
    const p = profileFor(def.id);
    if (p.primaryMuscle) out.push(p);
  }
  return out;
}

// ── Ranking ───────────────────────────────────────────────────────────────────

export interface ReplacementSuggestion {
  exercise: ExerciseProfile;
  score: number;
  /** why this is a good swap, best factor first */
  reasons: string[];
  /** trade-offs worth knowing before accepting */
  cautions: string[];
}

interface Factor {
  points: number;
  reason?: string;
  caution?: string;
}

const WINDOW_DAYS = 28; // volume-rate window, matching the coach planner
const DAY_MS = 86_400_000;
const MAX_REASONS = 3;

// Context derived once per suggestion request, shared by every candidate score.
interface RankContext {
  target: ExerciseProfile;
  targetMuscles: Set<MuscleGroup>;
  /** movement patterns the rest of the day already covers */
  patternsInDay: Set<WorkoutType>;
  loggedIds: Set<string>;
  trendUp: Set<string>;
  trendDown: Set<string>;
  /** trailing weekly hard-set rate per muscle; empty when history is thin */
  weeklyRate: Map<MuscleGroup, number>;
  /** equipment seen in the user's logged history or current day */
  observedEquipment: Set<Equipment>;
}

export function suggestReplacements(
  target: Exercise,
  day: WorkoutDay,
  snapshot: TrainingSnapshot | null,
  limit = 3,
  now = Date.now(),
): ReplacementSuggestion[] {
  const targetProfile = profileFor(target.id, target.name);
  // Without a primary muscle there is no training intent to preserve — the UI
  // points the user at the metadata editor instead.
  if (!targetProfile.primaryMuscle) return [];

  const ctx = buildContext(targetProfile, day, snapshot, now);
  const dayIds = new Set(day.exercises.map(e => e.id));

  const suggestions: ReplacementSuggestion[] = [];
  for (const cand of candidateProfiles()) {
    if (cand.id === target.id || dayIds.has(cand.id)) continue;
    if (sameLift(cand.name, target.name)) continue; // same movement under another name
    const candMuscles = [cand.primaryMuscle!, ...cand.secondaryMuscles];
    if (!candMuscles.includes(targetProfile.primaryMuscle)) continue;

    const factors = scoreCandidate(cand, ctx);
    const score = factors.reduce((s, f) => s + f.points, 0);
    if (score <= 0) continue;

    const reasons = factors
      .filter(f => f.reason)
      .sort((a, b) => b.points - a.points)
      .slice(0, MAX_REASONS)
      .map(f => f.reason!);
    const cautions = factors.filter(f => f.caution).map(f => f.caution!);
    suggestions.push({ exercise: cand, score, reasons, cautions });
  }

  suggestions.sort(
    (a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name),
  );

  // The shortlist must be genuinely distinct movements: the candidate pool can
  // contain the same lift under two names ("Cable Pushdown" / "Tricep Cable
  // Pushdown"), and offering both wastes a suggestion slot. Keep the
  // higher-ranked one and let the next-best distinct movement through.
  const unique: ReplacementSuggestion[] = [];
  for (const s of suggestions) {
    if (unique.some(u => sameLift(u.exercise.name, s.exercise.name))) continue;
    unique.push(s);
    if (unique.length >= limit) break;
  }
  return unique;
}

function buildContext(
  target: ExerciseProfile,
  day: WorkoutDay,
  snapshot: TrainingSnapshot | null,
  now: number,
): RankContext {
  const patternsInDay = new Set<WorkoutType>();
  const observedEquipment = new Set<Equipment>();
  for (const ex of day.exercises) {
    const p = profileFor(ex.id, ex.name);
    if (p.equipment) observedEquipment.add(p.equipment);
    if (ex.id === target.id) continue;
    if (p.workoutType) patternsInDay.add(p.workoutType);
  }

  const loggedIds = new Set<string>();
  let trendUp = new Set<string>();
  let trendDown = new Set<string>();
  let weeklyRate = new Map<MuscleGroup, number>();

  if (snapshot) {
    for (const logs of snapshot.setsBySession.values()) {
      for (const l of logs) loggedIds.add(l.exerciseId);
    }
    // Shared multi-signal trend (progress.ts) — balanced weighting, since a
    // swap suggestion isn't tied to one goal's priorities.
    const directions = progressDirections(assessSnapshot(snapshot, 'general'));
    trendUp = directions.up;
    trendDown = directions.down;

    // Trailing weekly volume rate per muscle — same model as the coach planner,
    // so "over/under target" means the same thing everywhere.
    const windowStart = now - WINDOW_DAYS * DAY_MS;
    const inWindow = snapshot.sessions.filter(s => sessionTimestamp(s) >= windowStart);
    if (inWindow.length > 0) {
      const oldest = Math.min(...inWindow.map(sessionTimestamp));
      const weeks = Math.min(WINDOW_DAYS / 7, Math.max(1, (now - oldest) / (7 * DAY_MS)));
      const totals = muscleSetTotals(snapshot, s => sessionTimestamp(s) >= windowStart).totals;
      weeklyRate = new Map([...totals].map(([m, v]) => [m, v / weeks]));
    }

    for (const id of loggedIds) {
      const eq = profileFor(id).equipment;
      if (eq) observedEquipment.add(eq);
    }
  }

  return {
    target,
    targetMuscles: new Set([target.primaryMuscle!, ...target.secondaryMuscles]),
    patternsInDay,
    loggedIds,
    trendUp,
    trendDown,
    weeklyRate,
    observedEquipment,
  };
}

function scoreCandidate(cand: ExerciseProfile, ctx: RankContext): Factor[] {
  const { target } = ctx;
  const muscle = target.primaryMuscle!;
  const factors: Factor[] = [];

  // Training intent: direct stimulus for the slot's muscle dominates the score
  if (cand.primaryMuscle === muscle) {
    factors.push({ points: 40, reason: `Trains ${muscle} directly, like ${target.name}` });
  } else {
    factors.push({ points: 12, reason: `Works ${muscle} as a secondary mover — a lighter stimulus than ${target.name}` });
  }

  // Muscle-coverage similarity (Jaccard over the full muscle sets)
  const candMuscles = new Set([cand.primaryMuscle!, ...cand.secondaryMuscles]);
  let shared = 0;
  for (const m of candMuscles) if (ctx.targetMuscles.has(m)) shared++;
  const union = new Set([...candMuscles, ...ctx.targetMuscles]).size;
  const overlap = union > 0 ? shared / union : 0;
  factors.push({
    points: Math.round(overlap * 12),
    reason: overlap >= 0.5 ? 'Covers nearly the same muscles' : undefined,
  });

  // Movement pattern: matching the outgoing lift keeps the stimulus similar —
  // unless the rest of the day already covers that pattern, in which case the
  // swap makes the workout redundant and the similarity bonus doesn't apply.
  if (cand.workoutType) {
    if (ctx.patternsInDay.has(cand.workoutType)) {
      factors.push({
        points: -14,
        caution: `Duplicates the ${cand.workoutType} pattern already in this workout`,
      });
    } else if (cand.workoutType === target.workoutType) {
      factors.push({ points: 12, reason: `Same movement pattern (${cand.workoutType})` });
    } else {
      factors.push({ points: 4, reason: 'Brings a movement pattern the day doesn\'t have yet' });
    }
  }

  // Compound/isolation character
  if (cand.mechanics === target.mechanics) {
    factors.push({
      points: 6,
      reason: cand.mechanics === 'compound'
        ? 'Compound movement, matching the slot it replaces'
        : 'Isolation movement, matching the slot it replaces',
    });
  }

  // Loading style — same implement means recommendations translate better
  if (cand.weightType && cand.weightType === target.weightType) {
    factors.push({ points: 3 });
  }

  // Equipment the user demonstrably has access to
  if (cand.equipment) {
    if (ctx.observedEquipment.size > 0 && !ctx.observedEquipment.has(cand.equipment)) {
      factors.push({
        points: -8,
        caution: `Needs a ${cand.equipment.toLowerCase()} — not seen in your training yet`,
      });
    } else if (ctx.observedEquipment.has(cand.equipment)) {
      factors.push({ points: 6 });
    }
  }

  // Familiarity and performance history — a lift the user already knows (and
  // is progressing on) is what a coach would reach for first.
  if (ctx.loggedIds.has(cand.id)) {
    if (ctx.trendUp.has(cand.id)) {
      factors.push({ points: 18, reason: 'You\'ve trained it before and your strength on it is trending up' });
    } else {
      factors.push({ points: 13, reason: 'You\'ve trained it before — its progression history carries straight over' });
      if (ctx.trendDown.has(cand.id)) {
        factors.push({ points: -16, caution: 'Your strength on it has been declining lately' });
      }
    }
  }

  // Weekly-volume balance: extra muscles the swap drags in should help an
  // under-trained muscle, not pile onto one already at the ceiling.
  if (ctx.weeklyRate.size > 0) {
    for (const m of candMuscles) {
      if (ctx.targetMuscles.has(m)) continue;
      const rate = ctx.weeklyRate.get(m) ?? 0;
      if (rate >= SETS_TARGET_HIGH) {
        factors.push({ points: -6, caution: `Adds volume to ${m}, already at the weekly ceiling` });
      } else if (rate < SETS_TARGET_LOW) {
        factors.push({ points: 3, reason: `Bonus work for ${m}, which is under its weekly target` });
      }
    }
  }

  // Fatigue: swapping in a lift that recruits more muscles costs more recovery
  const extra = candMuscles.size - ctx.targetMuscles.size;
  if (extra > 0) factors.push({ points: -2 * extra });

  return factors;
}

// "Cable Pushdown" vs "Tricep Cable Pushdown" is the same movement wearing a
// different name — when one name's tokens are a subset of the other's, treat
// them as duplicates rather than suggesting one as a replacement for the other.
function sameLift(a: string, b: string): boolean {
  const ta = new Set(normalizeName(a).split(' '));
  const tb = new Set(normalizeName(b).split(' '));
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  return [...small].every(t => large.has(t));
}
