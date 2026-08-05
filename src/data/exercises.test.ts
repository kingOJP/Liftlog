import { describe, it, expect, beforeEach } from 'vitest';
import {
  getExerciseMeta, headsFor, MUSCLE_HEADS, EXERCISES, EXERCISE_MAP,
  difficultyFor, prerequisitesFor,
} from './exercises';

beforeEach(() => localStorage.clear());

describe('exercise metadata — legacy value normalization', () => {
  it('remaps merged-away taxonomy values on read', () => {
    localStorage.setItem('liftlog_exercise_meta', JSON.stringify({
      'my-press': {
        primaryMuscle: 'Front Delts', secondaryMuscle1: 'Triceps',
        secondaryMuscle2: null, secondaryMuscle3: null,
        workoutType: 'Overhead Press', equipment: 'Leg Press Machine', weightType: 'Barbell',
      },
    }));
    const meta = getExerciseMeta('my-press');
    expect(meta.primaryMuscle).toBe('Delts');
    expect(meta.workoutType).toBe('Vertical Press');
    expect(meta.equipment).toBe('Machine');
  });

  it('defaults a bare legacy Press (ambiguous plane) to Horizontal Press', () => {
    localStorage.setItem('liftlog_exercise_meta', JSON.stringify({
      'my-bench': {
        primaryMuscle: 'Chest', secondaryMuscle1: null,
        secondaryMuscle2: null, secondaryMuscle3: null,
        workoutType: 'Press', equipment: 'Bench', weightType: 'Barbell',
      },
    }));
    const meta = getExerciseMeta('my-bench');
    expect(meta.workoutType).toBe('Horizontal Press');
  });

  it('dedupes muscles that collapse into the same group', () => {
    // Old override listing all three delt heads — after the merge they'd all
    // be 'Delts'; only the first mention survives.
    localStorage.setItem('liftlog_exercise_meta', JSON.stringify({
      'my-ohp': {
        primaryMuscle: 'Front Delts', secondaryMuscle1: 'Side Delts',
        secondaryMuscle2: 'Triceps', secondaryMuscle3: 'Rear Delts',
        workoutType: 'Chest Press', equipment: 'Bench', weightType: 'Dumbbell',
      },
    }));
    const meta = getExerciseMeta('my-ohp');
    expect(meta.primaryMuscle).toBe('Delts');
    expect(meta.secondaryMuscle1).toBeNull();
    expect(meta.secondaryMuscle2).toBe('Triceps');
    expect(meta.secondaryMuscle3).toBeNull();
    expect(meta.workoutType).toBe('Horizontal Press');
  });

  it('leaves current taxonomy values untouched', () => {
    localStorage.setItem('liftlog_exercise_meta', JSON.stringify({
      'my-row': {
        primaryMuscle: 'Upper Back', secondaryMuscle1: 'Lats',
        secondaryMuscle2: null, secondaryMuscle3: null,
        workoutType: 'Row', equipment: 'Cable Machine', weightType: 'Machine',
      },
    }));
    const meta = getExerciseMeta('my-row');
    expect(meta.primaryMuscle).toBe('Upper Back');
    expect(meta.secondaryMuscle1).toBe('Lats');
    expect(meta.workoutType).toBe('Row');
    expect(meta.equipment).toBe('Cable Machine');
  });
});

describe('catalogDefFor — timestamped custom ids that are really catalog exercises', () => {
  it('resolves a slug-timestamp id to its catalog def', async () => {
    const { catalogDefFor } = await import('./exercises');
    expect(catalogDefFor('back-extensions-1782325116469')?.id).toBe('back-extensions');
    expect(catalogDefFor('hip-thrusts-1782325062957')?.id).toBe('hip-thrusts');
    expect(catalogDefFor('standing-calf-raises-1782324989917')?.primaryMuscle).toBe('Calves');
  });

  it('passes canonical ids straight through', async () => {
    const { catalogDefFor } = await import('./exercises');
    expect(catalogDefFor('back-extensions')?.id).toBe('back-extensions');
  });

  it('returns null for genuinely custom ids with no catalog namesake', async () => {
    const { catalogDefFor } = await import('./exercises');
    expect(catalogDefFor('my-weird-lift-1782325116469')).toBeNull();
    expect(catalogDefFor('face-pulls-d2')).toBeNull(); // legacy suffix, not a timestamp
  });

  it('getExerciseMeta fills a timestamped id from its catalog namesake', () => {
    // No override stored — should still resolve the primary muscle
    const meta = getExerciseMeta('hip-thrusts-1782325062957');
    expect(meta.primaryMuscle).toBe('Glutes');
    expect(meta.workoutType).toBe('Hip Thrust');
  });
});

describe('rotational/lateral core exercises classify as Obliques', () => {
  it('pallof press and side plank are Obliques-primary', () => {
    expect(getExerciseMeta('pallof-press').primaryMuscle).toBe('Obliques');
    expect(getExerciseMeta('side-plank').primaryMuscle).toBe('Obliques');
    expect(getExerciseMeta('dead-bug').primaryMuscle).toBe('Obliques');
  });

  it('a front plank stays Abs — it resists extension, not rotation', () => {
    expect(getExerciseMeta('plank').primaryMuscle).toBe('Abs');
  });

  it('Copenhagen plank\'s secondary shifted from Abs to Obliques', () => {
    expect(getExerciseMeta('copenhagen-plank').secondaryMuscle1).toBe('Obliques');
  });
});

describe('headsFor — Tier 3 muscle-head assignment', () => {
  it('assigns a head only from its primary muscle\'s catalogued vocabulary', () => {
    for (const [id, expected] of [
      ['incline-barbell-press', ['Upper Chest']],
      ['dumbbell-bench-press', ['Lower Chest']],
      ['cable-lateral-raises', ['Side Delt']],
      ['face-pulls', ['Rear Delt']],
      ['seated-calf-raises', ['Soleus']],
      ['standing-calf-raises', ['Gastrocnemius']],
    ] as const) {
      const heads = headsFor(id);
      expect(heads).toEqual(expected);
      const primary = getExerciseMeta(id).primaryMuscle!;
      for (const head of heads) expect(MUSCLE_HEADS[primary]).toContain(head);
    }
  });

  it('returns empty for exercises with no established head emphasis', () => {
    expect(headsFor('barbell-back-squat')).toEqual([]);
    expect(headsFor('lat-pull-down')).toEqual([]);
  });

  it('returns empty for muscles with no catalogued heads at all', () => {
    expect(MUSCLE_HEADS['Lats']).toBeUndefined();
    expect(headsFor('weighted-pull-ups')).toEqual([]);
  });

  it('resolves through a timestamped custom id, like difficultyFor', () => {
    expect(headsFor('standing-calf-raises-1782324989917')).toEqual(['Gastrocnemius']);
  });
});

describe('catalog metadata audit fixes', () => {
  it('seated calf raises requires a machine, not no equipment', () => {
    expect(EXERCISE_MAP.get('seated-calf-raises')?.equipment).toBe('Machine');
  });

  it('straight-arm pulldown is Pull Over — the same joint action as a pullover, not a bent-elbow pulldown', () => {
    const def = EXERCISE_MAP.get('straight-arm-pulldowns')!;
    expect(def.workoutType).toBe('Pull Over');
    // No elbow flexion in the movement, so no biceps assist either.
    expect(def.secondaryMuscles).not.toContain('Biceps');
  });
});

describe('kettlebell catalog additions', () => {
  const KB_IDS = [
    'kettlebell-swing', 'kettlebell-goblet-squat', 'kettlebell-single-arm-press',
    'kettlebell-single-arm-row', 'kettlebell-suitcase-carry',
    'kettlebell-front-rack-lunge', 'kettlebell-turkish-get-up',
  ];

  it('every kettlebell exercise is fully classified', () => {
    for (const id of KB_IDS) {
      const def = EXERCISE_MAP.get(id);
      expect(def, id).toBeDefined();
      expect(def!.weightType).toBe('Kettlebell');
      expect(def!.equipment).toBe('None');
      expect(def!.primaryMuscle).not.toBeNull();
      expect(def!.workoutType).not.toBeNull();
    }
  });

  it('the suitcase carry is timed like the other loaded carry', () => {
    expect(EXERCISE_MAP.get('kettlebell-suitcase-carry')?.unit).toBe('seconds');
  });

  it('the suitcase carry trains Obliques — a loaded alternative to the isometric holds', () => {
    expect(EXERCISE_MAP.get('kettlebell-suitcase-carry')?.primaryMuscle).toBe('Obliques');
  });

  it('gates the swing and get-up behind a controlled-movement prerequisite', () => {
    expect(difficultyFor('kettlebell-swing')).toBe('advanced');
    expect(prerequisitesFor('kettlebell-swing').length).toBeGreaterThan(0);
    expect(difficultyFor('kettlebell-turkish-get-up')).toBe('advanced');
    expect(prerequisitesFor('kettlebell-turkish-get-up').length).toBeGreaterThan(0);
  });

  it('the goblet squat is beginner-friendly, matching its dumbbell counterpart', () => {
    expect(difficultyFor('kettlebell-goblet-squat')).toBe('beginner');
  });

  it('every kettlebell id resolves a unique name with no catalog collisions', () => {
    const names = EXERCISES.map(e => e.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});
