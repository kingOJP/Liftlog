// prescribe.ts + the planStore read side it depends on.
import { it } from 'vitest';
import { Fixture, DEFAULT_NOW } from '../harness';
import { prescribeFor, slotFor } from '../../../src/data/prescribe';
import type { PrescribeOptions } from '../../../src/data/prescribe';
import { getPlannedGoal, getTrainingGoal, getProfileOrDefault, getActivePhase, planStateHasContent, getPlanState } from '../../../src/data/planStore';
import { buildSnapshot } from '../../../src/data/analytics';
import { defaultTrainingProfile } from '../../../src/data/plan';
import type { Goal, ExperienceLevel, TrainingBlock, TrainingPlan } from '../../../src/data/plan';
import type { DosageSlot } from '../../../src/data/dosage';
import type { Session, SetLog } from '../../../src/db/database';

const block = (x: Partial<TrainingBlock> = {}): TrainingBlock => ({
  id: 'b', name: 'B', focus: 'strength', startDate: '2026-01-05', program: [], intent: '', progression: '', status: 'active', activatedAt: 1,
  phases: ['accumulation', 'accumulation', 'deload'], ...x,
});
const plan = (x: Partial<TrainingPlan>): TrainingPlan => ({ id: 'p', goal: 'strength', origin: 'planned', status: 'active', createdAt: 1, blocks: [block()], ...x });
const STATES: Record<string, unknown> = {
  none: null,
  planned: { version: 1, plans: [plan({})], updatedAt: 1 },
  migratedPending: { version: 1, updatedAt: 1, plans: [plan({ origin: 'migrated', goal: 'general', blocks: [block({ openEnded: true, phases: [] })] })],
    pendingActivation: { goal: 'hypertrophy', block: block({ status: 'pending' }), createdAt: 1 } },
  migratedOnly: { version: 1, updatedAt: 1, plans: [plan({ origin: 'migrated', goal: 'general', blocks: [block({ openEnded: true, phases: [] })] })] },
  beginnerHyp: { version: 1, updatedAt: 1, plans: [plan({ goal: 'hypertrophy' })], profile: { ...defaultTrainingProfile(), experience: 'beginner' } },
  migratedChosen: { version: 1, updatedAt: 1, plans: [plan({ origin: 'migrated', goal: 'fat-loss', blocks: [block({ openEnded: true, status: 'completed', phases: [] }), block({ id: 'c' })] })] },
  strengthOnly: { version: 1, updatedAt: 1, plans: [], strength: { maxes: [{ exerciseId: 'barbell-squat', weight: 300, source: 'tested', date: '2026-01-01', updatedAt: 1 }], goals: [] } },
  badVersion: { version: 2, plans: [plan({})], updatedAt: 1 },
};
const storage = (k: string) => (STATES[k] == null ? {} : { liftlog_plan: STATES[k] });
const EXS: [string, string][] = [['barbell-squat', 'Barbell Squat'], ['leg-press', 'Leg Press'], ['cable-lateral-raises', 'Cable Lateral Raises'],
  ['barbell-overhead-press', 'Overhead Press'], ['my-custom-1782325116469', 'Incline Press']];
const DAY = 86_400_000;
const SESSIONS: Session[] = [], LOGS: SetLog[] = [];
for (let i = 0; i < 5; i++) {
  const t = DEFAULT_NOW - (i + 1) * 3 * DAY;
  SESSIONS.push({ id: i + 1, guid: `g${i}`, dayId: 1, weekNumber: 1, startedAt: t, completedAt: t + 3_600_000 });
  EXS.forEach(([id], j) => [6 + i, 5 + i, 4 + j].forEach((r, k) => LOGS.push({ id: i * 100 + j * 10 + k + 1, sessionId: i + 1, exerciseId: id, setNumber: k + 1, weight: 100, reps: r })));
}
type Args = [string, string, DosageSlot | null, Goal | 'unset' | null, ExperienceLevel | null, boolean];
const opts = (name: string, slot: DosageSlot | null, goal: Goal | 'unset' | null, exp: ExperienceLevel | null, hist: boolean): PrescribeOptions => ({
  name, ...(slot ? { slot } : {}), ...(goal !== 'unset' ? { goal } : {}), ...(exp ? { experience: exp } : {}),
  snapshot: hist ? buildSnapshot(SESSIONS, LOGS) : null,
});

it('prescribe fixture', () => {
  const f = new Fixture('prescribe');
  f.record('history data', 'history', [SESSIONS, LOGS], (s: Session[], l: SetLog[]) => s.length + l.length);
  for (const st of Object.keys(STATES)) {
    f.record(`store ${st}`, 'planStore', [], () => ({
      planned: getPlannedGoal(), training: getTrainingGoal(), profile: getProfileOrDefault(), phase: getActivePhase(DEFAULT_NOW),
      content: planStateHasContent(getPlanState()),
    }), { storage: storage(st) });
    for (const [id, name] of EXS) for (const slot of [null, { main: true }, { main: false }]) for (const goal of ['unset', null, 'strength'] as const)
      for (const exp of [null, 'advanced'] as const) for (const hist of [false, true]) {
        const args: Args = [id, name, slot, goal, exp, hist];
        f.record(`rx ${st} ${id} ${JSON.stringify(slot)} ${goal} ${exp} ${hist}`, 'prescribeFor', args,
          (...a: Args) => prescribeFor(a[0], opts(a[1], a[2], a[3], a[4], a[5])), { storage: storage(st) });
        if (exp == null && slot?.main !== false) f.record(`slot ${st} ${id} ${JSON.stringify(slot)} ${goal} ${hist}`, 'slotFor', args,
          (...a: Args) => slotFor(a[0], a[1], opts(a[1], a[2], a[3], a[4], a[5])), { storage: storage(st) });
      }
  }
  f.write();
});
