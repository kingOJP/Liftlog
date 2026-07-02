// Legacy exercise IDs from old builds (the -d1/-d2/-d4 per-day suffixes) mapped
// to their canonical, unified IDs. This is the single source of truth for that
// remap — used both to migrate set logs in IndexedDB (database.ts) and to
// canonicalize the stored workout program (programStore.ts). Keeping the program
// and the logs on the same IDs is what stops finished workouts from creating
// duplicate, unclassified "-d2" exercises.
export const LEGACY_ID_MAP: Record<string, string> = {
  'cable-lateral-raises-d1': 'cable-lateral-raises',
  'face-pulls-d2':           'face-pulls',
  'face-pulls-d4':           'face-pulls',
  'lat-pulldown-d2':         'lat-pull-down',
  'cable-pull-down-d2':      'straight-arm-pulldowns',
  'tricep-pushdowns-d4':     'tricep-cable-pushdown',
};

export function canonicalizeId(id: string): string {
  return LEGACY_ID_MAP[id] ?? id;
}
