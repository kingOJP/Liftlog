// Weight unit preference (decision D8).
//
// Every weight in the app — set logs, prescriptions, the engine's arithmetic,
// the sync wire, D1 — is stored in POUNDS and always will be. The preference
// only changes what the user sees and types: `toDisplay` converts a stored
// load for a label or an input, `fromDisplay` converts what they typed back
// before it is stored, and `fmtWeight` is the one formatter every reason
// string and label goes through. Increments stay equipment-based in pounds
// (a 2.5 lb microplate is a 2.5 lb microplate) and are displayed converted,
// so a kg user sees 1.1 kg steps on a barbell. Device-local, like the rest
// of settings.ts.

export type WeightUnit = 'lb' | 'kg';

const KEY = 'liftlog_weight_unit';
export const LB_PER_KG = 2.20462;

const listeners = new Set<() => void>();

export function getWeightUnit(): WeightUnit {
  try {
    return localStorage.getItem(KEY) === 'kg' ? 'kg' : 'lb';
  } catch {
    return 'lb';
  }
}

export function saveWeightUnit(unit: WeightUnit): void {
  localStorage.setItem(KEY, unit);
  for (const l of listeners) l();
}

export function subscribeWeightUnit(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A stored load (lbs) as the number the user sees: kg to one decimal. */
export function toDisplay(lbs: number, unit: WeightUnit = getWeightUnit()): number {
  if (unit === 'lb') return lbs;
  return Math.round((lbs / LB_PER_KG) * 10) / 10;
}

/**
 * What the user typed, back to the stored unit. A kg entry snaps to the
 * nearest quarter pound: display rounds kg to 0.1 (≈0.11 lb), so a prescribed
 * 185 lbs shown as 83.9 kg and logged untouched comes back as exactly 185 —
 * the engine's "same load" reads stay exact instead of drifting by a decimal.
 */
export function fromDisplay(value: number, unit: WeightUnit = getWeightUnit()): number {
  if (unit === 'lb') return value;
  return Math.round(value * LB_PER_KG * 4) / 4;
}

export function unitLabelFor(unit: WeightUnit = getWeightUnit()): string {
  return unit === 'kg' ? 'kg' : 'lbs';
}

/** "190 lbs" / "86.2 kg" — THE weight formatter for labels and reason strings. */
export function fmtWeight(lbs: number, unit: WeightUnit = getWeightUnit()): string {
  return `${toDisplay(lbs, unit)} ${unitLabelFor(unit)}`;
}
