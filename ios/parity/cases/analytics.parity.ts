// analytics.ts — snapshot, durations, e1RM series, identity, muscle/head set totals.
import { it } from 'vitest';
import { Fixture, DEFAULT_NOW } from '../harness';
import {
  volumeTargetFor, buildSnapshot, sessionTimestamp, sessionWeekStart, sessionDurationMs, avgDurationByDay, epley1RM,
  e1rmSeries, normalizeName, resolveExerciseIdentity, musclesForExercise, primaryMuscleFor, musclesForSet, musclesForSlot,
  movementPatternFor, muscleSetTotals, headSetTotals,
} from '../../../src/data/analytics';
import type { Session, SetLog } from '../../../src/db/database';
import type { Goal, ExperienceLevel } from '../../../src/data/plan';
import type { SetVariation } from '../../../src/data/variations';

const DAY = 86_400_000, MIN = 60_000;
const obj = <K, V>(m: Map<K, V>) => Object.fromEntries([...m].map(([k, v]) => [String(k), v]));
const sess = (id: number, dayId: number, daysAgo: number, mins: number | null): Session => ({
  id, guid: `g${id}`, dayId, weekNumber: 1, startedAt: DEFAULT_NOW - daysAgo * DAY,
  completedAt: mins == null ? undefined : DEFAULT_NOW - daysAgo * DAY + mins * MIN, updatedAt: 1,
});
const SESSIONS: Session[] = [
  sess(1, 1, 20, 55), sess(2, 2, 18, 5), sess(3, 1, 13, 62), sess(4, 2, 11, 300), sess(5, 1, 6, 48),
  sess(6, 2, 4, 70), sess(7, 1, 1, null), sess(8, 3, 0, 40), sess(9, 1, 27, 50), sess(10, 1, 34, 51),
  sess(11, 1, 41, 52), sess(12, 1, 48, 53), sess(13, 1, 55, 54), sess(14, 1, 62, 56), sess(15, 1, 69, 57),
];
let n = 0;
const set = (sessionId: number, exerciseId: string, weight: number, reps: number, extra: Partial<SetLog> = {}): SetLog =>
  ({ id: ++n, sessionId, exerciseId, setNumber: 1, weight, reps, ...extra });
const LOGS: SetLog[] = [
  set(1, 'barbell-bench-press', 95, 10, { warmup: true }), set(1, 'barbell-bench-press', 185, 8), set(1, 'barbell-bench-press', 185, 7, { grip: 'close' }),
  set(1, 'barbell-bench-press', 135, 12, { technique: 'drop' }), set(1, 'lat-pull-down', 140, 10, { grip: 'wide' }),
  set(3, 'barbell-bench-press', 190, 8), set(3, 'romanian-deadlifts', 225, 8, { technique: 'deficit' }), set(3, 'my-custom-1782325116469', 50, 10),
  set(3, 'incline-db-press-1782325116469', 60, 10), set(5, 'barbell-bench-press', 195, 6, { technique: 'paused' }), set(5, 'cable-lateral-raises', 20, 15),
  set(5, 'barbell-squat', 275, 5), set(5, 'face-pulls', 40, 15, { technique: 'partials' }), set(6, 'leg-press', 400, 12), set(6, 'leg-press', 400, 10, { technique: 'rest-pause' }),
  set(7, 'barbell-bench-press', 200, 5), set(8, 'plank', 0, 60), set(8, 'barbell-bench-press', 0, 0), set(99, 'barbell-squat', 300, 3),
  set(4, 'barbell-squat', 285, 4, { warmup: true }),
];
const storage = { liftlog_library_v3: '1', liftlog_exercises: [
  { id: 'incline-db-press-1782325116469', name: 'Incline Dumbbell Press' }, { id: 'my-custom-1782325116469', name: 'My Custom Lift' },
], liftlog_exercise_meta: { 'cable-lateral-raises': { primaryMuscle: 'Delts', secondaryMuscle1: 'Traps', secondaryMuscle2: null, secondaryMuscle3: null, workoutType: 'Lateral Raise', equipment: 'Cable Machine', weightType: 'Machine' } } };

const snapView = (s: ReturnType<typeof buildSnapshot>) => ({
  sessions: s.sessions.map(x => x.id), working: obj(new Map([...s.setsBySession].map(([k, v]) => [k, v.map(l => l.id)]))),
  all: obj(new Map([...s.allSetsBySession].map(([k, v]) => [k, v.map(l => l.id)]))),
});
const totalsView = (t: ReturnType<typeof muscleSetTotals>) => ({ totals: obj(t.totals), unmappedSets: t.unmappedSets, unmapped: [...t.unmappedExerciseIds].sort() });
const headsView = (t: ReturnType<typeof headSetTotals>) => ({ byHead: obj(t.byHead), unspecified: obj(t.unspecified) });

it('analytics fixture', () => {
  const f = new Fixture('analytics');
  for (const g of [null, 'hypertrophy', 'sport-support', 'strength'] as (Goal | null)[]) {
    for (const x of [null, 'beginner', 'advanced'] as (ExperienceLevel | null)[]) f.record(`target ${g} ${x}`, 'volumeTargetFor', [g, x], volumeTargetFor);
  }
  f.record('snapshot', 'buildSnapshot', [SESSIONS, LOGS], (s: Session[], l: SetLog[]) => snapView(buildSnapshot(s, l)));
  for (const s of SESSIONS) f.record(`session ${s.id}`, 'sessionTime', [s], (x: Session) => ({ ts: sessionTimestamp(x), week: sessionWeekStart(x), dur: sessionDurationMs(x) }));
  f.record('avg duration', 'avgDurationByDay', [SESSIONS, LOGS], (s: Session[], l: SetLog[]) => obj(avgDurationByDay(buildSnapshot(s, l))));
  for (const [w, r] of [[100, 10], [225, 5], [0, 12], [135.5, 1], [60, 0]]) f.record(`epley ${w}x${r}`, 'epley1RM', [w, r], epley1RM);
  f.record('e1rm series', 'e1rmSeries', [SESSIONS, LOGS], (s: Session[], l: SetLog[]) => obj(e1rmSeries(buildSnapshot(s, l))), { storage });
  for (const s of ['Barbell Bench-Press!', '  Incline DB  press ', 'ÄBC 123', '']) f.record(`norm ${s}`, 'normalizeName', [s], normalizeName);
  const IDS = ['barbell-bench-press', 'cable-lateral-raises', 'incline-db-press-1782325116469', 'my-custom-1782325116469', 'unknown-thing', 'romanian-deadlifts', 'plank', 'lat-pull-down'];
  for (const id of IDS) {
    f.record(`identity ${id}`, 'identity', [id], (x: string) => ({
      identity: resolveExerciseIdentity(x), muscles: musclesForExercise(x), primary: primaryMuscleFor(x), pattern: movementPatternFor(x),
    }), { storage });
  }
  f.record('identity fallback name', 'identityNamed', ['some-id-1782325116469', 'Barbell Squat'], (id: string, name: string) => resolveExerciseIdentity(id, name), { storage });
  const VARS: (SetVariation | null)[] = [null, { grip: 'close' }, { grip: 'wide' }, { technique: 'deficit' }, { technique: 'paused', grip: 'neutral' }];
  for (const id of IDS) for (const v of VARS) f.record(`set ${id} ${JSON.stringify(v)}`, 'musclesForSet', [id, v], musclesForSet, { storage });
  const slot = { id: 'barbell-bench-press', name: 'B', sets: 3, grip: 'close' as const };
  f.record('slot', 'musclesForSlot', [slot], musclesForSlot, { storage });
  f.record('muscle totals all', 'muscleSetTotals', [SESSIONS, LOGS, null], (...a: [Session[], SetLog[], null]) => totalsView(muscleSetTotals(buildSnapshot(a[0], a[1]))), { storage });
  f.record('muscle totals recent', 'muscleSetTotals', [SESSIONS, LOGS, DEFAULT_NOW - 10 * DAY], (s: Session[], l: SetLog[], since: number) =>
    totalsView(muscleSetTotals(buildSnapshot(s, l), x => sessionTimestamp(x) >= since)), { storage });
  f.record('head totals all', 'headSetTotals', [SESSIONS, LOGS, null], (...a: [Session[], SetLog[], null]) => headsView(headSetTotals(buildSnapshot(a[0], a[1]))), { storage });
  f.record('head totals recent', 'headSetTotals', [SESSIONS, LOGS, DEFAULT_NOW - 10 * DAY], (s: Session[], l: SetLog[], since: number) =>
    headsView(headSetTotals(buildSnapshot(s, l), x => sessionTimestamp(x) >= since)), { storage });
  f.write();
});
