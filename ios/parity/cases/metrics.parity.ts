// metrics.ts + heatmap.ts — weekly volume, range summaries, per-exercise series,
// muscle heat over windows, the split insight and the heat colour scale.
import { it } from 'vitest';
import { Fixture, DEFAULT_NOW } from '../harness';
import { computeMetrics, computeRangeSummary } from '../../../src/data/metrics';
import {
  computeMuscleHeat, splitInsight, volumeSplit, heatColor, heatLabel, rangeWindow, mesocycleWindow,
  previousWindow, defaultHeatRange, presetCopy, bodyHalfFor, dateInputValue,
} from '../../../src/data/heatmap';
import type { HeatmapData, HeatPreset, HeatRange } from '../../../src/data/heatmap';
import { buildSnapshot } from '../../../src/data/analytics';
import type { Session, SetLog } from '../../../src/db/database';
import { MUSCLE_GROUPS } from '../../../src/data/taxonomy';
import type { MuscleGroup } from '../../../src/data/taxonomy';

const DAY = 86_400_000;
const SESSIONS: Session[] = [];
const LOGS: SetLog[] = [];
let n = 0;
const add = (sessionId: number, exerciseId: string, weight: number, reps: number[], x: Partial<SetLog> = {}) =>
  reps.forEach((r, i) => LOGS.push({ id: ++n, sessionId, exerciseId, setNumber: i + 1, weight, reps: r, ...x }));
const OFFSETS = [1, 3, 6, 9, 13, 17, 22, 26, 33, 41, 48, 62, 75];
OFFSETS.forEach((d, i) => {
  const id = i + 1;
  const start = DEFAULT_NOW - d * DAY;
  SESSIONS.push({ id, guid: `g${id}`, dayId: (i % 3) + 1, weekNumber: 1, startedAt: start, completedAt: start + 3_000_000 });
  if (i % 3 === 0) { add(id, 'barbell-bench-press', 185 + i * 2.5, [8, 7, 6]); add(id, 'cable-lateral-raises', 20, [15, 12]); }
  if (i % 3 === 1) { add(id, 'barbell-squat', 275 + i * 5, [5, 5, 5]); add(id, 'romanian-deadlifts', 225, [8, 8], { grip: 'wide' }); }
  if (i % 3 === 2) { add(id, 'pull-ups', 0, [9, 8, 7]); add(id, 'barbell-curl', 65, [10, 9]); add(id, 'plank', 0, [60]); }
  if (i < 4) add(id, 'my-custom-thing-1', 40, [10, 10]);
  if (i === 5) { add(id, 'barbell-bench-press', 135, [12], { technique: 'drop' }); add(id, 'barbell-bench-press', 95, [10], { warmup: true }); }
  if (i > 8) add(id, 'leg-press', 300, [12, 12, 10]);
});
SESSIONS.sort((a, b) => b.completedAt! - a.completedAt!);
const SETTINGS = (programStart: string) => ({ storage: { liftlog_settings: { programStart } } });
const heatObj = (h: HeatmapData) => ({ weeks: h.weeks, byMuscle: Object.fromEntries([...h.byMuscle].sort((a, b) => (a[0] < b[0] ? -1 : 1))) });

it('metrics fixture', () => {
  const f = new Fixture('metrics');
  const NOWS = [DEFAULT_NOW, DEFAULT_NOW + 2 * DAY, DEFAULT_NOW + 40 * DAY];
  NOWS.forEach((now, i) => f.record(`metrics now${i}`, 'computeMetrics', [SESSIONS, LOGS, now], (s: Session[], l: SetLog[], t: number) => computeMetrics(buildSnapshot(s, l), t)));
  f.record('metrics empty', 'computeMetrics', [[], [], DEFAULT_NOW], (s: Session[], l: SetLog[], t: number) => computeMetrics(buildSnapshot(s, l), t));
  for (const days of [7, 14, 30, 90]) for (const back of [0, 10]) {
    const to = DEFAULT_NOW - back * DAY, from = to - days * DAY;
    f.record(`range ${days} ${back}`, 'computeRangeSummary', [SESSIONS, LOGS, from, to], (s: Session[], l: SetLog[], a: number, b: number) => computeRangeSummary(buildSnapshot(s, l), a, b));
  }
  const windows: Array<[string, number, number]> = [['7d', DEFAULT_NOW - 7 * DAY, DEFAULT_NOW], ['30d', DEFAULT_NOW - 30 * DAY, DEFAULT_NOW],
    ['90d', DEFAULT_NOW - 90 * DAY, DEFAULT_NOW], ['1d', DEFAULT_NOW - 0.5 * DAY, DEFAULT_NOW], ['old', DEFAULT_NOW - 60 * DAY, DEFAULT_NOW - 30 * DAY]];
  for (const [name, from, to] of windows) {
    f.record(`heat ${name}`, 'computeMuscleHeat', [SESSIONS, LOGS, from, to], (s: Session[], l: SetLog[], a: number, b: number) => heatObj(computeMuscleHeat(buildSnapshot(s, l), a, b)));
    f.record(`split ${name}`, 'splitInsight', [SESSIONS, LOGS, from, to], (s: Session[], l: SetLog[], a: number, b: number) => {
      const snap = buildSnapshot(s, l), prev = previousWindow({ from: a, to: b });
      return { insight: splitInsight(computeMuscleHeat(snap, a, b), computeMuscleHeat(snap, prev.from, prev.to)),
        alone: splitInsight(computeMuscleHeat(snap, a, b), null), split: volumeSplit(computeMuscleHeat(snap, a, b)) };
    });
  }
  const BANDS = [undefined, { low: 4, high: 10 }, { low: 8, high: 16 }];
  BANDS.forEach((band, bi) => {
    for (const r of [-1, 0, 2, 4, 8.5, 10, 13, 16, 20, 22, 26, 30, 40]) {
      f.record(`color ${bi} ${r}`, 'heatColor', [r, band ?? null], (x: number, b: { low: number; high: number } | null) => heatColor(x, b ?? undefined));
      f.record(`label ${bi} ${r}`, 'heatLabel', [r, band ?? null], (x: number, b: { low: number; high: number } | null) => heatLabel(x, b ?? undefined));
    }
  });
  const RANGES: HeatRange[] = [
    { preset: '7d', customFrom: '', customTo: '' }, { preset: '30d', customFrom: '', customTo: '' }, { preset: 'meso', customFrom: '', customTo: '' },
    { preset: 'custom', customFrom: '2026-02-01', customTo: '2026-03-10' }, { preset: 'custom', customFrom: '2026-03-10', customTo: '2026-02-01' },
    { preset: 'custom', customFrom: '2026-03-08', customTo: '2026-03-08' },
  ];
  for (const ps of ['2026-01-05', '2026-03-16', '2026-04-01']) {
    RANGES.forEach((r, i) => f.record(`range ${ps} ${i}`, 'rangeWindow', [r], rangeWindow, SETTINGS(ps)));
    f.record(`meso ${ps}`, 'mesocycleWindow', [], () => mesocycleWindow(), SETTINGS(ps));
  }
  f.record('defaultRange', 'defaultHeatRange', [], () => defaultHeatRange());
  for (const t of [DEFAULT_NOW, DEFAULT_NOW - 200 * DAY, Date.UTC(2026, 10, 1, 7)]) f.record(`date ${t}`, 'dateInputValue', [t], dateInputValue);
  for (const p of ['7d', '30d', 'meso', 'custom'] as HeatPreset[]) f.record(`copy ${p}`, 'presetCopy', [p], presetCopy);
  for (const m of MUSCLE_GROUPS as MuscleGroup[]) f.record(`half ${m}`, 'bodyHalfFor', [m], bodyHalfFor);
  f.write();
});
