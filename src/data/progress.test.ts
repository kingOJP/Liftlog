import { describe, it, expect, beforeEach } from 'vitest';
import { buildSnapshot } from './analytics';
import type { Session, SetLog } from '../db/database';
import {
  assessSnapshot,
  exercisePointSeries,
  sessionExercisePositions,
} from './progress';

beforeEach(() => localStorage.clear());

const DAY = 86_400_000;
const T0 = new Date('2026-05-01T12:00:00').getTime();

// Build a snapshot from a compact spec: one session per entry.
// entry = { day, sets: [[exerciseId, weight, reps, order?], ...] }
interface Entry { day: number; sets: Array<[string, number, number, number?]>; }

function build(entries: Entry[]) {
  const sessions: Session[] = [];
  const setLogs: SetLog[] = [];
  let logId = 1;
  entries.forEach((e, i) => {
    const completedAt = T0 + i * 3 * DAY;
    sessions.push({ id: i + 1, dayId: e.day, weekNumber: 1, startedAt: completedAt - 3_600_000, completedAt });
    e.sets.forEach(([exerciseId, weight, reps, order], j) => {
      setLogs.push({ id: logId++, sessionId: i + 1, exerciseId, setNumber: j + 1, weight, reps, order });
    });
  });
  return buildSnapshot(sessions, setLogs);
}

// Three flat sets of one exercise
const s = (id: string, w: number, r: number, order?: number): [string, number, number, number?][] =>
  [[id, w, r, order], [id, w, r, order], [id, w, r, order]];

describe('sessionExercisePositions', () => {
  it('uses the explicit order field when present', () => {
    const logs: SetLog[] = [
      { id: 1, sessionId: 1, exerciseId: 'bench', setNumber: 1, weight: 100, reps: 8, order: 2 },
      { id: 2, sessionId: 1, exerciseId: 'ohp',   setNumber: 1, weight: 60,  reps: 8, order: 0 },
      { id: 3, sessionId: 1, exerciseId: 'fly',   setNumber: 1, weight: 30,  reps: 12, order: 1 },
    ];
    const pos = sessionExercisePositions(logs);
    expect(pos.get('ohp')).toBe(0);
    expect(pos.get('fly')).toBe(1);
    expect(pos.get('bench')).toBe(2);
  });

  it('falls back to set-log insertion order when order is absent', () => {
    const logs: SetLog[] = [
      { id: 5, sessionId: 1, exerciseId: 'bench', setNumber: 1, weight: 100, reps: 8 },
      { id: 6, sessionId: 1, exerciseId: 'ohp',   setNumber: 1, weight: 60,  reps: 8 },
    ];
    const pos = sessionExercisePositions(logs);
    expect(pos.get('bench')).toBe(0);
    expect(pos.get('ohp')).toBe(1);
  });
});

describe('PR detection', () => {
  it('flags weight PRs and rep PRs against running all-time bests', () => {
    const snap = build([
      { day: 1, sets: s('bench', 100, 8) },
      { day: 1, sets: s('bench', 105, 8) },  // weight PR
      { day: 1, sets: s('bench', 105, 9) },  // rep PR at 105
    ]);
    const points = exercisePointSeries(snap).get('bench')!;
    expect(points[0].weightPR).toBe(false); // first session — no baseline
    expect(points[1].weightPR).toBe(true);
    expect(points[2].repPR).toBe(true);
    expect(points[2].prLabels.some(l => /Rep PR/.test(l))).toBe(true);
  });
});

describe('assessSnapshot — goal-weighted multi-signal', () => {
  it('marks a climbing lift as progressing (weight + volume + PRs)', () => {
    const snap = build([
      { day: 1, sets: s('bench', 100, 8) },
      { day: 1, sets: s('bench', 105, 8) },
      { day: 1, sets: s('bench', 110, 8) },
      { day: 1, sets: s('bench', 115, 8) },
    ]);
    const a = assessSnapshot(snap, 'hypertrophy').get('bench')!;
    expect(a.status).toBe('progressing');
    expect(a.weightPRs).toBeGreaterThan(0);
    expect(a.e1rmChangePct!).toBeGreaterThan(0);
  });

  it('marks flat identical sessions as stalled', () => {
    const snap = build([
      { day: 1, sets: s('bench', 100, 8) },
      { day: 1, sets: s('bench', 100, 8) },
      { day: 1, sets: s('bench', 100, 8) },
    ]);
    const a = assessSnapshot(snap, 'strength').get('bench')!;
    expect(a.status).toBe('stalled');
    expect(a.weightPRs + a.repPRs).toBe(0);
  });

  it('credits volume progress even when e1RM is flat (added a set at the same load)', () => {
    // e1RM identical every session, but tonnage climbs as sets are added.
    const snap = build([
      { day: 1, sets: [['bench', 100, 8], ['bench', 100, 8]] },
      { day: 1, sets: [['bench', 100, 8], ['bench', 100, 8], ['bench', 100, 8]] },
      { day: 1, sets: [['bench', 100, 8], ['bench', 100, 8], ['bench', 100, 8], ['bench', 100, 8]] },
    ]);
    const strength = assessSnapshot(snap, 'strength').get('bench')!;
    const hypertrophy = assessSnapshot(snap, 'hypertrophy').get('bench')!;
    expect(strength.e1rmChangePct).toBe(0);
    expect(hypertrophy.volumeChangePct!).toBeGreaterThan(0);
    // Volume-led goal rewards the added work more than the strength-led goal
    expect(hypertrophy.score).toBeGreaterThan(strength.score);
    expect(hypertrophy.status).toBe('progressing');
  });

  it('does not penalize a session trained much later in the workout than usual', () => {
    // Bench trained 2nd for three sessions climbing, then 4th (fatigued) and
    // lower — that last session is excluded from the trend endpoints. Every
    // exercise carries an explicit order, as WorkoutView writes them.
    const snap = build([
      { day: 1, sets: [['ohp', 60, 8, 0], ['bench', 100, 8, 1]] },
      { day: 1, sets: [['ohp', 60, 8, 0], ['bench', 105, 8, 1]] },
      { day: 1, sets: [['ohp', 60, 8, 0], ['bench', 110, 8, 1]] },
      // benches taken — bench pushed to slot 4, numbers dip on tired muscles
      { day: 1, sets: [['ohp', 60, 8, 0], ['fly', 30, 12, 1], ['row', 80, 8, 2], ['bench', 95, 8, 3]] },
    ]);
    const a = assessSnapshot(snap, 'strength').get('bench')!;
    expect(a.positionShifted).toBe(true);
    // Verdict reflects the fresh sessions (climbing), not the fatigued dip
    expect(a.status).toBe('progressing');
    expect(a.evidence.some(e => /later in the workout/.test(e))).toBe(true);
  });

  it('treats holding strength in a deficit as a win for fat-loss', () => {
    const snap = build([
      { day: 1, sets: s('bench', 100, 8) },
      { day: 1, sets: s('bench', 100, 8) },
      { day: 1, sets: s('bench', 100, 8) },
    ]);
    const fatLoss = assessSnapshot(snap, 'fat-loss').get('bench')!;
    const strength = assessSnapshot(snap, 'strength').get('bench')!;
    // Same flat data reads worse for a strength goal than a fat-loss goal
    expect(fatLoss.score).toBeGreaterThan(strength.score);
    expect(fatLoss.status).not.toBe('declining');
  });

  it('progresses bodyweight work on reps alone (no e1RM)', () => {
    const snap = build([
      { day: 1, sets: [['pushup', 0, 15], ['pushup', 0, 15]] },
      { day: 1, sets: [['pushup', 0, 18], ['pushup', 0, 18]] },
      { day: 1, sets: [['pushup', 0, 20], ['pushup', 0, 20]] },
    ]);
    const a = assessSnapshot(snap, 'general').get('pushup')!;
    expect(a.e1rmChangePct).toBeNull();
    expect(a.volumeChangePct!).toBeGreaterThan(0);
    expect(a.status).toBe('progressing');
  });

  it('marks a declining lift', () => {
    const snap = build([
      { day: 1, sets: s('bench', 120, 8) },
      { day: 1, sets: s('bench', 110, 8) },
      { day: 1, sets: s('bench', 100, 8) },
    ]);
    const a = assessSnapshot(snap, 'strength').get('bench')!;
    expect(a.status).toBe('declining');
    expect(a.e1rmChangePct!).toBeLessThan(0);
  });
});
