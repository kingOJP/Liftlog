import { describe, it, expect } from 'vitest';
import { dosage, isHeavyAxial, rangeFromHistory, resolvePrescription } from './dosage';
import { profileFor } from './substitution';
import type { ExerciseProfile } from './substitution';

const main = { main: true };
const accessory = {};

// Real catalog entries, so the tiers are exercised through the same profile
// resolution the app uses.
const deadlift = profileFor('conventional-deadlift');
const rdl = profileFor('romanian-deadlifts');
const legPress = profileFor('leg-press');
const hipThrust = profileFor('hip-thrusts');
const benchPress = profileFor('dumbbell-bench-press');
const curl = profileFor('hammer-curls');
const laterals = profileFor('cable-lateral-raises');

describe('isHeavyAxial', () => {
  it('catches the barbell hinge and squat families', () => {
    expect(isHeavyAxial(deadlift)).toBe(true);
    expect(isHeavyAxial(rdl)).toBe(true);
  });

  it('excludes machine and non-barbell work that shares the pattern', () => {
    // Leg press is a Leg Press pattern, hip thrusts are Hip Thrust — neither
    // loads the spine the way a barbell pull does.
    expect(isHeavyAxial(legPress)).toBe(false);
    expect(isHeavyAxial(hipThrust)).toBe(false);
    expect(isHeavyAxial(benchPress)).toBe(false);
  });
});

describe('dosage', () => {
  it('keeps heavy axial work in a low, narrow range on a hypertrophy goal', () => {
    // The bug that started this: a barbell deadlift dosed like a cable row.
    expect(dosage('hypertrophy', main, deadlift, 'intermediate'))
      .toEqual({ sets: 3, repLow: 5, repHigh: 8 });
    expect(dosage('general', accessory, deadlift, 'intermediate'))
      .toEqual({ sets: 3, repLow: 5, repHigh: 8 });
  });

  it('goes lower still on a strength goal', () => {
    expect(dosage('strength', main, deadlift, 'intermediate'))
      .toEqual({ sets: 4, repLow: 3, repHigh: 5 });
  });

  it('leaves other compounds where they were', () => {
    expect(dosage('hypertrophy', main, benchPress, 'intermediate'))
      .toEqual({ sets: 3, repLow: 6, repHigh: 10 });
    expect(dosage('hypertrophy', accessory, benchPress, 'intermediate'))
      .toEqual({ sets: 3, repLow: 8, repHigh: 12 });
  });

  it('doses isolation work by goal', () => {
    expect(dosage('hypertrophy', accessory, curl, 'intermediate'))
      .toEqual({ sets: 3, repLow: 10, repHigh: 15 });
    expect(dosage('strength', accessory, curl, 'intermediate'))
      .toEqual({ sets: 3, repLow: 8, repHigh: 12 });
  });

  it('sends high-rep patterns high whatever the goal', () => {
    for (const goal of ['strength', 'hypertrophy', 'general'] as const) {
      expect(dosage(goal, accessory, laterals, 'intermediate'))
        .toEqual({ sets: 3, repLow: 12, repHigh: 20 });
    }
  });

  it('never drops a beginner below 8 reps, axial work included', () => {
    // Technique before intensity — the beginner floor outranks the axial tier.
    expect(dosage('strength', main, deadlift, 'beginner'))
      .toEqual({ sets: 3, repLow: 8, repHigh: 12 });
  });
});

describe('rangeFromHistory', () => {
  const sess = (...reps: number[]) => ({ sets: reps.map(r => ({ reps: r })) });

  it('reads the range off what the lifter actually does', () => {
    const range = rangeFromHistory([sess(10, 9, 10), sess(10, 10, 9), sess(9, 10, 10)]);
    expect(range).toEqual({ sets: 3, repLow: 8, repHigh: 12 });
  });

  it('tracks a high-rep movement rather than assuming 8–12', () => {
    const range = rangeFromHistory([sess(20, 18, 18), sess(19, 18, 20)]);
    expect(range!.repLow!).toBeGreaterThan(12);
    expect(range!.repHigh!).toBeGreaterThan(range!.repLow!);
  });

  it('clamps the set count to something trainable', () => {
    expect(rangeFromHistory([sess(5)])!.sets).toBe(2);
    expect(rangeFromHistory([sess(...Array(9).fill(10))])!.sets).toBe(5);
  });

  it('returns null with nothing logged', () => {
    expect(rangeFromHistory([])).toBeNull();
    expect(rangeFromHistory([{ sets: [] }])).toBeNull();
  });
});

describe('resolvePrescription — the cascade', () => {
  const history = [{ sets: [{ reps: 10 }, { reps: 10 }, { reps: 9 }] }];

  it('doses from the plan goal when one is active', () => {
    const out = resolvePrescription({
      profile: deadlift, goal: 'hypertrophy', experience: 'intermediate', history,
    });
    expect(out).toEqual({ sets: 3, repLow: 5, repHigh: 8 });
  });

  it('falls back to the lifter\'s own history when there is no plan', () => {
    const out = resolvePrescription({
      profile: deadlift, goal: null, experience: 'intermediate', history,
    });
    expect(out).toEqual({ sets: 3, repLow: 8, repHigh: 12 });
  });

  it('prescribes nothing when there is no plan and no history', () => {
    // The whole point: no plan, never done it → say nothing rather than invent
    // a rep range the user never chose and the coach can't justify.
    expect(resolvePrescription({
      profile: deadlift, goal: null, experience: 'intermediate', history: [],
    })).toBeNull();
    expect(resolvePrescription({
      profile: deadlift, goal: null, experience: 'intermediate',
    })).toBeNull();
  });

  it('never returns a hardcoded 3 × 8–12 for an unknown movement', () => {
    const unknown: ExerciseProfile = {
      ...profileFor('something-nobody-has-heard-of-1780000000000'),
    };
    expect(resolvePrescription({
      profile: unknown, goal: null, experience: 'intermediate', history: [],
    })).toBeNull();
  });
});

// ── Sport-support ────────────────────────────────────────────────────────────
// The sport templates carry their own per-slot dose, but every OTHER route an
// exercise takes into a sport-support program — the day editor, the mid-workout
// add panel, a quick workout — comes through here. Without a branch it fell
// through to the generic default and handed a triathlete a hypertrophy
// prescription with no regard for the weekly set ceiling.
const backSquat = profileFor('barbell-back-squat');
const cableRow = profileFor('seated-cable-row');
const boxJump = profileFor('box-jump');
const plank = profileFor('plank');
const sidePlank = profileFor('side-plank');

describe('sport-support dosage', () => {
  it('doses a main compound as heavy, low-volume strength work', () => {
    expect(dosage('sport-support', main, backSquat, 'intermediate'))
      .toEqual({ sets: 4, repLow: 4, repHigh: 6 });
  });

  it('overrides the heavy-axial range: maximal strength is the point here', () => {
    // isHeavyAxial would give 3 × 5–8. For an endurance athlete the whole
    // reason to squat is force production, so the sport branch wins.
    expect(isHeavyAxial(backSquat)).toBe(true);
    const sport = dosage('sport-support', main, backSquat, 'intermediate');
    const hyp = dosage('hypertrophy', main, backSquat, 'intermediate');
    expect(sport.repHigh!).toBeLessThan(hyp.repHigh!);
  });

  it('keeps accessory compounds cheap', () => {
    const d = dosage('sport-support', accessory, cableRow, 'intermediate');
    expect(d.sets).toBeLessThanOrEqual(3);
    expect(d.repHigh!).toBeLessThanOrEqual(8);
  });

  it('prescribes less isolation volume than a hypertrophy plan would', () => {
    expect(dosage('sport-support', accessory, curl, 'intermediate').sets)
      .toBeLessThan(dosage('hypertrophy', accessory, curl, 'intermediate').sets);
  });

  it('gives plyometrics low reps, not a hypertrophy range', () => {
    expect(dosage('sport-support', accessory, boxJump, 'intermediate').repHigh!)
      .toBeLessThanOrEqual(6);
  });

  it('still protects a beginner — no near-maximal work while learning', () => {
    expect(dosage('sport-support', main, backSquat, 'beginner').repLow!)
      .toBeGreaterThanOrEqual(8);
  });

  it('reaches the day editor and quick workouts through the cascade', () => {
    const d = resolvePrescription({
      profile: backSquat, slot: main, goal: 'sport-support', experience: 'intermediate',
    });
    expect(d).toEqual({ sets: 4, repLow: 4, repHigh: 6 });
  });
});

describe('timed exercises are prescribed in seconds', () => {
  it('prescribes a hold duration rather than a rep count', () => {
    const d = dosage('hypertrophy', accessory, plank, 'intermediate');
    expect(d.repLow!).toBeGreaterThanOrEqual(20);
    expect(d.repHigh!).toBeGreaterThanOrEqual(d.repLow!);
  });

  it('holds are shorter for a beginner', () => {
    expect(dosage('general', accessory, plank, 'beginner').repHigh!)
      .toBeLessThan(dosage('general', accessory, plank, 'intermediate').repHigh!);
  });

  it('spends fewer sets on a hold when lifting supports a sport', () => {
    expect(dosage('sport-support', accessory, sidePlank, 'intermediate').sets)
      .toBeLessThan(dosage('hypertrophy', accessory, sidePlank, 'intermediate').sets);
  });

  it('is not confused by the plank being an Anti-Rotation-adjacent pattern', () => {
    // Plank is a Plank pattern, so it must not fall into the high-rep table and
    // come out as "3 × 12–20" reps.
    const d = dosage('general', accessory, plank, 'intermediate');
    expect(d.repHigh!).toBeGreaterThan(20);
  });
});
