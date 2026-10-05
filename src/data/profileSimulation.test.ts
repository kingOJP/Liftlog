// Five user profiles, three months each.
//
// blockSimulation.test.ts trains one block with a perfect follower. This file
// is the other half of the October 2026 functional audit: a *person* using
// the app for a quarter — onboarding through the real planner, activating
// blocks through the real planStore, training against the real per-set
// prescription and coach overlay, wrapping blocks with the real retrospective
// and replanning with its carryover — while the athlete is simulated as a
// human rather than a perfect follower: a hidden per-exercise capacity that
// grows at a training-age-dependent rate, day-to-day noise, set-to-set
// fatigue, skipped sessions, a week off.
//
// Every week the harness records what the user would have seen: the chip on
// every exercise card, the coach adjustments, the dashboard's progress read,
// and at each block boundary the review and the next proposal. The
// assertions come in two kinds:
//
//   • properties that hold today (the app never crashes, never prescribes
//     NaN, always explains itself) — plain `it`;
//   • the audit's findings, reproduced — `it.fails`. vitest reports an
//     `it.fails` test that starts passing as a failure, so each one flips to
//     a plain `it` in the phase of docs/action-plan-2026-10.md that fixes it.
//
// The athlete is synthetic, so absolute numbers are illustrative; the
// mechanisms are deterministic (seeded PRNG) and reproducible.

import { describe, it, expect, beforeEach } from 'vitest';
import type { Session, SetLog } from '../db/database';
import type { Exercise, WorkoutDay } from './program';
import { dayInPhase } from './program';
import type { ExperienceLevel, Goal, PhaseKind, TrainingPlan, TrainingProfile } from './plan';
import { isEasyPhase, toPlanDate } from './plan';
import { buildPlanProposal } from './planner';
import type { ExerciseDecision, PlannerInput } from './planner';
import { buildSetPlan } from './recommendations';
import type { ExerciseSession, RecKind } from './recommendations';
import { buildSnapshot, sessionTimestamp } from './analytics';
import type { TrainingSnapshot } from './analytics';
import { applyPlanToDay, computeProgramPlan } from './coach';
import { computeCoaching } from './insights';
import type { Coaching } from './insights';
import { EXERCISE_MAP, getExerciseMeta, unitFor } from './exercises';
import { computeBlockRetrospective } from './retrospective';
import type { BlockRetrospective } from './plan';
import {
  activateProposal, getActiveBlockInfo, getActivePhase, getProfileOrDefault,
  getTrainingGoal, saveTrainingProfile,
} from './planStore';
import { effectiveExperience, inferExperience } from './experience';
import { getStoredProgram } from './programStore';
import { snapshotPositions } from './progress';
import { slotFor } from './prescribe';

beforeEach(() => localStorage.clear());

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const START = new Date(2026, 6, 6).getTime(); // Monday 6 July 2026
const QUARTER = 13;
/** "Today" for the end-of-quarter Metrics read. */
const END = START + QUARTER * WEEK - 2 * DAY;

// ── The athlete ──────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Weekly capacity growth by training age (the hidden truth the engines chase). */
const GROWTH: Record<ExperienceLevel, number> = { beginner: 0.02, intermediate: 0.006, advanced: 0.0025 };
const NOISE = 0.03;
const FATIGUE = 0.07;

/** Epley, inverted: reps achievable at `weight` for an estimated 1RM `e1rm`. */
function repsAt(e1rm: number, weight: number): number {
  return Math.floor((e1rm / weight - 1) * 30);
}
function loadFor(e1rm: number, reps: number): number {
  return e1rm / (1 + reps / 30);
}
function snap5(w: number): number {
  return Math.max(5, Math.round(w / 5) * 5);
}

/** A plausible opening 1RM (or max reps/seconds) for a never-trained movement. */
function seedCapacity(exerciseId: string, level: ExperienceLevel): number {
  const scale = { beginner: 0.6, intermediate: 1, advanced: 1.4 }[level];
  if (unitFor(exerciseId) === 'seconds') return 45 * scale;
  const wt = getExerciseMeta(exerciseId).weightType;
  if (wt === 'Bodyweight') return 12 * scale;
  const base = { Barbell: 200, Dumbbell: 60, Machine: 160, Kettlebell: 50, 'EZ Bar': 90, 'Resistance Band': 40 }[wt ?? 'Machine'] ?? 120;
  // Lower-body compounds are stronger than pressing; crude but enough.
  const def = EXERCISE_MAP.get(exerciseId);
  const legs = def?.primaryMuscle === 'Quads' || def?.primaryMuscle === 'Glutes' || def?.primaryMuscle === 'Hamstrings';
  return base * scale * (legs ? 1.6 : 1);
}

interface AthleteSpec {
  level: ExperienceLevel;
  /** chance any single scheduled session is skipped */
  skipRate: number;
  /** 0-based quarter weeks with no training at all */
  weeksOff?: number[];
  /** reps in reserve the athlete leaves when choosing an opening weight */
  caution: number;
  seed: number;
}

class Athlete {
  private capacity = new Map<string, number>();
  readonly spec: AthleteSpec;
  readonly rng: () => number;
  constructor(spec: AthleteSpec) {
    this.spec = spec;
    this.rng = mulberry32(spec.seed);
  }

  private cap(id: string): number {
    let c = this.capacity.get(id);
    if (c == null) {
      c = seedCapacity(id, this.spec.level);
      this.capacity.set(id, c);
    }
    return c;
  }

  /** A week of life: every capacity grows at the athlete's rate. */
  weekPasses(): void {
    for (const [id, c] of this.capacity) this.capacity.set(id, c * (1 + GROWTH[this.spec.level]));
  }

  /** The weight chosen for a lift the plan left blank. */
  chooseWeight(id: string, targetReps: number | null): number {
    if (unitFor(id) === 'seconds' || getExerciseMeta(id).weightType === 'Bodyweight') return 0;
    return snap5(loadFor(this.cap(id), (targetReps ?? 10) + this.spec.caution));
  }

  /** What actually happens on set `index` at `weight`, chasing `target`. */
  perform(id: string, weight: number, target: number | null, index: number): number {
    const effort = (1 + (this.rng() * 2 - 1) * NOISE) * (1 - FATIGUE * index);
    const timed = unitFor(id) === 'seconds';
    const achievable = weight > 0
      ? repsAt(this.cap(id) * effort, weight)
      : Math.floor(this.cap(id) * effort);
    const attempt = target == null
      ? achievable - 2
      : target + (this.rng() < 0.3 ? 1 : 0);
    return Math.max(timed ? 10 : 1, Math.min(attempt, achievable));
  }
}

// ── The harness ──────────────────────────────────────────────────────────────

interface ChipRecord {
  week: number;
  exerciseId: string;
  kind: RecKind | null;
  reason: string | null;
  /** set-1 prescribed weight (null → athlete chose) */
  weight: number | null;
}

interface WeekRecord {
  week: number;
  phase: PhaseKind | null;
  attended: number;
  scheduled: number;
  chips: ChipRecord[];
  adjustments: number;
  /** the dashboard/metrics read on the Monday, before training */
  coaching: Coaching | null;
  inferred: ExperienceLevel;
  weeklySets: number;
  /** exerciseId → set-1 load prescribed this week */
  loads: Map<string, number>;
}

interface BlockRecord {
  startWeek: number;
  weeks: number;
  program: WorkoutDay[];
  phases: PhaseKind[];
  decisions: ExerciseDecision[];
  /** the retrospective of the block this one replaced, as the wizard showed it */
  previousReview: BlockRetrospective | null;
  plannedWith: ExperienceLevel;
}

interface Journey {
  weeks: WeekRecord[];
  blocks: BlockRecord[];
  snapshot: TrainingSnapshot;
  finalCoaching: Coaching;
  finalPlan: TrainingPlan | null;
}

interface BlockSpec {
  weeks: number;
  includeDeload: boolean;
}

interface PlannedProfile {
  name: string;
  profile: Omit<TrainingProfile, 'updatedAt'>;
  goal: Goal;
  blocks: BlockSpec[];
  athlete: AthleteSpec;
  /** review-step edits: swap `from` for `to` on the first day that has `from` */
  swapAtReview?: { from: string; to: string };
}

function historyFor(exerciseId: string, snapshot: TrainingSnapshot): ExerciseSession[] {
  // Mirrors WorkoutView: up to the last 4 sessions containing the lift.
  const positions = snapshotPositions(snapshot);
  const out: ExerciseSession[] = [];
  for (const session of snapshot.sessions) {
    const sets = (snapshot.setsBySession.get(session.id!) ?? [])
      .filter(s => s.exerciseId === exerciseId)
      .sort((a, b) => a.setNumber - b.setNumber)
      .map(s => ({ weight: s.weight, reps: s.reps }));
    if (sets.length > 0) {
      out.push({ completedAt: sessionTimestamp(session), sets, position: positions.get(session.id!)?.get(exerciseId) ?? null });
    }
    if (out.length >= 4) break;
  }
  return out;
}

class Log {
  sessions: Session[] = [];
  setLogs: SetLog[] = [];
  snapshot = buildSnapshot([], []);
  private nextSession = 1;
  private nextSet = 1;

  startSession(dayId: number, startedAt: number): number {
    const id = this.nextSession++;
    this.sessions.push({ id, dayId, weekNumber: 1, startedAt, completedAt: startedAt + 50 * 60_000 });
    return id;
  }

  logSet(sessionId: number, exerciseId: string, setNumber: number, weight: number, reps: number, order: number): void {
    this.setLogs.push({ id: this.nextSet++, sessionId, exerciseId, setNumber, weight, reps, order });
  }

  refresh(): void {
    this.snapshot = buildSnapshot(this.sessions, this.setLogs);
  }
}

/** One week of training the live program, exactly as WorkoutView would run it. */
function trainWeek(week: number, athlete: Athlete, log: Log, program: WorkoutDay[]): WeekRecord {
  const monday = START + week * WEEK;
  const phase = getActivePhase(monday);
  const goal = getTrainingGoal();
  const experience = effectiveExperience(getProfileOrDefault(), log.snapshot);
  const coaching = log.snapshot.sessions.length > 0
    ? computeCoaching(program, log.snapshot, monday, phase, goal)
    : null;
  const overlay = computeProgramPlan(program, log.snapshot, monday, phase, goal);
  const scheduled = program.filter(d => dayInPhase(d, phase));
  const chips: ChipRecord[] = [];
  const loads = new Map<string, number>();
  let attended = 0;
  let weeklySets = 0;

  const off = athlete.spec.weeksOff?.includes(week) ?? false;
  if (!off) {
    scheduled.forEach((day, di) => {
      if (athlete.rng() < athlete.spec.skipRate) return;
      attended += 1;
      const effDay = applyPlanToDay(day, overlay);
      const startedAt = monday + di * DAY + 17 * 3_600_000;
      const sessionId = log.startSession(day.id, startedAt);
      effDay.exercises.forEach((ex, order) => {
        const plan = buildSetPlan(historyFor(ex.id, log.snapshot), ex, {
          phase, goal, experience, now: startedAt,
          weightType: getExerciseMeta(ex.id).weightType, unit: unitFor(ex.id),
        });
        const chosen = plan.sets[0].weight ?? athlete.chooseWeight(ex.id, plan.sets[0].targetReps);
        chips.push({ week, exerciseId: ex.id, kind: plan.rec?.kind ?? null, reason: plan.rec?.reason ?? null, weight: plan.sets[0].weight });
        loads.set(ex.id, chosen);
        plan.sets.forEach((s, i) => {
          const weight = s.weight ?? chosen;
          const reps = athlete.perform(ex.id, weight, s.targetReps, i);
          log.logSet(sessionId, ex.id, i + 1, weight, reps, order);
          weeklySets += 1;
        });
      });
      log.refresh();
    });
  }
  athlete.weekPasses();
  return {
    week, phase, attended, scheduled: off ? 0 : scheduled.length, chips,
    adjustments: overlay.changes.length, coaching,
    inferred: inferExperience(log.snapshot, monday).level, weeklySets, loads,
  };
}

/** Plan and activate a block the way PlanSetupView does, at the given Monday. */
function planBlock(spec: BlockSpec, p: PlannedProfile, week: number, log: Log, isFirst: boolean): BlockRecord {
  const monday = START + week * WEEK;
  const snapshot = log.snapshot.sessions.length > 0 ? log.snapshot : null;
  const active = getActiveBlockInfo();
  const previousReview = active && snapshot ? computeBlockRetrospective(active.block, snapshot, monday) : null;
  const experience = effectiveExperience(getProfileOrDefault(), snapshot);
  const input: PlannerInput = {
    goal: p.goal,
    daysPerWeek: p.profile.daysPerWeek,
    weeks: spec.weeks,
    includeDeload: spec.includeDeload,
    openWithRecovery: !isFirst,
    startDate: toPlanDate(new Date(monday)),
    notes: '',
    experience,
    equipmentAccess: p.profile.equipment,
    priorityMuscles: p.profile.priorityMuscles,
    injuries: p.profile.injuries,
    previousGoal: active?.plan.goal ?? null,
  };
  const proposal = buildPlanProposal(input, getStoredProgram(), snapshot, previousReview);
  let days = proposal.days;
  if (p.swapAtReview) {
    const { from, to } = p.swapAtReview;
    const def = EXERCISE_MAP.get(to)!;
    days = days.map(d => ({
      ...d,
      exercises: d.exercises.map(ex => (ex.id === from ? { ...ex, id: to, name: def.name } : ex)),
    }));
  }
  activateProposal({ ...proposal, days }, previousReview, monday);
  return {
    startWeek: week, weeks: spec.weeks, program: getStoredProgram(), phases: proposal.phases,
    decisions: proposal.decisions, previousReview, plannedWith: experience,
  };
}

function simulatePlanned(p: PlannedProfile): Journey {
  localStorage.clear();
  saveTrainingProfile({ ...p.profile, updatedAt: START }, START);
  const athlete = new Athlete(p.athlete);
  const log = new Log();
  const weeks: WeekRecord[] = [];
  const blocks: BlockRecord[] = [];
  let week = 0;
  for (let b = 0; week < QUARTER; b++) {
    const spec = p.blocks[Math.min(b, p.blocks.length - 1)];
    blocks.push(planBlock(spec, p, week, log, b === 0));
    for (let w = 0; w < spec.weeks && week < QUARTER; w++, week++) {
      weeks.push(trainWeek(week, athlete, log, getStoredProgram()));
    }
  }
  const info = getActiveBlockInfo();
  return {
    weeks, blocks, snapshot: log.snapshot,
    finalCoaching: computeCoaching(getStoredProgram(), log.snapshot, END, getActivePhase(END), getTrainingGoal()),
    finalPlan: info?.plan ?? null,
  };
}

// ── The profiles (functional audit, appendix) ────────────────────────────────

const PLANNED: PlannedProfile[] = [
  {
    name: 'Newcomer · beginner, 0 months · general fitness · 3 days',
    profile: { injuries: '', equipment: 'full-gym', daysPerWeek: 3, experience: 'beginner', trainingAgeMonths: 0, priorityMuscles: [] },
    goal: 'general',
    blocks: [{ weeks: 6, includeDeload: false }],
    athlete: { level: 'beginner', skipRate: 0.15, weeksOff: [7], caution: 3, seed: 1 },
  },
  {
    name: 'Guided Beginner · beginner, 9 months · muscle growth · 4 days · priority arms',
    profile: { injuries: '', equipment: 'full-gym', daysPerWeek: 4, experience: 'beginner', trainingAgeMonths: 9, priorityMuscles: ['Biceps', 'Triceps'] },
    goal: 'hypertrophy',
    blocks: [{ weeks: 8, includeDeload: false }, { weeks: 5, includeDeload: false }],
    athlete: { level: 'beginner', skipRate: 0.10, caution: 2, seed: 2 },
  },
  {
    name: 'Optimizer · intermediate, 42 months · muscle growth · 5 days · priority chest/back · shoulder note',
    profile: { injuries: 'sore right shoulder overhead', equipment: 'full-gym', daysPerWeek: 5, experience: 'intermediate', trainingAgeMonths: 42, priorityMuscles: ['Chest', 'Lats'] },
    goal: 'hypertrophy',
    blocks: [{ weeks: 6, includeDeload: true }],
    athlete: { level: 'intermediate', skipRate: 0.05, caution: 2, seed: 3 },
    swapAtReview: { from: 'dumbbell-bench-press', to: 'flat-barbell-bench-press' },
  },
  {
    name: 'Advanced · advanced, 84 months · strength · 4 days',
    profile: { injuries: '', equipment: 'full-gym', daysPerWeek: 4, experience: 'advanced', trainingAgeMonths: 84, priorityMuscles: [] },
    goal: 'strength',
    blocks: [{ weeks: 8, includeDeload: true }, { weeks: 5, includeDeload: false }],
    athlete: { level: 'advanced', skipRate: 0, caution: 1, seed: 4 },
  },
];

// ── Self-Directed: never opens the wizard, runs their own push/pull/legs ──────

const PPL: { label: string; lifts: { id: string; sets: number; reps: number }[] }[] = [
  { label: 'Push', lifts: [
    { id: 'flat-barbell-bench-press', sets: 5, reps: 5 }, { id: 'barbell-overhead-press', sets: 3, reps: 8 },
    { id: 'weighted-dips', sets: 3, reps: 8 }, { id: 'cable-lateral-raises', sets: 3, reps: 15 } ] },
  { label: 'Pull', lifts: [
    { id: 'conventional-deadlift', sets: 3, reps: 5 }, { id: 'barbell-rows', sets: 4, reps: 8 },
    { id: 'chin-ups', sets: 3, reps: 8 }, { id: 'hammer-curls', sets: 3, reps: 12 } ] },
  { label: 'Legs', lifts: [
    { id: 'barbell-back-squat', sets: 5, reps: 5 }, { id: 'romanian-deadlifts', sets: 3, reps: 8 },
    { id: 'leg-press', sets: 3, reps: 12 }, { id: 'standing-calf-raises', sets: 4, reps: 12 } ] },
];

/**
 * What App startup does to quick-workout-only history today: wrap it in a
 * migrated "Foundation training" plan with goal hypertrophy. Written directly
 * (ensureJourneyMigrated reads IndexedDB) but field-for-field the same
 * document. Phase 4.1 of the action plan changes this behaviour; update this
 * helper with it.
 */
function migrateLikeStartup(now: number): void {
  const plan: TrainingPlan = {
    id: 'sim-migrated', goal: 'hypertrophy', origin: 'migrated', status: 'active', createdAt: now,
    blocks: [{
      id: 'sim-foundation', name: 'Foundation training', focus: 'hypertrophy',
      startDate: toPlanDate(new Date(START)), phases: [], openEnded: true, program: [],
      intent: '', progression: '', status: 'active', activatedAt: now,
    }],
  };
  localStorage.setItem('liftlog_plan', JSON.stringify({ version: 1, plans: [plan], updatedAt: now }));
}

interface SelfDirectedJourney {
  weeks: WeekRecord[];
  snapshot: TrainingSnapshot;
  finalCoaching: Coaching;
  /** week → exerciseId → the slot the quick-workout picker built */
  slots: Map<number, Map<string, Exercise>>;
}

function simulateSelfDirected(): SelfDirectedJourney {
  localStorage.clear();
  const athlete = new Athlete({ level: 'intermediate', skipRate: 0.03, caution: 2, seed: 5 });
  const log = new Log();
  const weeks: WeekRecord[] = [];
  const slots = new Map<number, Map<string, Exercise>>();
  /** the lifter's own loads — they add weight when every set hits their rep target */
  const own = new Map<string, number>();

  for (let week = 0; week < QUARTER; week++) {
    const monday = START + week * WEEK;
    // The relaunch after the first week of logging runs the startup migration.
    if (week === 1) migrateLikeStartup(monday);
    const goal = getTrainingGoal();
    const experience = effectiveExperience(getProfileOrDefault(), log.snapshot);
    const coaching = log.snapshot.sessions.length > 0 ? computeCoaching([], log.snapshot, monday, null, goal) : null;
    const chips: ChipRecord[] = [];
    const loads = new Map<string, number>();
    const weekSlots = new Map<string, Exercise>();
    let attended = 0;
    let weeklySets = 0;

    PPL.forEach((day, di) => {
      if (athlete.rng() < athlete.spec.skipRate) return;
      attended += 1;
      const startedAt = monday + di * 2 * DAY + 17 * 3_600_000;
      const sessionId = log.startSession(-1, startedAt);
      day.lifts.forEach((lift, order) => {
        const def = EXERCISE_MAP.get(lift.id)!;
        // The quick-workout picker doses the slot; the lifter still trains
        // their own sets × reps on top of it.
        const slot = slotFor(lift.id, def.name, { snapshot: log.snapshot });
        weekSlots.set(lift.id, slot);
        const plan = buildSetPlan(historyFor(lift.id, log.snapshot), slot, {
          goal, experience, now: startedAt, weightType: def.weightType, unit: unitFor(lift.id),
        });
        chips.push({ week, exerciseId: lift.id, kind: plan.rec?.kind ?? null, reason: plan.rec?.reason ?? null, weight: plan.sets[0].weight });
        let weight = own.get(lift.id);
        if (weight == null) {
          weight = athlete.chooseWeight(lift.id, lift.reps);
          own.set(lift.id, weight);
        }
        loads.set(lift.id, weight);
        const reps: number[] = [];
        for (let i = 0; i < lift.sets; i++) {
          const r = athlete.perform(lift.id, weight, lift.reps, i);
          reps.push(r);
          log.logSet(sessionId, lift.id, i + 1, weight, r, order);
          weeklySets += 1;
        }
        if (weight > 0 && reps.every(r => r >= lift.reps)) own.set(lift.id, weight + (def.primaryMuscle === 'Quads' || def.primaryMuscle === 'Glutes' || def.primaryMuscle === 'Hamstrings' ? 10 : 5));
      });
      log.refresh();
    });
    athlete.weekPasses();
    slots.set(week, weekSlots);
    weeks.push({
      week, phase: null, attended, scheduled: PPL.length, chips, adjustments: 0, coaching,
      inferred: inferExperience(log.snapshot, monday).level, weeklySets, loads,
    });
  }
  return {
    weeks, snapshot: log.snapshot, slots,
    finalCoaching: computeCoaching([], log.snapshot, END, null, getTrainingGoal()),
  };
}

// ── Shared helpers for the assertions ────────────────────────────────────────

function chipsOfKind(weeks: WeekRecord[], kind: RecKind, fromWeek = 0): ChipRecord[] {
  return weeks.filter(w => w.week >= fromWeek).flatMap(w => w.chips.filter(c => c.kind === kind));
}

function decliningOn(coaching: Coaching | null): string[] {
  return (coaching?.progress ?? []).filter(p => p.status === 'declining').map(p => p.exerciseId);
}

// ── Properties every planned journey holds today ─────────────────────────────

describe('a quarter of training, profile by profile', () => {
  for (const p of PLANNED) {
    describe(p.name, () => {
      const j = simulatePlanned(p);

      it('trains the whole quarter and reaches a second block', () => {
        expect(j.weeks).toHaveLength(QUARTER);
        expect(j.blocks.length).toBeGreaterThanOrEqual(2);
        expect(j.snapshot.sessions.length).toBeGreaterThan(20);
      });

      it('schedules at least one workout every week the athlete was around', () => {
        for (const w of j.weeks) {
          if (p.athlete.weeksOff?.includes(w.week)) continue;
          expect(w.scheduled, `week ${w.week + 1} (${w.phase})`).toBeGreaterThan(0);
        }
      });

      it('prescribes only real numbers, and never a load the athlete did not choose for a first exposure', () => {
        for (const w of j.weeks) {
          for (const [id, load] of w.loads) {
            expect(Number.isFinite(load), `${id} week ${w.week + 1}`).toBe(true);
            expect(load, `${id} week ${w.week + 1}`).toBeGreaterThanOrEqual(0);
          }
        }
        for (const log of j.snapshot.setsBySession.values()) {
          for (const s of log) expect(s.reps, `${s.exerciseId}`).toBeGreaterThan(0);
        }
      });

      it('explains every exercise decision in every proposal', () => {
        for (const b of j.blocks) {
          expect(b.decisions.length).toBeGreaterThan(0);
          for (const d of b.decisions) expect(d.reason.length, d.exerciseId).toBeGreaterThan(0);
        }
      });

      it('reviews the first block with a planned-session count and a verdict per lift', () => {
        const review = j.blocks[1].previousReview!;
        expect(review).not.toBeNull();
        expect(review.sessionsPlanned).toBeGreaterThan(0);
        expect(review.adherencePct).not.toBeNull();
        expect(review.strength.length).toBeGreaterThan(0);
        for (const line of review.summary) expect(line).not.toMatch(/undefined|NaN/);
      });

      it('never renders undefined or NaN in the coach card or metrics', () => {
        const reads = [...j.weeks.map(w => w.coaching), j.finalCoaching].filter((c): c is Coaching => c != null);
        expect(reads.length).toBeGreaterThan(5);
        for (const c of reads) {
          for (const i of [...c.highlights, ...c.opportunities]) {
            expect(i.title).not.toMatch(/undefined|NaN/);
            expect(i.detail).not.toMatch(/undefined|NaN/);
          }
          for (const e of c.progress) for (const line of e.evidence) expect(line).not.toMatch(/undefined|NaN/);
        }
        for (const c of j.weeks.flatMap(w => w.chips)) {
          if (c.reason) expect(c.reason).not.toMatch(/undefined|NaN/);
        }
      });
    });
  }
});

// ── The audit's findings, reproduced ─────────────────────────────────────────
// Each flips from `it.fails` to `it` in the named phase of the action plan.

describe('F1 — progress is blind to planned easy weeks (Phase 2.1)', () => {
  // The synthetic athlete's capacity only ever grows, so a "declining" verdict
  // can only come from reading a planned back-off as weakness.
  for (const p of PLANNED.filter(x => x.name.startsWith('Newcomer') || x.name.startsWith('Optimizer'))) {
    it.fails(`${p.name.split(' ·')[0]}: nothing reads declining the Monday after a planned easy week`, () => {
      const j = simulatePlanned(p);
      const afterEasy = j.weeks.filter((w, i) => i > 0 && isEasyPhase(j.weeks[i - 1].phase) && w.coaching);
      expect(afterEasy.length, 'the journey must contain an easy week to test this').toBeGreaterThan(0);
      const declining = afterEasy.flatMap(w => decliningOn(w.coaching).map(id => `week ${w.week + 1}: ${id}`));
      expect(declining).toEqual([]);
    });
  }

  it.fails('Optimizer: the block review does not rotate out most of a program that climbed all block', () => {
    const j = simulatePlanned(PLANNED[2]);
    const replaced = j.blocks[1].decisions.filter(d => d.status === 'replacement').length;
    const total = j.blocks[0].program.reduce((n, d) => n + d.exercises.length, 0);
    expect(replaced / total).toBeLessThan(0.5);
  });
});

describe('F5 — experience inference promotes people far too fast (Phase 3.3)', () => {
  it.fails('a true newcomer is still inferred a beginner after one quarter', () => {
    const j = simulatePlanned(PLANNED[0]);
    expect(j.weeks[QUARTER - 1].inferred).toBe('beginner');
  });

  it.fails('a three-year intermediate is not inferred advanced within one quarter', () => {
    // Two advanced-tagged lifts trained three times each plus 30 sessions is
    // enough today — i.e. anyone who squats and deadlifts for ten weeks.
    const j = simulatePlanned(PLANNED[2]);
    expect(j.weeks[QUARTER - 1].inferred).not.toBe('advanced');
  });
});

describe('F6 — beginner blocks are judged against a band they were never prescribed (Phase 3.5)', () => {
  it.fails('block 2 does not grow weekly sets by more than a quarter over block 1', () => {
    const j = simulatePlanned(PLANNED[1]);
    const sets = (b: BlockRecord) => b.program.reduce((n, d) => n + d.exercises.reduce((m, e) => m + e.sets, 0), 0);
    expect(sets(j.blocks[1])).toBeLessThanOrEqual(sets(j.blocks[0]) * 1.25);
  });

  it.fails('the coach does not propose the same adjustment at every workout for a quarter', () => {
    const j = simulatePlanned(PLANNED[0]);
    const weeksWithAdjustments = j.weeks.filter(w => w.adjustments > 0).length;
    expect(weeksWithAdjustments).toBeLessThan(QUARTER / 2);
  });
});

describe('F9 — advanced lifters are deloaded for progressing slowly (Phases 2.11, 7.1)', () => {
  const j = simulatePlanned(PLANNED[3]);

  it.fails('an advanced strength block ends no lighter than it started on its loaded lifts', () => {
    const first = j.weeks.find(w => !isEasyPhase(w.phase) && w.attended > 0)!;
    const lastHard = [...j.weeks.slice(0, j.blocks[1].startWeek)].reverse().find(w => !isEasyPhase(w.phase) && w.attended > 0)!;
    const lost = [...first.loads]
      .filter(([id, start]) => start > 0 && (lastHard.loads.get(id) ?? start) < start)
      .map(([id]) => id);
    expect(lost).toEqual([]);
  });

  it.fails('block 2 keeps the main barbell lifts rather than rotating them for lighter variants', () => {
    const before = new Set(j.blocks[0].program.flatMap(d => d.exercises.map(e => e.id)));
    const after = new Set(j.blocks[1].program.flatMap(d => d.exercises.map(e => e.id)));
    const mains = [...before].filter(id => ['barbell-back-squat', 'conventional-deadlift', 'flat-barbell-bench-press', 'barbell-overhead-press'].includes(id));
    expect(mains.length, 'the strength block should anchor on barbell lifts').toBeGreaterThan(1);
    expect(mains.filter(id => !after.has(id))).toEqual([]);
  });
});

describe('F2 — a quick-workout lifter is silently given a plan and then fought by it (Phase 4.1)', () => {
  const j = simulateSelfDirected();

  it('logs a quarter of their own push/pull/legs', () => {
    expect(j.snapshot.sessions.length).toBeGreaterThan(30);
  });

  it.fails('never re-anchors a lift to a rep range the lifter did not choose', () => {
    expect(chipsOfKind(j.weeks, 'reanchor', 2).map(c => `week ${c.week + 1}: ${c.exerciseId}`)).toEqual([]);
  });

  it.fails('does not dose a 5×5 lifter as a beginner on a hypertrophy block they never planned', () => {
    const bench = j.slots.get(QUARTER - 1)!.get('flat-barbell-bench-press')!;
    // A slot derived from the lifter's own history reads 5 × ~5; the migrated
    // plan's beginner hypertrophy dose reads 2 × 8–12.
    expect(bench.repLow ?? 0).toBeLessThanOrEqual(6);
  });

  it('is assessed by the progress engine even with no program', () => {
    // The engine does its job; what hides the verdict is MetricsView filtering
    // the Progress tab to the current (empty) program — a UI concern this
    // harness cannot see. Phase 4.3 lifts that filter.
    expect(j.finalCoaching.progress.length).toBeGreaterThan(0);
  });
});
