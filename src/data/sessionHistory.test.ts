import { describe, it, expect, beforeEach } from 'vitest';
import { buildSnapshot } from './analytics';
import { snapshotPositions } from './progress';
import { expectedVariation, exerciseHistory } from './sessionHistory';
import type { Session, SetLog } from '../db/database';
import type { SetTechnique, Grip } from './variations';

beforeEach(() => localStorage.clear());

const DAY = 86_400_000;
const T0 = new Date('2026-06-01T12:00:00').getTime();

type Spec = Array<[number, number, SetTechnique?, Grip?]>; // weight, reps, technique, grip

function build(sessions: Spec[], exerciseId = 'flat-barbell-bench-press') {
  const rows: Session[] = [];
  const logs: SetLog[] = [];
  let id = 1;
  sessions.forEach((sets, i) => {
    const completedAt = T0 + i * 3 * DAY;
    rows.push({ id: i + 1, dayId: 1, weekNumber: 1, startedAt: completedAt - 3_600_000, completedAt });
    sets.forEach(([weight, reps, technique, grip], j) => {
      logs.push({
        id: id++, sessionId: i + 1, exerciseId, setNumber: j + 1, weight, reps, order: 0,
        ...(technique ? { technique } : {}), ...(grip ? { grip } : {}),
      });
    });
  });
  return buildSnapshot(rows, logs);
}

const BENCH = { id: 'flat-barbell-bench-press' };

describe('expectedVariation — how today\'s sets are expected to be done', () => {
  it('is the slot\'s prescribed variation when it has one', () => {
    const snap = build([[[200, 5, 'paused']]]);
    expect(expectedVariation({ ...BENCH, grip: 'close' }, snap)).toEqual({ grip: 'close' });
  });

  it('otherwise carries forward whatever the last session was done with', () => {
    const snap = build([
      [[200, 5], [200, 5]],
      [[185, 5, 'paused', 'close'], [185, 5, 'paused', 'close'], [185, 4, 'paused', 'close']],
    ]);
    expect(expectedVariation(BENCH, snap)).toEqual({ technique: 'paused', grip: 'close' });
  });

  it('reads the dominant style of the last session, ignoring its drop rows', () => {
    const snap = build([[[200, 8], [200, 8], [160, 10, 'drop'], [120, 12, 'drop']]]);
    expect(expectedVariation(BENCH, snap)).toEqual({});
  });

  it('is plain with no history', () => {
    expect(expectedVariation(BENCH, null)).toEqual({});
    expect(expectedVariation(BENCH, build([]))).toEqual({});
  });
});

describe('exerciseHistory — the sessions the engine compares', () => {
  it('never lets a drop or partial row reach the engine', () => {
    const snap = build([[[200, 8], [200, 8], [160, 10, 'drop'], [200, 3, 'partials']]]);
    const { history } = exerciseHistory(snap, BENCH.id, 4, snapshotPositions(snap), {});
    expect(history[0].sets.map(s => s.weight)).toEqual([200, 200]);
  });

  it('compares like with like: only sessions done the expected way, newest first', () => {
    const snap = build([
      [[200, 8], [200, 8]],                                   // touch-and-go
      [[185, 5, 'paused'], [185, 5, 'paused']],               // paused
      [[205, 8], [205, 7]],                                   // touch-and-go again
    ]);
    const paused = exerciseHistory(snap, BENCH.id, 4, snapshotPositions(snap), { technique: 'paused' });
    expect(paused.borrowed).toBe(false);
    expect(paused.history.map(h => h.sets[0].weight)).toEqual([185]);

    const plain = exerciseHistory(snap, BENCH.id, 4, snapshotPositions(snap), {});
    expect(plain.history.map(h => h.sets[0].weight)).toEqual([205, 200]);
  });

  it('borrows the plain sets the first time a variation is logged, and says so', () => {
    const snap = build([[[200, 8], [200, 8]]]);
    const out = exerciseHistory(snap, BENCH.id, 4, snapshotPositions(snap), { technique: 'paused', grip: 'close' });
    expect(out.borrowed).toBe(true);
    expect(out.history).toHaveLength(1);
  });

  it('is not "borrowed" when there is nothing to borrow — a first session is just a first session', () => {
    const snap = build([]);
    const out = exerciseHistory(snap, BENCH.id, 4, snapshotPositions(snap), { grip: 'wide' });
    expect(out).toEqual({ history: [], borrowed: false });
  });

  it('does not borrow when the expectation is plain and nothing matches — an empty history is honest there', () => {
    const snap = build([[[185, 5, 'paused'], [185, 5, 'paused']]]);
    const out = exerciseHistory(snap, BENCH.id, 4, snapshotPositions(snap), {});
    expect(out.borrowed).toBe(false);
    expect(out.history).toHaveLength(0);
  });

  it('respects the depth cap', () => {
    const snap = build([[[100, 8]], [[105, 8]], [[110, 8]], [[115, 8]]]);
    const out = exerciseHistory(snap, BENCH.id, 2, snapshotPositions(snap), {});
    expect(out.history.map(h => h.sets[0].weight)).toEqual([115, 110]);
  });
});
