import { describe, it, expect, beforeEach } from 'vitest';
import { getExerciseMeta } from './exercises';

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
    expect(meta.workoutType).toBe('Press');
    expect(meta.equipment).toBe('Machine');
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
    expect(meta.workoutType).toBe('Press');
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
