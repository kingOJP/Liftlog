// syncMerge.ts + worker/planMerge.ts — the sync v2 merge rules every device applies.
import { it } from 'vitest';
import { Fixture, DEFAULT_NOW } from '../harness';
import { planSessionMerge, sessionGuid, sessionUpdatedAt } from '../../../src/data/syncMerge';
import type { SessionDoc } from '../../../src/data/syncMerge';
import { mergePlanDocs, planDocClock } from '../../../worker/planMerge';
import { defaultTrainingProfile } from '../../../src/data/plan';
import type { PlanState } from '../../../src/data/planStore';
import type { Session } from '../../../src/db/database';

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
const H = 3_600_000;

function local(id: number, guid: string | undefined, start: number, clock: 'updated' | 'completed' | 'started', delta: number): Session {
  const s: Session = { id, dayId: 1 + (id % 3), weekNumber: 1, startedAt: start };
  if (guid) s.guid = guid;
  if (clock !== 'started') s.completedAt = start + H;
  if (clock === 'updated') s.updatedAt = start + H + delta;
  return s;
}

function doc(guid: string, start: number, updatedAt: number, sets: number): SessionDoc {
  return {
    guid, dayId: 2, weekNumber: 3, startedAt: start, completedAt: start + H, updatedAt,
    ...(sets % 2 ? { note: `n${sets}` } : {}),
    sets: Array.from({ length: sets }, (_, i) => ({ exerciseId: 'leg-press', setNumber: i + 1, weight: 100 + i * 5, reps: 8, order: 0 })),
  };
}

const plan = (updatedAt: number, profileAt: number | null, tag: string): PlanState => ({
  version: 1, plans: [], updatedAt,
  ...(profileAt == null ? {} : { profile: { ...defaultTrainingProfile(), injuries: tag, updatedAt: profileAt } }),
});

it('sync fixture', () => {
  const f = new Fixture('sync');
  const T = DEFAULT_NOW - 30 * 24 * H;

  // Every local-clock shape against every incoming-clock relation.
  const shapes: Array<['updated' | 'completed' | 'started', number]> = [['updated', 0], ['updated', 5000], ['completed', 0], ['started', 0]];
  for (const [clock, delta] of shapes) for (const rel of [-1, 0, 1]) for (const guid of ['g-1', undefined]) for (const tomb of [false, true]) {
    const s = local(1, guid, T, clock, delta);
    const g = sessionGuid(s);
    const d = doc(g, T, sessionUpdatedAt(s) + rel, 2);
    f.record(`one ${clock}${delta} rel${rel} ${guid ?? 'legacy'}${tomb ? ' tomb' : ''}`, 'planSessionMerge',
      [[s], [d], tomb ? [g] : []], (l: Session[], inc: SessionDoc[], t: string[]) => planSessionMerge(l, inc, new Set(t)));
  }

  // Random multi-device mixes: local-only, server-only, both (either newer), tombstoned on either side.
  for (let n = 0; n < 60; n++) {
    const locals: Session[] = [], docs: SessionDoc[] = [], tombs: string[] = [];
    const count = 1 + Math.floor(rnd() * 8);
    for (let i = 0; i < count; i++) {
      const start = T + i * 24 * H;
      const where = pick(['local', 'server', 'both', 'both', 'legacy-both']);
      const guid = where === 'legacy-both' ? undefined : `g${n}-${i}`;
      const s = local(i + 1, guid, start, pick(['updated', 'completed', 'started']), Math.floor(rnd() * 3) * 1000);
      if (where !== 'server') locals.push(s);
      if (where !== 'local') docs.push(doc(sessionGuid(s), start, sessionUpdatedAt(s) + pick([-1000, 0, 1000, 0]), Math.floor(rnd() * 4)));
      if (rnd() < 0.15) tombs.push(sessionGuid(s));
    }
    if (rnd() < 0.3) tombs.push('not-present');
    f.record(`mix ${n}`, 'planSessionMerge', [locals, docs, tombs], (l: Session[], inc: SessionDoc[], t: string[]) => planSessionMerge(l, inc, new Set(t)));
  }
  f.record('empty', 'planSessionMerge', [[], [], []], (l: Session[], inc: SessionDoc[], t: string[]) => planSessionMerge(l, inc, new Set(t)));

  // Plan document: plans and profile win independently, equal clocks keep current.
  const clocks = [100, 200];
  const profiles = [null, 50, 150, 250];
  f.record('plan into nothing', 'mergePlanDocs', [null, plan(100, 100, 'in')], (c: PlanState | null, i: PlanState) => ({ ...mergePlanDocs(c, i), clock: planDocClock(i) }));
  for (const cu of clocks) for (const iu of clocks) for (const cp of profiles) for (const ip of profiles) {
    f.record(`plan c${cu}/${cp} i${iu}/${ip}`, 'mergePlanDocs', [plan(cu, cp, 'cur'), plan(iu, ip, 'in')],
      (c: PlanState | null, i: PlanState) => ({ ...mergePlanDocs(c, i), clock: planDocClock(i) }));
  }
  f.write();
});
