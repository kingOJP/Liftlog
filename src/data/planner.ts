// The block planner — "design the destination".
//
// buildPlanProposal() turns a goal + a handful of constraints + the user's
// entire training history into a complete, explained training-block proposal:
// split, phase layout (weeks tagged accumulation/intensification/peak/deload),
// generated workouts, and a per-exercise decision trail (kept / new /
// replacement, each with a reason). The existing in-workout engines then
// "optimize the journey": recommendations.ts moves loads session to session
// and coach.ts nudges set counts — both within the block this planner designed.
//
// Same architecture rules as every other engine in data/:
//   - a pure function of (input, current program, TrainingSnapshot,
//     previous retrospective) — no storage writes, fully unit-testable
//   - candidates come through the ExerciseProfile seam (substitution.ts), so
//     any future source — an LLM proposing exercises, coach-curated packs —
//     plugs in by producing profiles/proposals of the same shape, and the
//     review-and-activate flow stays identical
//   - every meaningful decision carries a plain-language reason, and the
//     proposal declares its own confidence: history-backed picks say so,
//     defaults admit they're defaults

import type { MuscleGroup, WorkoutType, Equipment, WeightType } from './taxonomy';
import type { Exercise, WorkoutDay } from './program';
import type { TrainingSnapshot } from './analytics';
import { assessSnapshot, progressDirections } from './progress';
import type { ExerciseProfile } from './substitution';
import { candidateProfiles, profileFor } from './substitution';
import { DIFFICULTY_RANK } from './exercises';
import type { Goal, PhaseKind, BlockRetrospective, EquipmentAccess, ExperienceLevel } from './plan';
import { goalLabel, experienceLabel, validatePhases, MIN_PRODUCTIVE_WEEKS_BEFORE_DELOAD } from './plan';

// ── Input / output ────────────────────────────────────────────────────────────

export interface PlannerInput {
  goal: Goal;
  daysPerWeek: number;        // 2..6
  weeks: number;              // block length incl. recovery/deload weeks
  includeDeload: boolean;
  /** open with an easy re-entry week (offered after a completed block) */
  openWithRecovery: boolean;
  startDate: string;          // yyyy-mm-dd
  notes: string;              // open-ended guidance, kept verbatim on the plan
  // ── Athlete profile (from the onboarding TrainingProfile) ──
  /** effective experience — self-report maxed with data-driven inference */
  experience: ExperienceLevel;
  /** structured equipment access; complements free-text notes for constraints */
  equipmentAccess?: EquipmentAccess;
  /** muscles to bias extra volume toward (weak points / priorities) */
  priorityMuscles?: MuscleGroup[];
  /** injuries/limitations — parsed alongside notes into hard constraints */
  injuries?: string;
}

export interface PlannerConfidence {
  level: 'low' | 'medium' | 'high';
  sessions: number;
  detail: string;
}

export interface ExerciseDecision {
  exerciseId: string;
  name: string;
  dayId: number;
  status: 'kept' | 'new' | 'replacement';
  replacesName?: string;
  reason: string;
}

export interface PlanProposal {
  input: PlannerInput;
  confidence: PlannerConfidence;
  splitName: string;
  splitReason: string;
  phases: PhaseKind[];
  /** why the deload/recovery weeks sit where they sit */
  phaseNotes: string[];
  days: WorkoutDay[];
  decisions: ExerciseDecision[];
  /** what the planner understood from the user's notes */
  guidanceNotes: string[];
  /** projected weekly hard sets per muscle (primary 1, secondary 0.5) */
  muscleWeeklySets: { muscle: MuscleGroup; sets: number }[];
  intent: string;
  progression: string;
  warnings: string[];
}

// ── Open-ended guidance parsing ───────────────────────────────────────────────
// Deliberately conservative: a handful of unambiguous patterns (equipment
// limits, common joint issues). Every match is echoed back as a guidance note
// so the user sees exactly what was understood — anything the parser can't
// read stays visible on the plan and actionable through the review step.

interface Guidance {
  bannedWeightTypes: Set<WeightType>;
  bannedEquipment: Set<Equipment>;
  avoidPatterns: Set<WorkoutType>;
  avoidNameParts: string[];
  notes: string[];
}

export function parseGuidance(raw: string): Guidance {
  const g: Guidance = {
    bannedWeightTypes: new Set(),
    bannedEquipment: new Set(),
    avoidPatterns: new Set(),
    avoidNameParts: [],
    notes: [],
  };
  const text = raw.toLowerCase();
  if (text.trim().length === 0) return g;

  if (/\bdumbbells?\s*only\b|\bonly\s+(have\s+)?dumbbells\b/.test(text)) {
    for (const w of ['Barbell', 'EZ Bar', 'Machine', 'Kettlebell'] as WeightType[]) g.bannedWeightTypes.add(w);
    for (const e of ['Cable Machine', 'Machine', 'Smith Machine', 'Squat Rack'] as Equipment[]) g.bannedEquipment.add(e);
    g.notes.push('Dumbbell-only setup — no barbell, cable or machine work in this plan.');
  } else {
    if (/\b(no|without a?|don'?t have a?)\s*barbell\b/.test(text)) {
      g.bannedWeightTypes.add('Barbell');
      g.notes.push('No barbell available — dumbbell and machine alternatives cover the heavy work.');
    }
    if (/\bhome gym\b|\bno (cable|machine)s?\b|\btraining at home\b/.test(text)) {
      g.bannedEquipment.add('Cable Machine');
      g.bannedEquipment.add('Machine');
      g.bannedEquipment.add('Smith Machine');
      g.notes.push('Home setup — machine and cable exercises are swapped for free-weight versions.');
    }
  }

  const hurt = '(pain|injur\\w*|hurt\\w*|issue|problem|tweak\\w*|surgery)';
  const near = '[^.,;!?]{0,30}';
  if (new RegExp(`knee${near}${hurt}|${hurt}${near}knee`).test(text)) {
    g.avoidPatterns.add('Squat');
    g.avoidPatterns.add('Lunge');
    g.avoidPatterns.add('Leg Extension');
    g.notes.push('Knee issue noted — squats, lunges and leg extensions are out; pressing and hinging carry the legs. Start lighter than feels necessary.');
  }
  if (new RegExp(`shoulder${near}${hurt}|${hurt}${near}shoulder`).test(text)) {
    g.avoidPatterns.add('Dip');
    g.avoidNameParts.push('overhead');
    g.notes.push('Shoulder issue noted — no overhead pressing or dips; horizontal pressing and raises stay.');
  }
  if (new RegExp(`(lower\\s+)?back${near}${hurt}|${hurt}${near}(lower\\s+)?back\\b`).test(text)) {
    g.avoidPatterns.add('Hip Hinge');
    g.avoidPatterns.add('Squat');
    g.notes.push('Lower-back issue noted — barbell hinges and squats are out; supported machine work covers the posterior chain.');
  }

  if (g.notes.length === 0) {
    g.notes.push('Notes saved with the plan — review the workouts below and swap anything that doesn\'t fit.');
  }
  return g;
}

// Structured equipment access → the same constraint shape. Applied on top of
// the free-text parse so a picked "Dumbbells only" and a typed "no barbell"
// compound rather than fight.
function applyEquipmentAccess(g: Guidance, access: EquipmentAccess | undefined): void {
  if (!access || access === 'full-gym') return;
  const ban = (ws: WeightType[], es: Equipment[]) => {
    for (const w of ws) g.bannedWeightTypes.add(w);
    for (const e of es) g.bannedEquipment.add(e);
  };
  if (access === 'home-rack') {
    // Rack + barbell + some plates, but no selectorized machines or cables.
    ban([], ['Cable Machine', 'Machine', 'Smith Machine']);
    g.notes.push('Home gym with a rack — machine and cable work is swapped for barbell, dumbbell and bodyweight versions.');
  } else if (access === 'dumbbells-only') {
    ban(['Barbell', 'EZ Bar', 'Machine', 'Kettlebell'], ['Cable Machine', 'Machine', 'Smith Machine', 'Squat Rack', 'Pull Up Bar', 'Dip Station']);
    g.notes.push('Dumbbell-only setup — the whole plan is built from dumbbell and bodyweight movements.');
  } else if (access === 'minimal') {
    ban(['Barbell', 'EZ Bar', 'Machine'], ['Cable Machine', 'Machine', 'Smith Machine', 'Squat Rack']);
    g.notes.push('Minimal equipment — bodyweight, bands and dumbbell work carry the plan; loads matter less than effort here.');
  }
}

// ── Split templates ───────────────────────────────────────────────────────────
// Each slot names the training intent (muscle + acceptable movement patterns);
// the selector fills it with the best exercise the user's history supports.
// Templates are pre-calibrated so the weekly per-muscle volume lands inside
// the 10–20 hard-set band at default set counts.

interface Slot {
  muscle: MuscleGroup;
  patterns?: WorkoutType[];     // preference order; hard-filtered, with fallback
  mechanics?: 'compound' | 'isolation';
  main?: boolean;               // the day's heavy anchor — more sets, lower reps
}

interface DayTemplate {
  title: string;                // rendered as the day's muscleGroups line
  slots: Slot[];
}

function splitFor(
  daysPerWeek: number,
  experience: ExperienceLevel = 'intermediate',
): { name: string; reason: string; days: DayTemplate[]; warning?: string } {
  const upperA: DayTemplate = {
    title: 'Upper — Chest, Back, Arms',
    slots: [
      { muscle: 'Chest',      patterns: ['Press'], mechanics: 'compound', main: true },
      { muscle: 'Upper Back', patterns: ['Row'], mechanics: 'compound', main: true },
      { muscle: 'Delts',      patterns: ['Press', 'Lateral Raise'] },
      { muscle: 'Lats',       patterns: ['Pull Down', 'Pull Up'] },
      { muscle: 'Triceps',    patterns: ['Tricep Extension', 'Dip'] },
      { muscle: 'Biceps',     patterns: ['Curl'] },
    ],
  };
  const lowerA: DayTemplate = {
    title: 'Lower — Quads, Hamstrings, Glutes',
    slots: [
      { muscle: 'Quads',      patterns: ['Squat', 'Leg Press'], mechanics: 'compound', main: true },
      { muscle: 'Hamstrings', patterns: ['Hip Hinge', 'Leg Curl'], main: true },
      { muscle: 'Glutes',     patterns: ['Hip Thrust', 'Lunge'] },
      { muscle: 'Quads',      patterns: ['Leg Extension', 'Lunge'] },
      { muscle: 'Calves',     patterns: ['Calf Raise'] },
    ],
  };
  const upperB: DayTemplate = {
    title: 'Upper — Shoulders, Back, Chest',
    slots: [
      { muscle: 'Lats',       patterns: ['Pull Up', 'Pull Down'], mechanics: 'compound', main: true },
      { muscle: 'Chest',      patterns: ['Press', 'Fly'], main: true },
      { muscle: 'Delts',      patterns: ['Lateral Raise'] },
      { muscle: 'Upper Back', patterns: ['Row'] },
      { muscle: 'Delts',      patterns: ['Face Pull', 'Reverse Fly'] },
      { muscle: 'Biceps',     patterns: ['Curl'] },
      { muscle: 'Triceps',    patterns: ['Tricep Extension', 'Dip'] },
    ],
  };
  const lowerB: DayTemplate = {
    title: 'Lower — Hamstrings, Quads, Calves',
    slots: [
      { muscle: 'Hamstrings', patterns: ['Leg Curl', 'Hip Hinge'], main: true },
      { muscle: 'Quads',      patterns: ['Leg Press', 'Squat', 'Lunge'], mechanics: 'compound', main: true },
      { muscle: 'Glutes',     patterns: ['Hip Thrust', 'Hip Hinge'] },
      { muscle: 'Calves',     patterns: ['Calf Raise'] },
      { muscle: 'Abs',        patterns: ['Crunch'] },
    ],
  };
  const push: DayTemplate = {
    title: 'Push — Chest, Delts, Triceps',
    slots: [
      { muscle: 'Chest',   patterns: ['Press'], mechanics: 'compound', main: true },
      { muscle: 'Chest',   patterns: ['Fly', 'Dip', 'Press'] },
      { muscle: 'Delts',   patterns: ['Press', 'Lateral Raise'] },
      { muscle: 'Delts',   patterns: ['Lateral Raise'] },
      { muscle: 'Triceps', patterns: ['Tricep Extension', 'Dip'] },
      { muscle: 'Triceps', patterns: ['Tricep Extension'] },
    ],
  };
  const pull: DayTemplate = {
    title: 'Pull — Back, Rear Delts, Biceps',
    slots: [
      { muscle: 'Lats',       patterns: ['Pull Down', 'Pull Up'], mechanics: 'compound', main: true },
      { muscle: 'Upper Back', patterns: ['Row'], mechanics: 'compound', main: true },
      { muscle: 'Lats',       patterns: ['Pull Over', 'Pull Down', 'Row'] },
      { muscle: 'Delts',      patterns: ['Face Pull', 'Reverse Fly'] },
      { muscle: 'Biceps',     patterns: ['Curl'] },
      { muscle: 'Biceps',     patterns: ['Curl'] },
    ],
  };
  const legs: DayTemplate = {
    title: 'Legs — Quads, Hamstrings, Calves',
    slots: [
      { muscle: 'Quads',      patterns: ['Squat', 'Leg Press'], mechanics: 'compound', main: true },
      { muscle: 'Hamstrings', patterns: ['Hip Hinge', 'Leg Curl'], main: true },
      { muscle: 'Quads',      patterns: ['Leg Extension', 'Lunge'] },
      { muscle: 'Glutes',     patterns: ['Hip Thrust', 'Lunge'] },
      { muscle: 'Calves',     patterns: ['Calf Raise'] },
    ],
  };
  const fullA: DayTemplate = {
    title: 'Full Body A',
    slots: [
      { muscle: 'Quads',      patterns: ['Squat', 'Leg Press'], mechanics: 'compound', main: true },
      { muscle: 'Chest',      patterns: ['Press'], mechanics: 'compound', main: true },
      { muscle: 'Upper Back', patterns: ['Row'] },
      { muscle: 'Delts',      patterns: ['Lateral Raise'] },
      { muscle: 'Calves',     patterns: ['Calf Raise'] },
    ],
  };
  const fullB: DayTemplate = {
    title: 'Full Body B',
    slots: [
      { muscle: 'Hamstrings', patterns: ['Hip Hinge', 'Leg Curl'], main: true },
      { muscle: 'Lats',       patterns: ['Pull Down', 'Pull Up'], mechanics: 'compound', main: true },
      { muscle: 'Delts',      patterns: ['Press', 'Lateral Raise'] },
      { muscle: 'Biceps',     patterns: ['Curl'] },
      { muscle: 'Abs',        patterns: ['Crunch'] },
    ],
  };
  const fullC: DayTemplate = {
    title: 'Full Body C',
    slots: [
      { muscle: 'Quads',      patterns: ['Leg Press', 'Lunge', 'Squat'], main: true },
      { muscle: 'Chest',      patterns: ['Fly', 'Press'] },
      { muscle: 'Upper Back', patterns: ['Row'] },
      { muscle: 'Glutes',     patterns: ['Hip Thrust'] },
      { muscle: 'Triceps',    patterns: ['Tricep Extension', 'Dip'] },
    ],
  };

  const days = Math.min(6, Math.max(2, daysPerWeek));

  // Beginners learn fastest and recover best on full-body, high-frequency
  // training — every session is practice on every movement. Cap the split so a
  // novice who picks 5–6 days still gets a beginner-appropriate layout (and a
  // gentle nudge that fewer days would serve them better), never a bro-split.
  if (experience === 'beginner') {
    if (days <= 2) return {
      name: 'Full Body ×2',
      reason: 'Two full-body sessions a week hit every movement twice — the ideal way to build skill and strength when you\'re starting out.',
      days: [fullA, fullB],
    };
    if (days === 3) return {
      name: 'Full Body ×3',
      reason: 'Three full-body days is the most-validated beginner program there is: you practise the big movements often, recover between sessions, and progress week to week.',
      days: [fullA, fullB, fullC],
    };
    return {
      name: 'Upper / Lower ×2',
      reason: 'Four days split upper/lower keeps each session short while training everything twice a week — plenty of frequency without the volume of a body-part split.',
      days: [upperA, lowerA, upperB, lowerB],
      warning: days >= 5
        ? `You picked ${days} days, but as a beginner you'll build faster on 3–4 — recovery, not gym time, is the limiter early on. This plan uses 4 focused days; add the extra day as a walk or mobility session.`
        : undefined,
    };
  }

  switch (days) {
    case 2: return {
      name: 'Full Body ×2',
      reason: 'Two sessions cover every muscle twice a week — at this schedule, full-body training is the only layout that hits the frequency research keeps validating.',
      days: [fullA, fullB],
    };
    case 3: return {
      name: 'Full Body ×3',
      reason: 'Three full-body days train everything ~1.5–2× a week with a rest day between sessions — the highest-return schedule per gym hour.',
      days: [fullA, fullB, fullC],
    };
    case 4: return {
      name: 'Upper / Lower ×2',
      reason: 'Four days split upper/lower trains every muscle twice a week — the frequency sweet spot — while keeping each session under an hour.',
      days: [upperA, lowerA, upperB, lowerB],
    };
    case 5: return {
      name: 'Push / Pull / Legs + Upper / Lower',
      reason: 'Five days blend a push/pull/legs cycle with an upper/lower pair, so every muscle still lands twice a week without any session turning into a marathon.',
      days: [push, pull, legs, upperA, lowerA],
    };
    default: return {
      name: 'Push / Pull / Legs ×2',
      reason: 'Six days run the push/pull/legs cycle twice — maximum volume distribution with every muscle trained twice a week.',
      days: [push, pull, legs, push, pull, legs],
    };
  }
}

// ── Dosage (sets × rep range) by goal ─────────────────────────────────────────

const HIGH_REP_PATTERNS = new Set<WorkoutType>([
  'Lateral Raise', 'Calf Raise', 'Face Pull', 'Reverse Fly', 'Crunch',
]);

function dosage(
  goal: Goal,
  slot: Slot,
  profile: ExerciseProfile,
  experience: ExperienceLevel,
): Pick<Exercise, 'sets' | 'repLow' | 'repHigh'> {
  if (profile.workoutType && HIGH_REP_PATTERNS.has(profile.workoutType)) {
    return experience === 'beginner' ? { sets: 2, repLow: 12, repHigh: 20 } : { sets: 3, repLow: 12, repHigh: 20 };
  }
  const compound = profile.mechanics === 'compound';

  // Beginners: submaximal loads, moderate reps, and fewer sets. Rep ranges
  // never drop below 8 — a novice building technique should not be grinding
  // near-maximal singles/triples, whatever their stated goal. Lower set counts
  // keep total volume in the range a new lifter actually recovers from.
  if (experience === 'beginner') {
    if (slot.main && compound) return { sets: 3, repLow: 8, repHigh: 12 };
    if (compound) return { sets: 2, repLow: 8, repHigh: 12 };
    return { sets: 2, repLow: 10, repHigh: 15 };
  }

  if (slot.main && compound) {
    if (goal === 'strength') return { sets: 4, repLow: 4, repHigh: 6 };
    if (goal === 'athletic') return { sets: 4, repLow: 5, repHigh: 8 };
    if (goal === 'hypertrophy') return { sets: 3, repLow: 6, repHigh: 10 };
    return { sets: 3, repLow: 8, repHigh: 12 };
  }
  if (compound) {
    return goal === 'strength' ? { sets: 3, repLow: 6, repHigh: 10 } : { sets: 3, repLow: 8, repHigh: 12 };
  }
  // isolation
  if (goal === 'strength') return { sets: 3, repLow: 8, repHigh: 12 };
  if (goal === 'hypertrophy') return { sets: 3, repLow: 10, repHigh: 15 };
  return { sets: 3, repLow: 12, repHigh: 15 };
}

// ── Phase layout ──────────────────────────────────────────────────────────────

export function defaultBlockWeeks(): number {
  return 6;
}

export function buildPhases(
  input: Pick<PlannerInput, 'goal' | 'weeks' | 'includeDeload' | 'openWithRecovery'>,
  previousRetro?: BlockRetrospective | null,
): { phases: PhaseKind[]; notes: string[]; warnings: string[] } {
  const notes: string[] = [];
  const warnings: string[] = [];
  const weeks = Math.min(12, Math.max(3, Math.round(input.weeks)));

  const recovery = input.openWithRecovery ? 1 : 0;
  let deload = input.includeDeload ? 1 : 0;
  let productive = weeks - recovery - deload;
  if (deload && productive < MIN_PRODUCTIVE_WEEKS_BEFORE_DELOAD) {
    // A deload has to be earned — with too few hard weeks it's just detraining.
    deload = 0;
    productive = weeks - recovery;
    warnings.push(
      `Dropped the closing deload: a ${weeks}-week block${recovery ? ' with a recovery opener' : ''} leaves fewer than ${MIN_PRODUCTIVE_WEEKS_BEFORE_DELOAD} productive weeks to earn one. Extend the block to get it back.`,
    );
  }

  const phases: PhaseKind[] = [];
  if (recovery) phases.push('recovery');
  if (input.goal === 'strength' && productive >= 4) {
    const acc = Math.ceil((productive - 1) / 2);
    const int = productive - 1 - acc;
    for (let i = 0; i < acc; i++) phases.push('accumulation');
    for (let i = 0; i < int; i++) phases.push('intensification');
    phases.push('peak');
  } else {
    const acc = Math.ceil(productive * 0.6);
    for (let i = 0; i < productive; i++) phases.push(i < acc ? 'accumulation' : 'intensification');
  }
  if (deload) phases.push('deload');

  if (recovery) {
    notes.push('Week 1 is a recovery week — you just closed out a block, and easing back in beats grinding back in.');
  }
  if (deload) {
    const stalls = previousRetro?.carryover.reviewExerciseIds.length ?? 0;
    notes.push(
      `The deload lands in week ${phases.length} — after ${productive} hard weeks, fatigue starts masking fitness; one planned easy week lets it show.` +
      (stalls > 0 ? ` Your last block ended with ${stalls} stalled lift${stalls === 1 ? '' : 's'}, so this one is non-negotiable.` : ''),
    );
  } else if (!input.includeDeload) {
    notes.push('No deload scheduled — the block simply ends. The in-workout coach still deloads any single lift that stalls.');
  }

  const problem = validatePhases(phases);
  if (problem) warnings.push(problem); // should be unreachable; belt and braces

  return { phases, notes, warnings };
}

// ── Exercise selection ────────────────────────────────────────────────────────

interface SelectCtx {
  goal: Goal;
  experience: ExperienceLevel;
  byMuscle: Map<MuscleGroup, ExerciseProfile[]>;
  used: Set<string>;
  currentIds: Set<string>;
  trendUp: Set<string>;
  trendDown: Set<string>;
  loggedIds: Set<string>;
  observedEquipment: Set<Equipment>;
  keep: Set<string>;
  review: Set<string>;
}

// Can this athlete be programmed this exercise right now? Advanced-tagged lifts
// are gated for beginners behind their prerequisites: a novice shouldn't be
// handed a conventional deadlift before they've trained a hinge. Intermediate+
// lifters clear the gate outright.
function meetsSkillGate(p: ExerciseProfile, ctx: SelectCtx): boolean {
  if (ctx.experience !== 'beginner') return true;
  if (DIFFICULTY_RANK[p.difficulty] < DIFFICULTY_RANK.advanced) return true;
  // Advanced lift + beginner: allowed once they've trained the lift itself or
  // at least one prerequisite for it.
  return ctx.loggedIds.has(p.id) || p.prerequisites.some(id => ctx.loggedIds.has(id));
}

function allowedByGuidance(p: ExerciseProfile, g: Guidance): boolean {
  if (p.weightType && g.bannedWeightTypes.has(p.weightType)) return false;
  if (p.equipment && g.bannedEquipment.has(p.equipment)) return false;
  if (p.workoutType && g.avoidPatterns.has(p.workoutType)) return false;
  const lower = p.name.toLowerCase();
  if (g.avoidNameParts.some(part => lower.includes(part))) return false;
  return true;
}

function scoreCandidate(p: ExerciseProfile, slot: Slot, ctx: SelectCtx): number {
  let score = 0;
  if (slot.patterns && p.workoutType) {
    const idx = slot.patterns.indexOf(p.workoutType);
    if (idx >= 0) score += 12 - idx * 2;
  }
  if (slot.mechanics) score += p.mechanics === slot.mechanics ? 6 : -6;
  if (ctx.currentIds.has(p.id)) score += ctx.review.has(p.id) ? -10 : 12;
  if (ctx.keep.has(p.id)) score += 8;
  if (ctx.trendUp.has(p.id)) score += 10;
  if (ctx.trendDown.has(p.id)) score -= 12;
  if (ctx.review.has(p.id) && !ctx.currentIds.has(p.id)) score -= 6;
  if (ctx.loggedIds.has(p.id)) score += 6;
  if (p.equipment && ctx.observedEquipment.size > 0) {
    score += ctx.observedEquipment.has(p.equipment) ? 4 : -5;
  }

  // Difficulty fit. Beginners are steered hard toward low-skill movements they
  // can load safely on day one; advanced lifters get a nudge toward the
  // free-weight compounds that reward their base. Intermediate is neutral.
  const rank = DIFFICULTY_RANK[p.difficulty];
  if (ctx.experience === 'beginner') {
    if (rank === DIFFICULTY_RANK.beginner) score += 14;
    else if (rank === DIFFICULTY_RANK.advanced) score -= 16;
  } else if (ctx.experience === 'advanced') {
    if (rank >= DIFFICULTY_RANK.intermediate) score += 4;
  }
  return score;
}

function reasonFor(p: ExerciseProfile, slot: Slot, ctx: SelectCtx): string {
  if (ctx.currentIds.has(p.id)) {
    if (ctx.trendUp.has(p.id)) return 'Kept — your strength on it is climbing, and momentum like that is never rotated away.';
    if (ctx.review.has(p.id)) return 'Kept despite a recent stall — no stronger alternative fit this slot; the deload should unstick it.';
    return 'Kept from your current program — consistency on a lift you know compounds faster than novelty.';
  }
  if (ctx.loggedIds.has(p.id)) {
    if (ctx.trendUp.has(p.id)) return 'Brought back — it was producing progress when you last trained it.';
    return 'You\'ve trained it before, so its progression history carries straight over.';
  }
  if (ctx.experience === 'beginner' && p.difficulty === 'beginner') {
    return `Beginner-friendly ${slot.muscle} work — easy to learn and load safely while you build a base.`;
  }
  const pattern = p.workoutType ? ` (${p.workoutType.toLowerCase()})` : '';
  return `Direct ${slot.muscle} work${pattern} — an evidence-based pick for this slot.`;
}

function pickForSlot(slot: Slot, ctx: SelectCtx, guidance: Guidance): { profile: ExerciseProfile; reason: string } | null {
  let pool = (ctx.byMuscle.get(slot.muscle) ?? []).filter(
    p => !ctx.used.has(p.id) && allowedByGuidance(p, guidance),
  );
  if (pool.length === 0) return null;

  // Skill gate: hide advanced lifts a beginner hasn't earned — unless nothing
  // else is left for the muscle, in which case a scored penalty still applies.
  const gated = pool.filter(p => meetsSkillGate(p, ctx));
  if (gated.length > 0) pool = gated;

  // Prefer candidates matching the slot's movement patterns; fall back to any
  // exercise for the muscle when constraints (equipment, injuries) empty that set.
  const patternPool = slot.patterns
    ? pool.filter(p => p.workoutType != null && slot.patterns!.includes(p.workoutType))
    : pool;
  const candidates = patternPool.length > 0 ? patternPool : pool;

  candidates.sort((a, b) =>
    scoreCandidate(b, slot, ctx) - scoreCandidate(a, slot, ctx) || a.name.localeCompare(b.name),
  );
  const best = candidates[0];
  return { profile: best, reason: reasonFor(best, slot, ctx) };
}

// ── Confidence ────────────────────────────────────────────────────────────────

function confidenceFor(snapshot: TrainingSnapshot | null, experience: ExperienceLevel = 'intermediate'): PlannerConfidence {
  const sessions = snapshot?.sessions.length ?? 0;
  if (sessions === 0) {
    return {
      level: 'low', sessions,
      detail: `No training history yet, so this plan leans on established exercise science, calibrated for a ${experienceLabel(experience).toLowerCase()} lifter. It gets personal fast — every workout you log sharpens the next block.`,
    };
  }
  if (sessions < 12) {
    return {
      level: 'medium', sessions,
      detail: `Built from ${sessions} logged workout${sessions === 1 ? '' : 's'} plus evidence-based defaults — enough to keep what's working, not yet enough to read every trend.`,
    };
  }
  return {
    level: 'high', sessions,
    detail: `Grounded in ${sessions} logged workouts — exercise selection and volume reflect what has actually produced progress for you.`,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const MINUTES_PER_SET = 3;       // matches the coach planner's estimate
const SESSION_OVERHEAD_MIN = 10;
const LONG_SESSION_MIN = 95;

export function buildPlanProposal(
  input: PlannerInput,
  currentProgram: WorkoutDay[],
  snapshot: TrainingSnapshot | null,
  previousRetro: BlockRetrospective | null = null,
): PlanProposal {
  // Injuries and free-text notes are parsed together, then structured
  // equipment access is layered on top.
  const guidance = parseGuidance([input.notes, input.injuries ?? ''].join('. '));
  applyEquipmentAccess(guidance, input.equipmentAccess);
  const split = splitFor(input.daysPerWeek, input.experience);
  const { phases, notes: phaseNotes, warnings } = buildPhases(input, previousRetro);
  if (split.warning) warnings.push(split.warning);
  const confidence = confidenceFor(snapshot, input.experience);

  // History-derived context (all optional — the planner works from zero).
  // Direction comes from the shared multi-signal assessment (progress.ts),
  // weighted for the goal this plan is built around.
  let trendUp = new Set<string>();
  let trendDown = new Set<string>();
  const loggedIds = new Set<string>();
  const observedEquipment = new Set<Equipment>();
  if (snapshot) {
    for (const logs of snapshot.setsBySession.values()) {
      for (const l of logs) loggedIds.add(l.exerciseId);
    }
    const directions = progressDirections(assessSnapshot(snapshot, input.goal));
    trendUp = directions.up;
    trendDown = directions.down;
    for (const id of loggedIds) {
      const eq = profileFor(id).equipment;
      if (eq) observedEquipment.add(eq);
    }
  }

  const byMuscle = new Map<MuscleGroup, ExerciseProfile[]>();
  for (const p of candidateProfiles()) {
    if (!p.primaryMuscle) continue;
    const arr = byMuscle.get(p.primaryMuscle);
    if (arr) arr.push(p);
    else byMuscle.set(p.primaryMuscle, [p]);
  }

  const currentIds = new Set(currentProgram.flatMap(d => d.exercises.map(e => e.id)));
  const currentNameById = new Map(
    currentProgram.flatMap(d => d.exercises.map(e => [e.id, e.name] as const)),
  );

  const ctx: SelectCtx = {
    goal: input.goal,
    experience: input.experience,
    byMuscle,
    used: new Set<string>(),
    currentIds,
    trendUp,
    trendDown,
    loggedIds,
    observedEquipment,
    keep: new Set(previousRetro?.carryover.keepExerciseIds ?? []),
    review: new Set([
      ...(previousRetro?.carryover.reviewExerciseIds ?? []),
      ...trendDown, // a declining lift is a rotation candidate even without a retro
    ]),
  };

  const days: WorkoutDay[] = [];
  const decisions: ExerciseDecision[] = [];

  split.days.forEach((template, i) => {
    const dayId = i + 1;
    const exercises: Exercise[] = [];
    for (const slot of template.slots) {
      const picked = pickForSlot(slot, ctx, guidance);
      if (!picked) {
        warnings.push(`Couldn't find a ${slot.muscle} exercise matching your constraints for Day ${dayId} — add one manually if you want that slot filled.`);
        continue;
      }
      ctx.used.add(picked.profile.id);
      const dose = dosage(input.goal, slot, picked.profile, input.experience);
      exercises.push({ id: picked.profile.id, name: picked.profile.name, ...dose });
      decisions.push({
        exerciseId: picked.profile.id,
        name: picked.profile.name,
        dayId,
        status: ctx.currentIds.has(picked.profile.id) ? 'kept' : 'new',
        reason: picked.reason,
      });
    }
    days.push({ id: dayId, label: `Day ${dayId}`, muscleGroups: template.title, exercises });
  });

  // Pair fresh picks with the stalled current-program lifts they displace, so
  // the review reads as a coach's rotation call, not an unexplained dropout.
  const displaced = [...currentIds].filter(id => ctx.review.has(id) && !ctx.used.has(id));
  for (const d of decisions) {
    if (d.status !== 'new' || displaced.length === 0) continue;
    const primary = profileFor(d.exerciseId).primaryMuscle;
    const matchIdx = displaced.findIndex(id => profileFor(id, currentNameById.get(id)).primaryMuscle === primary);
    if (matchIdx === -1) continue;
    const oldId = displaced.splice(matchIdx, 1)[0];
    const oldName = currentNameById.get(oldId) ?? oldId;
    d.status = 'replacement';
    d.replacesName = oldName;
    d.reason = `Fresh stimulus for ${primary} — ${oldName} has stalled, and rotating the movement is how a plateau gets broken.`;
  }

  // Volume rebalancing from the last block's findings: one extra set where a
  // muscle under-responded, one fewer where volume ran past the ceiling.
  if (previousRetro) {
    for (const muscle of previousRetro.carryover.underMuscles) {
      bumpSets(days, decisions, muscle, +1, `+1 set — ${muscle} finished last block under its weekly volume target.`);
    }
    for (const muscle of previousRetro.carryover.overMuscles) {
      bumpSets(days, decisions, muscle, -1, `−1 set — ${muscle} ran past the weekly ceiling last block; trimming protects recovery.`);
    }
  }

  // Priority muscles (weak points the athlete flagged) get an extra set each,
  // within the same guardrails — a targeted bias toward what they care about.
  for (const muscle of input.priorityMuscles ?? []) {
    bumpSets(days, decisions, muscle, +1, `+1 set — you flagged ${muscle} as a priority, so it gets extra volume.`);
  }

  // Projected weekly volume per muscle (primary 1, secondary 0.5)
  const weekly = new Map<MuscleGroup, number>();
  for (const day of days) {
    for (const ex of day.exercises) {
      const p = profileFor(ex.id, ex.name);
      if (p.primaryMuscle) weekly.set(p.primaryMuscle, (weekly.get(p.primaryMuscle) ?? 0) + ex.sets);
      for (const m of p.secondaryMuscles) weekly.set(m, (weekly.get(m) ?? 0) + ex.sets * 0.5);
    }
  }
  const muscleWeeklySets = [...weekly]
    .map(([muscle, sets]) => ({ muscle, sets: Math.round(sets * 2) / 2 }))
    .sort((a, b) => b.sets - a.sets);

  for (const day of days) {
    const setCount = day.exercises.reduce((s, e) => s + e.sets, 0);
    const est = SESSION_OVERHEAD_MIN + setCount * MINUTES_PER_SET;
    if (est > LONG_SESSION_MIN) {
      warnings.push(`Day ${day.id} projects ~${est} minutes — trim a set or drop an exercise if that doesn't fit your schedule.`);
    }
  }

  return {
    input,
    confidence,
    splitName: split.name,
    splitReason: split.reason,
    phases,
    phaseNotes,
    days,
    decisions,
    guidanceNotes: guidance.notes,
    muscleWeeklySets,
    intent: intentFor(input, split.name, phases),
    progression: progressionFor(input.goal, phases, input.experience),
    warnings,
  };
}

// +/- one set on the exercise doing the most direct work for the muscle,
// within the same 2–5 set guardrails the in-block coach uses.
function bumpSets(
  days: WorkoutDay[],
  decisions: ExerciseDecision[],
  muscle: MuscleGroup,
  delta: 1 | -1,
  note: string,
): void {
  let best: Exercise | null = null;
  for (const day of days) {
    for (const ex of day.exercises) {
      if (profileFor(ex.id, ex.name).primaryMuscle !== muscle) continue;
      if (delta > 0 && ex.sets >= 5) continue;
      if (delta < 0 && ex.sets <= 2) continue;
      if (!best || (delta > 0 ? ex.sets < best.sets : ex.sets > best.sets)) best = ex;
    }
  }
  if (!best) return;
  best.sets += delta;
  const d = decisions.find(dec => dec.exerciseId === best!.id);
  if (d) d.reason = `${d.reason} ${note}`;
}

function intentFor(input: PlannerInput, splitName: string, phases: PhaseKind[]): string {
  const weeks = phases.length;
  const deload = phases[phases.length - 1] === 'deload';
  const arc = deload
    ? `build for ${weeks - (phases[0] === 'recovery' ? 2 : 1)} weeks, then deload and reassess`
    : `build across all ${weeks} weeks, then roll straight into the next block`;
  switch (input.goal) {
    case 'strength':
      return `${weeks} weeks aimed at moving more weight: ${splitName} keeps the big lifts fresh, loading climbs from volume work toward a heavy peak week, and assistance volume keeps joints and muscles resilient. The plan is to ${arc}.`;
    case 'fat-loss':
      return `${weeks} weeks of muscle insurance while you diet: ${splitName} holds every muscle at an effective weekly dose, because training intensity — not extra gym cardio — is what protects lean mass in a deficit. The plan is to ${arc}.`;
    case 'athletic':
      return `${weeks} weeks of strength with carryover: ${splitName} anchors each session on a big compound movement and backs it with balanced volume across the whole body. The plan is to ${arc}.`;
    case 'general':
      return `${weeks} weeks of balanced, sustainable training: ${splitName} covers every muscle at an effective dose without any marathon sessions. The plan is to ${arc}.`;
    default:
      return `${weeks} weeks of focused hypertrophy: ${splitName} trains every muscle about twice a week inside the 10–20 weekly hard-set band, adding reps and load as you earn them. The plan is to ${arc}.`;
  }
}

function progressionFor(goal: Goal, phases: PhaseKind[], experience: ExperienceLevel = 'intermediate'): string {
  const deloadWeek = phases.indexOf('deload') + 1;
  const deloadLine = deloadWeek > 0
    ? ` Week ${deloadWeek} is a planned deload — roughly 10% lighter across the board — so the rebound lands inside this block, not after it.`
    : ' No deload is scheduled; any lift that stalls still gets an automatic reactive deload from the in-workout coach.';

  // Beginners get concrete starting-point and effort guidance — the thing a
  // new lifter actually needs — and the reassurance that linear progression
  // (add a little every session) is expected to work for a long while yet.
  if (experience === 'beginner') {
    return 'Start each new lift lighter than feels necessary — a weight you could do 3–4 more reps with — and focus on clean, controlled form. '
      + 'Each session, if you hit the top of the rep range with good technique, add the smallest jump (usually 5 lbs, or 2.5 on smaller lifts) next time. '
      + 'As a beginner this simple "add a little every week" progression works for months — the coach handles the bookkeeping and eases you back if a weight gets away from you.'
      + deloadLine + ` ${goalLabel(goal)} stays the destination — just keep showing up.`;
  }

  const base = goal === 'strength'
    ? 'Loading runs on double progression with bigger jumps on the main lifts: own the top of the rep range on every set and the coach adds weight next session. As the block moves into its peak weeks, reps drop and loads climb.'
    : 'Loading runs on double progression: hit the top of the rep range on every set and the coach adds weight next session; miss the bottom and it eases you back. Set counts stay adaptive week to week within the block\'s guardrails.';
  return base + deloadLine + ` ${goalLabel(goal)} stays the destination — the in-workout coach optimizes the route.`;
}
