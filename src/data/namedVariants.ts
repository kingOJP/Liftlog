// Named variants: the exercise names lifters use for an existing exercise done
// a particular way — "Wide Grip Lat Pulldown", "Pendlay Row", "Paused Squat",
// "Deficit Deadlift".
//
// Each of these is a catalog exercise plus a set-variation modifier
// (variations.ts), so none of them is a catalog entry of its own. Making them
// separate exercises would split one lift's history across several ids (the
// wide-grip pulldowns would never count toward the pulldown's trend), give the
// substitution engine near-duplicates to suggest for each other, and duplicate
// the emphasis shift variations.ts already applies. Instead a named variant
// resolves to its base exercise with the modifier pinned on the program slot
// (Exercise.technique / Exercise.grip): the card pre-selects it, the engines
// compare it like for like, and the volume accounting sees the shift.
//
// Compiled, app-owned, never synced — the same footing as aliases. Only
// modifiers the base exercise's movement pattern actually offers
// (gripOptionsFor / techniqueOptionsFor) are allowed; catalog.test.ts checks
// that, and that no variant name collides with a catalog name or alias.
//
// Not expressible yet, so deliberately absent: STANCE variants (sumo leg
// press, narrow-stance hack squat — see docs/set-variations.md "Not done") and
// incline/decline ANGLE variants, which stay separate catalog exercises
// because the angle changes the prime mover's head (Upper vs Lower Chest).

import type { Exercise } from './program';
import type { Grip, SetTechnique } from './variations';
import { variationLabel } from './variations';
import { catalogDefFor, slugifyName } from './exercises';

export interface NamedVariant {
  /** the name a lifter would type or read on a program */
  name: string;
  /** the catalog exercise it is a way of doing */
  exerciseId: string;
  technique?: SetTechnique;
  grip?: Grip;
  /** other spellings of the same variant */
  aliases?: string[];
}

export const NAMED_VARIANTS: NamedVariant[] = [
  // Pulldowns and pull-ups — grip is the whole difference
  { name: 'Wide Grip Lat Pulldown',    exerciseId: 'lat-pull-down', grip: 'wide', aliases: ['Wide Grip Pulldown'] },
  { name: 'Close Grip Lat Pulldown',   exerciseId: 'lat-pull-down', grip: 'close', aliases: ['V Bar Pulldown', 'Close Grip Pulldown'] },
  { name: 'Neutral Grip Lat Pulldown', exerciseId: 'lat-pull-down', grip: 'neutral', aliases: ['Neutral Grip Pulldown'] },
  { name: 'Reverse Grip Lat Pulldown', exerciseId: 'lat-pull-down', grip: 'underhand', aliases: ['Underhand Pulldown', 'Supinated Pulldown'] },
  { name: 'Wide Grip Pull Up',         exerciseId: 'pull-ups', grip: 'wide' },
  { name: 'Neutral Grip Pull Up',      exerciseId: 'pull-ups', grip: 'neutral', aliases: ['Hammer Grip Pull Up', 'Parallel Grip Pull Up'] },

  // Rows
  { name: 'Pendlay Row',               exerciseId: 'barbell-rows', technique: 'paused', aliases: ['Dead Stop Row'] },
  { name: 'Yates Row',                 exerciseId: 'barbell-rows', grip: 'underhand', aliases: ['Underhand Barbell Row', 'Reverse Grip Barbell Row'] },
  { name: 'Wide Grip Cable Row',       exerciseId: 'seated-cable-row', grip: 'wide', aliases: ['Wide Grip Seated Row'] },

  // Pressing
  { name: 'Wide Grip Bench Press',     exerciseId: 'flat-barbell-bench-press', grip: 'wide' },
  { name: 'Paused Bench Press',        exerciseId: 'flat-barbell-bench-press', technique: 'paused', aliases: ['Pause Bench Press', 'Competition Pause Bench'] },
  { name: 'Neutral Grip Dumbbell Press', exerciseId: 'dumbbell-bench-press', grip: 'neutral', aliases: ['Hammer Grip Dumbbell Press'] },
  { name: 'Neutral Grip Dumbbell Shoulder Press', exerciseId: 'seated-db-overhead-press', grip: 'neutral' },
  { name: 'Diamond Push Up',           exerciseId: 'push-ups', grip: 'close', aliases: ['Close Grip Push Up'] },
  { name: 'Deficit Push Up',           exerciseId: 'push-ups', technique: 'deficit' },
  { name: 'Reverse Grip Pushdown',     exerciseId: 'cable-pushdown', grip: 'underhand', aliases: ['Underhand Pushdown'] },

  // Squats, hinges, lunges — rep style and range of motion
  { name: 'Paused Squat',              exerciseId: 'barbell-back-squat', technique: 'paused', aliases: ['Pause Squat'] },
  { name: 'Tempo Squat',               exerciseId: 'barbell-back-squat', technique: 'tempo' },
  { name: 'Deficit Deadlift',          exerciseId: 'conventional-deadlift', technique: 'deficit' },
  { name: 'Paused Deadlift',           exerciseId: 'conventional-deadlift', technique: 'paused' },
  { name: 'Deficit Romanian Deadlift', exerciseId: 'romanian-deadlifts', technique: 'deficit', aliases: ['Deficit RDL'] },
  { name: 'Deficit Reverse Lunge',     exerciseId: 'dumbbell-reverse-lunge', technique: 'deficit' },

  // Curls
  { name: 'Rope Hammer Curl',          exerciseId: 'cable-curls', grip: 'neutral', aliases: ['Cable Hammer Curl'] },
  { name: 'Wide Grip Barbell Curl',    exerciseId: 'barbell-curl', grip: 'wide' },
  { name: 'Close Grip EZ Bar Curl',    exerciseId: 'ez-bar-curls', grip: 'close' },
];

const BY_SLUG = new Map<string, NamedVariant>();
for (const v of NAMED_VARIANTS) {
  for (const n of [v.name, ...(v.aliases ?? [])]) BY_SLUG.set(slugifyName(n), v);
}

/** The named variant a typed name refers to (its name or an alias), or null. */
export function namedVariantFor(name: string): NamedVariant | null {
  const slug = slugifyName(name);
  return slug ? (BY_SLUG.get(slug) ?? null) : null;
}

/** "Lat Pull Down · wide grip" — what a variant is, for the picker row. */
export function namedVariantDetail(v: NamedVariant): string {
  const base = catalogDefFor(v.exerciseId)?.name ?? v.exerciseId;
  const mod = variationLabel({ technique: v.technique, grip: v.grip });
  return mod ? `${base} · ${mod}` : base;
}

/** Pin the variant's modifier on a slot already dosed for its base exercise. */
export function applyNamedVariant(slot: Exercise, v: NamedVariant): Exercise {
  return {
    ...slot,
    ...(v.technique ? { technique: v.technique } : {}),
    ...(v.grip ? { grip: v.grip } : {}),
  };
}
