// Storage/sync documents in the exact shape the PWA writes them. The Swift
// models must decode each and re-encode it to the same JSON.
import { it } from 'vitest';
import { Fixture } from '../harness';
import type { WorkoutDay, LibraryExercise } from '../../../src/data/program';
import type { Session, SetLog } from '../../../src/db/database';
import type { SessionDoc } from '../../../src/data/syncMerge';
import type { DraftSession } from '../../../src/data/draftSession';
import type { PlanState } from '../../../src/data/planStore';
import type { ExerciseMetaOverride } from '../../../src/data/exercises';
import type { SyncStatus } from '../../../src/data/syncStatus';

const program: WorkoutDay[] = [
  {
    id: 1, label: 'Day 1', muscleGroups: 'Chest · Triceps',
    exercises: [
      { id: 'bench-press', name: 'Bench Press', sets: 4, repLow: 5, repHigh: 8, main: true, rangeSource: 'plan' },
      { id: 'incline-db-press', name: 'Incline DB Press', sets: 3, repLow: 8, repHigh: 12, technique: 'paused', grip: 'neutral', progression: 'manual' },
      { id: 'tricep-pushdown', name: 'Tricep Pushdown', sets: 3, archived: true },
    ],
  },
  { id: 2, label: 'Day 2', muscleGroups: 'Legs', exercises: [], phases: ['accumulation', 'intensification'] },
];

const library: LibraryExercise[] = [
  { id: 'bench-press', name: 'Bench Press' },
  { id: 'custom-1700000000000', name: 'Landmine Press', updatedAt: 1700000000000, archived: true },
  { id: 'legacy', name: 'Legacy', sets: 3, repLow: 8, repHigh: 12 },
];

const session: Session = { id: 7, guid: 'g-7', dayId: 1, weekNumber: 3, startedAt: 1773846000000, completedAt: 1773849600000, updatedAt: 1773849600000, note: 'felt strong' };
const setLog: SetLog = { id: 70, sessionId: 7, exerciseId: 'bench-press', setNumber: 1, weight: 185, reps: 8, order: 0, repLow: 5, repHigh: 8, technique: 'paused', grip: 'close' };
const warmup: SetLog = { id: 71, sessionId: 7, exerciseId: 'bench-press', setNumber: 0, weight: 95, reps: 10, warmup: true };

const sessionDoc: SessionDoc = {
  guid: 'g-7', dayId: 1, weekNumber: 3, startedAt: 1773846000000, updatedAt: 1773849600000,
  sets: [
    { exerciseId: 'bench-press', setNumber: 1, weight: 185, reps: 8, order: 0, repLow: 5, repHigh: 8 },
    { exerciseId: 'bench-press', setNumber: 2, weight: 165, reps: 6.5, technique: 'drop' },
  ],
};

const draft: DraftSession = {
  dayId: 1, startedAt: 1773846000000, savedAt: 1773846600000,
  sets: { 'bench-press': [{ weight: 185, reps: 8 }, { weight: 185, reps: 7, technique: 'rest-pause', grip: 'wide' }] },
  order: ['bench-press'], origin: 'quick', note: 'n',
  day: program[0],
  added: [{ id: 'dips', name: 'Dips', sets: 2 }],
};

const planState: PlanState = {
  version: 1,
  updatedAt: 1773849600000,
  profile: {
    injuries: 'left knee', equipment: 'home-rack', daysPerWeek: 3, experience: 'intermediate', trainingAgeMonths: 18,
    priorityMuscles: ['Upper Back', 'Glutes'], injuryAreas: ['knee', 'lower-back'], updatedAt: 1773800000000,
    sport: { sport: 'running', event: 'run-half', proximity: 'mid', load: 'very-high', weakLink: 'run', niggles: ['achilles'] },
  },
  strength: {
    maxes: [{ exerciseId: 'bench-press', weight: 225, source: 'tested', date: '2026-03-01', updatedAt: 1772400000000 }],
    goals: [{ exerciseId: 'bench-press', targetWeight: 250, createdAt: 1772400000000 }],
  },
  plans: [{
    id: 'plan-1', goal: 'sport-support', goalNotes: 'half marathon in June', origin: 'planned', status: 'active', createdAt: 1770000000000,
    blocks: [
      {
        id: 'block-0', name: 'Foundation', focus: 'general', startDate: '2026-01-05', phases: [], openEnded: true,
        program: [], intent: 'i', progression: 'p', status: 'completed', activatedAt: 1767600000000,
        completedAt: 1770000000000, completedBy: 'activation',
        retrospective: {
          blockId: 'block-0', from: 1767600000000, to: 1770000000000, sessionsCompleted: 12, sessionsPlanned: null,
          adherencePct: null, avgSessionMinutes: 54.5,
          strength: [
            { exerciseId: 'bench-press', name: 'Bench Press', startE1rm: 200, endE1rm: 215.3, changePct: 7.65, sessions: 8, status: 'progressing', volumeChangePct: null, prCount: 2 },
            { exerciseId: 'squat', name: 'Squat', startE1rm: 300, endE1rm: 300, changePct: 0, sessions: 6 },
          ],
          muscles: [{ muscle: 'Chest', weeklySets: 12.5, status: 'optimal' }],
          summary: ['Bench Press up 8%'],
          carryover: { keepExerciseIds: ['bench-press'], reviewExerciseIds: ['squat'], underMuscles: ['Lats'], overMuscles: [] },
        },
      },
      {
        id: 'block-1', name: 'Build', focus: 'sport-support', startDate: '2026-02-02', phases: ['intro', 'accumulation', 'deload', 'race-week'],
        program, intent: 'i', progression: 'p', status: 'active', activatedAt: 1770000000000, experience: 'intermediate',
        replacedBlockId: 'block-0', replacedProgram: [],
        coachDecisions: [{ key: 'add-volume:Lats', accepted: true, at: 1771000000000 }],
      },
    ],
  }],
  pendingActivation: {
    goal: 'hypertrophy', createdAt: 1773849600000,
    block: {
      id: 'block-2', name: 'Next', focus: 'hypertrophy', startDate: '2026-04-06', phases: ['accumulation'], program,
      intent: 'i', progression: 'p', status: 'pending', activatedAt: 0,
    },
  },
};

const meta: Record<string, ExerciseMetaOverride> = {
  'bench-press': { primaryMuscle: 'Chest', secondaryMuscle1: 'Triceps', secondaryMuscle2: 'Delts', secondaryMuscle3: null, workoutType: 'Horizontal Press', equipment: 'Bench', weightType: 'Barbell', updatedAt: 1773800000000 },
  'custom-1': { primaryMuscle: null, secondaryMuscle1: null, secondaryMuscle2: null, secondaryMuscle3: null, workoutType: null, equipment: null, weightType: null },
};

const syncStatus: SyncStatus = { lastSuccessAt: 1773849600000, lastPullAt: null, lastError: 'offline', lastErrorAt: 1773849700000, hasUnpushed: true, authExpired: false };

it('models fixture', () => {
  const f = new Fixture('models');
  const id = <T>(v: T): T => v;
  f.record('program', 'WorkoutDay[]', [program], id);
  f.record('library', 'LibraryExercise[]', [library], id);
  f.record('session', 'Session', [session], id);
  f.record('setLogs', 'SetLog[]', [[setLog, warmup]], id);
  f.record('sessionDoc', 'SessionDoc', [sessionDoc], id);
  f.record('draft', 'DraftSession', [draft], id);
  f.record('planState', 'PlanState', [planState], id);
  f.record('exerciseMeta', 'Record<string, ExerciseMetaOverride>', [meta], id);
  f.record('settings', 'Settings', [{ programStart: '2026-01-05' }], id);
  f.record('syncStatus', 'SyncStatus', [syncStatus], id);
  f.write();
});
