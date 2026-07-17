// Pure merge planner for session sync.
//
// Sync treats each workout session as an atomic document: a session and its
// sets always travel (and win or lose) together, identified by an immutable
// GUID. Merging happens per session — newer `updatedAt` wins — so two devices
// logging different workouts both keep theirs, and an edit made on one device
// overwrites only that one session everywhere else. Tombstones make deletions
// stick. This module is pure (no IndexedDB) so the merge rules are unit-tested
// directly; db/database.ts applies the resulting plan.

import type { Session, SetLog } from '../db/database';

export interface SessionDoc {
  guid: string;
  dayId: number;
  weekNumber: number;
  startedAt: number;
  completedAt?: number;
  updatedAt: number;
  sets: Array<Pick<SetLog, 'exerciseId' | 'setNumber' | 'weight' | 'reps' | 'order' | 'warmup'>>;
}

export interface SessionMergePlan {
  /** Local session ids to delete (tombstoned on the server) */
  deleteLocalIds: number[];
  /** Server docs that replace an existing local session (server copy is newer) */
  replace: Array<{ localId: number; doc: SessionDoc }>;
  /** Server docs with no local counterpart — insert as new sessions */
  insert: SessionDoc[];
}

// Sessions created before sync-v2 have no stored GUID. Deriving it from
// startedAt is deterministic, so every device holding a copy of the same
// legacy session (spread by the old full-replace sync) computes the SAME
// identity and the copies merge instead of duplicating.
export function sessionGuid(s: Session): string {
  return s.guid ?? `legacy-${s.startedAt}`;
}

// Legacy sessions have no updatedAt; their last meaningful write was completion.
export function sessionUpdatedAt(s: Session): number {
  return s.updatedAt ?? s.completedAt ?? s.startedAt;
}

export function planSessionMerge(
  local: Session[],
  incoming: SessionDoc[],
  tombstones: Set<string>,
): SessionMergePlan {
  const localByGuid = new Map(local.map(s => [sessionGuid(s), s]));

  const plan: SessionMergePlan = { deleteLocalIds: [], replace: [], insert: [] };

  for (const s of local) {
    if (tombstones.has(sessionGuid(s))) plan.deleteLocalIds.push(s.id!);
  }

  for (const doc of incoming) {
    if (tombstones.has(doc.guid)) continue;
    const existing = localByGuid.get(doc.guid);
    if (!existing) {
      plan.insert.push(doc);
    } else if (doc.updatedAt > sessionUpdatedAt(existing)) {
      plan.replace.push({ localId: existing.id!, doc });
    }
    // else: local copy is same or newer — keep it; the next push uploads it
  }

  return plan;
}

export function mergePlanIsEmpty(plan: SessionMergePlan): boolean {
  return plan.deleteLocalIds.length === 0 && plan.replace.length === 0 && plan.insert.length === 0;
}
