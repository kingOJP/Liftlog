// recommendations.ts — calculateRecommendation + buildSetPlan across every branch.
import { it } from 'vitest';
import { Fixture, DEFAULT_NOW } from '../harness';
import { calculateRecommendation, buildSetPlan, needsRegression, incrementFor, loadFromMax, historyDepthFor } from '../../../src/data/recommendations';
import type { ExerciseSession, PrescriptionContext } from '../../../src/data/recommendations';
import type { Exercise } from '../../../src/data/program';
import type { ExperienceLevel, Goal, PhaseKind } from '../../../src/data/plan';
import type { WeightType, MeasureUnit } from '../../../src/data/taxonomy';

const DAY = 86_400_000;
type S = [number, number[], number?, [number, number]?]; // weight, reps, position, recorded range
const hist = (gapDays: number, ...sessions: S[]): ExerciseSession[] => sessions.map(([w, reps, position, range], i) => ({
  completedAt: DEFAULT_NOW - (i + 1) * gapDays * DAY, position: position ?? null,
  sets: reps.map(r => ({ weight: w, reps: r, ...(range ? { repLow: range[0], repHigh: range[1] } : {}) })),
}));
const HISTORIES: Record<string, ExerciseSession[]> = {
  empty: [],
  topped: hist(3, [100, [12, 12, 11]], [100, [11, 10, 10]]),
  toppedFirst: hist(3, [100, [12, 12, 12]]),
  mid: hist(3, [100, [10, 9, 9]], [100, [9, 9, 8]]),
  stall: hist(3, [100, [9, 9, 8]], [100, [9, 9, 8]], [100, [9, 9, 8]], [100, [9, 9, 8]], [100, [9, 9, 8]], [100, [9, 9, 8]]),
  underRepeated: hist(3, [100, [7, 6, 6]], [100, [7, 7, 6]]),
  bigMiss: hist(3, [100, [5, 5, 4]], [100, [10, 9, 9]]),
  tooLight: hist(3, [100, [16, 15, 15]], [100, [15, 15, 14]]),
  tooHeavy: hist(3, [200, [4, 4, 3]], [200, [5, 4, 4]]),
  bodyweight: hist(3, [0, [12, 11, 10]], [0, [11, 10, 10]]),
  bodyweightStall: hist(3, [0, [6, 5, 5]], [0, [6, 5, 5]], [0, [6, 5, 5]], [0, [6, 5, 5]]),
  bodyweightUnder: hist(3, [0, [5, 4, 4]], [0, [5, 5, 4]], [0, [5, 4, 4]]),
  shifted: hist(3, [100, [7, 6, 6], 5], [100, [10, 10, 9], 0], [100, [10, 9, 9], 0], [100, [10, 9, 8], 1]),
  sparse: hist(20, [100, [9, 9, 8]], [100, [9, 9, 8]], [100, [9, 9, 8]]),
  rangeChanged: hist(3, [100, [6, 6, 5], undefined, [4, 6]], [100, [6, 5, 5], undefined, [4, 6]]),
  topSet: [],
  weeklyCap: hist(2, [110, [12, 12, 12]], [105, [12, 12, 12]], [100, [12, 12, 12]]),
  breakout: hist(3, [100, [11, 11, 11, 10]], [100, [10, 10, 10, 9]], [100, [9, 9, 9, 8]]),
  heavyExtra: hist(3, [185, [9, 9, 8]], [185, [9, 9, 8]]).map((h, i) => (i === 0 ? { ...h, sets: [...h.sets, { weight: 205, reps: 7 }] } : h)),
};
HISTORIES.topSet = [
  { completedAt: DEFAULT_NOW - 3 * DAY, sets: [{ weight: 225, reps: 5 }, { weight: 190, reps: 6 }, { weight: 190, reps: 6 }] },
  { completedAt: DEFAULT_NOW - 7 * DAY, sets: [{ weight: 225, reps: 4 }, { weight: 190, reps: 6 }, { weight: 190, reps: 5 }] },
];
const SLOTS: Record<string, Exercise> = {
  hyp: { id: 'x', name: 'X', sets: 3, repLow: 8, repHigh: 12 },
  str: { id: 'x', name: 'X', sets: 4, repLow: 4, repHigh: 6 },
  none: { id: 'x', name: 'X', sets: 3 },
  manual: { id: 'x', name: 'X', sets: 3, repLow: 8, repHigh: 12, progression: 'manual' },
  history: { id: 'x', name: 'X', sets: 3, repLow: 8, repHigh: 12, rangeSource: 'history' },
  high: { id: 'x', name: 'X', sets: 3, repLow: 12, repHigh: 15 },
};
interface Ctx { weightType?: WeightType; phase?: PhaseKind; goal?: Goal; experience?: ExperienceLevel; unit?: MeasureUnit;
  oneRepMax?: { weight: number; updatedAt: number }; scheme?: 'straight' | 'top-set'; easyPast?: boolean }
const CTXS: Ctx[] = [
  {}, { goal: 'fat-loss' }, { goal: 'sport-support' }, { goal: 'strength', experience: 'advanced' }, { experience: 'beginner' },
  { phase: 'deload' }, { phase: 'intro' }, { phase: 'intro', easyPast: true }, { phase: 'race-week' }, { phase: 'maintenance' },
  { oneRepMax: { weight: 180, updatedAt: DEFAULT_NOW } }, { oneRepMax: { weight: 120, updatedAt: DEFAULT_NOW } },
  { oneRepMax: { weight: 300, updatedAt: 0 } }, { weightType: 'Dumbbell' }, { weightType: 'Bodyweight' }, { unit: 'seconds' },
  { scheme: 'top-set', goal: 'strength' }, { scheme: 'top-set', phase: 'peak' }, { scheme: 'top-set', phase: 'deload' },
];
const toCtx = (c: Ctx): PrescriptionContext => {
  const { easyPast, ...rest } = c;
  return { ...rest, now: DEFAULT_NOW, ...(easyPast ? { phaseOf: () => 'intro' as PhaseKind } : {}) };
};

it('recommendations fixture', () => {
  const f = new Fixture('recommendations');
  for (const [hn, h] of Object.entries(HISTORIES)) for (const [sn, slot] of Object.entries(SLOTS)) CTXS.forEach((c, ci) => {
    f.record(`rec ${hn} ${sn} ${ci}`, 'calculateRecommendation', [h, slot, c], (hh: ExerciseSession[], s: Exercise, cc: Ctx) => calculateRecommendation(hh, s, toCtx(cc)));
    f.record(`plan ${hn} ${sn} ${ci}`, 'buildSetPlan', [h, slot, c], (hh: ExerciseSession[], s: Exercise, cc: Ctx) => buildSetPlan(hh, s, toCtx(cc)));
  });
  for (const [hn, h] of Object.entries(HISTORIES)) for (const [sn, slot] of Object.entries(SLOTS)) f.record(`regress ${hn} ${sn}`, 'needsRegression', [h, slot], needsRegression);
  for (const w of [0, 10, 29, 30, 45, 100, 315]) for (const t of [null, 'Dumbbell', 'Barbell'] as const) f.record(`inc ${w} ${t}`, 'incrementFor', [w, t], incrementFor);
  for (const m of [50, 135, 315, 500]) for (const r of [1, 5, 8, 12]) f.record(`fromMax ${m} ${r}`, 'loadFromMax', [m, r, null], loadFromMax);
  for (const x of ['beginner', 'intermediate', 'advanced'] as const) f.record(`depth ${x}`, 'historyDepthFor', [x], historyDepthFor);
  f.write();
});
