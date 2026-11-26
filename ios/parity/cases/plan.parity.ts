// plan.ts — label tables, block calendar math, phase resolution, validation.
import { it } from 'vitest';
import { Fixture, DEFAULT_NOW } from '../harness';
import {
  GOALS, EXPERIENCE_LEVELS, EQUIPMENT_ACCESS, RACE_PROXIMITY, ENDURANCE_LOADS, DISCIPLINES, INJURY_AREAS, PHASE_INFO,
  goalLabel, experienceLabel, proximityLabel, enduranceHours, isEasyPhase, isOpenerPhase, parsePlanDate, toPlanDate,
  mondayOf, nextMonday, blockWeekIndex, blockLengthWeeks, blockEnded, blockEndTs, blockPhaseAt, phaseResolverFor,
  currentPhase, productiveWeeks, validatePhases, defaultSportContext, defaultTrainingProfile,
} from '../../../src/data/plan';
import type { Goal, ExperienceLevel, RaceProximity, EnduranceLoad, PhaseKind, TrainingBlock, TrainingPlan } from '../../../src/data/plan';

const DAY = 86_400_000;
const block = (over: Partial<TrainingBlock>): TrainingBlock => ({
  id: 'b', name: 'B', focus: 'hypertrophy', startDate: '2026-03-04', phases: ['accumulation', 'accumulation', 'intensification', 'deload'],
  program: [], intent: '', progression: '', status: 'active', activatedAt: 1, ...over,
});
const BLOCKS: Record<string, TrainingBlock> = {
  scheduled: block({}),
  dst: block({ startDate: '2026-03-02', phases: ['accumulation', 'accumulation', 'peak'] }),
  fall: block({ startDate: '2026-10-28', phases: ['intro', 'accumulation', 'accumulation', 'accumulation', 'deload'] }),
  openEnded: block({ startDate: '2025-12-31', phases: [], openEnded: true }),
  openClosed: block({ startDate: '2025-12-31', phases: [], openEnded: true, completedAt: DEFAULT_NOW - 10 * DAY, status: 'completed' }),
  pending: block({ startDate: '2026-03-23', status: 'pending' }),
  badDate: block({ startDate: '2026-02-30' }),
};
const TIMES = [-30, -15, -1, 0, 1, 6, 13, 20, 27, 28, 60].map(d => DEFAULT_NOW + d * DAY).concat([Date.UTC(2026, 10, 2, 5, 30), Date.UTC(2026, 2, 9, 4, 59)]);

it('plan fixture', () => {
  const f = new Fixture('plan');
  f.record('tables', 'tables', [], () => ({ GOALS, EXPERIENCE_LEVELS, EQUIPMENT_ACCESS, RACE_PROXIMITY, ENDURANCE_LOADS, DISCIPLINES, INJURY_AREAS, PHASE_INFO }));
  for (const g of ['hypertrophy', 'strength', 'fat-loss', 'athletic', 'general', 'sport-support'] as Goal[]) f.record(`goal ${g}`, 'goalLabel', [g], goalLabel);
  for (const x of ['beginner', 'intermediate', 'advanced'] as ExperienceLevel[]) f.record(`exp ${x}`, 'experienceLabel', [x], experienceLabel);
  for (const p of ['none', 'soon', 'mid', 'far'] as RaceProximity[]) f.record(`prox ${p}`, 'proximityLabel', [p], proximityLabel);
  for (const l of ['low', 'moderate', 'high', 'very-high'] as EnduranceLoad[]) f.record(`load ${l}`, 'enduranceHours', [l], enduranceHours);
  const ALL: (PhaseKind | null)[] = ['intro', 'recovery', 'accumulation', 'intensification', 'peak', 'deload', 'maintenance', 'race-week', null];
  for (const p of ALL) f.record(`easy ${p}`, 'phaseFlags', [p], (x: PhaseKind | null) => ({ easy: isEasyPhase(x), opener: x == null ? null : isOpenerPhase(x) }));
  for (const d of ['2026-03-09', '2026-02-29', '2024-02-29', '2026-13-01', '26-03-09', '2026-3-9', '', '2026-11-01']) {
    f.record(`parse ${d}`, 'parsePlanDate', [d], (s: string) => { const r = parsePlanDate(s); return r ? r.getTime() : null; });
  }
  for (const t of TIMES) {
    f.record(`dates ${t}`, 'dates', [t], (ts: number) => ({ plan: toPlanDate(new Date(ts)), monday: mondayOf(new Date(ts)).getTime(), next: nextMonday(new Date(ts)) }));
  }
  for (const [name, b] of Object.entries(BLOCKS)) {
    f.record(`static ${name}`, 'blockStatic', [b], (x: TrainingBlock) => ({ len: blockLengthWeeks(x), end: blockEndTs(x) }));
    for (const t of TIMES) {
      f.record(`at ${name} ${t}`, 'blockAt', [b, t], (x: TrainingBlock, ts: number) => ({
        week: blockWeekIndex(x, ts), ended: blockEnded(x, ts), phase: blockPhaseAt(x, ts), current: currentPhase(x, ts),
      }));
    }
  }
  const plans: TrainingPlan[] = [
    { id: 'p1', goal: 'general', origin: 'migrated', status: 'completed', createdAt: 1, blocks: [BLOCKS.openClosed] },
    { id: 'p2', goal: 'hypertrophy', origin: 'planned', status: 'active', createdAt: 2, blocks: [BLOCKS.dst, BLOCKS.scheduled, BLOCKS.pending] },
  ];
  f.record('resolver', 'phaseResolverFor', [plans, TIMES], (ps: TrainingPlan[], ts: number[]) => { const r = phaseResolverFor(ps); return ts.map(r); });
  const SEQS: PhaseKind[][] = [
    [], Array(13).fill('accumulation'), ['intro', 'recovery'], ['accumulation', 'intro'], ['intro', 'intro', 'intro', 'accumulation'],
    ['accumulation', 'race-week', 'race-week'], ['race-week', 'accumulation'], ['accumulation', 'accumulation', 'accumulation', 'deload', 'deload', 'deload'],
    ['accumulation', 'deload', 'accumulation'], ['accumulation', 'accumulation', 'deload'], ['intro', 'accumulation', 'accumulation', 'accumulation', 'deload'],
    ['accumulation', 'intensification', 'peak', 'deload', 'deload', 'race-week'], ['accumulation', 'maintenance', 'maintenance', 'race-week'],
    ['recovery', 'intro', 'accumulation', 'peak', 'peak', 'deload'], ['accumulation', 'accumulation', 'accumulation', 'deload', 'race-week'],
  ];
  SEQS.forEach((s, i) => f.record(`validate ${i}`, 'validatePhases', [s], (p: PhaseKind[]) => ({ err: validatePhases(p), productive: productiveWeeks(p) })));
  f.record('defaults', 'defaults', [], () => ({ sport: defaultSportContext(), profile: defaultTrainingProfile() }));
  f.write();
});
