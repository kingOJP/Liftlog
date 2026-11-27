// planner.ts — guidance parsing, intro weeks, phase layout, block proposals.
import { it } from 'vitest';
import { Fixture, DEFAULT_NOW } from '../harness';
import {
  parseGuidance, applyInjuryArea, introWeeksFor, stimulusChange, buildPhases, sessionBudgetFor, buildPlanProposal, defaultBlockWeeks,
} from '../../../src/data/planner';
import type { PlannerInput, StimulusChange } from '../../../src/data/planner';
import { buildSnapshot } from '../../../src/data/analytics';
import { EXERCISES } from '../../../src/data/exercises';
import type {
  Goal, ExperienceLevel, InjuryArea, EquipmentAccess, BlockRetrospective, SportContext,
} from '../../../src/data/plan';
import type { MuscleGroup } from '../../../src/data/taxonomy';
import type { Exercise, WorkoutDay } from '../../../src/data/program';
import type { Session, SetLog } from '../../../src/db/database';

type G = ReturnType<typeof parseGuidance>;
const project = (g: G) => ({
  bannedWeightTypes: [...g.bannedWeightTypes].sort(), bannedEquipment: [...g.bannedEquipment].sort(),
  avoidPatterns: [...g.avoidPatterns].sort(), avoidNameParts: g.avoidNameParts, notes: g.notes,
});

const NOTES = [
  '', '   ', 'dumbbells only', 'I only have dumbbells at home', 'no barbell', "don't have a barbell, training at home",
  'home gym, no cables', 'my shoulder hurts when I do back squats', 'no knee problems, but my elbow hurts',
  'knee surgery 10 years ago, fully recovered', 'sore right shoulder overhead', 'lower back pain and tight hips',
  'bad wrists; carpal tunnel', "golfer's elbow flares up", 'ITB issues on long runs', 'sciatica bothers me sometimes',
  'Bulgarian split squats hurt my knee', 'I love hip thrusts and shoulder press', 'my knees ache. also my back is weak',
  'wrist injury however shoulders are fine now', 'want to get stronger', 'Dumbbells Only! Knee Pain!', 'groin strain last month',
];
const GOALS: Goal[] = ['hypertrophy', 'strength', 'fat-loss', 'athletic', 'general', 'sport-support'];
const EXP: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced'];
const AREAS: InjuryArea[] = ['knee', 'shoulder', 'lower-back', 'hip', 'elbow', 'wrist'];
const ACCESS: EquipmentAccess[] = ['full-gym', 'home-rack', 'dumbbells-only', 'minimal'];
const SPORT_TRI: SportContext = { sport: 'triathlon', event: 'tri-olympic', proximity: 'mid', load: 'moderate', weakLink: 'swim', niggles: ['knee'] };
const SPORT_RUN: SportContext = { sport: 'running', event: 'run-full', proximity: 'soon', load: 'high', weakLink: 'even', niggles: [] };

const DAY = 86_400_000;
const ex = (id: string, main = false): Exercise => ({ id, name: EXERCISES.find(e => e.id === id)?.name ?? id, sets: 3, repLow: 8, repHigh: 12, ...(main ? { main: true } : {}) });
const PROGRAM: WorkoutDay[] = [
  { id: 1, label: 'Push', muscleGroups: '', exercises: [ex('flat-barbell-bench-press', true), ex('incline-dumbbell-press'), ex('cable-lateral-raises'), ex('tricep-pushdowns')] },
  { id: 2, label: 'Pull', muscleGroups: '', exercises: [ex('barbell-rows', true), ex('lat-pull-down'), ex('dumbbell-curls')] },
  { id: 3, label: 'Legs', muscleGroups: '', exercises: [ex('barbell-back-squat', true), ex('romanian-deadlifts'), ex('leg-extensions'), ex('standing-calf-raises')] },
];
const sessions: Session[] = [], logs: SetLog[] = [];
let lid = 0;
for (let w = 0; w < 6; w++) PROGRAM.forEach((d, di) => {
  const id = w * 3 + di + 1, start = DEFAULT_NOW - (40 - w * 7 - di * 2) * DAY;
  sessions.push({ id, guid: `g${id}`, dayId: d.id, weekNumber: w + 1, startedAt: start, completedAt: start + 3_600_000 });
  d.exercises.forEach((e, i) => { for (let s = 0; s < 3; s++) logs.push({ id: ++lid, sessionId: id, exerciseId: e.id, setNumber: s + 1, weight: 100 + i * 20 + w * (i === 1 ? -6 : 5), reps: 10 - s, order: i }); });
});
const retro = (under: MuscleGroup[], over: MuscleGroup[], keep: string[], review: string[]) => ({
  blockId: 'b1', from: DEFAULT_NOW - 60 * DAY, to: DEFAULT_NOW - DAY, sessionsCompleted: 18, sessionsPlanned: 18, adherencePct: 100, avgSessionMinutes: 55,
  strength: [], muscles: [], summary: [], carryover: { keepExerciseIds: keep, reviewExerciseIds: review, underMuscles: under, overMuscles: over },
}) as unknown as BlockRetrospective;

const input = (goal: Goal, daysPerWeek: number, experience: ExperienceLevel, x: Partial<PlannerInput> = {}): PlannerInput => ({
  goal, daysPerWeek, weeks: 6, includeDeload: true, openWithRecovery: false, startDate: '2026-03-02', notes: '', experience,
  ...(goal === 'sport-support' ? { sport: SPORT_TRI } : {}), ...x,
});

it('planner fixture', () => {
  const f = new Fixture('planner');
  f.record('default weeks', 'defaultBlockWeeks', [], () => defaultBlockWeeks());
  for (const [i, n] of NOTES.entries()) f.record(`guidance ${i}`, 'parseGuidance', [n], (t: string) => project(parseGuidance(t)));
  for (const a of AREAS) f.record(`injury area ${a}`, 'applyInjuryArea', ['no barbell', [a, a]], (t: string, as: InjuryArea[]) => {
    const g = parseGuidance(t); for (const x of as) applyInjuryArea(g, x); return project(g);
  });

  const changes: StimulusChange[] = [{ newExerciseShare: 0, goalChanged: false }, { newExerciseShare: 0.5, goalChanged: false }, { newExerciseShare: 0.49, goalChanged: false }, { newExerciseShare: 0, goalChanged: true }];
  for (const x of EXP) for (const weeks of [3, 6, 8, 12]) for (const [ci, c] of changes.entries()) for (const rec of [false, true])
    f.record(`intro ${x} ${weeks} ${ci} ${rec}`, 'introWeeksFor', [x, weeks, c, rec], (a: ExperienceLevel, w: number, cc: StimulusChange, r: boolean) => introWeeksFor(a, w, cc, r));

  const other: WorkoutDay[] = [{ id: 1, label: 'X', muscleGroups: '', exercises: [ex('flat-barbell-bench-press'), ex('goblet-squat')] }];
  for (const [pi, prog] of [[], other, PROGRAM].entries()) for (const prev of [null, 'strength', 'hypertrophy'] as (Goal | null)[])
    f.record(`stimulus ${pi} ${prev}`, 'stimulusChange', [PROGRAM, prog, 'hypertrophy', prev], (d: WorkoutDay[], c: WorkoutDay[], g: Goal, p: Goal | null) => stimulusChange(d, c, g, p));

  for (const goal of GOALS) for (const weeks of [2, 3, 4, 5, 6, 7.4, 8, 10, 12, 13]) for (const deload of [true, false]) for (const rec of [false, true]) for (const x of ['beginner', 'intermediate'] as ExperienceLevel[]) {
    const i = input(goal, 3, x, { weeks, includeDeload: deload, openWithRecovery: rec });
    f.record(`phases ${goal} ${weeks} ${deload} ${rec} ${x}`, 'buildPhases', [i, null, null], (ii: PlannerInput, r: null, c: null) => buildPhases(ii, r, c ?? undefined));
  }
  for (const [ci, c] of changes.entries()) for (const r of [null, retro([], [], [], ['a', 'b'])]) for (const goal of ['strength', 'sport-support'] as Goal[])
    f.record(`phases retro ${ci} ${!!r} ${goal}`, 'buildPhases', [input(goal, 3, 'advanced', { weeks: 8, sport: SPORT_RUN }), r, c],
      (ii: PlannerInput, rr: BlockRetrospective | null, cc: StimulusChange) => buildPhases(ii, rr, cc));

  for (const name of ['Upper / Lower ×2', 'Push / Pull / Legs + Upper / Lower', 'Full Body ×3', 'Push / Pull / Legs ×2']) for (const goal of ['general', 'strength'] as Goal[]) for (const sport of [false, true])
    f.record(`budget ${name} ${goal} ${sport}`, 'sessionBudgetFor', [name, goal, sport], (n: string, g: Goal, s: boolean) => sessionBudgetFor(n, g, s));

  const prop = (name: string, i: PlannerInput, prog: WorkoutDay[], hist: boolean, r: BlockRetrospective | null = null) =>
    f.record(name, 'buildPlanProposal', [i, prog, hist ? sessions : null, hist ? logs : null, r],
      (ii: PlannerInput, pp: WorkoutDay[], s: Session[] | null, l: SetLog[] | null, rr: BlockRetrospective | null) =>
        buildPlanProposal(ii, pp, s && l ? buildSnapshot(s, l) : null, rr));

  for (const goal of GOALS) for (const days of [2, 3, 4, 5, 6]) for (const x of EXP) prop(`fresh ${goal} ${days} ${x}`, input(goal, days, x), [], false);
  for (const goal of GOALS) for (const days of [3, 4, 5]) prop(`history ${goal} ${days}`, input(goal, days, 'intermediate', { previousGoal: 'hypertrophy' }), PROGRAM, true);
  for (const access of ACCESS) for (const x of EXP) prop(`access ${access} ${x}`, input('hypertrophy', 4, x, { equipmentAccess: access }), PROGRAM, true);
  for (const [ni, n] of NOTES.entries()) prop(`notes ${ni}`, input('general', 3, 'intermediate', { notes: n, injuries: ni % 3 === 0 ? 'sore knee' : undefined }), [], false);
  for (const a of AREAS) for (const x of ['beginner', 'advanced'] as ExperienceLevel[]) prop(`areas ${a} ${x}`, input('strength', 4, x, { injuryAreas: [a] }), PROGRAM, true);
  for (const pm of [['Biceps', 'Calves'], ['Delts', 'Glutes', 'Chest', 'Lats']] as MuscleGroup[][]) for (const goal of ['hypertrophy', 'sport-support'] as Goal[])
    prop(`priority ${pm.join('-')} ${goal}`, input(goal, 5, 'intermediate', { priorityMuscles: pm }), PROGRAM, true);
  const r1 = retro(['Biceps', 'Calves', 'Delts', 'Glutes'], ['Chest'], ['lat-pull-down'], ['barbell-rows', 'leg-extensions', 'romanian-deadlifts']);
  for (const goal of ['hypertrophy', 'strength', 'general'] as Goal[]) for (const days of [3, 4, 6]) prop(`retro ${goal} ${days}`, input(goal, days, 'advanced', { openWithRecovery: true }), PROGRAM, true, r1);
  for (const focus of [['barbell-back-squat'], ['conventional-deadlift', 'barbell-overhead-press'], ['flat-barbell-bench-press', 'incline-barbell-press'], ['pull-ups'], ['nonexistent-lift']])
    for (const x of ['beginner', 'intermediate'] as ExperienceLevel[]) for (const access of ['full-gym', 'dumbbells-only'] as EquipmentAccess[])
      prop(`focus ${focus.join('+')} ${x} ${access}`, input('strength', 3, x, { focusExerciseIds: focus, equipmentAccess: access }), PROGRAM, false);
  for (const sport of [SPORT_TRI, SPORT_RUN, { ...SPORT_TRI, event: 'tri-sprint', load: 'low', proximity: 'far', niggles: ['achilles', 'shoulder'], weakLink: 'bike' } as SportContext])
    for (const days of [2, 3, 4]) for (const x of EXP) for (const weeks of [4, 8, 12])
      prop(`sport ${sport.event} ${days} ${x} ${weeks}`, input('sport-support', days, x, { sport, weeks }), weeks === 8 ? PROGRAM : [], weeks === 8);
  f.write();
});
