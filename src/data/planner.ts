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

import type { MuscleGroup, MovementPattern, Equipment, WeightType } from './taxonomy';
import type { Exercise, WorkoutDay } from './program';
import type { TrainingSnapshot, VolumeTarget } from './analytics';
import { volumeTargetFor } from './analytics';
import { assessSnapshot, progressDirections } from './progress';
import type { ExerciseProfile } from './substitution';
import { candidateProfiles, profileFor } from './substitution';
import { DIFFICULTY_RANK } from './exercises';
import type {
  Goal, PhaseKind, BlockRetrospective, EquipmentAccess, ExperienceLevel, SportContext, InjuryArea, PhaseResolver,
} from './plan';
import { goalLabel, experienceLabel, validatePhases, MIN_PRODUCTIVE_WEEKS_BEFORE_DELOAD, MAX_OPENER_WEEKS, isEasyPhase } from './plan';
import { dosage, isHeavyAxial } from './dosage';
import type { Slot, DayTemplate } from './sports';
import { buildSportPlan, buildSportPhases, sportLabel, sportMeta } from './sports';

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
  /** structured injury areas from the wizard's chips — hard constraints, no parsing */
  injuryAreas?: InjuryArea[];
  /** required for goal 'sport-support' — the sport is a hard constraint */
  sport?: SportContext;
  /** the active plan's goal, when there is one — a change earns an intro week */
  previousGoal?: Goal | null;
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
  avoidPatterns: Set<MovementPattern>;
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

  // Injuries are read CLAUSE by clause (split on punctuation and "but"/"and"),
  // because a body part and a complaint in the same sentence are not enough:
  //   "my shoulder hurts when I do back squats" names a shoulder, not a back
  //   "no knee problems, but my elbow hurts" names a knee that is fine
  //   "knee surgery 10 years ago, fully recovered" names a knee that healed
  // Lift names that contain a body part are stripped first, a negated or
  // recovered clause is skipped, and the complaint vocabulary includes the
  // words people actually use ("sore right shoulder overhead" is the wizard's
  // own placeholder, and "sore" was not in the list).
  const liftNames = /\b(back|front|box|goblet|hack|split|bulgarian split|pistol|zercher|overhead|pause[d]?)\s+squats?\b|\bback\s+extensions?\b|\bhip\s+thrusts?\b|\bshoulder\s+press(es)?\b|\bknee\s+(push|drive|raise)s?\b/g;
  const hurt = /\b(pain(ful|s)?|injur\w*|hurt\w*|issues?|problems?|tweak\w*|surgery|sore(ness)?|tight(ness)?|ach(e|es|ing|y)|niggl\w*|strain\w*|tendi?n[io]tis|impingement|bad|dodgy|weak|cranky|flare\w*|bother\w*)\b/;
  const negated = /\b(no|not|never|without|free of|recovered|fully|healed|fine now|ok now|okay now|better now|used to|years? ago|months? ago|ages ago|no longer)\b/;
  const clauses = text
    .replace(liftNames, m => (m.includes('squat') ? 'squat' : m.includes('extension') ? 'extension' : m.includes('thrust') ? 'thrust' : m.includes('press') ? 'press' : 'drill'))
    .split(/[.,;!?\n]|\bbut\b|\band\b|\bhowever\b/);

  const flagged = new Set<'knee' | 'shoulder' | 'back' | 'hip' | 'elbow' | 'wrist'>();
  for (const clause of clauses) {
    if (!hurt.test(clause) || negated.test(clause)) continue;
    if (/\bknees?\b|\bpatell\w*\b|\bitb\b|\bit band\b/.test(clause)) flagged.add('knee');
    if (/\bshoulders?\b|\brotator\b|\bcuff\b/.test(clause)) flagged.add('shoulder');
    if (/\b(lower|low)\s+back\b|\blumbar\b|\bback\b|\bsciatic\w*\b|\bdisc\b/.test(clause)) flagged.add('back');
    if (/\bhips?\b|\bgroin\b|\bsi joint\b/.test(clause)) flagged.add('hip');
    if (/\belbows?\b|\btennis elbow\b|\bgolfer'?s elbow\b/.test(clause)) flagged.add('elbow');
    if (/\bwrists?\b|\bcarpal\b/.test(clause)) flagged.add('wrist');
  }
  if (flagged.has('knee')) applyInjuryArea(g, 'knee');
  if (flagged.has('shoulder')) applyInjuryArea(g, 'shoulder');
  if (flagged.has('back')) applyInjuryArea(g, 'lower-back');
  if (flagged.has('hip')) applyInjuryArea(g, 'hip');
  if (flagged.has('elbow')) applyInjuryArea(g, 'elbow');
  if (flagged.has('wrist')) applyInjuryArea(g, 'wrist');

  if (g.notes.length === 0) {
    g.notes.push('Notes saved with the plan — review the workouts below and swap anything that doesn\'t fit.');
  }
  return g;
}

/** The constraint each structured injury area imposes — one place, shared by chips and prose. */
export function applyInjuryArea(g: Guidance, area: InjuryArea): void {
  const add = (patterns: MovementPattern[], names: string[], note: string) => {
    for (const p of patterns) g.avoidPatterns.add(p);
    for (const n of names) if (!g.avoidNameParts.includes(n)) g.avoidNameParts.push(n);
    if (!g.notes.includes(note)) g.notes.push(note);
  };
  switch (area) {
    case 'knee':
      add(['Squat', 'Lunge', 'Leg Extension', 'Jump'], [],
        'Knee issue noted — squats, lunges, jumps and leg extensions are out; pressing and hinging carry the legs. Start lighter than feels necessary.');
      break;
    case 'shoulder':
      // Pattern-based, not name-based — catches every vertical press
      // regardless of naming (e.g. "Machine Shoulder Press" has no "overhead"
      // in its name, so a name-substring filter alone would miss it).
      add(['Dip', 'Vertical Press'], [],
        'Shoulder issue noted — no overhead pressing or dips; horizontal pressing and raises stay.');
      break;
    case 'lower-back':
      add(['Hip Hinge', 'Squat'], ['good morning'],
        'Lower-back issue noted — barbell hinges and squats are out; supported machine work covers the posterior chain.');
      break;
    case 'hip':
      add(['Lunge', 'Hip Hinge'], ['bulgarian', 'pistol'],
        'Hip issue noted — no deep lunging or heavy hinging; machines and hip thrusts carry the lower body.');
      break;
    case 'elbow':
      add(['Dip'], ['skull', 'close-grip', 'close grip', 'preacher'],
        'Elbow issue noted — no skull-crushers, dips or close-grip pressing; cable pressdowns and neutral-grip pulls stay.');
      break;
    case 'wrist':
      add([], ['wrist curl', 'barbell bench', 'barbell overhead', 'front squat', 'push-up', 'push up'],
        'Wrist issue noted — no barbell pressing, push-ups or wrist curls; neutral-grip dumbbell and machine work instead.');
      break;
  }
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

function splitFor(
  daysPerWeek: number,
  experience: ExperienceLevel = 'intermediate',
): { name: string; reason: string; days: DayTemplate[]; warning?: string } {
  const upperA: DayTemplate = {
    title: 'Upper — Chest, Back, Arms',
    slots: [
      { muscle: 'Chest',      patterns: ['Horizontal Press'], mechanics: 'compound', main: true },
      { muscle: 'Upper Back', patterns: ['Row'], mechanics: 'compound', main: true },
      { muscle: 'Delts',      patterns: ['Vertical Press', 'Lateral Raise'] },
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
      { muscle: 'Chest',      patterns: ['Horizontal Press', 'Fly'], main: true },
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
      { muscle: 'Chest',   patterns: ['Horizontal Press'], mechanics: 'compound', main: true },
      { muscle: 'Chest',   patterns: ['Fly', 'Dip', 'Horizontal Press'] },
      { muscle: 'Delts',   patterns: ['Vertical Press', 'Lateral Raise'] },
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
      { muscle: 'Chest',      patterns: ['Horizontal Press'], mechanics: 'compound', main: true },
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
      { muscle: 'Delts',      patterns: ['Vertical Press', 'Lateral Raise'] },
      { muscle: 'Biceps',     patterns: ['Curl'] },
      { muscle: 'Abs',        patterns: ['Crunch'] },
    ],
  };
  // Day C repeats A's two big compounds (A/B/A frequency on the movements
  // that matter most) and varies the accessories. The split's own rationale
  // says "you practise the big movements often"; with every day disjoint, a
  // beginner's squat was trained once a week.
  const fullC: DayTemplate = {
    title: 'Full Body C',
    slots: [
      { muscle: 'Quads',      patterns: ['Squat', 'Leg Press', 'Lunge'], mechanics: 'compound', main: true, reuse: true },
      { muscle: 'Chest',      patterns: ['Horizontal Press', 'Fly'], main: true, reuse: true },
      { muscle: 'Upper Back', patterns: ['Row'], reuse: true },
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

// Dosage (sets × rep range) is resolved by data/dosage.ts — the single source
// of truth shared with the day editor, the mid-workout add panel and quick
// workouts, so an exercise gets the same goal-aware prescription however it
// enters the program. A sport template's slot may carry its own explicit
// prescription, which wins: "3 sets of 4–6, short of failure" is the point of
// that slot, not a default for the goal table to override.
function doseFor(
  goal: Goal,
  slot: Slot,
  profile: ExerciseProfile,
  experience: ExperienceLevel,
): Pick<Exercise, 'sets' | 'repLow' | 'repHigh'> {
  return slot.dose ? { ...slot.dose } : dosage(goal, slot, profile, experience);
}

// ── Phase layout ──────────────────────────────────────────────────────────────

export function defaultBlockWeeks(): number {
  return 6;
}

// ── Introductory weeks ────────────────────────────────────────────────────────
// The repeated-bout effect is *exercise-specific*: the first exposure to an
// unaccustomed movement (or an unaccustomed rep range) produces markedly more
// muscle damage and soreness than the second, and that first bout confers
// protection for weeks afterwards. Which means the case for an easy opening week
// is about novelty, not about training age — a five-year lifter switching from
// 4-rep strength work to 15-rep hypertrophy work is meeting a new stimulus just
// as surely as a novice is.
//
// Novices additionally need time on task before load matters at all — the
// classic "anatomical adaptation" phase — so they always get one, and get two
// when the block is long enough to spare them.
//
// An intro week is NOT a deload: it exists before any fatigue has accumulated,
// and its job is to teach the movements at loads that leave plenty in reserve.

/** How much of this block is unfamiliar to the athlete. */
export interface StimulusChange {
  /** share of the new program's exercises the athlete isn't currently running (0–1) */
  newExerciseShare: number;
  /** the goal — and with it the rep ranges — changed from the active plan */
  goalChanged: boolean;
}

/** Share of new exercises past which a block counts as a new stimulus. */
export const NOVEL_SELECTION_SHARE = 0.5;

export function introWeeksFor(
  experience: ExperienceLevel,
  weeks: number,
  change: StimulusChange,
  openWithRecovery: boolean,
): { weeks: number; reason: string | null } {
  // A recovery opener is already an easy week; stacking an intro on top of it
  // would spend a third of a short block on ramp-up.
  if (openWithRecovery) return { weeks: 0, reason: null };

  if (experience === 'beginner') {
    const n = weeks >= 8 ? 2 : 1;
    return {
      weeks: n,
      reason: `You're starting out, so the block opens with ${n === 1 ? 'an introductory week' : 'two introductory weeks'}: same movements, easy loads, no chasing numbers. `
        + 'Technique first is not a formality — it is what makes the following weeks trainable.',
    };
  }

  const novelSelection = change.newExerciseShare >= NOVEL_SELECTION_SHARE;
  if (change.goalChanged) {
    return {
      weeks: 1,
      reason: 'You\'ve changed what you\'re training for, which changes the rep ranges your body is used to. '
        + 'Week 1 is an introduction at easy loads — unaccustomed rep ranges cause disproportionate soreness the first time through, and one easy exposure removes most of it.',
    };
  }
  if (novelSelection) {
    return {
      weeks: 1,
      reason: 'Most of these lifts are new to you, so week 1 is an introduction at easy loads. '
        + 'The first hard session on an unfamiliar movement causes far more soreness than the second — this spends that once, cheaply.',
    };
  }
  return { weeks: 0, reason: null };
}

/** Compare a proposed program against what the athlete is currently running. */
export function stimulusChange(
  days: WorkoutDay[],
  currentProgram: WorkoutDay[],
  goal: Goal,
  previousGoal: Goal | null,
): StimulusChange {
  const current = new Set(currentProgram.flatMap(d => d.exercises.map(e => e.id)));
  const proposed = days.flatMap(d => d.exercises.map(e => e.id));
  // No current program means a first plan — selection novelty is meaningless
  // there (everything is new), and experience alone decides.
  const newExerciseShare = current.size === 0 || proposed.length === 0
    ? 0
    : proposed.filter(id => !current.has(id)).length / proposed.length;
  return {
    newExerciseShare,
    goalChanged: previousGoal != null && previousGoal !== goal,
  };
}

export function buildPhases(
  input: Pick<PlannerInput, 'goal' | 'weeks' | 'includeDeload' | 'openWithRecovery' | 'experience' | 'sport'>,
  previousRetro?: BlockRetrospective | null,
  change: StimulusChange = { newExerciseShare: 0, goalChanged: false },
): { phases: PhaseKind[]; notes: string[]; warnings: string[] } {
  const intro = introWeeksFor(
    input.experience, input.weeks, change, input.openWithRecovery,
  );

  // Sport-support periodization is driven by how close the race is, not by a
  // generic build-to-peak arc.
  if (input.goal === 'sport-support' && input.sport) {
    const out = buildSportPhases(
      input.weeks, input.sport.proximity, input.sport.sport, intro.weeks,
    );
    if (intro.weeks > 0 && intro.reason) out.notes.unshift(intro.reason);
    return out;
  }

  const notes: string[] = [];
  const warnings: string[] = [];
  const weeks = Math.min(12, Math.max(3, Math.round(input.weeks)));

  // A 3-week block still opens with its intro week (one intro + two hard);
  // the previous `weeks - 3` floor silently dropped it for the shortest blocks.
  const introWeeks = Math.min(intro.weeks, MAX_OPENER_WEEKS, Math.max(0, weeks - 2));
  const recovery = input.openWithRecovery ? 1 : 0;
  let deload = input.includeDeload ? 1 : 0;
  let productive = weeks - recovery - introWeeks - deload;
  if (deload && productive < MIN_PRODUCTIVE_WEEKS_BEFORE_DELOAD) {
    // A deload has to be earned — with too few hard weeks it's just detraining.
    deload = 0;
    productive = weeks - recovery - introWeeks;
    warnings.push(
      `Dropped the closing deload: a ${weeks}-week block${recovery ? ' with a recovery opener' : ''} leaves fewer than ${MIN_PRODUCTIVE_WEEKS_BEFORE_DELOAD} productive weeks to earn one. Extend the block to get it back.`,
    );
  }

  const phases: PhaseKind[] = [];
  if (recovery) phases.push('recovery');
  for (let i = 0; i < introWeeks; i++) phases.push('intro');
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
  if (introWeeks > 0 && intro.reason) {
    notes.push(intro.reason);
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
  /** every candidate by id — lets a slot's preferIds reach past its muscle pool */
  byId: Map<string, ExerciseProfile>;
  used: Set<string>;
  /** exercises already placed in the day being built (reuse never repeats within a day) */
  dayUsed: Set<string>;
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
  // Any lift that names prerequisites is gated for a beginner — the advanced
  // ones, and the few intermediate ones with a hard strength floor (chin-ups):
  // allowed once they've trained the lift itself or at least one prerequisite.
  if (p.prerequisites.length === 0) return true;
  return ctx.loggedIds.has(p.id) || p.prerequisites.some(id => ctx.loggedIds.has(id));
}

// ── Strength anchoring (audit F9) ─────────────────────────────────────────────
// A strength block is built around the barbell lifts, not around whichever
// chest exercise sorts first. The main slots name their preferred lifts (the
// mechanism the sport templates already use), the overhead press becomes a
// main lift in its own right, and the current program's mains are kept out of
// the rotation set so a stall on the squat is answered with the deload the
// block already schedules, never with a goblet squat.
const STRENGTH_ANCHORS: Array<{ muscle: MuscleGroup; pattern: MovementPattern; preferIds: string[] }> = [
  { muscle: 'Chest',      pattern: 'Horizontal Press', preferIds: ['flat-barbell-bench-press', 'incline-barbell-press'] },
  { muscle: 'Quads',      pattern: 'Squat',            preferIds: ['barbell-back-squat'] },
  { muscle: 'Hamstrings', pattern: 'Hip Hinge',        preferIds: ['conventional-deadlift', 'romanian-deadlifts'] },
  { muscle: 'Delts',      pattern: 'Vertical Press',   preferIds: ['barbell-overhead-press'] },
];

function anchorStrengthMains(days: DayTemplate[]): DayTemplate[] {
  return days.map(day => ({
    ...day,
    slots: day.slots.map(slot => {
      const anchor = STRENGTH_ANCHORS.find(a =>
        a.muscle === slot.muscle && slot.patterns?.includes(a.pattern) && (slot.main || a.pattern === 'Vertical Press'));
      if (!anchor || slot.preferIds) return slot;
      return { ...slot, main: true, preferIds: anchor.preferIds };
    }),
  }));
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
  // A sport template names the movements it actually wants. The bonus is large
  // enough to win a normal slot contest but still loses to the hard filters
  // (equipment, injuries, skill gate), so an unavailable preference degrades to
  // the generically-best exercise rather than to nothing.
  if (slot.preferIds) {
    const idx = slot.preferIds.indexOf(p.id);
    if (idx >= 0) score += 40 - idx * 4;
  }
  if (slot.patterns && p.workoutType) {
    const idx = slot.patterns.indexOf(p.workoutType);
    if (idx >= 0) score += 12 - idx * 2;
  }
  if (slot.mechanics) score += p.mechanics === slot.mechanics ? 6 : -6;
  if (ctx.currentIds.has(p.id)) score += ctx.review.has(p.id) ? -10 : 12;
  // A reuse slot exists to repeat the movement already programmed this block
  if (slot.reuse && ctx.used.has(p.id)) score += 30;
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
  // A sport slot exists for a specific, citable reason — that beats anything
  // the generic selector could say about the exercise.
  if (slot.why) return slot.why;
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
  const eligible = (p: ExerciseProfile) =>
    !ctx.dayUsed.has(p.id) && (slot.reuse || !ctx.used.has(p.id)) && allowedByGuidance(p, guidance);
  let pool = (ctx.byMuscle.get(slot.muscle) ?? []).filter(eligible);
  // A slot's preferred lifts are explicit, and may be filed under a
  // neighbouring muscle (the conventional deadlift is Glutes-primary; a
  // strength block's hamstring slot still wants it). They join the pool.
  for (const id of slot.preferIds ?? []) {
    const p = ctx.byId.get(id);
    if (p && eligible(p) && !pool.includes(p)) pool.push(p);
  }
  if (pool.length === 0) return null;

  // One heavy axial lift per session. A back squat and a conventional deadlift
  // at 4×3–5 in the same workout is two spinal-loading maxes back to back —
  // the second is done tired and the session runs long (audit F9: Good
  // Mornings + Deadlift). When the day already has one, the hinge slot takes a
  // leg curl or an RDL variant that isn't a barbell, and the squat slot a
  // machine — unless nothing else fits the muscle.
  // A sport template's `heavy` slot is an explicit prescription (squat AND
  // hinge on the one lifting day a triathlete has) and is left alone.
  if (!slot.heavy && [...ctx.dayUsed].some(id => isHeavyAxial(profileFor(id)))) {
    const unloaded = pool.filter(p => !isHeavyAxial(p));
    if (unloaded.length > 0) pool = unloaded;
  }

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
      detail: `No training history yet, so this plan leans on established exercise science, calibrated for ${experience === 'intermediate' || experience === 'advanced' ? 'an' : 'a'} ${experienceLabel(experience).toLowerCase()} lifter. It gets personal fast — every workout you log sharpens the next block.`,
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
const HOUR_SESSION_MIN = 65;    // "under an hour" splits, with the warm-up overhead
const NO_MARATHON_MIN = 75;     // "no marathon sessions"
const SPORT_SESSION_MIN = 55;   // a support session that outgrows this is defeating itself
const MAX_VOLUME_TRIMS = 40;    // loop guard for the ceiling pass
/** how many under-target muscles a retrospective may add a set to, per block */
const MAX_RETRO_BUMPS = 3;
/** weekly sets may grow by at most this share block over block */
export const MAX_BLOCK_GROWTH = 0.25;

/** The session length a split's own copy commits to. */
export function sessionBudgetFor(splitName: string, goal: Goal, sport: boolean): number {
  if (sport) return SPORT_SESSION_MIN;
  if (splitName.startsWith('Upper / Lower')) return HOUR_SESSION_MIN;
  if (splitName.includes('+') || goal === 'general') return NO_MARATHON_MIN;
  return LONG_SESSION_MIN;
}

export function buildPlanProposal(
  input: PlannerInput,
  currentProgram: WorkoutDay[],
  snapshot: TrainingSnapshot | null,
  previousRetro: BlockRetrospective | null = null,
  /** which planned phase governed each past session — keeps deload weeks out of the trends */
  phaseOf: PhaseResolver | null = null,
): PlanProposal {
  // Injuries and free-text notes are parsed together, structured injury areas
  // and equipment access are layered on top.
  const guidance = parseGuidance([input.notes, input.injuries ?? ''].join('. '));
  for (const area of input.injuryAreas ?? []) applyInjuryArea(guidance, area);
  if (guidance.notes.length > 1) {
    const idx = guidance.notes.indexOf('Notes saved with the plan — review the workouts below and swap anything that doesn\'t fit.');
    if (idx >= 0) guidance.notes.splice(idx, 1);
  }
  applyEquipmentAccess(guidance, input.equipmentAccess);

  // Supporting another sport replaces the split wholesale: the sport registry
  // decides which sessions exist, how many the athlete's weekly sport load can
  // absorb, and what each slot is for.
  const sportPlan = input.goal === 'sport-support' && input.sport
    ? buildSportPlan(input.sport, input.daysPerWeek, input.experience)
    : null;
  const generic = sportPlan ? null : splitFor(input.daysPerWeek, input.experience);
  const split = sportPlan
    ? { name: sportPlan.splitName, reason: sportPlan.splitReason, days: sportPlan.days, warning: undefined }
    : input.goal === 'strength'
      ? { ...generic!, days: anchorStrengthMains(generic!.days) }
      : generic!;
  // Phases are resolved *after* the workouts, further down: whether the block
  // opens with an introductory week depends on how much of the selection is new
  // to this athlete, which isn't known until the days exist.
  const warnings: string[] = [];
  if (split.warning) warnings.push(split.warning);
  if (sportPlan) {
    warnings.push(...sportPlan.warnings);
    guidance.notes.push(...sportPlan.rationale);
  }
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
    const directions = progressDirections(assessSnapshot(snapshot, input.goal, () => true, phaseOf));
    trendUp = directions.up;
    trendDown = directions.down;
    for (const id of loggedIds) {
      const eq = profileFor(id).equipment;
      if (eq) observedEquipment.add(eq);
    }
  }

  const byMuscle = new Map<MuscleGroup, ExerciseProfile[]>();
  const byId = new Map<string, ExerciseProfile>();
  for (const p of candidateProfiles()) {
    if (!p.primaryMuscle) continue;
    byId.set(p.id, p);
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
    byId,
    used: new Set<string>(),
    dayUsed: new Set<string>(),
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
  // In a strength plan the main lifts ARE the plan: a stalled squat is not
  // rotated for a different squat, it is kept and deloaded.
  if (input.goal === 'strength') {
    for (const day of currentProgram) {
      for (const ex of day.exercises) {
        if (!ex.main) continue;
        ctx.review.delete(ex.id);
        ctx.keep.add(ex.id);
      }
    }
  }

  const days: WorkoutDay[] = [];
  const decisions: ExerciseDecision[] = [];

  split.days.forEach((template, i) => {
    const dayId = i + 1;
    const exercises: Exercise[] = [];
    ctx.dayUsed = new Set<string>();
    for (const slot of template.slots) {
      const picked = pickForSlot(slot, ctx, guidance);
      if (!picked) {
        warnings.push(`Couldn't find a ${slot.muscle} exercise matching your constraints for Day ${dayId} — add one manually if you want that slot filled.`);
        continue;
      }
      ctx.used.add(picked.profile.id);
      ctx.dayUsed.add(picked.profile.id);
      const dose = doseFor(input.goal, slot, picked.profile, input.experience);
      exercises.push({
        id: picked.profile.id, name: picked.profile.name, ...dose, rangeSource: 'plan',
        ...(slot.main ? { main: true } : {}),
      });
      decisions.push({
        exerciseId: picked.profile.id,
        name: picked.profile.name,
        dayId,
        status: ctx.currentIds.has(picked.profile.id) ? 'kept' : 'new',
        reason: picked.reason,
      });
    }
    days.push({
      id: dayId,
      label: `Day ${dayId}`,
      muscleGroups: template.title,
      exercises,
      // Phase gating is how the lifting taper is enforced rather than merely
      // described — the short power session simply stops being programmed once
      // the block reaches its maintenance weeks.
      ...(template.phases ? { phases: [...template.phases] } : {}),
    });
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
  // A sport prescription is already at its ceiling by construction, so the
  // retro's "add a set" and the priority-muscle bump are both skipped: they are
  // hypertrophy instincts, and here they would spend recovery the athlete's
  // sport has a prior claim on.
  // The retro's +1 is capped at MAX_RETRO_BUMPS muscles per block: "0 of 12
  // muscles in band" used to add a set to every one of them at once.
  const bumped: Exercise[] = [];
  if (previousRetro && !sportPlan) {
    for (const muscle of previousRetro.carryover.underMuscles.slice(0, MAX_RETRO_BUMPS)) {
      const ex = bumpSets(days, decisions, muscle, +1, `+1 set — ${muscle} finished last block under its weekly volume target.`);
      if (ex) bumped.push(ex);
    }
    for (const muscle of previousRetro.carryover.overMuscles) {
      bumpSets(days, decisions, muscle, -1, `−1 set — ${muscle} ran past the weekly ceiling last block; trimming protects recovery.`);
    }
  }

  // Priority muscles (weak points the athlete flagged) get an extra set each,
  // within the same guardrails — a targeted bias toward what they care about.
  if (!sportPlan) {
    for (const muscle of input.priorityMuscles ?? []) {
      const ex = bumpSets(days, decisions, muscle, +1, `+1 set — you flagged ${muscle} as a priority, so it gets extra volume.`);
      if (ex) bumped.push(ex);
    }
  }

  // Block-over-block growth cap. A block is allowed to be bigger than the one
  // it follows, but not by 60–70%: the retro bumps come back off (newest
  // first) until weekly sets sit within MAX_BLOCK_GROWTH of the current
  // program. A first plan has nothing to compare against.
  const currentSets = currentProgram.reduce((n, d) => n + d.exercises.reduce((m, e) => m + e.sets, 0), 0);
  const totalSets = () => days.reduce((n, d) => n + d.exercises.reduce((m, e) => m + e.sets, 0), 0);
  if (currentSets > 0 && !sportPlan) {
    let undone = 0;
    while (totalSets() > currentSets * (1 + MAX_BLOCK_GROWTH) && bumped.length > 0) {
      const ex = bumped.pop()!;
      if (ex.sets > 2) { ex.sets -= 1; undone += 1; }
    }
    if (undone > 0) {
      warnings.push(`Weekly volume is held within ${Math.round(MAX_BLOCK_GROWTH * 100)}% of your current block — ${undone} of the extra sets wait for the block after this one.`);
    }
    if (totalSets() > currentSets * (1 + MAX_BLOCK_GROWTH)) {
      warnings.push(`This block carries ${Math.round((totalSets() / currentSets - 1) * 100)}% more weekly sets than your current one — a big step. Trim a set or two in the review below if the sessions run long.`);
    }
  }

  // ── Phase layout ──
  // Now that the workouts exist we can tell how much of this block is new to the
  // athlete, which is what decides whether it opens with an introductory week.
  const change = stimulusChange(days, currentProgram, input.goal, input.previousGoal ?? null);
  const { phases, notes: phaseNotes, warnings: phaseWarnings } = buildPhases(input, previousRetro, change);
  warnings.push(...phaseWarnings);

  // Ceiling pass — last, so it sees every bump the retro and priority passes
  // made. A plan that starts over the ceiling is a plan the in-block coach will
  // spend the block undoing.
  const band = volumeTargetFor(input.goal, input.experience);
  capWeeklyVolume(days, decisions, band);

  const weekly = projectWeeklySets(days);
  const stillOver = [...weekly].filter(([, sets]) => sets > band.high).map(([m]) => m);
  if (stillOver.length > 0) {
    warnings.push(
      `${stillOver.join(', ')} still projects past the ${band.high}-set weekly ceiling and can't be trimmed further without dropping an exercise — remove one below if that worries you.`,
    );
  }

  const muscleWeeklySets = [...weekly]
    .map(([muscle, sets]) => ({ muscle, sets: Math.round(sets * 2) / 2 }))
    .sort((a, b) => b.sets - a.sets);

  // Each split is held to the promise its own rationale makes: "under an
  // hour" for upper/lower, "no marathon sessions" for the five-day blend and
  // general fitness, and a sport-support session has to fit around training
  // that matters more. A flat 95-minute line let an 82-minute "under an hour"
  // day through without a word.
  const sessionCap = sessionBudgetFor(split.name, input.goal, sportPlan != null);
  for (const day of days) {
    const setCount = day.exercises.reduce((s, e) => s + e.sets, 0);
    const est = SESSION_OVERHEAD_MIN + setCount * MINUTES_PER_SET;
    if (est > sessionCap) {
      warnings.push(`Day ${day.id} projects ~${est} minutes against the ~${sessionCap} this split promises — trim a set or drop an exercise if that doesn't fit your schedule.`);
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
    progression: progressionFor(input.goal, phases, input.experience, input.sport),
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
): Exercise | null {
  let best: Exercise | null = null;
  for (const day of days) {
    for (const ex of day.exercises) {
      if (profileFor(ex.id, ex.name).primaryMuscle !== muscle) continue;
      if (delta > 0 && ex.sets >= 5) continue;
      // A main lift is trimmed last and never below three sets — the same floor
      // the sport templates hold, so the two capping passes stop disagreeing.
      if (delta < 0 && ex.sets <= (ex.main ? 3 : 2)) continue;
      if (!best) { best = ex; continue; }
      if (delta < 0) {
        if ((best.main && !ex.main) || (best.main === ex.main && ex.sets > best.sets)) best = ex;
      } else if (ex.sets < best.sets) {
        best = ex;
      }
    }
  }
  if (!best) return null;
  best.sets += delta;
  const d = decisions.find(dec => dec.exerciseId === best!.id);
  if (d) d.reason = `${d.reason} ${note}`;
  return best;
}

/** Weekly hard sets per muscle for a program (primary 1, secondary 0.5). */
function projectWeeklySets(days: WorkoutDay[]): Map<MuscleGroup, number> {
  const weekly = new Map<MuscleGroup, number>();
  for (const day of days) {
    for (const ex of day.exercises) {
      const p = profileFor(ex.id, ex.name);
      if (p.primaryMuscle) weekly.set(p.primaryMuscle, (weekly.get(p.primaryMuscle) ?? 0) + ex.sets);
      for (const m of p.secondaryMuscles) weekly.set(m, (weekly.get(m) ?? 0) + ex.sets * 0.5);
    }
  }
  return weekly;
}

/**
 * Trim any muscle projected past the goal's weekly ceiling.
 *
 * The split templates are calibrated on DIRECT sets, but a muscle also collects
 * half a set from every compound that recruits it — and on a high-frequency
 * split that spillover is not a rounding error. Six days of push/pull/legs put
 * delts past 25 weekly sets without a single extra shoulder slot, purely from
 * pressing and rowing. Prescribing that and then having the in-block coach trim
 * it back is a worse experience than not prescribing it.
 *
 * Trims come off the exercise doing the most direct work for the muscle, never
 * below 2 sets, and every one carries its reason into the review step.
 */
function capWeeklyVolume(
  days: WorkoutDay[],
  decisions: ExerciseDecision[],
  band: VolumeTarget,
): void {
  for (let guard = 0; guard < MAX_VOLUME_TRIMS; guard++) {
    const over = [...projectWeeklySets(days)]
      .filter(([, sets]) => sets > band.high)
      .sort((a, b) => b[1] - a[1])[0];
    if (!over) return;
    const [muscle, sets] = over;
    const trimmed = bumpSets(
      days, decisions, muscle, -1,
      `−1 set — ${muscle} projected ${Math.round(sets * 2) / 2} weekly sets once the secondary work from your compounds is counted, past the ${band.high}-set ceiling.`,
    );
    // Nothing left to take without gutting a movement — the warning in the
    // proposal is the honest outcome.
    if (!trimmed) return;
  }
}

function intentFor(input: PlannerInput, splitName: string, phases: PhaseKind[]): string {
  const weeks = phases.length;

  // Supporting another sport: the intent has to say out loud that lifting is
  // the junior partner, because every week of the block is shaped by that.
  if (input.goal === 'sport-support' && input.sport) {
    const sport = sportLabel(input.sport.sport).toLowerCase();
    const holds = phases.includes('maintenance');
    const arc = holds
      ? 'build strength early, then hold it through your heaviest training weeks so your sport gets the recovery back'
      : 'build strength while it is cheap to build — there is no race close enough for that to cost you anything';
    return `${weeks} weeks of lifting in service of your ${sport}: ${splitName} keeps the sessions short, heavy and well short of failure. `
      + `The plan is to ${arc}. If a session ever clashes with a quality ${sport} workout, the ${sport} workout wins — that is not a compromise, it is the design.`;
  }

  const deload = phases[phases.length - 1] === 'deload';
  const hard = phases.filter(p => !isEasyPhase(p)).length;
  const arc = deload
    ? `build for ${hard} weeks, then deload and reassess`
    : hard === weeks
      ? `build across all ${weeks} weeks, then roll straight into the next block`
      : `ease in, build for ${hard} weeks, then roll straight into the next block`;
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

// One consistent explanation of what an intro week asks for, wherever it's shown.
function introSentence(count: number): string {
  return count === 1
    ? 'Week 1 is an introduction: run the prescribed sets and reps at a weight you could clearly do 4–5 more reps with. '
      + 'Nothing is being tested — you are teaching your body the movements so the following weeks can be hard.'
    : `Weeks 1–${count} are an introduction: the prescribed sets and reps at a weight you could clearly do 4–5 more reps with. `
      + 'Both weeks sit at the same easy load — nothing is being tested yet, and the first exposure is the one that makes you sore.';
}

function progressionFor(
  goal: Goal,
  phases: PhaseKind[],
  experience: ExperienceLevel = 'intermediate',
  sport?: SportContext,
): string {
  const introCount = phases.filter(p => p === 'intro').length;
  if (goal === 'sport-support' && sport) {
    const meta = sportMeta(sport.sport);
    const taperWeek = phases.indexOf('deload') + 1;
    const maintainFrom = phases.indexOf('maintenance') + 1;
    const lines: string[] = [];
    if (introCount > 0) {
      lines.push(introSentence(introCount));
    }
    lines.push(
      'Load climbs on the main lifts whenever you own the top of the rep range with two or three reps still in the tank. '
      + 'If a set feels like a grind, it was too heavy — stop the set, not the session.',
    );
    if (maintainFrom > 0) {
      lines.push(`From week ${maintainFrom} the loads stop climbing and the sets come down. That is deliberate: strength is defended by intensity, and the volume is what your ${meta.label.toLowerCase()} training needs back.`);
    }
    if (taperWeek > 0) {
      lines.push(`Week ${taperWeek} backs off — same kind of weight, a third of the work.`);
    }
    lines.push('The coach will never add sets to this plan. It can trim them, and it will if your logged sessions say you are running out of road.');
    return lines.join(' ');
  }

  const deloadWeek = phases.indexOf('deload') + 1;
  const deloadLine = deloadWeek > 0
    ? ` Week ${deloadWeek} is a planned deload — roughly 10% lighter across the board — so the rebound lands inside this block, not after it.`
    : ' No deload is scheduled; any lift that stalls still gets an automatic reactive deload from the in-workout coach.';

  // Beginners get concrete starting-point and effort guidance — the thing a
  // new lifter actually needs — and the reassurance that linear progression
  // (add a little every session) is expected to work for a long while yet.
  const introLine = introCount > 0 ? `${introSentence(introCount)} ` : '';

  if (experience === 'beginner') {
    return introLine
      + 'Start each new lift lighter than feels necessary — a weight you could do 3–4 more reps with — and focus on clean, controlled form. '
      + 'Each session, if you hit the top of the rep range with good technique, add the smallest jump (usually 5 lbs, or 2.5 on smaller lifts) next time. '
      + 'As a beginner this simple "add a little every week" progression works for months — the coach handles the bookkeeping and eases you back if a weight gets away from you.'
      + deloadLine + ` ${goalLabel(goal)} stays the destination — just keep showing up.`;
  }

  const base = goal === 'strength'
    ? 'Loading runs on double progression with bigger jumps on the main lifts: own the top of the rep range on every set and the coach adds weight next session. As the block moves into its peak weeks, reps drop and loads climb.'
    : 'Loading runs on double progression: hit the top of the rep range on every set and the coach adds weight next session; miss the bottom and it eases you back. Set counts stay adaptive week to week within the block\'s guardrails.';
  return introLine + base + deloadLine + ` ${goalLabel(goal)} stays the destination — the in-workout coach optimizes the route.`;
}
