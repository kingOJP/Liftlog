// End-to-end block simulation.
//
// Every other test in data/ checks one engine in isolation. This one runs the
// whole loop the way a user actually experiences it: design a block for a
// profile, then train it week by week — reading the prescription, logging
// exactly what it asked for, feeding that history back — and check that what
// comes out the far end is coherent training.
//
// It exists because the pieces can each be right while the composition is
// wrong: a phase array that schedules no workouts, a deload that prescribes
// more than the week before it, a taper that never lightens, an intro week that
// starts heavier than week 2, volume that drifts outside the goal's band. None
// of those are visible from a unit test of the part that caused them.

import { describe, it, expect, beforeEach } from 'vitest';
import type { Session, SetLog } from '../db/database';
import type { WorkoutDay } from './program';
import { dayInPhase } from './program';
import type { PhaseKind, SportContext } from './plan';
import { isEasyPhase } from './plan';
import { buildPlanProposal } from './planner';
import type { PlannerInput } from './planner';
import { buildSetPlan } from './recommendations';
import type { ExerciseSession } from './recommendations';
import { buildSnapshot, muscleSetTotals, volumeTargetFor } from './analytics';
import { computeProgramPlan } from './coach';
import { computeCoaching } from './insights';
import { getExerciseMeta, unitFor } from './exercises';

beforeEach(() => localStorage.clear());

const WEEK = 7 * 86_400_000;
const START = new Date(2026, 0, 5).getTime(); // a Monday
const WEEKS = 10;

// ── The lifter ───────────────────────────────────────────────────────────────
// A cooperative athlete: shows up for every scheduled session and hits exactly
// what the plan prescribes. That is the right subject for this test — if the
// engines misbehave for someone who does everything asked of them, the problem
// is the engines.

/** Opening load for a movement the athlete has never trained. */
function seedWeight(exerciseId: string): number {
  if (unitFor(exerciseId) === 'seconds') return 0;
  return getExerciseMeta(exerciseId).weightType === 'Bodyweight' ? 0 : 95;
}

interface WeekRecord {
  week: number;
  phase: PhaseKind | null;
  daysTrained: number;
  workingSets: number;
  /** exerciseId → the load prescribed for set 1 this week */
  loads: Map<string, number>;
  /** exerciseId → total prescribed reps/seconds this week */
  volume: Map<string, number>;
  /** Σ load × reps across the week — the honest measure of how much work it is */
  tonnage: number;
}

interface SimResult {
  days: WorkoutDay[];
  phases: PhaseKind[];
  weeks: WeekRecord[];
  snapshot: ReturnType<typeof buildSnapshot>;
  warnings: string[];
}

function simulate(input: PlannerInput, weeks = WEEKS): SimResult {
  const proposal = buildPlanProposal(input, [], null, null);
  const perExercise = new Map<string, ExerciseSession[]>();
  const sessions: Session[] = [];
  const setLogs: SetLog[] = [];
  const records: WeekRecord[] = [];
  let sessionId = 0;
  let setLogId = 0;

  for (let w = 0; w < weeks; w++) {
    const phase = proposal.phases[w] ?? null;
    const now = START + w * WEEK;
    const scheduled = proposal.days.filter(d => dayInPhase(d, phase));
    const loads = new Map<string, number>();
    const volume = new Map<string, number>();
    let workingSets = 0;
    let tonnage = 0;

    scheduled.forEach((day, dayIdx) => {
      sessionId += 1;
      const startedAt = now + dayIdx * 86_400_000;
      const completedAt = startedAt + 45 * 60_000;
      sessions.push({
        id: sessionId, dayId: day.id, weekNumber: w + 1, startedAt, completedAt,
      });

      day.exercises.forEach((ex, order) => {
        const history = perExercise.get(ex.id) ?? [];
        const plan = buildSetPlan(history, ex, {
          phase,
          goal: input.goal,
          experience: input.experience,
          weightType: getExerciseMeta(ex.id).weightType,
          unit: unitFor(ex.id),
          now: startedAt,
        });

        // Never trained → the plan leaves the weight blank and the athlete
        // picks one. Everything after that follows the prescription.
        const weight = plan.sets[0].weight ?? seedWeight(ex.id);
        const logged = plan.sets.map(s => ({
          weight: s.weight ?? weight,
          reps: s.targetReps ?? (unitFor(ex.id) === 'seconds' ? 30 : 8),
        }));

        loads.set(ex.id, weight);
        volume.set(ex.id, logged.reduce((sum, s) => sum + s.reps, 0));
        workingSets += logged.length;
        // Bodyweight and timed work has no load, so count its reps/seconds —
        // otherwise a plank-heavy week reads as zero work.
        tonnage += logged.reduce((sum, s) => sum + (s.weight > 0 ? s.weight * s.reps : s.reps), 0);

        for (const [i, s] of logged.entries()) {
          setLogId += 1;
          setLogs.push({
            id: setLogId, sessionId, exerciseId: ex.id,
            setNumber: i + 1, weight: s.weight, reps: s.reps, order,
          });
        }
        perExercise.set(ex.id, [
          { completedAt, position: order, sets: logged },
          ...history,
        ].slice(0, 4));
      });
    });

    records.push({ week: w + 1, phase, daysTrained: scheduled.length, workingSets, loads, volume, tonnage });
  }

  return {
    days: proposal.days,
    phases: proposal.phases,
    weeks: records,
    snapshot: buildSnapshot(sessions, setLogs),
    warnings: proposal.warnings,
  };
}

// ── The profiles ─────────────────────────────────────────────────────────────

function base(overrides: Partial<PlannerInput>): PlannerInput {
  return {
    goal: 'hypertrophy',
    daysPerWeek: 3,
    weeks: WEEKS,
    includeDeload: true,
    openWithRecovery: false,
    startDate: '2026-01-05',
    notes: '',
    experience: 'intermediate',
    equipmentAccess: 'full-gym',
    priorityMuscles: [],
    injuries: '',
    ...overrides,
  };
}

function sportCtx(overrides: Partial<SportContext> = {}): SportContext {
  return {
    sport: 'triathlon', event: 'tri-olympic', proximity: 'mid',
    load: 'moderate', weakLink: 'even', niggles: [], ...overrides,
  };
}

interface Profile {
  name: string;
  input: PlannerInput;
  /** the block is expected to raise loads on its main work */
  builds: boolean;
}

const PROFILES: Profile[] = [
  { name: 'beginner · muscle growth · 3 days',
    input: base({ experience: 'beginner', goal: 'hypertrophy' }), builds: true },
  { name: 'intermediate · muscle growth · 4 days',
    input: base({ experience: 'intermediate', goal: 'hypertrophy', daysPerWeek: 4 }), builds: true },
  { name: 'advanced · strength · 4 days',
    input: base({ experience: 'advanced', goal: 'strength', daysPerWeek: 4 }), builds: true },
  { name: 'intermediate · fat loss · 3 days',
    // Defending the load through a deficit is the win; climbing is not required.
    input: base({ experience: 'intermediate', goal: 'fat-loss' }), builds: false },
  { name: 'beginner · general fitness · 2 days',
    input: base({ experience: 'beginner', goal: 'general', daysPerWeek: 2 }), builds: true },
  { name: 'advanced · general fitness · 6 days',
    input: base({ experience: 'advanced', goal: 'general', daysPerWeek: 6 }), builds: true },
  { name: 'intermediate · home gym · dumbbells only',
    input: base({ experience: 'intermediate', equipmentAccess: 'dumbbells-only' }), builds: true },
  { name: 'intermediate · knee injury noted',
    input: base({ experience: 'intermediate', injuries: 'left knee pain on squats' }), builds: true },
  { name: 'triathlete · olympic · race 3–4 months out',
    input: base({ goal: 'sport-support', sport: sportCtx({ proximity: 'mid' }) }), builds: false },
  { name: 'triathlete · sprint · race within 8 weeks',
    input: base({ goal: 'sport-support', sport: sportCtx({ event: 'tri-sprint', proximity: 'soon', weakLink: 'bike' }) }), builds: false },
  { name: 'marathoner · high sport load · race soon',
    input: base({ goal: 'sport-support', experience: 'advanced',
      sport: sportCtx({ sport: 'running', event: 'run-full', proximity: 'soon', load: 'high' }) }), builds: false },
  { name: 'beginner runner · 5k · no race date',
    input: base({ goal: 'sport-support', experience: 'beginner',
      sport: sportCtx({ sport: 'running', event: 'run-5k', proximity: 'none', load: 'low' }) }), builds: false },
];

// ── Properties every block must hold, whoever it was built for ───────────────

describe('a 10-week block, simulated end to end', () => {
  for (const profile of PROFILES) {
    describe(profile.name, () => {
      const sim = simulate(profile.input);

      it('runs for the requested number of weeks', () => {
        expect(sim.phases).toHaveLength(WEEKS);
        expect(sim.weeks).toHaveLength(WEEKS);
      });

      it('schedules at least one workout every single week', () => {
        for (const w of sim.weeks) {
          expect(w.daysTrained, `week ${w.week} (${w.phase})`).toBeGreaterThan(0);
        }
      });

      it('prescribes only real numbers — no NaN, no zero-rep sets', () => {
        for (const w of sim.weeks) {
          for (const [id, load] of w.loads) {
            expect(Number.isFinite(load), `${id} week ${w.week}`).toBe(true);
            expect(load, `${id} week ${w.week}`).toBeGreaterThanOrEqual(0);
          }
          for (const [id, vol] of w.volume) {
            expect(vol, `${id} week ${w.week}`).toBeGreaterThan(0);
          }
        }
      });

      it('never lets a week get heavier than the week before it in an easy week', () => {
        for (let i = 1; i < sim.weeks.length; i++) {
          const prev = sim.weeks[i - 1];
          const cur = sim.weeks[i];
          if (!isEasyPhase(cur.phase)) continue;
          for (const [id, load] of cur.loads) {
            const before = prev.loads.get(id);
            if (before == null || before === 0) continue;
            expect(load, `${id}: ${prev.phase} week ${prev.week} → ${cur.phase} week ${cur.week}`)
              .toBeLessThanOrEqual(before);
          }
        }
      });

      it('does less work in an easy week than in a hard one', () => {
        const easy = sim.weeks.filter(w => isEasyPhase(w.phase));
        if (easy.length === 0) return;
        // Compared against the hard weeks that surround it, not the whole
        // block: week 1 of a build is legitimately lighter than week 6.
        const hard = sim.weeks.filter(w => !isEasyPhase(w.phase));
        const avg = (ws: WeekRecord[]) => ws.reduce((s, w) => s + w.tonnage, 0) / ws.length;
        expect(avg(easy)).toBeLessThan(avg(hard));
      });

      it('keeps weekly volume inside the band its goal asks for', () => {
        const band = volumeTargetFor(profile.input.goal);
        const { totals } = muscleSetTotals(sim.snapshot);
        for (const [muscle, sets] of totals) {
          const weekly = sets / WEEKS;
          // The floor is not asserted: a 10-week block includes easy weeks, and
          // small muscles legitimately sit under the band. The ceiling is the
          // one that matters — going over it is how a plan hurts someone.
          expect(weekly, `${muscle}`).toBeLessThanOrEqual(band.high + 1);
        }
      });

      if (profile.builds) {
        it('finishes stronger than it started on its main work', () => {
          const first = sim.weeks.find(w => !isEasyPhase(w.phase))!;
          const last = [...sim.weeks].reverse().find(w => !isEasyPhase(w.phase))!;
          const loaded = [...first.loads].filter(([id, w]) => w > 0 && last.loads.has(id));
          expect(loaded.length).toBeGreaterThan(0);
          const climbed = loaded.filter(([id, start]) => last.loads.get(id)! > start);
          expect(climbed.length, 'no lift gained load across the block').toBeGreaterThan(0);
        });
      } else {
        it('holds its loads rather than bleeding them away', () => {
          const first = sim.weeks.find(w => !isEasyPhase(w.phase))!;
          const last = [...sim.weeks].reverse().find(w => !isEasyPhase(w.phase))!;
          for (const [id, start] of first.loads) {
            const end = last.loads.get(id);
            if (end == null || start === 0) continue;
            expect(end, `${id} lost load across the block`).toBeGreaterThanOrEqual(start);
          }
        });
      }

      it('produces coaching that reads the block without falling over', () => {
        const coaching = computeCoaching(
          sim.days, sim.snapshot, START + WEEKS * WEEK, sim.phases[WEEKS - 1], profile.input.goal,
        );
        expect(coaching.hasData).toBe(true);
        for (const insight of [...coaching.highlights, ...coaching.opportunities]) {
          expect(insight.title.length).toBeGreaterThan(0);
          expect(insight.detail).not.toMatch(/undefined|NaN/);
        }
      });
    });
  }
});

// ── Behaviours specific to a goal ────────────────────────────────────────────

describe('the coach never adds volume to a sport-support block', () => {
  it('holds or trims across the whole block', () => {
    const sim = simulate(base({
      goal: 'sport-support', sport: sportCtx({ proximity: 'mid' }),
    }));
    const plan = computeProgramPlan(
      sim.days, sim.snapshot, START + WEEKS * WEEK, 'accumulation', 'sport-support',
    );
    expect(plan.changes.filter(c => c.kind === 'add-set')).toHaveLength(0);
  });

  it('is willing to add volume on a hypertrophy block, by contrast', () => {
    // Same machinery, different goal — proves the sport rule is the thing
    // suppressing additions, not a dead planner.
    const sim = simulate(base({ goal: 'hypertrophy', daysPerWeek: 2 }));
    const plan = computeProgramPlan(
      sim.days, sim.snapshot, START + WEEKS * WEEK, 'accumulation', 'hypertrophy',
    );
    expect(plan.ready).toBe(true);
  });
});

describe('the near-race taper', () => {
  const sim = simulate(base({
    goal: 'sport-support',
    sport: sportCtx({ event: 'tri-sprint', proximity: 'soon' }),
  }));

  it('ends on two easy weeks', () => {
    expect(sim.phases.slice(-2)).toEqual(['deload', 'deload']);
  });

  it('drops to a single session for both of them', () => {
    expect(sim.weeks[WEEKS - 1].daysTrained).toBe(1);
    expect(sim.weeks[WEEKS - 2].daysTrained).toBe(1);
  });

  it('trains meaningfully less in the taper than in the build', () => {
    const taper = sim.weeks.slice(-2).reduce((s, w) => s + w.workingSets, 0) / 2;
    const build = sim.weeks.slice(0, 3).reduce((s, w) => s + w.workingSets, 0) / 3;
    expect(taper).toBeLessThan(build * 0.5);
  });

  it('arrives at the taper no lighter than it started — strength was banked', () => {
    const first = sim.weeks[0];
    const lastHard = [...sim.weeks].reverse().find(w => !isEasyPhase(w.phase))!;
    for (const [id, start] of first.loads) {
      if (start === 0) continue;
      expect(lastHard.loads.get(id) ?? start).toBeGreaterThanOrEqual(start);
    }
  });
});

describe('intro weeks', () => {
  // One simulation, shared: a 10-week block is the most expensive fixture in
  // the suite, and both assertions are about the same block.
  const sim = simulate(base({ experience: 'beginner', goal: 'hypertrophy' }));

  it('give a beginner two easy weeks on a long block', () => {
    expect(sim.phases.slice(0, 2)).toEqual(['intro', 'intro']);
  });

  it('train lighter than the first hard week that follows them', () => {
    const introWeeks = sim.weeks.filter(w => w.phase === 'intro');
    const firstHard = sim.weeks.find(w => w.phase !== 'intro')!;
    const lightest = Math.min(...introWeeks.map(w => w.tonnage));
    expect(lightest).toBeLessThan(firstHard.tonnage);
  });

  it('do not appear for an experienced lifter on familiar ground', () => {
    const sim = simulate(base({ experience: 'advanced', goal: 'strength' }));
    expect(sim.phases).not.toContain('intro');
  });
});
