// retrospective.ts — block review: adherence, strength outcomes, muscle volume, carryover, summary.
import { it } from 'vitest';
import { Fixture, DEFAULT_NOW } from '../harness';
import { computeBlockRetrospective } from '../../../src/data/retrospective';
import { buildSnapshot } from '../../../src/data/analytics';
import type { Goal, PhaseKind, TrainingBlock } from '../../../src/data/plan';
import type { WorkoutDay } from '../../../src/data/program';
import type { Session, SetLog } from '../../../src/db/database';

const DAY = 86_400_000;
const ex = (id: string, sets: number) => ({ id, name: id, sets, repLow: 8, repHigh: 12 });
const PROGRAM: WorkoutDay[] = [
  { id: 1, label: 'A', muscleGroups: '', exercises: [ex('flat-barbell-bench-press', 3), ex('barbell-rows', 3), ex('cable-lateral-raises', 2)] },
  { id: 2, label: 'B', muscleGroups: '', exercises: [ex('barbell-back-squat', 4), ex('romanian-deadlifts', 3), ex('standing-calf-raises', 2)], phases: ['accumulation'] },
];
function hist(trend: number[], perWeek: number) {
  const sessions: Session[] = [], logs: SetLog[] = [];
  let sid = 0, lid = 0;
  for (let w = 0; w < 7; w++) for (let k = 0; k < perWeek; k++) {
    const id = ++sid, start = Date.UTC(2026, 1, 2, 18) + (w * 7 + k * 2) * DAY;
    if (start > DEFAULT_NOW) continue;
    sessions.push({ id, guid: `g${id}`, dayId: (k % 2) + 1, weekNumber: w + 1, startedAt: start, completedAt: start + (45 + k * 10) * 60_000 });
    PROGRAM[k % 2].exercises.forEach((e, i) => {
      for (let s = 0; s < e.sets + (i === 0 ? 4 : 0); s++)
        logs.push({ id: ++lid, sessionId: id, exerciseId: e.id, setNumber: s + 1, weight: 100 + i * 37 + w * trend[i] * (1 + k), reps: 10 - (s % 3), order: i });
    });
  }
  return { sessions: sessions.reverse(), logs };
}
const HISTS = { up: hist([5, 3.5, 1.2], 2), down: hist([-4, -2.5, -1.1], 2), flat: hist([0.3, -0.2, 0.1], 1), mixed: hist([6, -3, 0.2], 3), none: { sessions: [], logs: [] } };
const block = (focus: Goal, phases: PhaseKind[], extra: Partial<TrainingBlock> = {}): TrainingBlock => ({
  id: 'b', name: 'B', focus, startDate: '2026-02-02', phases, program: PROGRAM, intent: '', progression: '', status: 'active', activatedAt: 1, ...extra,
});
const BLOCKS: Record<string, TrainingBlock> = {
  hyp6: block('hypertrophy', ['accumulation', 'accumulation', 'accumulation', 'accumulation', 'accumulation', 'deload']),
  str4: block('strength', ['intro', 'accumulation', 'accumulation', 'deload']),
  sport: block('sport-support', ['accumulation', 'accumulation', 'maintenance', 'maintenance', 'maintenance', 'maintenance', 'maintenance', 'maintenance']),
  open: block('general', [], { openEnded: true }),
  beginner: block('fat-loss', ['accumulation', 'accumulation', 'accumulation', 'accumulation', 'accumulation', 'accumulation', 'deload', 'accumulation', 'accumulation', 'accumulation'], { experience: 'beginner' }),
};
it('retrospective fixture', () => {
  const f = new Fixture('retrospective');
  for (const [bn, b] of Object.entries(BLOCKS)) for (const [hn, h] of Object.entries(HISTS)) for (const now of [DEFAULT_NOW, DEFAULT_NOW - 20 * DAY, DEFAULT_NOW + 60 * DAY])
    f.record(`retro ${bn} ${hn} ${now}`, 'computeBlockRetrospective', [b, h.sessions, h.logs, now],
      (bb: TrainingBlock, s: Session[], l: SetLog[], t: number) => computeBlockRetrospective(bb, buildSnapshot(s, l), t));
  f.write();
});
