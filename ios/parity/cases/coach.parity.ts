// coach.ts + insights.ts — the adaptive set-redistribution planner and the
// Coach card (volume status, highlights, opportunities, next day).
import { it } from 'vitest';
import { Fixture, DEFAULT_NOW } from '../harness';
import { computeProgramPlan, applyPlanToDay, estimatedMinutesFor } from '../../../src/data/coach';
import type { ProgramPlan } from '../../../src/data/coach';
import { computeCoaching } from '../../../src/data/insights';
import { buildSnapshot } from '../../../src/data/analytics';
import { phaseResolverFor } from '../../../src/data/plan';
import type { CoachDecision, ExperienceLevel, Goal, PhaseKind, TrainingPlan } from '../../../src/data/plan';
import type { WorkoutDay } from '../../../src/data/program';
import type { Session, SetLog } from '../../../src/db/database';

const DAY = 86_400_000;
const ex = (id: string, sets: number) => ({ id, name: id.replace(/-/g, ' '), sets, repLow: 8, repHigh: 12 });
const PROGRAM: WorkoutDay[] = [
  { id: 1, label: 'Push', muscleGroups: 'Chest · Delts · Triceps', exercises: [ex('flat-barbell-bench-press', 3), ex('incline-dumbbell-press', 3), ex('cable-lateral-raises', 2), ex('cable-pushdown', 4)] },
  { id: 2, label: 'Pull', muscleGroups: 'Back · Biceps', exercises: [ex('lat-pull-down', 3), ex('barbell-rows', 5), ex('ez-bar-curls', 2), ex('face-pulls', 3)] },
  { id: 3, label: 'Legs', muscleGroups: 'Legs', exercises: [ex('barbell-back-squat', 4), ex('romanian-deadlifts', 3), ex('leg-press', 3), ex('standing-calf-raises', 2)] },
];
const SHORT: WorkoutDay[] = [{ id: 1, label: 'Full', muscleGroups: 'All', exercises: [ex('barbell-back-squat', 5), ex('flat-barbell-bench-press', 5), ex('hanging-leg-raise', 5)] }];

function history(minutes: number, weeks = 5, program = PROGRAM, extraQuads = true, declineBench = false) {
  const sessions: Session[] = [], logs: SetLog[] = [];
  let sid = 0, lid = 0;
  for (let w = weeks - 1; w >= 0; w--) {
    program.forEach((day, di) => {
      const start = DEFAULT_NOW - (w * 7 + (program.length - di) * 2) * DAY;
      const id = ++sid;
      sessions.push({ id, guid: `g${id}`, dayId: day.id, weekNumber: weeks - w, startedAt: start, completedAt: start + minutes * 60_000 });
      day.exercises.forEach((e, order) => {
        const base = 50 + order * 20 + (declineBench && e.id === 'flat-barbell-bench-press' ? -(weeks - w) * 10 : (weeks - w) * 5);
        for (let s = 0; s < e.sets; s++) logs.push({ id: ++lid, sessionId: id, exerciseId: e.id, setNumber: s + 1, weight: base, reps: 10 - s, order });
      });
      if (extraQuads && day.id === 3) for (let s = 0; s < 14; s++) logs.push({ id: ++lid, sessionId: id, exerciseId: 'hack-squat', setNumber: s + 1, weight: 200, reps: 10, order: 9 });
    });
  }
  return { sessions: sessions.reverse(), logs };
}
const HISTS = {
  normal: history(60), short: history(10), noQuads: history(60, 5, PROGRAM, false), decline: history(60, 6, PROGRAM, true, true),
  few: history(60, 1), fullBody: history(60, 4, SHORT, false), stale: history(60, 3),
};
const plans: TrainingPlan[] = [{ id: 'p', goal: 'hypertrophy', origin: 'planned', status: 'active', createdAt: 1, blocks: [{
  id: 'b', name: 'B', focus: 'hypertrophy', startDate: '2026-02-09', program: [], intent: '', progression: '', status: 'active', activatedAt: 1,
  phases: ['accumulation', 'accumulation', 'deload', 'accumulation', 'accumulation', 'accumulation'],
}] }];
interface Opts { goal?: Goal | null; experience?: ExperienceLevel | null; phase?: PhaseKind | null; decisions?: CoachDecision[]; phased?: boolean; now?: number }
const CONTEXTS: Opts[] = [
  {}, { goal: 'hypertrophy' }, { goal: 'sport-support' }, { goal: 'fat-loss', experience: 'beginner' }, { goal: 'strength', experience: 'advanced' },
  { phase: 'deload' }, { phase: 'maintenance' }, { phase: 'accumulation', phased: true }, { experience: 'beginner' },
  { decisions: [{ key: '1:cable-lateral-raises:add-set', accepted: false, at: 1 }, { key: '2:ez-bar-curls:add-set', accepted: false, at: 1 }, { key: '3:barbell-back-squat:remove-set', accepted: false, at: 1 }, { key: '1:cable-pushdown:add-set', accepted: true, at: 1 }] },
  { now: DEFAULT_NOW + 20 * DAY }, { now: DEFAULT_NOW + 40 * DAY },
];
const planObj = (p: ProgramPlan) => ({
  ready: p.ready, changes: p.changes, suggestions: p.suggestions,
  weeklyMuscleSets: Object.fromEntries([...p.weeklyMuscleSets].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
  days: Object.fromEntries([...p.days].sort((a, b) => a[0] - b[0]).map(([k, v]) => [String(k), v])),
});

it('coach fixture', () => {
  const f = new Fixture('coach');
  for (const [hn, h] of Object.entries(HISTS)) {
    const program = hn === 'fullBody' ? SHORT : PROGRAM;
    CONTEXTS.forEach((o, i) => {
      const args = [program, h.sessions, h.logs, o] as [WorkoutDay[], Session[], SetLog[], Opts];
      f.record(`plan ${hn} ${i}`, 'computeProgramPlan', args, (p, s, l, c) => {
        const plan = computeProgramPlan(p, buildSnapshot(s, l), c.now ?? DEFAULT_NOW, c.phase ?? null, c.goal ?? null,
          c.phased ? phaseResolverFor(plans) : null, c.experience ?? null, c.decisions ?? []);
        return { plan: planObj(plan), applied: p.map(d => applyPlanToDay(d, plan)) };
      });
      f.record(`coaching ${hn} ${i}`, 'computeCoaching', args, (p, s, l, c) => {
        const r = computeCoaching(p, buildSnapshot(s, l), c.now ?? DEFAULT_NOW, c.phase ?? null, c.goal ?? 'general',
          c.phased ? phaseResolverFor(plans) : null, c.experience ?? null, c.decisions ?? []);
        return { ...r, plan: planObj(r.plan) };
      });
    });
  }
  f.record('coaching empty', 'computeCoaching', [PROGRAM, [], [], {}] as [WorkoutDay[], Session[], SetLog[], Opts], (...a) => {
    const [p, s, l] = a;
    const r = computeCoaching(p, buildSnapshot(s, l), DEFAULT_NOW);
    return { ...r, plan: planObj(r.plan) };
  });
  f.record('coaching empty program', 'computeCoaching', [[], HISTS.normal.sessions, HISTS.normal.logs, {}] as [WorkoutDay[], Session[], SetLog[], Opts], (...a) => {
    const [p, s, l] = a;
    const r = computeCoaching(p, buildSnapshot(s, l), DEFAULT_NOW);
    return { ...r, plan: planObj(r.plan) };
  });
  for (const d of [...PROGRAM, ...SHORT]) f.record(`minutes ${d.label}`, 'estimatedMinutesFor', [d], estimatedMinutesFor);
  f.write();
});
