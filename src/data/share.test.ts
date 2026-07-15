import { describe, it, expect, beforeEach } from 'vitest';
import {
  encodeWorkoutShare, decodeWorkoutShare, buildShareUrl,
  resolveSharedExercises, acceptSharedWorkout,
  captureShareFromUrl, getPendingSharedWorkout, clearPendingShare,
} from './share';
import type { SharedWorkout } from './share';
import { addToExerciseLibrary, getExerciseLibrary } from './programStore';
import type { WorkoutDay } from './program';

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '';
});

const day: WorkoutDay = {
  id: 2,
  label: 'Day 2',
  muscleGroups: 'Back, Biceps',
  exercises: [
    { id: 'face-pulls', name: 'Face Pulls', sets: 3, repLow: 15, repHigh: 20 },
    { id: 'db-curls-1700000000000', name: 'Ünïcode Curls 💪', sets: 4, repLow: 8, repHigh: 12 },
  ],
};

describe('encode/decode round trip', () => {
  it('preserves the workout design (names, sets, rep ranges) including unicode', () => {
    const decoded = decodeWorkoutShare(encodeWorkoutShare(day))!;
    expect(decoded.label).toBe('Day 2');
    expect(decoded.muscleGroups).toBe('Back, Biceps');
    expect(decoded.exercises).toEqual([
      { name: 'Face Pulls', sets: 3, repLow: 15, repHigh: 20 },
      { name: 'Ünïcode Curls 💪', sets: 4, repLow: 8, repHigh: 12 },
    ]);
  });

  it('produces a URL-safe fragment payload', () => {
    const url = buildShareUrl(day, 'https://liftlog.example');
    expect(url).toMatch(/^https:\/\/liftlog\.example\/#share=[A-Za-z0-9_-]+$/);
  });

  it('rejects garbage, wrong versions, and out-of-shape payloads', () => {
    expect(decodeWorkoutShare('not-base64!!!')).toBeNull();
    expect(decodeWorkoutShare(btoa(JSON.stringify({ v: 2, l: 'x', g: '', x: [] })))).toBeNull();
    expect(decodeWorkoutShare(btoa(JSON.stringify({ v: 1, l: 'x', g: '', x: [['ok']] })))).toBeNull();
    expect(decodeWorkoutShare(btoa(JSON.stringify({ v: 1, l: 'x', g: '', x: [] })))).toBeNull();
  });

  it('clamps hostile numbers instead of importing them', () => {
    const raw = btoa(JSON.stringify({ v: 1, l: 'x', g: '', x: [['Bench', 9999, -5, 2.7]] }));
    const decoded = decodeWorkoutShare(raw)!;
    expect(decoded.exercises[0]).toEqual({ name: 'Bench', sets: 10, repLow: 1, repHigh: 3 });
  });
});

describe('resolveSharedExercises', () => {
  const shared: SharedWorkout = {
    label: 'Push Day',
    muscleGroups: 'Chest',
    exercises: [
      { name: 'face  pulls!', sets: 3, repLow: 15, repHigh: 20 }, // catalog match by slug
      { name: 'Mystery Movement', sets: 3, repLow: 8, repHigh: 12 }, // unknown
    ],
  };

  it('matches recipient exercises by name and keeps the shared programming', () => {
    const [known, unknown] = resolveSharedExercises(shared);
    expect(known.existing).toBe(true);
    expect(known.exercise.id).toBe('face-pulls');
    expect(known.exercise.name).toBe('Face Pulls'); // recipient's canonical name
    expect(known.exercise.repLow).toBe(15);
    expect(unknown.existing).toBe(false);
    expect(unknown.exercise.id).toMatch(/^mystery-movement-\d{10,}$/);
  });

  it('never carries weights — the payload has none by construction', () => {
    const decoded = decodeWorkoutShare(encodeWorkoutShare(day))!;
    for (const e of decoded.exercises) {
      expect(e).not.toHaveProperty('weight');
    }
  });
});

describe('acceptSharedWorkout', () => {
  it('builds a day and makes every exercise first-class in the library', () => {
    const shared = decodeWorkoutShare(encodeWorkoutShare(day))!;
    const imported = acceptSharedWorkout(shared, 5, 'Day 5');
    expect(imported.id).toBe(5);
    expect(imported.label).toBe('Day 5');
    expect(imported.exercises).toHaveLength(2);
    const libIds = new Set(getExerciseLibrary().map(e => e.id));
    for (const e of imported.exercises) expect(libIds.has(e.id)).toBe(true);
  });

  it('collapses two shared names that resolve to the same recipient exercise', () => {
    addToExerciseLibrary({ id: 'bench-press-1700000000000', name: 'Bench Press', sets: 3, repLow: 8, repHigh: 12 });
    const shared: SharedWorkout = {
      label: 'X', muscleGroups: '',
      exercises: [
        { name: 'Bench Press', sets: 3, repLow: 8, repHigh: 12 },
        { name: 'bench-press', sets: 4, repLow: 6, repHigh: 8 },
      ],
    };
    const imported = acceptSharedWorkout(shared, 1);
    expect(imported.exercises).toHaveLength(1);
  });
});

describe('share URL capture', () => {
  it('stashes a valid payload from the fragment and cleans the URL', () => {
    window.location.hash = `#share=${encodeWorkoutShare(day)}`;
    captureShareFromUrl();
    expect(window.location.hash).toBe('');
    expect(getPendingSharedWorkout()?.label).toBe('Day 2');
    clearPendingShare();
    expect(getPendingSharedWorkout()).toBeNull();
  });

  it('ignores corrupt fragments', () => {
    window.location.hash = '#share=zzzz';
    captureShareFromUrl();
    expect(getPendingSharedWorkout()).toBeNull();
  });

  it('is a no-op without a share fragment', () => {
    captureShareFromUrl();
    expect(getPendingSharedWorkout()).toBeNull();
  });
});
