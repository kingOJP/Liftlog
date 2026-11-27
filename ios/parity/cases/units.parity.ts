import { it } from 'vitest';
import { Fixture } from '../harness';
import { toDisplay, fromDisplay, fmtWeight, unitLabelFor, getWeightUnit } from '../../../src/data/units';
import type { WeightUnit } from '../../../src/data/units';

const WEIGHTS = [0, 2.5, 45, 135, 185.5, 225, 315.25, 1000];
const DISPLAY = [0, 1, 20, 61.2, 84.1, 100, 142.5];
const UNITS: WeightUnit[] = ['lb', 'kg'];

it('units fixture', () => {
  const f = new Fixture('units');
  for (const u of UNITS) {
    for (const w of WEIGHTS) {
      f.record(`toDisplay ${w} ${u}`, 'toDisplay', [w, u], toDisplay);
      f.record(`fmtWeight ${w} ${u}`, 'fmtWeight', [w, u], fmtWeight);
    }
    for (const d of DISPLAY) f.record(`fromDisplay ${d} ${u}`, 'fromDisplay', [d, u], fromDisplay);
    f.record(`unitLabelFor ${u}`, 'unitLabelFor', [u], unitLabelFor);
    // Stored preference (no explicit unit argument).
    f.record(`stored ${u}`, 'storedUnit', [], () => ({ unit: getWeightUnit(), w: fmtWeight(185.5) }),
      { storage: { liftlog_weight_unit: u } });
  }
  f.record('stored default', 'storedUnit', [], () => ({ unit: getWeightUnit(), w: fmtWeight(185.5) }));
  f.write();
});
