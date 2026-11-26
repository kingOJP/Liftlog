// progress.ts — point series with PRs, multi-signal assessment, rollups.
import { it } from 'vitest';
import { Fixture, DEFAULT_NOW } from '../harness';
import { exercisePointSeries, assessExercise, assessSnapshot, progressDirections, categoryProgress } from '../../../src/data/progress';
import type { ExercisePoint } from '../../../src/data/progress';
import { buildSnapshot } from '../../../src/data/analytics';
import { phaseResolverFor } from '../../../src/data/plan';
import type { Goal, TrainingPlan } from '../../../src/data/plan';
import type { Session, SetLog } from '../../../src/db/database';

const DAY = 86_400_000;
const SESSIONS: Session[] = [];
const LOGS: SetLog[] = [];
let n = 0;
const add = (sessionId: number, exerciseId: string, weight: number, reps: number[], x: Partial<SetLog> = {}) =>
  reps.forEach((r, i) => LOGS.push({ id: ++n, sessionId, exerciseId, setNumber: i + 1, weight, reps: r, ...x }));
for (let w = 0; w < 10; w++) {
  const id = w + 1;
  const start = DEFAULT_NOW - (70 - w * 7) * DAY;
  SESSIONS.push({ id, guid: `g${id}`, dayId: 1, weekNumber: w + 1, startedAt: start, completedAt: start + 3_600_000 });
  add(id, 'barbell-bench-press', 185 + w * 5, [8, 7, 6], { order: w === 8 ? 5 : 0 });
  add(id, 'barbell-squat', w === 7 ? 200 : 275, [5, 5, 5], { order: 1 });
  add(id, 'pull-ups', 0, [8 + (w % 3), 7], { order: 2 });
  if (w < 6) add(id, 'romanian-deadlifts', 225, [8, 8]); else add(id, 'romanian-deadlifts', 205, [8, 8], { technique: 'paused' });
  if (w % 2 === 0) add(id, 'cable-lateral-raises', 20 - w, [15, 15, 12]);
  if (w === 4) add(id, 'barbell-bench-press', 135, [12], { technique: 'drop' });
  if (w >= 8) add(id, 'leg-press', 300, [20, 15], { grip: 'wide' });
}
const plans: TrainingPlan[] = [{ id: 'p', goal: 'hypertrophy', origin: 'planned', status: 'active', createdAt: 1, blocks: [{
  id: 'b', name: 'B', focus: 'hypertrophy', startDate: '2026-01-05', program: [], intent: '', progression: '', status: 'active', activatedAt: 1,
  phases: ['accumulation', 'accumulation', 'accumulation', 'accumulation', 'accumulation', 'accumulation', 'accumulation', 'deload', 'accumulation', 'accumulation'],
}] }];
const GOALS: Goal[] = ['hypertrophy', 'strength', 'fat-loss', 'sport-support'];
const obj = <V>(m: Map<string, V>) => Object.fromEntries(m);

it('progress fixture', () => {
  const f = new Fixture('progress');
  for (const phased of [false, true]) {
    f.record(`series phased=${phased}`, 'exercisePointSeries', [SESSIONS, LOGS, phased ? plans : null], (s: Session[], l: SetLog[], p: TrainingPlan[] | null) =>
      obj(exercisePointSeries(buildSnapshot(s, l), () => true, p ? phaseResolverFor(p) : null)));
  }
  const series = exercisePointSeries(buildSnapshot(SESSIONS, LOGS), () => true, phaseResolverFor(plans));
  for (const [id, pts] of series) {
    for (const g of GOALS) for (const win of [4, null, 2]) for (const cut of new Set([pts.length, 2, 3, 5])) {
      const slice = pts.slice(0, cut);
      f.record(`assess ${id} ${g} ${win} ${cut}`, 'assessExercise', [id, slice, g, win], (e: string, p: ExercisePoint[], goal: Goal, w: number | null) =>
        assessExercise(e, p, goal, 'Name', w ?? Infinity));
    }
  }
  for (const g of GOALS) {
    f.record(`snapshot ${g}`, 'assessSnapshot', [SESSIONS, LOGS, g, plans], (s: Session[], l: SetLog[], goal: Goal, p: TrainingPlan[]) => {
      const a = assessSnapshot(buildSnapshot(s, l), goal, () => true, phaseResolverFor(p));
      const d = progressDirections(a);
      return { a: obj(a), up: [...d.up].sort(), down: [...d.down].sort(), stalled: [...d.stalled].sort() };
    }, { storage: {} });
    f.record(`category ${g}`, 'categoryProgress', [SESSIONS, LOGS, g], (s: Session[], l: SetLog[], goal: Goal) =>
      categoryProgress(buildSnapshot(s, l), goal).sort((x, y) => (x.category < y.category ? -1 : 1)));
  }
  f.write();
});
