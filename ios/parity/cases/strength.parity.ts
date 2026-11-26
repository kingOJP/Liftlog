// strength.ts — %1RM bands, logged maxes, trends, current max, goal projections.
import { it } from 'vitest';
import { Fixture, DEFAULT_NOW } from '../harness';
import {
  pctOfMaxForReps, pctOfMax, percentBandFor, loadBandFor, programLoadsFor, bestLoggedMax, e1rmSeriesFor, strengthTrend,
  currentMax, projectGoal, etaLabel, goalProgress,
} from '../../../src/data/strength';
import type { OneRepMax, LoggedMax, ProjectionInput, StrengthTrend } from '../../../src/data/strength';
import { buildSnapshot } from '../../../src/data/analytics';
import type { ExperienceLevel, Goal } from '../../../src/data/plan';
import type { Exercise, WorkoutDay } from '../../../src/data/program';
import type { Session, SetLog } from '../../../src/db/database';
import type { WeightType } from '../../../src/data/taxonomy';

const DAY = 86_400_000;
const SESSIONS: Session[] = [];
const LOGS: SetLog[] = [];
let n = 0;
for (let w = 0; w < 16; w++) {
  const id = w + 1, start = DEFAULT_NOW - (110 - w * 7) * DAY;
  SESSIONS.push({ id, guid: `g${id}`, dayId: 1, weekNumber: w + 1, startedAt: start, completedAt: start + 3_600_000 });
  const push = (exerciseId: string, weight: number, reps: number, x: Partial<SetLog> = {}) => LOGS.push({ id: ++n, sessionId: id, exerciseId, setNumber: 1, weight, reps, ...x });
  push('barbell-back-squat', 225 + w * 5, 5); push('barbell-back-squat', 225 + w * 5, 4);
  push('flat-barbell-bench-press', 185, 8); if (w === 10) push('flat-barbell-bench-press', 245, 1);
  push('flat-barbell-bench-press', 135, 20); push('flat-barbell-bench-press', 205, 6, { technique: 'drop' });
  push('romanian-deadlifts', 245 - w * 3, 8);
  if (w > 13) push('lat-pull-down', 120, 10);
}
const IDS = ['barbell-back-squat', 'flat-barbell-bench-press', 'romanian-deadlifts', 'lat-pull-down', 'none'];
const slot = (repLow?: number, repHigh?: number): Exercise => ({ id: 'barbell-back-squat', name: 'Squat', sets: 3, repLow, repHigh });
const SLOTS = [slot(), slot(3, 5), slot(6, 10), slot(8, 12), slot(12, 15), slot(1, 1)];
const PROGRAM: WorkoutDay[] = [{ id: 1, label: 'A', muscleGroups: '', exercises: [slot(3, 5), slot(8, 12)] }, { id: 2, label: 'B', muscleGroups: '', exercises: [slot()] }];

it('strength fixture', () => {
  const f = new Fixture('strength');
  for (const r of [1, 3, 5, 8, 10, 12, 15]) f.record(`pctReps ${r}`, 'pctOfMaxForReps', [r], pctOfMaxForReps);
  for (const [l, m] of [[200, 300], [0, 300], [100, 0], [315, 315]]) f.record(`pct ${l} ${m}`, 'pctOfMax', [l, m], pctOfMax);
  SLOTS.forEach((s, i) => {
    f.record(`band ${i}`, 'percentBandFor', [s], percentBandFor);
    for (const max of [0, 135, 315]) for (const wt of [null, 'Dumbbell', 'Barbell'] as (WeightType | null)[])
      f.record(`load ${i} ${max} ${wt}`, 'loadBandFor', [max, s, wt], loadBandFor);
  });
  f.record('programLoads', 'programLoadsFor', ['barbell-back-squat', 315, PROGRAM, null], programLoadsFor);
  for (const id of IDS) {
    f.record(`best ${id}`, 'bestLoggedMax', [SESSIONS, LOGS, id], (s: Session[], l: SetLog[], x: string) => bestLoggedMax(buildSnapshot(s, l), x));
    f.record(`series ${id}`, 'e1rmSeriesFor', [SESSIONS, LOGS, id], (s: Session[], l: SetLog[], x: string) => e1rmSeriesFor(buildSnapshot(s, l), x));
    for (const now of [DEFAULT_NOW, DEFAULT_NOW - 60 * DAY, DEFAULT_NOW + 70 * DAY])
      f.record(`trend ${id} ${now}`, 'strengthTrend', [SESSIONS, LOGS, id, now], (s: Session[], l: SetLog[], x: string, t: number) => strengthTrend(buildSnapshot(s, l), x, t));
  }
  const stored: (OneRepMax | null)[] = [null, { exerciseId: 'x', weight: 300, source: 'tested', date: '2026-01-01', updatedAt: DEFAULT_NOW - 50 * DAY },
    { exerciseId: 'x', weight: 300, source: 'estimated', date: '2026-01-01', updatedAt: DEFAULT_NOW }, { exerciseId: 'x', weight: 0, source: 'tested', date: '', updatedAt: 0 }];
  const logged: (LoggedMax | null)[] = [null, { e1rm: 320.4, weight: 280, reps: 4, ts: DEFAULT_NOW - 10 * DAY }, { e1rm: 280, weight: 250, reps: 4, ts: DEFAULT_NOW - 10 * DAY }];
  stored.forEach((s, i) => logged.forEach((l, j) => f.record(`current ${i} ${j}`, 'currentMax', [s, l], currentMax)));
  const trends: (StrengthTrend | null)[] = [null, { ratePctPerWeek: 0.4, points: 5, spanWeeks: 8 }, { ratePctPerWeek: 4, points: 5, spanWeeks: 8 }, { ratePctPerWeek: -0.2, points: 6, spanWeeks: 10.4 }, { ratePctPerWeek: 0.01, points: 3, spanWeeks: 3 }];
  const pairs = [[300, 315], [300, 400], [300, 600], [300, 300], [0, 200], [200, 205]];
  for (const x of ['beginner', 'intermediate', 'advanced'] as ExperienceLevel[]) for (const g of ['strength', 'hypertrophy', 'fat-loss', 'sport-support', 'general'] as Goal[])
    trends.forEach((t, ti) => pairs.forEach(([c, tg]) => {
      const input: ProjectionInput = { current: c, target: tg, experience: x, goal: g, trend: t, now: DEFAULT_NOW };
      f.record(`project ${x} ${g} ${ti} ${c} ${tg}`, 'projectGoal', [input], (i: ProjectionInput) => { const p = projectGoal(i); return { p, eta: etaLabel(p) }; });
    }));
  for (const [s, c, t] of [[200, 250, 300], [300, 250, 300], [200, 150, 300], [200, 400, 300]]) f.record(`progress ${s} ${c} ${t}`, 'goalProgress', [s, c, t], goalProgress);
  f.write();
});
