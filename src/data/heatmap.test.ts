import { describe, it, expect, beforeEach } from 'vitest';
import { buildSnapshot, SETS_TARGET_LOW, SETS_TARGET_HIGH } from './analytics';
import { computeMuscleHeat, heatColor, heatLabel, presetWindow } from './heatmap';
import type { Session, SetLog } from '../db/database';

beforeEach(() => localStorage.clear());

const NOW = new Date('2026-07-01T12:00:00').getTime();
const DAY = 86_400_000;

describe('computeMuscleHeat', () => {
  it('accumulates fractional sets inside the window and normalizes to a weekly rate', () => {
    const sessions: Session[] = [
      { id: 1, dayId: 1, weekNumber: 1, startedAt: NOW - 2 * DAY, completedAt: NOW - 2 * DAY },
      // outside the window — must be excluded
      { id: 2, dayId: 1, weekNumber: 1, startedAt: NOW - 40 * DAY, completedAt: NOW - 40 * DAY },
    ];
    const setLogs: SetLog[] = [
      // dumbbell-bench-press: Chest primary, Delts + Triceps secondary
      { id: 1, sessionId: 1, exerciseId: 'dumbbell-bench-press', setNumber: 1, weight: 100, reps: 10 },
      { id: 2, sessionId: 1, exerciseId: 'dumbbell-bench-press', setNumber: 2, weight: 100, reps: 10 },
      { id: 3, sessionId: 2, exerciseId: 'dumbbell-bench-press', setNumber: 1, weight: 100, reps: 10 },
    ];
    const heat = computeMuscleHeat(buildSnapshot(sessions, setLogs), NOW - 7 * DAY, NOW);

    expect(heat.byMuscle.get('Chest')?.sets).toBe(2);
    expect(heat.byMuscle.get('Delts')?.sets).toBe(1);   // 2 × 0.5 secondary
    expect(heat.byMuscle.get('Triceps')?.sets).toBe(1);
    expect(heat.byMuscle.get('Chest')?.weeklyRate).toBeCloseTo(2); // 7-day window → rate = sets
    expect(heat.byMuscle.get('Quads')).toBeUndefined();
  });
});

describe('heatColor', () => {
  it('maps the gradient endpoints', () => {
    expect(heatColor(0)).toBe('#3D6BE8');                          // blue — untrained
    expect(heatColor(SETS_TARGET_LOW)).toBe('rgb(29, 158, 117)');  // green — on target
    expect(heatColor(SETS_TARGET_HIGH)).toBe('rgb(29, 158, 117)'); // green holds across the range
    expect(heatColor(999)).toBe('#E85555');                        // red — very high
  });

  it('blends between stops', () => {
    // Halfway from blue to green — neither endpoint
    expect(heatColor(SETS_TARGET_LOW / 2)).not.toBe(heatColor(0));
    expect(heatColor(SETS_TARGET_LOW / 2)).not.toBe(heatColor(SETS_TARGET_LOW));
  });
});

describe('heatLabel', () => {
  it('describes each band', () => {
    expect(heatLabel(0)).toMatch(/no recent/i);
    expect(heatLabel(5)).toMatch(/below/i);
    expect(heatLabel(15)).toMatch(/on target/i);
    expect(heatLabel(23)).toMatch(/elevated/i);
    expect(heatLabel(40)).toMatch(/very high/i);
  });
});

describe('presetWindow', () => {
  it('produces trailing windows for the day presets', () => {
    expect(presetWindow('7d', NOW)).toEqual({ from: NOW - 7 * DAY, to: NOW });
    expect(presetWindow('30d', NOW)).toEqual({ from: NOW - 30 * DAY, to: NOW });
  });

  it('anchors the mesocycle window to 4-week blocks', () => {
    const { from, to } = presetWindow('meso', NOW);
    expect(to).toBe(NOW);
    expect(from).toBeLessThanOrEqual(NOW);
    expect(NOW - from).toBeLessThanOrEqual(28 * DAY);
  });
});
