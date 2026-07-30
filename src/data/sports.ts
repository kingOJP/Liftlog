// Sport-support programming — the research layer behind the 'sport-support' goal.
//
// When lifting exists to serve another sport, the sport is a hard constraint,
// not a preference: it sets the volume ceiling, the movement emphases and the
// periodization. This module owns that knowledge as data — day templates,
// dosage, the interference budget and the plain-language rationale — so
// planner.ts stays a generic assembler and a new sport means a new entry here
// rather than a new branch in the planner.
//
// Same architecture rules as the rest of data/: pure functions, no storage
// access, every decision carries a reason the user can read.
//
// The evidence this encodes (see docs/sport-support.md for the long form):
//
//   - Heavy, low-volume strength work — not hypertrophy dosing — is what
//     improves cycling and running economy (Rønnestad & Mujika's review of
//     strength training in endurance athletes; Beattie and colleagues on
//     running economy). Two sessions a week, two or three multi-joint lifts,
//     3–5 sets of 3–8 reps, stopping short of failure.
//   - The interference effect scales with endurance frequency and duration,
//     and running interferes more than cycling because of its eccentric load
//     (Wilson and colleagues' concurrent-training meta-analysis). So the
//     lifting ceiling has to be a function of the sport's own weekly load.
//   - Added muscle mass is a cost an endurance athlete carries up every hill,
//     which is why the goal's weekly set band (analytics.volumeTargetFor) sits
//     at 4–10 rather than 10–20.
//   - Plyometric and heavy-strength work improves running economy on the order
//     of a few percent (Balsalobre-Fernández and colleagues' meta-analysis),
//     which is why a short power session earns its place in base and build
//     weeks — and why it is the first thing cut when the schedule tightens.
//   - Strength is maintained on a fraction of the volume that built it as long
//     as intensity is held, which is what makes a lifting taper cheap: keep
//     the load, gut the sets.

import type { MuscleGroup, WorkoutType } from './taxonomy';
import type { PhaseKind, SportContext, SportId, Discipline, ExperienceLevel, EnduranceLoad } from './plan';
import { enduranceHours, MIN_PRODUCTIVE_WEEKS_BEFORE_DELOAD } from './plan';
import type { VolumeTarget } from './analytics';
import { volumeTargetFor } from './analytics';

// ── Slot / template vocabulary ────────────────────────────────────────────────
// Shared with planner.ts, which fills slots from the ExerciseProfile pool. A
// sport template usually knows exactly which movements it wants, so it can name
// them in `preferIds`; the generic scorer still resolves the slot when those
// exercises are unavailable (equipment, injuries, tombstones).

export interface SlotDose {
  sets: number;
  repLow: number;
  repHigh: number;
}

export interface Slot {
  muscle: MuscleGroup;
  patterns?: WorkoutType[];
  mechanics?: 'compound' | 'isolation';
  /** the day's heavy anchor — more sets, lower reps */
  main?: boolean;
  /** preferred exercise ids, best first — a strong bonus, never a hard filter */
  preferIds?: string[];
  /** overrides the goal's dosage for this slot */
  dose?: SlotDose;
  /** why this slot exists, in coach voice; shown on the exercise in review */
  why?: string;
}

export interface DayTemplate {
  title: string;
  slots: Slot[];
  /** phases this day is programmed for; absent = every week */
  phases?: PhaseKind[];
  /** only include this day when at least this many lift days are available */
  minLiftDays?: number;
}

// Phase sets used by the sport-support taper. Day A runs every week of the
// block; the second session steps out for the taper and race week; the short
// power session belongs to the build weeks only.
const BUILD_PHASES: PhaseKind[] = ['recovery', 'accumulation', 'intensification', 'peak'];
const THROUGH_MAINTENANCE: PhaseKind[] = [...BUILD_PHASES, 'maintenance'];

// ── Niggles ───────────────────────────────────────────────────────────────────
// Recurring sport complaints, as the chips the wizard offers. Each one routes
// the template rather than just being recorded.

export interface Niggle {
  id: string;
  label: string;
  blurb: string;
}

export const NIGGLES: Niggle[] = [
  { id: 'achilles', label: 'Achilles or calf',          blurb: 'Swaps to heavy-slow calf loading and drops the jumping' },
  { id: 'knee',     label: "Knee (runner's knee / ITB)", blurb: 'Trims deep-knee loading, prioritises hip abduction and tempo' },
  { id: 'back',     label: 'Low back or hip',            blurb: 'Drops barbell hinges and axial loading for supported work' },
  { id: 'shoulder', label: 'Shoulder (swim)',            blurb: 'No overhead pressing; rotation and posterior-cuff work stays' },
];

export function niggleLabel(id: string): string {
  return NIGGLES.find(n => n.id === id)?.label ?? id;
}

// ── Sport metadata ────────────────────────────────────────────────────────────

export type SportFamily = 'endurance' | 'hybrid' | 'power';

export interface SportMeta {
  id: SportId;
  label: string;
  family: SportFamily;
  blurb: string;
  /** false while the sport falls back to a generic template of its family */
  specialised: boolean;
}

export const SPORTS: SportMeta[] = [
  { id: 'triathlon', label: 'Triathlon',       family: 'endurance', blurb: 'Swim, bike and run — the plan covers all three plus the durability they demand', specialised: true },
  { id: 'running',   label: 'Running',         family: 'endurance', blurb: '5k to marathon — tendon stiffness, pelvic stability and eccentric control', specialised: true },
  { id: 'cycling',   label: 'Cycling',         family: 'endurance', blurb: 'Road, gravel or track — hip-extension force and time-trial trunk strength', specialised: true },
  { id: 'swimming',  label: 'Swimming',        family: 'endurance', blurb: 'Pull strength, shoulder durability and a trunk that holds a line', specialised: true },
  { id: 'hyrox',     label: 'Hyrox / hybrid',  family: 'hybrid',    blurb: 'Strength endurance, carries and lunges at much higher lifting volume', specialised: false },
  { id: 'sprint',    label: 'Sprint / field',  family: 'power',     blurb: 'Max strength and rate of force development, low interference', specialised: false },
  { id: 'other',     label: 'Something else',  family: 'endurance', blurb: 'A general strength-support template you can adjust in review', specialised: false },
];

export function sportMeta(id: SportId): SportMeta {
  return SPORTS.find(s => s.id === id) ?? SPORTS[SPORTS.length - 1];
}

export function sportLabel(id: SportId): string {
  return sportMeta(id).label;
}

// ── Interference budget ───────────────────────────────────────────────────────
// The honest core of "don't cause overtraining": the sport's own weekly load
// decides how much lifting the athlete can absorb, and the planner treats the
// result as a ceiling rather than a suggestion. Running-heavy sports pay a
// surcharge — the eccentric load is what the interference literature keeps
// finding to be the expensive part.

export interface LiftBudget {
  /** lifting days the plan will actually program */
  days: number;
  /** total weekly working sets across all lifting days */
  maxWeeklySets: number;
  /** set when the request was reduced, in coach voice */
  warning?: string;
}

const DAYS_BY_LOAD: Record<EnduranceLoad, number> = {
  low: 3, moderate: 3, high: 2, 'very-high': 2,
};

// Total weekly working sets the athlete's sport load leaves room for. These are
// ceilings, not targets: three short sessions of heavy multi-joint work plus
// stability comes to the mid-thirties, and the per-muscle band does the finer
// work of stopping any one area from hogging them.
const SETS_BY_LOAD: Record<EnduranceLoad, number> = {
  low: 42, moderate: 38, high: 28, 'very-high': 24,
};

export function liftBudget(
  ctx: SportContext,
  requestedDays: number,
  experience: ExperienceLevel = 'intermediate',
): LiftBudget {
  const family = sportMeta(ctx.sport).family;
  let days = Math.min(requestedDays, DAYS_BY_LOAD[ctx.load]);
  let maxWeeklySets = SETS_BY_LOAD[ctx.load];

  // A power sport doesn't pay much of an interference tax — sprinting is not
  // an endurance load, and the lifting *is* the training.
  if (family === 'power') {
    days = Math.min(requestedDays, 4);
    maxWeeklySets = Math.round(maxWeeklySets * 1.3);
  } else if (family === 'hybrid') {
    // Hybrid racing is a strength-endurance event: more lifting volume is the
    // point, not a cost to be minimised.
    maxWeeklySets = Math.round(maxWeeklySets * 1.25);
  }

  // Beginners are limited by recovery and technique, not schedule.
  if (experience === 'beginner') {
    days = Math.min(days, 2);
    maxWeeklySets = Math.min(maxWeeklySets, 26);
  }

  const warning = days < requestedDays
    ? `You asked for ${requestedDays} lifting days, but at ${loadLabel(ctx.load)} of ${sportLabel(ctx.sport).toLowerCase()} a week the plan uses ${days}. `
      + 'Lifting that costs you a quality session in your sport is a net loss — the extra day is better spent recovering.'
    : undefined;

  return { days, maxWeeklySets, warning };
}

function loadLabel(load: EnduranceLoad): string {
  const h = enduranceHours(load);
  return h >= 12 ? '12+ hours' : h >= 8 ? '8–11 hours' : h >= 4 ? '4–7 hours' : 'under 4 hours';
}

// ── Phase layout ──────────────────────────────────────────────────────────────
// Periodization runs off the race date, not a generic build-to-peak arc. The
// arc is: build heavy while there's time → hold at maintenance while the sport
// takes priority → taper → race week. There is never a lifting peak near an A
// race; the peak belongs to the race itself.

export interface SportPhases {
  phases: PhaseKind[];
  notes: string[];
  warnings: string[];
}

export function buildSportPhases(
  weeks: number,
  weeksToRace: number | null,
  sport: SportId,
): SportPhases {
  const notes: string[] = [];
  const warnings: string[] = [];
  const label = sportLabel(sport).toLowerCase();

  // No race on the calendar: this is base training, and base is where heavy
  // strength work belongs. No taper, no race week.
  if (weeksToRace == null) {
    const total = Math.min(12, Math.max(3, Math.round(weeks)));
    // A deload has to be earned here too — the shared guardrail wants three
    // productive weeks before one, so a very short base block simply ends.
    const deload = total - 1 >= MIN_PRODUCTIVE_WEEKS_BEFORE_DELOAD ? 1 : 0;
    const productive = total - deload;
    const build = Math.max(1, Math.ceil(productive * 0.5));
    const phases: PhaseKind[] = [];
    for (let i = 0; i < productive; i++) {
      phases.push(i === 0 ? 'accumulation' : i < build ? 'intensification' : 'maintenance');
    }
    if (deload) phases.push('deload');
    notes.push(
      'No race on the calendar, so this block treats the time as base training — the one window where heavy strength work is cheap.'
      + (deload ? ` The last week deloads so you start your next ${label} block fresh.` : ''),
    );
    return { phases, notes, warnings };
  }

  const total = Math.min(12, Math.max(2, Math.min(Math.round(weeks), weeksToRace)));
  if (weeksToRace > total) {
    warnings.push(
      `Your race is ${weeksToRace} weeks out but this block runs ${total} — plan another block after this one to cover the gap.`,
    );
  }

  // Race week always closes the block. A taper week earns its place once the
  // block is long enough to have built something worth tapering from.
  const raceWeek = 1;
  const taper = total >= 5 ? 1 : 0;
  const remaining = Math.max(0, total - raceWeek - taper);
  const build = Math.min(remaining, Math.max(1, Math.ceil(remaining / 2)));
  const maintain = remaining - build;

  const phases: PhaseKind[] = [];
  for (let i = 0; i < build; i++) phases.push(i === 0 ? 'accumulation' : 'intensification');
  for (let i = 0; i < maintain; i++) phases.push('maintenance');
  if (taper) phases.push('deload');
  phases.push('race-week');

  if (build > 0) {
    notes.push(
      `Weeks 1–${build} carry the real strength work — heavy, low-volume, well short of failure. This is the only part of the block where lifting is allowed to cost you anything.`,
    );
  }
  if (maintain > 0) {
    notes.push(
      `Weeks ${build + 1}–${build + maintain} hold the loads and cut the sets. Your ${label} training is the priority from here; lifting exists to stop you losing what you built.`,
    );
  }
  if (taper) {
    notes.push(
      `Week ${total - 1} is a taper — the load stays respectable but the volume is gutted, because intensity is the half of the dose that defends strength on reduced volume.`,
    );
  }
  notes.push(
    `Week ${total} is race week: one short session early on and nothing inside 72 hours of the start. Nothing you lift that week makes you faster; plenty of it could make you slower.`,
  );

  return { phases, notes, warnings };
}

// ── Day templates ─────────────────────────────────────────────────────────────

export interface SportPlan {
  splitName: string;
  splitReason: string;
  days: DayTemplate[];
  budget: LiftBudget;
  rationale: string[];
  warnings: string[];
}

const TRI_STRENGTH_DAY = (): DayTemplate => ({
  title: 'Max Strength — legs, trunk',
  slots: [
    {
      muscle: 'Quads', main: true, mechanics: 'compound',
      patterns: ['Squat', 'Leg Press'],
      preferIds: ['barbell-back-squat', 'hack-squat', 'leg-press', 'goblet-squat'],
      dose: { sets: 4, repLow: 4, repHigh: 6 },
      why: 'Peak hip and knee extension force — the strength that shows up as sustainable power on the bike and a cheaper stride on the run.',
    },
    {
      muscle: 'Hamstrings', main: true,
      patterns: ['Hip Hinge'],
      preferIds: ['romanian-deadlifts', 'dumbbell-rdl', 'cable-pull-through'],
      dose: { sets: 3, repLow: 6, repHigh: 8 },
      why: 'Posterior-chain strength is the best-supported protective factor for the run leg, and it powers the top of the pedal stroke.',
    },
    {
      muscle: 'Calves',
      patterns: ['Calf Raise'],
      preferIds: ['seated-calf-raises', 'single-leg-calf-raise', 'standing-calf-raises'],
      dose: { sets: 3, repLow: 8, repHigh: 12 },
      why: 'Bent-knee calf work loads the soleus — the largest force contributor in running gait, and the tissue most often under-prepared for it. Three seconds down on every rep.',
    },
    {
      muscle: 'Abs',
      patterns: ['Anti-Rotation'],
      preferIds: ['pallof-press', 'dead-bug'],
      dose: { sets: 2, repLow: 8, repHigh: 12 },
      why: 'Anti-rotation strength holds the aero position without leaking power, and keeps your pelvis honest as the run wears on.',
    },
  ],
});

const TRI_UNILATERAL_DAY = (): DayTemplate => ({
  title: 'Unilateral + Upper — single leg, pull',
  phases: THROUGH_MAINTENANCE,
  slots: [
    {
      muscle: 'Quads', main: true, mechanics: 'compound',
      patterns: ['Lunge'],
      preferIds: ['dumbbell-step-up', 'bulgarian-split-squat', 'walking-lunges'],
      dose: { sets: 3, repLow: 6, repHigh: 8 },
      why: 'Loaded single-leg hip extension is the closest the gym gets to a pedal stroke, and it exposes the side-to-side asymmetry bilateral lifting hides.',
    },
    {
      muscle: 'Hamstrings',
      patterns: ['Hip Hinge'],
      preferIds: ['single-leg-rdl', 'dumbbell-rdl'],
      dose: { sets: 3, repLow: 8, repHigh: 10 },
      why: 'Hamstring strength plus pelvic control in one movement — the combination that holds up in the back half of a run.',
    },
    {
      muscle: 'Lats', main: true, mechanics: 'compound',
      patterns: ['Pull Up', 'Pull Down'],
      preferIds: ['chin-ups', 'lat-pull-down', 'weighted-pull-ups'],
      dose: { sets: 3, repLow: 6, repHigh: 10 },
      why: 'Vertical pulling strength for the catch — the phase of the stroke where propulsion is actually generated.',
    },
    {
      muscle: 'Upper Back',
      patterns: ['Row'],
      preferIds: ['seated-cable-row', 'chest-supported-row', 'bent-over-db-row'],
      dose: { sets: 2, repLow: 8, repHigh: 12 },
      why: 'Postural counterweight to the hours you spend folded over the bars.',
    },
    {
      muscle: 'Delts',
      patterns: ['Rotation', 'Reverse Fly'],
      preferIds: ['db-external-rotation', 'db-y-raise', 'face-pulls'],
      dose: { sets: 2, repLow: 12, repHigh: 15 },
      why: 'Light external rotation balances the internally-rotated pull of swim volume. Two or three kilos is plenty — this slot is insurance, not training.',
    },
  ],
});

const TRI_POWER_DAY = (): DayTemplate => ({
  title: 'Power & Stability — short session',
  phases: BUILD_PHASES,
  minLiftDays: 3,
  slots: [
    {
      muscle: 'Calves',
      patterns: ['Jump'],
      preferIds: ['pogo-hops'],
      dose: { sets: 3, repLow: 12, repHigh: 20 },
      why: 'Low-amplitude hopping trains Achilles stiffness — the elastic return that makes each stride cost less. Quality over accumulation; stop when they stop feeling springy.',
    },
    {
      muscle: 'Quads',
      patterns: ['Jump'],
      preferIds: ['box-jump'],
      dose: { sets: 3, repLow: 4, repHigh: 6 },
      why: 'Rate of force development, which matters more at short-course intensity than at long. Full recovery between sets — this is a power slot, not conditioning.',
    },
    {
      muscle: 'Abductors',
      patterns: ['Abduction'],
      preferIds: ['hip-abduction', 'banded-hip-abduction'],
      dose: { sets: 3, repLow: 12, repHigh: 15 },
      why: 'Glute-med strength controls the pelvis on every single-leg stance phase — the cheapest insurance there is against ITB and kneecap pain.',
    },
    {
      muscle: 'Abs',
      patterns: ['Plank'],
      preferIds: ['side-plank', 'plank'],
      dose: { sets: 2, repLow: 30, repHigh: 45 },
      why: 'Lateral trunk stability under single-leg load. Logged in seconds — build the hold, not the reps.',
    },
  ],
});

// Weak-link bias: one extra set on the discipline that needs it most, plus a
// slot the balanced template wouldn't have spent. Deliberately small — a weak
// link is a reason to bias a plan, not to unbalance it.
function applyWeakLink(days: DayTemplate[], weakLink: Discipline): string[] {
  const notes: string[] = [];
  const findSlot = (dayIdx: number, muscle: MuscleGroup): Slot | undefined =>
    days[dayIdx]?.slots.find(s => s.muscle === muscle);

  if (weakLink === 'bike') {
    const stepUp = findSlot(1, 'Quads');
    if (stepUp?.dose) {
      stepUp.dose = { ...stepUp.dose, sets: stepUp.dose.sets + 1 };
      notes.push('Bike is your weak link, so the single-leg step-up carries an extra set — unilateral hip extension is the most direct strength transfer to sustained pedalling power.');
    }
  } else if (weakLink === 'run') {
    const calf = findSlot(0, 'Calves');
    if (calf?.dose) {
      calf.dose = { ...calf.dose, sets: calf.dose.sets + 1 };
      notes.push('Run is your weak link, so calf loading gets an extra set — the soleus and Achilles carry more force per stride than anything else in the chain.');
    }
  } else if (weakLink === 'swim') {
    const upper = days[1];
    if (upper && !upper.slots.some(s => s.muscle === 'Lats' && s.patterns?.includes('Pull Over'))) {
      upper.slots.push({
        muscle: 'Lats',
        patterns: ['Pull Over', 'Pull Down'],
        preferIds: ['straight-arm-pulldowns', 'dumbbell-pullover'],
        dose: { sets: 2, repLow: 10, repHigh: 14 },
        why: 'Straight-arm pulling mirrors the front of the catch, where a weak swim usually loses its water.',
      });
      notes.push('Swim is your weak link, so the upper day adds a straight-arm pulling slot on top of the vertical pull.');
    }
  }
  return notes;
}

// Niggles reroute the template. Each rule is a substitution or a removal with a
// stated reason — never a silent drop.
function applyNiggles(days: DayTemplate[], niggles: string[]): string[] {
  const notes: string[] = [];
  const has = (id: string) => niggles.includes(id);

  if (has('achilles')) {
    for (const day of days) {
      day.slots = day.slots.filter(s => {
        if (s.patterns?.includes('Jump')) {
          if (s.muscle === 'Calves') {
            // Keep the calf slot, load it slowly instead of ballistically.
            s.patterns = ['Calf Raise'];
            s.preferIds = ['single-leg-calf-raise', 'seated-calf-raises'];
            s.dose = { sets: 3, repLow: 8, repHigh: 12 };
            s.why = 'Heavy-slow calf loading instead of hopping — the tendon still gets the stimulus it needs, without the impact an irritable Achilles cannot absorb yet.';
            return true;
          }
          return false;
        }
        return true;
      });
    }
    notes.push('Achilles/calf history noted — the jumping is out and calf work is loaded heavy and slow instead. Reintroduce hops only once it is quiet for a few weeks.');
  }

  if (has('knee')) {
    for (const day of days) {
      day.slots = day.slots.filter(s => !(s.patterns?.includes('Jump') && s.muscle === 'Quads'));
      for (const s of day.slots) {
        if (s.muscle === 'Quads' && s.patterns?.includes('Squat')) {
          s.preferIds = ['leg-press', 'hack-squat', 'goblet-squat'];
          s.why = 'Supported knee-extension work with a controlled range — the strength still transfers, and the joint gets a say in the depth.';
        }
      }
    }
    notes.push("Knee history noted — box jumps are out, squatting moves to supported variations, and hip abduction stays in as the direct fix for the pelvic control that usually drives runner's knee.");
  }

  if (has('back')) {
    for (const day of days) {
      for (const s of day.slots) {
        if (s.patterns?.includes('Hip Hinge')) {
          s.preferIds = ['single-leg-rdl', 'cable-pull-through', 'seated-leg-curl', 'lying-leg-curl'];
          s.why = 'Lighter, supported posterior-chain work — the hamstrings and glutes still get loaded without a barbell compressing your spine.';
        }
        if (s.muscle === 'Quads' && s.patterns?.includes('Squat')) {
          s.preferIds = ['leg-press', 'hack-squat'];
        }
      }
    }
    notes.push('Low-back history noted — barbell hinges and axial squatting are replaced with supported and single-leg versions.');
  }

  if (has('shoulder')) {
    for (const day of days) {
      for (const s of day.slots) {
        if (s.muscle === 'Delts') {
          s.preferIds = ['db-external-rotation', 'face-pulls', 'db-y-raise'];
          s.dose = { sets: 3, repLow: 12, repHigh: 15 };
          s.why = 'Rotation and posterior-cuff work only — no overhead loading while the shoulder is unhappy. Light weight, strict form, every session.';
        }
      }
    }
    notes.push('Shoulder history noted — nothing goes overhead, and the rotation work gets an extra set because that is the part that actually helps.');
  }

  return notes;
}

/**
 * The full sport-support prescription: which days, which slots, how much, and
 * why — pure, so the planner can call it and the tests can assert on it.
 */
export function buildSportPlan(
  ctx: SportContext,
  requestedDays: number,
  experience: ExperienceLevel = 'intermediate',
  band: VolumeTarget = volumeTargetFor('sport-support'),
): SportPlan {
  const meta = sportMeta(ctx.sport);
  const budget = liftBudget(ctx, requestedDays, experience);
  const warnings: string[] = [];
  if (budget.warning) warnings.push(budget.warning);

  let days = [TRI_STRENGTH_DAY(), TRI_UNILATERAL_DAY(), TRI_POWER_DAY()]
    .filter(d => (d.minLiftDays ?? 0) <= budget.days)
    .slice(0, budget.days);

  const rationale: string[] = [
    'Two or three sessions a week of heavy, low-volume, multi-joint lifting is the dose the concurrent-training research supports for endurance athletes — enough to raise maximal strength, cheap enough that your sport keeps its recovery.',
    'Every main lift stops two to three reps short of failure. The strength adaptation does not need the last rep; your next session does need the recovery it would cost.',
    'Volume sits well under a bodybuilding dose on purpose: added muscle mass is weight you carry for the whole race, and rising tonnage is a cost here rather than a sign of progress.',
  ];

  if (!meta.specialised) {
    warnings.push(
      `${meta.label} doesn't have a specialised template yet, so this plan uses the general strength-support layout. `
      + 'Review the workouts below and swap anything that doesn\'t match your event.',
    );
  }
  if (meta.family === 'endurance') {
    rationale.push('Running-dominant training interferes with lifting more than cycling or swimming does, because of the eccentric load — which is why the plan tapers lifting as race day approaches instead of holding it flat.');
  }

  rationale.push(...applyWeakLink(days, ctx.weakLink));
  rationale.push(...applyNiggles(days, ctx.niggles));

  // ── Enforce the ceilings ──
  // Two passes, in this order, because they answer different questions. The
  // per-muscle cap stops a weak-link bonus or a stacked pattern from pushing one
  // area past the goal's band; only then does the weekly total get trimmed.
  // Both only ever take sets from non-main slots and never below two — the
  // heavy anchors are the reason the plan exists.
  const trimmableIn = (slots: Slot[]): Slot[] =>
    slots.filter(s => !s.main && s.dose && s.dose.sets > 2)
      .sort((a, b) => b.dose!.sets - a.dose!.sets);

  const setsFor = (muscle: MuscleGroup): number => days
    .flatMap(d => d.slots)
    .filter(s => s.muscle === muscle)
    .reduce((sum, s) => sum + (s.dose?.sets ?? 3), 0);

  const muscles = new Set(days.flatMap(d => d.slots.map(s => s.muscle)));
  for (const muscle of muscles) {
    let guard = 0;
    while (setsFor(muscle) > band.high && guard++ < 20) {
      const candidates = trimmableIn(days.flatMap(d => d.slots).filter(s => s.muscle === muscle));
      if (candidates.length === 0) break;
      candidates[0].dose!.sets -= 1;
    }
  }

  const total = (): number => days.reduce((sum, d) => sum + d.slots.reduce((s, sl) => s + (sl.dose?.sets ?? 3), 0), 0);
  let guard = 0;
  const dropped: string[] = [];
  while (total() > budget.maxWeeklySets && guard++ < 60) {
    const candidates = trimmableIn(days.flatMap(d => d.slots));
    if (candidates.length > 0) {
      candidates[0].dose!.sets -= 1;
      continue;
    }
    // Every accessory slot is already at its floor. Thinning further would give
    // the athlete a plan made entirely of two-set gestures, so drop the
    // lowest-priority slot instead: fewer exercises done properly beats more
    // done token. Main lifts are never candidates.
    let victim: { day: DayTemplate; slot: Slot } | null = null;
    for (const day of days) {
      for (const slot of day.slots) {
        if (slot.main) continue;
        victim = { day, slot };   // last non-main slot wins — accessories are ordered by priority
      }
    }
    if (!victim) break;
    victim.day.slots = victim.day.slots.filter(s => s !== victim!.slot);
    dropped.push(victim.slot.muscle);
  }
  if (dropped.length > 0) {
    warnings.push(
      `At ${loadLabel(ctx.load)} of ${sportLabel(ctx.sport).toLowerCase()} a week there is only room for a minimum effective dose, so `
      + `${dropped.length === 1 ? 'one accessory slot was' : `${dropped.length} accessory slots were`} dropped (${[...new Set(dropped)].join(', ')}). `
      + 'The heavy lifts are what defend your strength — those stay.',
    );
  }

  const dayWord = budget.days === 1 ? 'day' : 'days';
  const splitName = budget.days >= 3
    ? 'Strength · Unilateral · Power'
    : budget.days === 2 ? 'Strength · Unilateral' : 'Single strength session';
  const splitReason = budget.days >= 3
    ? `Three ${dayWord}: one heavy bilateral session, one single-leg and pulling session, and a short power/stability session that costs almost nothing to recover from. `
      + 'The power day is the first to go once your race gets close — you can see that in the week-by-week plan.'
    : budget.days === 2
      ? `Two ${dayWord} — the dose the research keeps validating for endurance athletes. One heavy bilateral session, one single-leg and pulling session, both under 40 minutes.`
      : 'One session a week holds the strength you have. It won\'t build much, which is the right trade this close to a race.';

  return { splitName, splitReason, days, budget, rationale, warnings };
}
