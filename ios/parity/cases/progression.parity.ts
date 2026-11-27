// progression.ts — composite progress score, deadband, stall windows.
import { it } from 'vitest';
import { Fixture } from '../harness';
import { fullMarksFor, deadband, pctChange, compositeScore, stallWindowFor, holdsInsteadOfDeload, GOAL_SIGNAL_WEIGHTS } from '../../../src/data/progression';
import type { ProgressSignals } from '../../../src/data/progression';
import type { Goal, ExperienceLevel } from '../../../src/data/plan';

const GOALS: Goal[] = ['hypertrophy', 'strength', 'fat-loss', 'athletic', 'general', 'sport-support'];
const EXPS: (ExperienceLevel | null)[] = [null, 'beginner', 'intermediate', 'advanced'];

it('progression fixture', () => {
  const f = new Fixture('progression');
  f.record('weights', 'weights', [], () => GOAL_SIGNAL_WEIGHTS);
  for (const x of EXPS) f.record(`marks ${x}`, 'fullMarksFor', [x], fullMarksFor);
  for (const p of [null, 0, 2.9, -2.9, 3, -3, 10.5]) for (const fl of [3, 5]) f.record(`deadband ${p} ${fl}`, 'deadband', [p, fl], deadband);
  for (const [a, b] of [[0, 10], [-5, 10], [100, 105], [100, 90], [3, 3]]) f.record(`pct ${a} ${b}`, 'pctChange', [a, b], pctChange);
  const SIGNALS: ProgressSignals[] = [
    { e1rmChangePct: null, volumeChangePct: null, prEvents: 0 }, { e1rmChangePct: 6, volumeChangePct: 12, prEvents: 3 },
    { e1rmChangePct: -8, volumeChangePct: -15, prEvents: 0 }, { e1rmChangePct: 1.5, volumeChangePct: null, prEvents: 1 },
    { e1rmChangePct: -2, volumeChangePct: 4, prEvents: 0 }, { e1rmChangePct: null, volumeChangePct: 7, prEvents: 2 },
    { e1rmChangePct: 2.5, volumeChangePct: -3, prEvents: 1 }, { e1rmChangePct: 0, volumeChangePct: 0, prEvents: 0 },
  ];
  SIGNALS.forEach((s, i) => { for (const g of GOALS) for (const x of EXPS) f.record(`score ${i} ${g} ${x}`, 'compositeScore', [s, g, x], compositeScore); });
  for (const x of ['beginner', 'intermediate', 'advanced'] as ExperienceLevel[]) f.record(`stall ${x}`, 'stallWindowFor', [x], stallWindowFor);
  for (const g of GOALS) for (const x of EXPS) f.record(`holds ${g} ${x}`, 'holdsInsteadOfDeload', [g, x], holdsInsteadOfDeload);
  f.write();
});
