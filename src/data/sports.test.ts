import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildSportPlan, buildSportPhases, liftBudget, sportMeta, NIGGLES,
} from './sports';
import type { SportContext } from './plan';
import { validatePhases } from './plan';
import { volumeTargetFor } from './analytics';
import { buildPlanProposal } from './planner';
import type { PlannerInput } from './planner';
import { unitFor } from './exercises';
import { profileFor } from './substitution';

beforeEach(() => localStorage.clear());

function sport(overrides: Partial<SportContext> = {}): SportContext {
  return {
    sport: 'triathlon',
    event: 'sprint',
    load: 'moderate',
    weakLink: 'even',
    niggles: [],
    ...overrides,
  };
}

// The intake the user actually gave us: sprint triathlon, race ~8 weeks out,
// 4–7 h/week of swim/bike/run, 3 lift days requested, bike as the weak link.
function triInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    goal: 'sport-support',
    daysPerWeek: 3,
    weeks: 8,
    includeDeload: true,
    openWithRecovery: false,
    startDate: '2026-08-03',
    notes: '',
    experience: 'intermediate',
    equipmentAccess: 'full-gym',
    priorityMuscles: [],
    injuries: '',
    sport: sport({ raceDate: '2026-09-26', weakLink: 'bike' }),
    ...overrides,
  };
}

const setsFor = (days: { exercises: { id: string; sets: number }[] }[], muscle: string): number =>
  days.flatMap(d => d.exercises)
    .filter(e => profileFor(e.id).primaryMuscle === muscle)
    .reduce((s, e) => s + e.sets, 0);

describe('interference budget', () => {
  it('honours the requested lift days at a moderate sport load', () => {
    expect(liftBudget(sport({ load: 'moderate' }), 3).days).toBe(3);
  });

  it('cuts lift days when the sport load is high, and says why', () => {
    const b = liftBudget(sport({ load: 'high' }), 3);
    expect(b.days).toBe(2);
    expect(b.warning).toMatch(/net loss/i);
  });

  it('shrinks the weekly set ceiling as sport hours climb', () => {
    const low = liftBudget(sport({ load: 'low' }), 3).maxWeeklySets;
    const high = liftBudget(sport({ load: 'very-high' }), 3).maxWeeklySets;
    expect(high).toBeLessThan(low);
  });

  it('caps beginners at two days regardless of available time', () => {
    expect(liftBudget(sport({ load: 'low' }), 3, 'beginner').days).toBe(2);
  });

  it('does not tax a power sport the way it taxes an endurance one', () => {
    const power = liftBudget(sport({ sport: 'sprint', load: 'moderate' }), 4).maxWeeklySets;
    const endurance = liftBudget(sport({ sport: 'triathlon', load: 'moderate' }), 4).maxWeeklySets;
    expect(power).toBeGreaterThan(endurance);
  });
});

describe('race-date periodization', () => {
  it('lays out build → maintain → taper → race week for an 8-week run-in', () => {
    const { phases } = buildSportPhases(8, 8, 'triathlon');
    expect(phases).toEqual([
      'accumulation', 'intensification', 'intensification',
      'maintenance', 'maintenance', 'maintenance',
      'deload', 'race-week',
    ]);
  });

  it('never programs a lifting peak in a race build', () => {
    const { phases } = buildSportPhases(10, 10, 'triathlon');
    expect(phases).not.toContain('peak');
  });

  it('always closes a race build with race week', () => {
    for (const weeks of [3, 5, 6, 8, 12]) {
      const { phases } = buildSportPhases(weeks, weeks, 'triathlon');
      expect(phases[phases.length - 1]).toBe('race-week');
    }
  });

  it('produces layouts the shared phase guardrails accept', () => {
    for (const weeks of [3, 4, 5, 6, 8, 10, 12]) {
      expect(validatePhases(buildSportPhases(weeks, weeks, 'triathlon').phases)).toBeNull();
      expect(validatePhases(buildSportPhases(weeks, null, 'triathlon').phases)).toBeNull();
    }
  });

  it('treats a block with no race date as base training — no taper, no race week', () => {
    const { phases, notes } = buildSportPhases(6, null, 'triathlon');
    expect(phases).not.toContain('race-week');
    expect(phases[phases.length - 1]).toBe('deload');
    expect(notes.join(' ')).toMatch(/base training/i);
  });

  it('warns when the race sits beyond the block it was given', () => {
    const { warnings } = buildSportPhases(6, 14, 'triathlon');
    expect(warnings.join(' ')).toMatch(/another block/i);
  });
});

describe('triathlon template', () => {
  it('programs strength, unilateral and power sessions at three lift days', () => {
    const plan = buildSportPlan(sport(), 3);
    expect(plan.days).toHaveLength(3);
    expect(plan.splitName).toMatch(/Power/);
  });

  it('drops the power session first when only two days are available', () => {
    const plan = buildSportPlan(sport({ load: 'high' }), 3);
    expect(plan.days).toHaveLength(2);
    expect(plan.days.map(d => d.title).join(' ')).not.toMatch(/Power/);
  });

  it('gates the taper: the power day is build-only, the second day stops before race week', () => {
    const plan = buildSportPlan(sport(), 3);
    const [strength, unilateral, power] = plan.days;
    expect(strength.phases).toBeUndefined();               // every week
    expect(unilateral.phases).not.toContain('race-week');
    expect(unilateral.phases).not.toContain('deload');
    expect(power.phases).toEqual(['recovery', 'accumulation', 'intensification', 'peak']);
  });

  it('keeps every slot inside the sport-support weekly band', () => {
    const band = volumeTargetFor('sport-support');
    for (const weakLink of ['swim', 'bike', 'run', 'even'] as const) {
      const plan = buildSportPlan(sport({ weakLink }), 3);
      const byMuscle = new Map<string, number>();
      for (const day of plan.days) {
        for (const slot of day.slots) {
          byMuscle.set(slot.muscle, (byMuscle.get(slot.muscle) ?? 0) + (slot.dose?.sets ?? 3));
        }
      }
      for (const [muscle, sets] of byMuscle) {
        expect(sets, `${weakLink}: ${muscle}`).toBeLessThanOrEqual(band.high);
      }
    }
  });

  it('respects the weekly set ceiling the sport load allows', () => {
    for (const load of ['low', 'moderate', 'high', 'very-high'] as const) {
      const plan = buildSportPlan(sport({ load }), 3);
      const total = plan.days.reduce(
        (sum, d) => sum + d.slots.reduce((s, sl) => s + (sl.dose?.sets ?? 3), 0), 0,
      );
      expect(total, load).toBeLessThanOrEqual(plan.budget.maxWeeklySets);
    }
  });

  it('never trims a main lift below its prescription', () => {
    const plan = buildSportPlan(sport({ load: 'very-high' }), 3);
    for (const day of plan.days) {
      for (const slot of day.slots) {
        if (slot.main) expect(slot.dose!.sets).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('biases the weak link without unbalancing the plan', () => {
    const even = buildSportPlan(sport({ weakLink: 'even' }), 3);
    const bike = buildSportPlan(sport({ weakLink: 'bike' }), 3);
    const stepUpEven = even.days[1].slots.find(s => s.preferIds?.includes('dumbbell-step-up'));
    const stepUpBike = bike.days[1].slots.find(s => s.preferIds?.includes('dumbbell-step-up'));
    expect(stepUpBike!.dose!.sets).toBe(stepUpEven!.dose!.sets + 1);
    expect(bike.rationale.join(' ')).toMatch(/bike is your weak link/i);
  });

  it('adds a straight-arm pulling slot for a weak swim', () => {
    const plan = buildSportPlan(sport({ weakLink: 'swim' }), 3);
    const upper = plan.days[1];
    expect(upper.slots.some(s => s.preferIds?.includes('straight-arm-pulldowns'))).toBe(true);
  });

  it('flags sports that have no specialised template yet', () => {
    expect(sportMeta('hyrox').specialised).toBe(false);
    const plan = buildSportPlan(sport({ sport: 'hyrox' }), 3);
    expect(plan.warnings.join(' ')).toMatch(/specialised template/i);
  });
});

describe('niggles reroute the template', () => {
  it('replaces jumping with heavy-slow calf work for an Achilles history', () => {
    const plan = buildSportPlan(sport({ niggles: ['achilles'] }), 3);
    const slots = plan.days.flatMap(d => d.slots);
    expect(slots.some(s => s.patterns?.includes('Jump'))).toBe(false);
    expect(slots.some(s => s.muscle === 'Calves' && s.preferIds?.includes('single-leg-calf-raise'))).toBe(true);
    expect(plan.rationale.join(' ')).toMatch(/heavy and slow/i);
  });

  it('drops box jumps and supports the squat for a knee history', () => {
    const plan = buildSportPlan(sport({ niggles: ['knee'] }), 3);
    const slots = plan.days.flatMap(d => d.slots);
    expect(slots.some(s => s.preferIds?.includes('box-jump'))).toBe(false);
    const squat = slots.find(s => s.patterns?.includes('Squat'));
    expect(squat!.preferIds![0]).toBe('leg-press');
  });

  it('keeps hip abduction in for a knee history — it is the direct fix', () => {
    const plan = buildSportPlan(sport({ niggles: ['knee'] }), 3);
    expect(plan.days.flatMap(d => d.slots).some(s => s.muscle === 'Abductors')).toBe(true);
  });

  it('routes the posterior chain away from barbell hinges for a back history', () => {
    const plan = buildSportPlan(sport({ niggles: ['back'] }), 3);
    const hinge = plan.days.flatMap(d => d.slots).find(s => s.patterns?.includes('Hip Hinge'));
    expect(hinge!.preferIds).not.toContain('romanian-deadlifts');
  });

  it('every declared niggle changes something and says so', () => {
    for (const n of NIGGLES) {
      const plan = buildSportPlan(sport({ niggles: [n.id] }), 3);
      expect(plan.rationale.join(' '), n.id).toMatch(/noted/i);
    }
  });
});

describe('the full proposal for a sprint triathlon 8 weeks out', () => {
  it('produces the approved three-session block', () => {
    const p = buildPlanProposal(triInput(), [], null, null);
    expect(p.splitName).toBe('Strength · Unilateral · Power');
    expect(p.days).toHaveLength(3);
    expect(p.phases).toEqual([
      'accumulation', 'intensification', 'intensification',
      'maintenance', 'maintenance', 'maintenance',
      'deload', 'race-week',
    ]);
  });

  it('anchors day one on a heavy bilateral squat at 4–6 reps', () => {
    const p = buildPlanProposal(triInput(), [], null, null);
    const main = p.days[0].exercises[0];
    expect(main.id).toBe('barbell-back-squat');
    expect(main.sets).toBe(4);
    expect(main.repHigh).toBe(6);
  });

  it('selects the movements the sport template asks for, not bodybuilding staples', () => {
    const p = buildPlanProposal(triInput(), [], null, null);
    const ids = p.days.flatMap(d => d.exercises.map(e => e.id));
    for (const wanted of [
      'romanian-deadlifts', 'seated-calf-raises', 'pallof-press',
      'dumbbell-step-up', 'single-leg-rdl', 'db-external-rotation',
      'pogo-hops', 'hip-abduction', 'side-plank',
    ]) {
      expect(ids, wanted).toContain(wanted);
    }
  });

  it('prescribes the side plank in seconds, not reps', () => {
    const p = buildPlanProposal(triInput(), [], null, null);
    const plank = p.days.flatMap(d => d.exercises).find(e => e.id === 'side-plank')!;
    expect(unitFor(plank.id)).toBe('seconds');
    expect(plank.repLow).toBeGreaterThanOrEqual(20);
  });

  it('holds every muscle inside the 4–10 sport-support band', () => {
    const p = buildPlanProposal(triInput(), [], null, null);
    const band = volumeTargetFor('sport-support');
    for (const muscle of ['Quads', 'Hamstrings', 'Calves', 'Abs', 'Lats', 'Abductors']) {
      expect(setsFor(p.days, muscle), muscle).toBeLessThanOrEqual(band.high);
    }
  });

  it('lands nowhere near a hypertrophy dose', () => {
    const tri = buildPlanProposal(triInput(), [], null, null);
    const hyp = buildPlanProposal(
      { ...triInput(), goal: 'hypertrophy', sport: undefined, daysPerWeek: 3 }, [], null, null,
    );
    const total = (days: typeof tri.days) => days.reduce((s, d) => s + d.exercises.reduce((a, e) => a + e.sets, 0), 0);
    expect(total(tri.days) / 3).toBeLessThan(total(hyp.days) / 3 * 1.6);
    expect(setsFor(tri.days, 'Chest')).toBe(0); // no bench press in a triathlon block
  });

  it('explains every exercise with the slot rationale, not a generic line', () => {
    const p = buildPlanProposal(triInput(), [], null, null);
    for (const d of p.decisions) {
      expect(d.reason.length, d.name).toBeGreaterThan(40);
    }
    expect(p.decisions.find(d => d.exerciseId === 'seated-calf-raises')!.reason).toMatch(/soleus/i);
  });

  it('states that the sport wins any scheduling conflict', () => {
    const p = buildPlanProposal(triInput(), [], null, null);
    expect(p.intent).toMatch(/triathlon workout wins/i);
    expect(p.progression).toMatch(/never add sets/i);
  });

  it('reduces the plan to two days and warns when sport hours are high', () => {
    const p = buildPlanProposal(
      triInput({ sport: sport({ raceDate: '2026-09-26', weakLink: 'bike', load: 'high' }) }),
      [], null, null,
    );
    expect(p.days).toHaveLength(2);
    expect(p.warnings.join(' ')).toMatch(/3 lifting days/);
  });

  it('keeps sessions short enough to fit around real training', () => {
    const p = buildPlanProposal(triInput(), [], null, null);
    expect(p.warnings.filter(w => /projects ~/.test(w))).toHaveLength(0);
  });

  it('ignores priority-muscle bumps that would spend the sport\'s recovery', () => {
    const withPriority = buildPlanProposal(
      triInput({ priorityMuscles: ['Chest', 'Biceps'] }), [], null, null,
    );
    const without = buildPlanProposal(triInput(), [], null, null);
    const total = (days: typeof without.days) => days.reduce((s, d) => s + d.exercises.reduce((a, e) => a + e.sets, 0), 0);
    expect(total(withPriority.days)).toBe(total(without.days));
  });
});
