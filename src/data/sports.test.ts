import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildSportPlan, buildSportPhases, liftBudget, eventsFor, nigglesFor, NIGGLES,
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
    event: 'tri-sprint',
    proximity: 'soon',
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
    sport: sport({ weakLink: 'bike' }),
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

  it('shrinks the ceiling as race distance grows', () => {
    const short = liftBudget(sport({ event: 'run-5k' }), 3).maxWeeklySets;
    const long = liftBudget(sport({ event: 'run-full' }), 3).maxWeeklySets;
    expect(long).toBeLessThan(short);
  });

  it('caps beginners at two days regardless of available time', () => {
    expect(liftBudget(sport({ load: 'low' }), 3, 'beginner').days).toBe(2);
  });
});

describe('race proximity shapes the block', () => {
  it('builds the whole way when there is no race close', () => {
    const { phases } = buildSportPhases(8, 'none', 'triathlon');
    expect(phases).not.toContain('maintenance');
    expect(phases.filter(p => p === 'accumulation' || p === 'intensification')).toHaveLength(8);
  });

  it('spends most of a race-close block holding rather than building', () => {
    const { phases } = buildSportPhases(8, 'soon', 'triathlon');
    const building = phases.filter(p => p === 'accumulation' || p === 'intensification').length;
    const holding = phases.filter(p => p === 'maintenance').length;
    expect(holding).toBeGreaterThan(building);
  });

  it('builds then holds at mid-range proximity', () => {
    const { phases } = buildSportPhases(10, 'mid', 'triathlon');
    expect(phases).toContain('intensification');
    expect(phases).toContain('maintenance');
  });

  it('never labels a week race week — there is no exact race date to justify it', () => {
    for (const proximity of ['none', 'soon', 'mid', 'far'] as const) {
      for (const weeks of [2, 4, 6, 8, 10, 12]) {
        expect(buildSportPhases(weeks, proximity, 'running').phases).not.toContain('race-week');
      }
    }
  });

  it('honours the requested block length exactly', () => {
    for (const weeks of [4, 6, 8, 10, 12]) {
      expect(buildSportPhases(weeks, 'mid', 'running').phases).toHaveLength(weeks);
    }
  });

  it('produces layouts the shared phase guardrails accept', () => {
    for (const proximity of ['none', 'soon', 'mid', 'far'] as const) {
      for (const weeks of [2, 3, 4, 5, 6, 8, 10, 12]) {
        for (const intro of [0, 1, 2]) {
          const { phases } = buildSportPhases(weeks, proximity, 'triathlon', intro);
          expect(validatePhases(phases), `${proximity}/${weeks}/${intro}`).toBeNull();
        }
      }
    }
  });

  it('closes a near-race block on two easy weeks', () => {
    const { phases, notes } = buildSportPhases(10, 'soon', 'triathlon');
    expect(phases.slice(-2)).toEqual(['deload', 'deload']);
    expect(phases.filter(p => p === 'deload')).toHaveLength(2);
    expect(notes.join(' ')).toMatch(/fresh legs/i);
  });

  it('keeps the taper at one week when the race is further out', () => {
    expect(buildSportPhases(10, 'mid', 'triathlon').phases.filter(p => p === 'deload')).toHaveLength(1);
    expect(buildSportPhases(10, 'far', 'triathlon').phases.filter(p => p === 'deload')).toHaveLength(0);
    expect(buildSportPhases(10, 'none', 'triathlon').phases.filter(p => p === 'deload')).toHaveLength(0);
  });

  it('shrinks the taper rather than eating the productive weeks', () => {
    // 5 weeks: two easy would leave only 3 hard weeks — exactly the minimum, so
    // the full taper survives. 4 weeks cannot afford both.
    expect(buildSportPhases(5, 'soon', 'running').phases.filter(p => p === 'deload')).toHaveLength(2);
    expect(buildSportPhases(4, 'soon', 'running').phases.filter(p => p === 'deload')).toHaveLength(1);
    expect(buildSportPhases(3, 'soon', 'running').phases.filter(p => p === 'deload')).toHaveLength(0);
  });

  it('still fits the requested length with a two-week taper', () => {
    for (const weeks of [5, 6, 8, 10, 12]) {
      expect(buildSportPhases(weeks, 'soon', 'running').phases, `${weeks}`).toHaveLength(weeks);
    }
  });

  it('runs a single short session through both taper weeks', () => {
    // Day gating does the volume cut: only the strength day survives a deload.
    const plan = buildSportPlan(sport({ proximity: 'soon' }), 3);
    const running = plan.days.filter(d => !d.phases || d.phases.includes('deload'));
    expect(running).toHaveLength(1);
    expect(running[0].title).toMatch(/Max Strength/);
  });

  it('opens with the intro weeks it was given', () => {
    const { phases } = buildSportPhases(8, 'mid', 'running', 2);
    expect(phases.slice(0, 2)).toEqual(['intro', 'intro']);
    expect(phases).toHaveLength(8);
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

  it('gates the taper: the power day is build-only, the second day stops before the deload', () => {
    const plan = buildSportPlan(sport(), 3);
    const [strength, unilateral, power] = plan.days;
    expect(strength.phases).toBeUndefined();               // every week
    expect(unilateral.phases).toContain('maintenance');
    expect(unilateral.phases).not.toContain('deload');
    expect(power.phases).not.toContain('maintenance');
    expect(power.phases).toContain('intensification');
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

  it('offers only triathlon distances for triathlon', () => {
    const ids = eventsFor('triathlon').map(e => e.id);
    expect(ids).toEqual(['tri-sprint', 'tri-olympic', 'tri-half', 'tri-full']);
  });
});

describe('race distance changes the programming', () => {
  it('offers 5k through marathon for running', () => {
    const ids = eventsFor('running').map(e => e.id);
    expect(ids).toEqual(['run-5k', 'run-10k', 'run-half', 'run-full']);
  });

  it('keeps plyometrics for short races and drops them for long ones', () => {
    const jumps = (event: SportContext['event']) =>
      buildSportPlan(sport({ sport: event.startsWith('run') ? 'running' : 'triathlon', event }), 3)
        .days.flatMap(d => d.slots).filter(sl => sl.patterns?.includes('Jump')).length;
    expect(jumps('run-5k')).toBeGreaterThan(0);
    expect(jumps('run-10k')).toBeGreaterThan(0);
    expect(jumps('run-half')).toBe(0);
    expect(jumps('run-full')).toBe(0);
    expect(jumps('tri-sprint')).toBeGreaterThan(0);
    expect(jumps('tri-full')).toBe(0);
  });

  it('raises the main lifts\' rep range as the distance grows', () => {
    const reps = (event: SportContext['event'], sportId: SportContext['sport']) => {
      const plan = buildSportPlan(sport({ sport: sportId, event }), 3);
      return plan.days.flatMap(d => d.slots).find(sl => sl.main)!.dose!;
    };
    expect(reps('run-5k', 'running').repHigh).toBe(6);
    expect(reps('run-full', 'running').repHigh).toBe(8);
    expect(reps('tri-sprint', 'triathlon').repHigh).toBe(6);
    expect(reps('tri-full', 'triathlon').repHigh).toBe(8);
  });

  it('explains the distance choice on the plan', () => {
    const plan = buildSportPlan(sport({ sport: 'running', event: 'run-full' }), 3);
    expect(plan.rationale.join(' ')).toMatch(/Marathon:/);
    expect(plan.rationale.join(' ')).toMatch(/mileage is the training/i);
  });

  it('says why a long-distance plan uses fewer days than requested', () => {
    const plan = buildSportPlan(sport({ sport: 'running', event: 'run-full', load: 'low' }), 3);
    expect(plan.warnings.join(' ')).toMatch(/plyometric day/i);
  });
});

describe('running is programmed as running, not as a triathlon', () => {
  it('spends no volume on swim-specific upper body', () => {
    const plan = buildSportPlan(sport({ sport: 'running', event: 'run-10k' }), 3);
    const ids = plan.days.flatMap(d => d.slots).flatMap(sl => sl.preferIds ?? []);
    expect(ids).not.toContain('db-external-rotation');
    expect(ids).not.toContain('chin-ups');
  });

  it('programs hip abduction and single-leg calf work instead', () => {
    const plan = buildSportPlan(sport({ sport: 'running', event: 'run-10k' }), 3);
    const ids = plan.days.flatMap(d => d.slots).flatMap(sl => sl.preferIds ?? []);
    expect(ids).toContain('hip-abduction');
    expect(ids).toContain('single-leg-calf-raise');
  });

  it('ignores the weak-link answer, which only means something for triathlon', () => {
    const even = buildSportPlan(sport({ sport: 'running', event: 'run-10k', weakLink: 'even' }), 3);
    const bike = buildSportPlan(sport({ sport: 'running', event: 'run-10k', weakLink: 'bike' }), 3);
    const total = (p: typeof even) => p.days.reduce((s, d) => s + d.slots.reduce((a, sl) => a + sl.dose!.sets, 0), 0);
    expect(total(bike)).toBe(total(even));
  });

  it('never offers a swim niggle to a runner', () => {
    expect(nigglesFor('running').map(n => n.id)).not.toContain('shoulder');
    expect(nigglesFor('triathlon').map(n => n.id)).toContain('shoulder');
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
    expect(p.phases).toHaveLength(8);
    expect(p.phases).not.toContain('race-week');
    expect(p.phases).toContain('maintenance');
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

  it('runs for exactly the number of weeks the athlete chose', () => {
    for (const weeks of [4, 6, 8, 10, 12]) {
      expect(buildPlanProposal(triInput({ weeks }), [], null, null).phases).toHaveLength(weeks);
    }
  });

  it('reduces the plan to two days and warns when sport hours are high', () => {
    const p = buildPlanProposal(
      triInput({ sport: sport({ weakLink: 'bike', load: 'high' }) }),
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
