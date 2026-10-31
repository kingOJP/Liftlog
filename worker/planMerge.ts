// The training-journey document merge, shared by the worker (push) and the
// client (pull) so both ends make the same decision.
//
// The document is still last-write-wins as a whole — plans, blocks and the
// pending activation move together — but the athlete profile inside it has
// its own clock. Before this, saving the profile bumped the whole-document
// clock, so a casual "level up" tap on an offline device could reject a newer
// block activation made elsewhere while the program store still adopted that
// block's program: plan and program diverged. Now the two parts merge
// independently: the newer plans document wins, and the newer profile wins,
// whichever document it rides in on.
//
// Pure and dependency-free: it lives under worker/ only because the worker's
// project cannot reach into src/, while src/ can import from here.

export interface PlanDocLike {
  version: 1;
  plans: unknown[];
  pendingActivation?: unknown;
  profile?: { updatedAt: number };
  updatedAt: number;
}

export function isPlanDoc(value: unknown): value is PlanDocLike {
  if (value == null || typeof value !== 'object') return false;
  const d = value as Partial<PlanDocLike>;
  if (d.version !== 1 || !Array.isArray(d.plans) || typeof d.updatedAt !== 'number') return false;
  if (d.profile != null && (typeof d.profile !== 'object' || typeof d.profile.updatedAt !== 'number')) return false;
  return true;
}

function profileClock(doc: PlanDocLike | null): number {
  return doc?.profile?.updatedAt ?? -1;
}

/** The clock the whole document sorts by: the newer of its two parts. */
export function planDocClock(doc: PlanDocLike): number {
  return Math.max(doc.updatedAt, doc.profile?.updatedAt ?? 0);
}

/**
 * Merge an incoming document into the current one. `changed` is true when the
 * result differs from `current` (so the caller knows whether to write it).
 * Equal clocks keep the current copy.
 */
export function mergePlanDocs<T extends PlanDocLike>(
  current: T | null,
  incoming: T,
): { doc: T; changed: boolean } {
  if (current == null) return { doc: incoming, changed: true };

  const takePlans   = incoming.updatedAt > current.updatedAt;
  const takeProfile = profileClock(incoming) > profileClock(current);
  if (!takePlans && !takeProfile) return { doc: current, changed: false };

  const base    = takePlans ? incoming : current;
  const profile = takeProfile ? incoming.profile : current.profile;
  const doc = { ...base } as T;
  if (profile) doc.profile = profile;
  else delete doc.profile;
  return { doc, changed: true };
}
