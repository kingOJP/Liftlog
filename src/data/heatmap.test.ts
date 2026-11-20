import { describe, it, expect, beforeEach } from 'vitest';
import { buildSnapshot, SETS_TARGET_LOW, SETS_TARGET_HIGH } from './analytics';
import { computeMuscleHeat, heatColor, heatLabel, presetWindow, previousWindow, volumeSplit, splitInsight, rangeWindow, dateInputValue, HEAT_LEGEND_GRADIENT } from './heatmap';
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

  it('credits secondary volume from compounds — a push day counts real triceps sets', () => {
    // 4 incline press (Triceps secondary) + 3 pushdowns (Triceps primary)
    const sessions: Session[] = [
      { id: 1, dayId: 1, weekNumber: 1, startedAt: NOW - DAY, completedAt: NOW - DAY },
    ];
    const setLogs: SetLog[] = [
      ...[1, 2, 3, 4].map(s => ({
        id: s, sessionId: 1, exerciseId: 'incline-barbell-press', setNumber: s, weight: 135, reps: 8,
      })),
      ...[1, 2, 3].map(s => ({
        id: 4 + s, sessionId: 1, exerciseId: 'tricep-cable-pushdown', setNumber: s, weight: 50, reps: 12,
      })),
    ];
    const heat = computeMuscleHeat(buildSnapshot(sessions, setLogs), NOW - 7 * DAY, NOW);
    expect(heat.byMuscle.get('Triceps')?.sets).toBe(4 * 0.5 + 3);  // 5 fractional hard sets
  });
});

describe('heatColor', () => {
  it('maps the gradient endpoints', () => {
    expect(heatColor(0)).toBe('#2E3754');                          // slate — untrained
    expect(heatColor(SETS_TARGET_LOW)).toBe('rgb(56, 151, 240)');  // blue — on target
    expect(heatColor(SETS_TARGET_HIGH)).toBe('rgb(56, 151, 240)'); // blue holds across the range
    expect(heatColor(999)).toBe('#835EFB');                        // violet — very high
  });

  it('blends between stops', () => {
    // Halfway from slate to blue — neither endpoint
    expect(heatColor(SETS_TARGET_LOW / 2)).not.toBe(heatColor(0));
    expect(heatColor(SETS_TARGET_LOW / 2)).not.toBe(heatColor(SETS_TARGET_LOW));
  });

  it('draws the legend from the same colours the regions are filled with', () => {
    // The legend used to be a hand-copied CSS gradient; a palette change that
    // missed it left the key describing colours the figure no longer used.
    for (const hex of ['#2E3754', '#3897F0', '#5D5DFA', '#835EFB']) {
      expect(HEAT_LEGEND_GRADIENT).toContain(hex);
    }
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

// Isolation sets only (one muscle each, no secondaries), so the shares are exact.
function splitSnapshot(rows: Array<{ daysAgo: number; legs: number; delts: number }>) {
  const sessions: Session[] = [];
  const setLogs: SetLog[] = [];
  let id = 1;
  rows.forEach((r, i) => {
    const ts = NOW - r.daysAgo * DAY;
    sessions.push({ id: i + 1, dayId: 1, weekNumber: 1, startedAt: ts, completedAt: ts });
    for (let n = 0; n < r.legs; n++) setLogs.push({ id: id++, sessionId: i + 1, exerciseId: 'leg-extension', setNumber: n + 1, weight: 100, reps: 10 });
    for (let n = 0; n < r.delts; n++) setLogs.push({ id: id++, sessionId: i + 1, exerciseId: 'dumbbell-lateral-raises', setNumber: n + 1, weight: 20, reps: 12 });
  });
  return buildSnapshot(sessions, setLogs);
}

describe('previousWindow', () => {
  it('is the window of the same length ending where this one starts', () => {
    expect(previousWindow({ from: NOW - 7 * DAY, to: NOW })).toEqual({ from: NOW - 14 * DAY, to: NOW - 7 * DAY });
  });
});

describe('volumeSplit / splitInsight', () => {
  it('reports each body half as a share of the window\'s muscle-sets', () => {
    const snap = splitSnapshot([{ daysAgo: 2, legs: 3, delts: 1 }]);
    const split = volumeSplit(computeMuscleHeat(snap, NOW - 7 * DAY, NOW))!;
    expect(split.lower).toBeCloseTo(0.75);
    expect(split.upper).toBeCloseTo(0.25);
    expect(split.lower + split.upper + split.core).toBeCloseTo(1);
  });

  it('has nothing to say about an empty window', () => {
    const heat = computeMuscleHeat(buildSnapshot([], []), NOW - 7 * DAY, NOW);
    expect(volumeSplit(heat)).toBeNull();
    expect(splitInsight(heat, null)).toBeNull();
  });

  it('names the dominant half and how its share moved against the window before', () => {
    const snap = splitSnapshot([
      { daysAgo: 2, legs: 3, delts: 1 },    // this week: 75% lower
      { daysAgo: 9, legs: 2, delts: 2 },    // last week: 50% lower
    ]);
    const win = { from: NOW - 7 * DAY, to: NOW };
    const prev = previousWindow(win);
    const insight = splitInsight(
      computeMuscleHeat(snap, win.from, win.to),
      computeMuscleHeat(snap, prev.from, prev.to),
    )!;
    expect(insight.half).toBe('lower');
    expect(insight.pct).toBe(75);
    expect(insight.deltaPts).toBe(25);
  });

  it('makes no comparison when the window before is empty — a first week is not "up 100 points"', () => {
    const snap = splitSnapshot([{ daysAgo: 2, legs: 1, delts: 3 }]);
    const win = { from: NOW - 7 * DAY, to: NOW };
    const prev = previousWindow(win);
    const insight = splitInsight(
      computeMuscleHeat(snap, win.from, win.to),
      computeMuscleHeat(snap, prev.from, prev.to),
    )!;
    expect(insight.half).toBe('upper');
    expect(insight.deltaPts).toBeNull();
  });

  it('lists muscles trained in the window before that this one skipped', () => {
    const snap = splitSnapshot([
      { daysAgo: 2, legs: 3, delts: 0 },
      { daysAgo: 9, legs: 2, delts: 2 },
    ]);
    const win = { from: NOW - 7 * DAY, to: NOW };
    const prev = previousWindow(win);
    const insight = splitInsight(
      computeMuscleHeat(snap, win.from, win.to),
      computeMuscleHeat(snap, prev.from, prev.to),
    )!;
    expect(insight.untrained).toContain('Delts');
    expect(insight.untrained).not.toContain('Quads');
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

describe('rangeWindow', () => {
  it('follows the preset for everything but a custom range', () => {
    const range = { preset: '7d' as const, customFrom: '2020-01-01', customTo: '2020-01-02' };
    expect(rangeWindow(range, NOW)).toEqual(presetWindow('7d', NOW));
  });

  it('covers both days of a custom range in full', () => {
    const { from, to } = rangeWindow({ preset: 'custom', customFrom: '2026-06-01', customTo: '2026-06-07' }, NOW);
    expect(from).toBe(new Date(2026, 5, 1).getTime());
    expect(to).toBe(new Date(2026, 5, 7, 23, 59, 59).getTime());
  });

  it('reads the same whichever way round the dates were entered', () => {
    // A date picker can't stop the second field being set earlier than the
    // first; an inverted range used to produce an empty window.
    const forward = rangeWindow({ preset: 'custom', customFrom: '2026-06-01', customTo: '2026-06-07' }, NOW);
    const backward = rangeWindow({ preset: 'custom', customFrom: '2026-06-07', customTo: '2026-06-01' }, NOW);
    expect(backward).toEqual(forward);
  });

  it('round-trips a timestamp through the date-input format in local time', () => {
    expect(dateInputValue(new Date(2026, 0, 5, 23, 30).getTime())).toBe('2026-01-05');
  });
});
