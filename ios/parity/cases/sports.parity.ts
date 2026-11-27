// sports.ts — sport metadata, event profiles, lift budget, sport phases, sport plans.
import { it } from 'vitest';
import { Fixture } from '../harness';
import {
  nigglesFor, niggleLabel, sportMeta, eventsFor, eventMeta, defaultEventFor, liftBudget, buildSportPhases, buildSportPlan,
  NIGGLES, SPORT_EVENTS,
} from '../../../src/data/sports';
import type { SportContext, SportId, RaceProximity, EnduranceLoad, Discipline, ExperienceLevel } from '../../../src/data/plan';
import type { VolumeTarget } from '../../../src/data/analytics';

const SPORTS: SportId[] = ['triathlon', 'running'];
const PROX: RaceProximity[] = ['none', 'soon', 'mid', 'far'];
const LOADS: EnduranceLoad[] = ['low', 'moderate', 'high', 'very-high'];
const WEAK: Discipline[] = ['swim', 'bike', 'run', 'even'];
const EXP: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced'];
const NIGGLE_SETS = [[], ['achilles'], ['knee'], ['back'], ['shoulder'], ['achilles', 'knee', 'back', 'shoulder'], ['knee', 'back']];

it('sports fixture', () => {
  const f = new Fixture('sports');
  for (const s of SPORTS) {
    f.record(`niggles ${s}`, 'nigglesFor', [s], (x: SportId) => nigglesFor(x));
    f.record(`meta ${s}`, 'sportMeta', [s], (x: SportId) => sportMeta(x));
    f.record(`events ${s}`, 'eventsFor', [s], (x: SportId) => eventsFor(x));
    f.record(`default event ${s}`, 'defaultEventFor', [s], (x: SportId) => defaultEventFor(x));
  }
  for (const id of [...NIGGLES.map(n => n.id), 'unknown-niggle']) f.record(`niggle label ${id}`, 'niggleLabel', [id], (x: string) => niggleLabel(x));
  for (const e of SPORT_EVENTS) f.record(`event ${e.id}`, 'eventMeta', [e.id], (x: typeof e.id) => eventMeta(x));

  const ctx = (event: (typeof SPORT_EVENTS)[number], load: EnduranceLoad, weakLink: Discipline = 'even', niggles: string[] = [], proximity: RaceProximity = 'mid'): SportContext =>
    ({ sport: event.sport, event: event.id, proximity, load, weakLink, niggles });

  for (const e of SPORT_EVENTS) for (const load of LOADS) for (const days of [1, 2, 3, 4, 5]) for (const x of EXP)
    f.record(`budget ${e.id} ${load} ${days} ${x}`, 'liftBudget', [ctx(e, load), days, x], (c: SportContext, d: number, xx: ExperienceLevel) => liftBudget(c, d, xx));

  for (const weeks of [1, 2, 3, 4, 5, 6, 6.5, 7, 8, 10, 12, 14]) for (const p of PROX) for (const s of SPORTS) for (const intro of [0, 1, 2])
    f.record(`phases ${weeks} ${p} ${s} ${intro}`, 'buildSportPhases', [weeks, p, s, intro], (w: number, pp: RaceProximity, ss: SportId, i: number) => buildSportPhases(w, pp, ss, i));

  for (const e of SPORT_EVENTS) for (const load of LOADS) for (const days of [1, 2, 3, 4]) for (const x of ['beginner', 'intermediate'] as ExperienceLevel[])
    f.record(`plan ${e.id} ${load} ${days} ${x}`, 'buildSportPlan', [ctx(e, load), days, x, null],
      (c: SportContext, d: number, xx: ExperienceLevel, b: null) => buildSportPlan(c, d, xx, b ?? undefined));
  for (const e of SPORT_EVENTS.filter(ev => ['tri-olympic', 'tri-full', 'run-5k', 'run-half'].includes(ev.id)))
    for (const [ni, niggles] of NIGGLE_SETS.entries()) for (const weak of e.sport === 'triathlon' ? WEAK : ['even' as Discipline]) for (const load of ['low', 'high'] as EnduranceLoad[])
      f.record(`plan niggles ${e.id} ${ni} ${weak} ${load}`, 'buildSportPlan', [ctx(e, load, weak, niggles), 3, 'intermediate', null],
        (c: SportContext, d: number, xx: ExperienceLevel, b: null) => buildSportPlan(c, d, xx, b ?? undefined));
  const tight: VolumeTarget = { low: 2, high: 5 };
  for (const e of SPORT_EVENTS) for (const weak of WEAK)
    f.record(`plan tight band ${e.id} ${weak}`, 'buildSportPlan', [ctx(e, 'very-high', weak, ['achilles']), 3, 'advanced', tight],
      (c: SportContext, d: number, xx: ExperienceLevel, b: VolumeTarget) => buildSportPlan(c, d, xx, b));
  f.write();
});
