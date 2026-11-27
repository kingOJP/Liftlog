// sessionHistory.ts + progress.ts positions — like-for-like exercise history.
import { it } from 'vitest';
import { Fixture, DEFAULT_NOW } from '../harness';
import { expectedVariation, exerciseHistory } from '../../../src/data/sessionHistory';
import { buildSnapshot } from '../../../src/data/analytics';
import { snapshotPositions, sessionExercisePositions } from '../../../src/data/progress';
import type { Session, SetLog } from '../../../src/db/database';
import type { SetVariation } from '../../../src/data/variations';
import type { Exercise } from '../../../src/data/program';

const DAY = 86_400_000;
const S = (id: number, daysAgo: number): Session => ({ id, guid: `g${id}`, dayId: 1, weekNumber: 1, startedAt: DEFAULT_NOW - daysAgo * DAY, completedAt: DEFAULT_NOW - daysAgo * DAY + 3_600_000 });
const SESSIONS = [S(1, 21), S(2, 14), S(3, 7), S(4, 3), S(5, 1)];
let n = 0;
const L = (sessionId: number, exerciseId: string, setNumber: number, weight: number, reps: number, x: Partial<SetLog> = {}): SetLog =>
  ({ id: ++n, sessionId, exerciseId, setNumber, weight, reps, ...x });
const LOGS: SetLog[] = [
  L(1, 'squat', 1, 225, 8), L(1, 'bench', 1, 185, 8, { repLow: 6, repHigh: 10 }), L(1, 'bench', 2, 185, 7, { repLow: 6, repHigh: 10 }),
  L(2, 'bench', 2, 175, 8, { grip: 'close' }), L(2, 'bench', 1, 180, 8, { grip: 'close' }), L(2, 'bench', 3, 135, 10, { technique: 'drop' }),
  L(2, 'squat', 1, 230, 8, { order: 0 }), L(3, 'bench', 1, 190, 6, { technique: 'paused' }), L(3, 'bench', 2, 190, 5, { technique: 'paused', grip: 'wide' }),
  L(3, 'bench', 3, 185, 6, { technique: 'paused' }), L(4, 'row', 1, 135, 10, { order: 3 }), L(4, 'bench', 1, 195, 5, { order: 5, repLow: 4 }),
  L(4, 'curl', 1, 30, 12, { order: 3 }), L(5, 'bench', 1, 100, 10, { warmup: true }), L(5, 'bench', 1, 200, 4, { technique: 'tempo', grip: 'close' }),
  L(5, 'bench', 2, 200, 4, { technique: 'tempo', grip: 'close' }), L(5, 'bench', 3, 200, 3, { grip: 'close' }), L(5, 'squat', 1, 240, 6),
];
const VARS: SetVariation[] = [{}, { grip: 'close' }, { technique: 'paused' }, { technique: 'tempo', grip: 'close' }, { technique: 'deficit' }, { technique: 'drop' }];

it('sessionHistory fixture', () => {
  const f = new Fixture('sessionHistory');
  f.record('positions', 'snapshotPositions', [SESSIONS, LOGS], (s: Session[], l: SetLog[]) =>
    Object.fromEntries([...snapshotPositions(buildSnapshot(s, l))].map(([k, m]) => [String(k), Object.fromEntries(m)])));
  f.record('positions raw', 'sessionExercisePositions', [LOGS], (l: SetLog[]) => Object.fromEntries(sessionExercisePositions(l)));
  const slots: Exercise[] = [
    { id: 'bench', name: 'Bench', sets: 3 }, { id: 'bench', name: 'Bench', sets: 3, technique: 'deficit' }, { id: 'bench', name: 'Bench', sets: 3, grip: 'wide' },
    { id: 'bench', name: 'Bench', sets: 3, technique: 'drop' }, { id: 'squat', name: 'Squat', sets: 3 }, { id: 'nope', name: 'Nope', sets: 3 },
  ];
  slots.forEach((ex, i) => {
    f.record(`expected ${i}`, 'expectedVariation', [ex, SESSIONS, LOGS], (e: Exercise, s: Session[], l: SetLog[]) => expectedVariation(e, buildSnapshot(s, l)));
    f.record(`expected ${i} nosnap`, 'expectedVariation', [ex, null, null], (...a: [Exercise, null, null]) => expectedVariation(a[0], null));
  });
  for (const id of ['bench', 'squat', 'row', 'nope']) {
    for (const v of VARS) {
      for (const depth of [1, 3, 10]) {
        f.record(`history ${id} ${JSON.stringify(v)} ${depth}`, 'exerciseHistory', [SESSIONS, LOGS, id, depth, v], (s: Session[], l: SetLog[], e: string, d: number, vv: SetVariation) => {
          const snap = buildSnapshot(s, l);
          return exerciseHistory(snap, e, d, snapshotPositions(snap), vv);
        });
      }
    }
  }
  f.write();
});
