import { describe, it, expect } from 'vitest';
import { planSessionMerge, sessionGuid, sessionUpdatedAt } from './syncMerge';
import type { SessionDoc } from './syncMerge';
import type { Session } from '../db/database';

function doc(guid: string, updatedAt: number, overrides: Partial<SessionDoc> = {}): SessionDoc {
  return {
    guid,
    dayId: 1,
    weekNumber: 3,
    startedAt: 1_000,
    completedAt: 2_000,
    updatedAt,
    sets: [{ exerciseId: 'face-pulls', setNumber: 1, weight: 50, reps: 15 }],
    ...overrides,
  };
}

function local(id: number, guid: string | undefined, updatedAt?: number, startedAt = 1_000): Session {
  return { id, guid, dayId: 1, weekNumber: 3, startedAt, completedAt: 2_000, updatedAt };
}

describe('sessionGuid / sessionUpdatedAt', () => {
  it('derives a deterministic legacy guid from startedAt when none is stored', () => {
    expect(sessionGuid(local(1, undefined, undefined, 42))).toBe('legacy-42');
    expect(sessionGuid(local(1, 'abc'))).toBe('abc');
  });

  it('falls back to completedAt then startedAt for legacy updatedAt', () => {
    expect(sessionUpdatedAt(local(1, 'a', 99))).toBe(99);
    expect(sessionUpdatedAt(local(1, 'a'))).toBe(2_000);
    expect(sessionUpdatedAt({ id: 1, dayId: 1, weekNumber: 1, startedAt: 7 })).toBe(7);
  });
});

describe('planSessionMerge', () => {
  it('inserts server sessions that do not exist locally', () => {
    const plan = planSessionMerge([local(1, 'a', 10)], [doc('a', 10), doc('b', 20)], new Set());
    expect(plan.insert.map(d => d.guid)).toEqual(['b']);
    expect(plan.replace).toHaveLength(0);
    expect(plan.deleteLocalIds).toHaveLength(0);
  });

  it('keeps local-only sessions (a pull can never drop a local workout)', () => {
    const plan = planSessionMerge([local(1, 'local-only', 10)], [], new Set());
    expect(plan.deleteLocalIds).toHaveLength(0);
    expect(plan.insert).toHaveLength(0);
    expect(plan.replace).toHaveLength(0);
  });

  it('replaces the local copy only when the server copy is newer', () => {
    const locals = [local(1, 'a', 10), local(2, 'b', 30)];
    const incoming = [doc('a', 20), doc('b', 20)];
    const plan = planSessionMerge(locals, incoming, new Set());
    expect(plan.replace).toEqual([{ localId: 1, doc: incoming[0] }]);
  });

  it('treats equal updatedAt as in-sync (no churn on repeated pulls)', () => {
    const plan = planSessionMerge([local(1, 'a', 10)], [doc('a', 10)], new Set());
    expect(plan.replace).toHaveLength(0);
    expect(plan.insert).toHaveLength(0);
  });

  it('matches legacy sessions by derived guid', () => {
    const legacyLocal = local(1, undefined, undefined, 555); // guid legacy-555, updatedAt 2000
    const plan = planSessionMerge([legacyLocal], [doc('legacy-555', 3_000)], new Set());
    expect(plan.replace).toEqual([{ localId: 1, doc: doc('legacy-555', 3_000) }]);
  });

  it('deletes tombstoned local sessions and never inserts tombstoned docs', () => {
    const plan = planSessionMerge(
      [local(1, 'dead', 10), local(2, 'alive', 10)],
      [doc('dead', 99), doc('new-dead', 99)],
      new Set(['dead', 'new-dead']),
    );
    expect(plan.deleteLocalIds).toEqual([1]);
    expect(plan.insert).toHaveLength(0);
    expect(plan.replace).toHaveLength(0);
  });

  it('two devices logging on the same day both keep their sessions', () => {
    // Device A holds its own workout; server has device B's from the same day
    const deviceA = [local(1, 'session-A', 100, 9_000)];
    const fromB = [doc('session-B', 110, { startedAt: 9_500 })];
    const plan = planSessionMerge(deviceA, fromB, new Set());
    expect(plan.insert.map(d => d.guid)).toEqual(['session-B']); // B arrives
    expect(plan.deleteLocalIds).toHaveLength(0);                 // A survives
  });
});
