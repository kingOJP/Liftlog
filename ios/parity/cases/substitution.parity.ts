// substitution.ts — candidate pool + ranked, explained replacement suggestions.
import { it } from 'vitest';
import { Fixture, DEFAULT_NOW } from '../harness';
import { candidateProfiles, suggestReplacements } from '../../../src/data/substitution';
import { buildSnapshot } from '../../../src/data/analytics';
import { EXERCISES } from '../../../src/data/exercises';
import type { Goal } from '../../../src/data/plan';
import type { Exercise, WorkoutDay } from '../../../src/data/program';
import type { Session, SetLog } from '../../../src/db/database';

const DAY = 86_400_000;
const ex = (id: string): Exercise => ({ id, name: EXERCISES.find(e => e.id === id)?.name ?? id, sets: 3, repLow: 8, repHigh: 12 });
const DAYS: WorkoutDay[] = [
  { id: 1, label: 'Push', muscleGroups: '', exercises: ['flat-barbell-bench-press', 'incline-dumbbell-press', 'cable-lateral-raises', 'tricep-pushdowns'].map(ex) },
  { id: 2, label: 'Pull', muscleGroups: '', exercises: ['barbell-rows', 'lat-pull-down', 'dumbbell-curls'].map(ex) },
  { id: 3, label: 'Legs', muscleGroups: '', exercises: ['barbell-back-squat', 'romanian-deadlifts', 'leg-extensions', 'standing-calf-raises'].map(ex) },
];
const sessions: Session[] = [], logs: SetLog[] = [];
let lid = 0;
for (let w = 0; w < 6; w++) DAYS.forEach((d, di) => {
  const id = w * 3 + di + 1, start = DEFAULT_NOW - (40 - w * 7 - di * 2) * DAY;
  sessions.push({ id, guid: `g${id}`, dayId: d.id, weekNumber: w + 1, startedAt: start, completedAt: start + 3_600_000 });
  d.exercises.forEach((e, i) => { for (let s = 0; s < 3; s++) logs.push({ id: ++lid, sessionId: id, exerciseId: e.id, setNumber: s + 1, weight: 100 + i * 20 + w * (i === 1 ? -6 : 5), reps: 10 - s, order: i }); });
});
const pullups = { id: 99, label: 'BW', muscleGroups: '', exercises: ['pull-ups', 'dips', 'push-ups'].map(ex) } as WorkoutDay;

it('substitution fixture', () => {
  const f = new Fixture('substitution');
  f.record('candidates', 'candidateProfiles', [], () => candidateProfiles());
  const targets = [...DAYS, pullups].flatMap(d => d.exercises.map(e => [d, e] as const));
  for (const [d, t] of targets) for (const hist of [false, true]) for (const goal of [null, 'strength', 'sport-support'] as (Goal | null)[]) for (const regression of [false, true])
    f.record(`suggest ${t.id} ${hist} ${goal} ${regression}`, 'suggestReplacements', [t, d, hist ? sessions : null, hist ? logs : null, goal, regression, 3],
      (tt: Exercise, dd: WorkoutDay, s: Session[] | null, l: SetLog[] | null, g: Goal | null, r: boolean, lim: number) =>
        suggestReplacements(tt, dd, s && l ? buildSnapshot(s, l) : null, lim, DEFAULT_NOW, g, { regression: r }));
  for (const id of EXERCISES.map(e => e.id)) f.record(`any ${id}`, 'suggestReplacements', [ex(id), DAYS[0], null, null, null, false, 5],
    (tt: Exercise, dd: WorkoutDay, _s: null, _l: null, _g: null, _r: boolean, lim: number) => suggestReplacements(tt, dd, null, lim, DEFAULT_NOW, null));
  f.write();
});
