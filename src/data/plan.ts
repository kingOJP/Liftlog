// Training-journey domain model — the planning layer above individual workouts.
//
// Two levels, deliberately not more:
//   TrainingPlan  — a "goal era" (Muscle Growth, Strength, …). Owns a sequence
//                   of blocks. One plan is active at a time; history is
//                   unlimited. A goal transition completes the old plan and
//                   starts a new one.
//   TrainingBlock — a mesocycle: a start date, one phase tag per week, the
//                   program designed for it, and (once finished) its
//                   retrospective. Blocks are the unit of planning, review and
//                   comparison.
//
// Phases are week *tags inside a block*, not separate entities: the coach
// reasons in phases (accumulation → intensification → deload) while the user
// keeps thinking in weeks, and one array bridges both mental models. Annual
// planning, peaking blocks, rehab and return-to-training all reduce to
// "another block with a different focus and phase layout" — no new objects.
//
// Everything here is types + pure date/validation math. Persistence lives in
// planStore.ts; generation in planner.ts; review in retrospective.ts.

import type { MuscleGroup } from './taxonomy';
import type { WorkoutDay } from './program';

// ── Goals ─────────────────────────────────────────────────────────────────────

export type Goal = 'hypertrophy' | 'strength' | 'fat-loss' | 'athletic' | 'general';

export const GOALS: { id: Goal; label: string; blurb: string }[] = [
  { id: 'hypertrophy', label: 'Muscle Growth',        blurb: 'Build size with high-quality volume and double progression' },
  { id: 'strength',    label: 'Strength',             blurb: 'Move more weight on the big lifts — lower reps, longer rests' },
  { id: 'fat-loss',    label: 'Fat Loss',             blurb: 'Hold onto muscle while dieting — training defends what you built' },
  { id: 'athletic',    label: 'Athletic Performance', blurb: 'Strength plus movement quality across the whole body' },
  { id: 'general',     label: 'General Fitness',      blurb: 'Balanced full-body training you can sustain for years' },
];

export function goalLabel(goal: Goal): string {
  return GOALS.find(g => g.id === goal)?.label ?? goal;
}

// ── Training profile (the athlete, not the plan) ──────────────────────────────
// Everything the coach needs to know about *the person* to design a safe,
// appropriate plan — collected once at onboarding, pre-filled on every replan,
// and refined from logged data over time. Split into the tiers the request
// laid out: hard constraints that directly gate exercise selection, and
// calibration inputs that tune volume, loading and movement choice.

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';

export const EXPERIENCE_LEVELS: { id: ExperienceLevel; label: string; blurb: string }[] = [
  { id: 'beginner',     label: 'Beginner',     blurb: 'New to lifting, or back after a long time off — learning the movements' },
  { id: 'intermediate', label: 'Intermediate', blurb: 'A year or two of consistent training — the big lifts feel familiar' },
  { id: 'advanced',     label: 'Advanced',     blurb: 'Years under the bar — you know your body and progress is hard-won' },
];

export function experienceLabel(x: ExperienceLevel): string {
  return EXPERIENCE_LEVELS.find(e => e.id === x)?.label ?? x;
}

export type EquipmentAccess = 'full-gym' | 'home-rack' | 'dumbbells-only' | 'minimal';

export const EQUIPMENT_ACCESS: { id: EquipmentAccess; label: string; blurb: string }[] = [
  { id: 'full-gym',       label: 'Full gym',        blurb: 'Barbells, machines, cables, dumbbells — the works' },
  { id: 'home-rack',      label: 'Home gym',        blurb: 'A rack, barbell and some plates; maybe a few dumbbells' },
  { id: 'dumbbells-only', label: 'Dumbbells only',  blurb: 'A pair (or a set) of dumbbells and a bench' },
  { id: 'minimal',        label: 'Minimal / bands', blurb: 'Bodyweight, bands, the odd dumbbell — travel or home light' },
];

export interface TrainingProfile {
  // ── Tier 1: hard constraints (gate exercise selection) ──
  /** free-text injuries / limitations, parsed conservatively by the planner */
  injuries: string;
  equipment: EquipmentAccess;
  daysPerWeek: number;
  // ── Tier 2: calibration ──
  /** self-reported at onboarding; the effective level maxes this with inference */
  experience: ExperienceLevel;
  trainingAgeMonths?: number;
  /** weak points / muscles to bias volume toward */
  priorityMuscles: MuscleGroup[];
  updatedAt: number;
}

export function defaultTrainingProfile(): TrainingProfile {
  return {
    injuries: '',
    equipment: 'full-gym',
    daysPerWeek: 3,
    experience: 'beginner',
    priorityMuscles: [],
    updatedAt: 0,
  };
}

// ── Phases ────────────────────────────────────────────────────────────────────

export type PhaseKind = 'recovery' | 'accumulation' | 'intensification' | 'peak' | 'deload';

export const PHASE_INFO: Record<PhaseKind, { label: string; blurb: string }> = {
  recovery:        { label: 'Recovery',   blurb: 'Easy re-entry week — lighter loads, groove the movements' },
  accumulation:    { label: 'Build',      blurb: 'Add reps and sets — accumulate productive volume' },
  intensification: { label: 'Push',       blurb: 'Loads climb, effort climbs — chase the top of every rep range' },
  peak:            { label: 'Peak',       blurb: 'Heaviest work of the block — low reps, full recovery between sets' },
  deload:          { label: 'Deload',     blurb: 'Planned easy week — ~10% lighter so you rebound stronger' },
};

// ── Domain objects ────────────────────────────────────────────────────────────

export interface TrainingBlock {
  id: string;                    // immutable guid
  name: string;
  focus: Goal;                   // usually the plan's goal; peaking/rehab blocks may differ
  startDate: string;             // yyyy-mm-dd, local
  /** one phase per week; empty for open-ended (migrated legacy) blocks */
  phases: PhaseKind[];
  /** migrated pre-journey training — no scheduled end, no deload planning */
  openEnded?: boolean;
  /** the program as designed at activation (the live copy is liftlog_program) */
  program: WorkoutDay[];
  /** high-level coaching intent, in plain language */
  intent: string;
  /** progression philosophy for the block */
  progression: string;
  /** pending = approved but not started; its workouts install on the start date */
  status: 'pending' | 'active' | 'completed';
  activatedAt: number;
  completedAt?: number;
  retrospective?: BlockRetrospective;
}

export interface TrainingPlan {
  id: string;
  goal: Goal;
  goalNotes?: string;            // the user's open-ended guidance, kept verbatim
  origin: 'planned' | 'migrated';
  status: 'active' | 'completed';
  createdAt: number;
  completedAt?: number;
  blocks: TrainingBlock[];       // oldest first
}

// ── Retrospective (stored on a completed block) ──────────────────────────────

export interface ExerciseOutcome {
  exerciseId: string;
  name: string;
  startE1rm: number;
  endE1rm: number;
  /** e1RM change across the block (total-rep change for bodyweight work) */
  changePct: number;
  sessions: number;
  /** multi-signal verdict (progress.ts); absent on retros stored by old builds */
  status?: 'progressing' | 'steady' | 'stalled' | 'declining';
  volumeChangePct?: number | null;
  /** PR events (weight + rep) inside the block */
  prCount?: number;
}

export interface MuscleOutcome {
  muscle: MuscleGroup;
  weeklySets: number;
  status: 'low' | 'optimal' | 'high';
}

export interface BlockRetrospective {
  blockId: string;
  from: number;
  to: number;
  sessionsCompleted: number;
  /** null for open-ended blocks (no planned schedule to compare against) */
  sessionsPlanned: number | null;
  adherencePct: number | null;
  avgSessionMinutes: number | null;
  /** per-exercise e1RM change across the block, best first */
  strength: ExerciseOutcome[];
  muscles: MuscleOutcome[];
  /** coach-voice paragraphs, ready to render */
  summary: string[];
  /** signals the next planning cycle consumes */
  carryover: {
    keepExerciseIds: string[];    // progressing — earned their spot
    reviewExerciseIds: string[];  // plateaued/declining — rotation candidates
    underMuscles: MuscleGroup[];
    overMuscles: MuscleGroup[];
  };
}

// ── Date math ─────────────────────────────────────────────────────────────────
// Week boundaries snap to Monday, matching program.ts week numbering, and use
// whole-day rounding so DST's 23/25-hour days can't drift a boundary.

const DAY_MS = 86_400_000;

// Parse yyyy-mm-dd as local time (UTC parsing would shift the week boundary
// for anyone west of Greenwich).
export function parsePlanDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(year, month - 1, day);
  const valid = d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
  return valid ? d : null;
}

export function toPlanDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d;
}

/** The Monday starting the block's first week. */
export function blockAnchor(block: Pick<TrainingBlock, 'startDate'>): Date {
  return mondayOf(parsePlanDate(block.startDate) ?? new Date());
}

/** yyyy-mm-dd of the next Monday (default start for a new block). */
export function nextMonday(now = new Date()): string {
  const monday = mondayOf(now);
  monday.setDate(monday.getDate() + 7);
  return toPlanDate(monday);
}

/**
 * 0-based week index of `now` within the block. Negative before the block
 * starts; for scheduled blocks an index >= phases.length means it has ended.
 */
export function blockWeekIndex(block: TrainingBlock, now = Date.now()): number {
  const anchor = blockAnchor(block).getTime();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - anchor) / DAY_MS);
  return Math.floor(days / 7);
}

export function blockEnded(block: TrainingBlock, now = Date.now()): boolean {
  if (block.openEnded) return false;
  return blockWeekIndex(block, now) >= block.phases.length;
}

/** Exclusive end timestamp of a scheduled block (start of the week after). */
export function blockEndTs(block: TrainingBlock): number | null {
  if (block.openEnded) return null;
  return blockAnchor(block).getTime() + block.phases.length * 7 * DAY_MS;
}

/**
 * The phase governing this week's training, or null when the block hasn't
 * started / has ended. Open-ended blocks are perpetual accumulation — the
 * reactive engines (stall-triggered deloads) carry the load there.
 */
export function currentPhase(block: TrainingBlock, now = Date.now()): PhaseKind | null {
  const week = blockWeekIndex(block, now);
  if (week < 0) return null;
  if (block.openEnded) return 'accumulation';
  return week < block.phases.length ? block.phases[week] : null;
}

// ── Phase-layout validation ───────────────────────────────────────────────────
// Guardrails from the deload-planning rules: a recovery week may only open a
// block (after a completed prior block), and a deload has to be *earned* —
// at least three productive weeks of training before it, and nothing after it.

export const MIN_PRODUCTIVE_WEEKS_BEFORE_DELOAD = 3;
export const MAX_BLOCK_WEEKS = 12;

export function productiveWeeks(phases: PhaseKind[]): number {
  return phases.filter(p => p !== 'recovery' && p !== 'deload').length;
}

/** Returns a plain-language problem, or null when the layout is sound. */
export function validatePhases(phases: PhaseKind[]): string | null {
  if (phases.length === 0) return 'A block needs at least one week.';
  if (phases.length > MAX_BLOCK_WEEKS) {
    return `Blocks longer than ${MAX_BLOCK_WEEKS} weeks outrun any plan — split this into two blocks.`;
  }
  if (phases.slice(1).includes('recovery')) {
    return 'A recovery week only makes sense as the opening week after a finished block.';
  }
  const deloads = phases.filter(p => p === 'deload').length;
  if (deloads > 1) return 'One deload per block — more than that is just detraining.';
  if (deloads === 1) {
    const at = phases.indexOf('deload');
    if (at !== phases.length - 1) {
      return 'The deload closes the block — training on tired legs after an easy week wastes both.';
    }
    if (productiveWeeks(phases.slice(0, at)) < MIN_PRODUCTIVE_WEEKS_BEFORE_DELOAD) {
      return `A deload needs at least ${MIN_PRODUCTIVE_WEEKS_BEFORE_DELOAD} productive weeks before it — there's no fatigue to shed yet.`;
    }
  }
  return null;
}

export function generatePlanId(): string {
  return crypto.randomUUID();
}
