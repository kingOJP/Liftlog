import { it } from 'vitest';
import { Fixture } from '../harness';
import {
  TECHNIQUE_INFO, GRIP_INFO, SET_TECHNIQUES, GRIPS, isExtension, isRepStyle, styleOf, variationKey, sameVariation,
  hasVariation, variationLabel, setCredit, countsForStrength, gripOptionsFor, techniqueOptionsFor,
  extensionOptionsFor, adjustInvolvement,
} from '../../../src/data/variations';
import type { SetVariation, Involvement } from '../../../src/data/variations';
import { MOVEMENT_PATTERNS } from '../../../src/data/taxonomy';
import type { MovementPattern } from '../../../src/data/taxonomy';

const VARIATIONS: (SetVariation | null)[] = [null, {}];
for (const t of [undefined, ...SET_TECHNIQUES]) for (const g of [undefined, ...GRIPS]) {
  if (t || g) VARIATIONS.push({ ...(t ? { technique: t } : {}), ...(g ? { grip: g } : {}) });
}

it('variations fixture', () => {
  const f = new Fixture('variations');
  f.record('info tables', 'info', [], () => ({ technique: TECHNIQUE_INFO, grip: GRIP_INFO }));
  for (const t of [null, 'bogus', ...SET_TECHNIQUES]) {
    f.record(`technique ${t}`, 'technique', [t], (x: string | null) => ({
      isExtension: isExtension(x as never), isRepStyle: isRepStyle(x as never), setCredit: setCredit(x), countsForStrength: countsForStrength(x),
    }));
  }
  for (const v of VARIATIONS) {
    f.record(`variation ${JSON.stringify(v)}`, 'variation', [v], (x: SetVariation | null) => ({
      key: variationKey(x), style: styleOf(x ?? {}), has: hasVariation(x), label: variationLabel(x),
    }));
  }
  f.record('styleOf strips unknowns', 'styleOfRaw', [{ technique: 'drop', grip: 'sideways' }], styleOf);
  f.record('styleOf raw paused/mixed', 'styleOfRaw', [{ technique: 'paused', grip: 'mixed' }], styleOf);
  const pairs: [SetVariation | null, SetVariation | null][] = [
    [null, {}], [{ technique: 'drop' }, null], [{ technique: 'paused' }, { technique: 'paused', grip: 'wide' }],
    [{ grip: 'close' }, { grip: 'close', technique: 'rest-pause' }], [{ technique: 'tempo' }, { technique: 'paused' }],
  ];
  for (const [a, b] of pairs) f.record(`same ${JSON.stringify([a, b])}`, 'sameVariation', [a, b], sameVariation);
  for (const p of [null, ...MOVEMENT_PATTERNS] as (MovementPattern | null)[]) {
    f.record(`options ${p}`, 'options', [p], (x: MovementPattern | null) => ({
      grips: gripOptionsFor(x), techniques: techniqueOptionsFor(x), timedTechniques: techniqueOptionsFor(x, 'seconds'),
    }));
  }
  f.record('extension options', 'extensionOptions', [], () => [extensionOptionsFor(), extensionOptionsFor('seconds')]);
  const bases: [MovementPattern, Involvement[]][] = [
    ['Horizontal Press', [{ muscle: 'Chest', weight: 1 }, { muscle: 'Triceps', weight: 0.5 }, { muscle: 'Delts', weight: 0.5 }]],
    ['Row', [{ muscle: 'Upper Back', weight: 1 }, { muscle: 'Lats', weight: 0.5 }, { muscle: 'Biceps', weight: 0.5 }]],
    ['Pull Down', [{ muscle: 'Lats', weight: 1 }, { muscle: 'Biceps', weight: 0.25 }]],
    ['Hip Hinge', [{ muscle: 'Hamstrings', weight: 1 }, { muscle: 'Glutes', weight: 0.5 }, { muscle: 'Lower Back', weight: 0.5 }]],
    ['Curl', [{ muscle: 'Biceps', weight: 1 }]],
    ['Shrug', [{ muscle: 'Traps', weight: 1 }]],
    ['Lunge', [{ muscle: 'Quads', weight: 1 }, { muscle: 'Glutes', weight: 0.75 }]],
    ['Squat', [{ muscle: 'Quads', weight: 1 }]],
  ];
  for (const [p, base] of bases) for (const v of VARIATIONS) {
    f.record(`adjust ${p} ${JSON.stringify(v)}`, 'adjustInvolvement', [base, p, v], adjustInvolvement);
  }
  f.record('adjust no pattern', 'adjustInvolvement', [bases[0][1], null, { grip: 'close' }], adjustInvolvement);
  f.write();
});
