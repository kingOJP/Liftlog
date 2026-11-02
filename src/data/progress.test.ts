import { describe, it, expect, beforeEach } from 'vitest';
import { buildSnapshot } from './analytics';
import type { Session, SetLog } from '../db/database';
import {
  assessSnapshot,
  categoryProgress,
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

describe('categoryProgress — movement-pattern rollup', () => {
  it('buckets real catalog exercises by movement category, not muscle', () => {
    const snap = build([
      { day: 1, sets: [...s('barbell-back-squat', 200, 8), ...s('incline-barbell-press', 135, 8)] },
      { day: 1, sets: [...s('barbell-back-squat', 205, 8), ...s('incline-barbell-press', 140, 8)] },
      { day: 1, sets: [...s('barbell-back-squat', 210, 8), ...s('incline-barbell-press', 145, 8)] },
    ]);
    const categories = categoryProgress(snap, 'strength');
    const squat = categories.find(c => c.category === 'Squat');
    const push = categories.find(c => c.category === 'Push');
    expect(squat?.exerciseCount).toBe(1);
    expect(push?.exerciseCount).toBe(1);
    expect((squat?.progressing ?? 0) + (squat?.steady ?? 0)).toBe(1);
  });

  it('excludes exercises with no resolvable movement pattern', () => {
    const snap = build([
      { day: 1, sets: s('some-unclassified-custom-lift', 50, 10) },
      { day: 1, sets: s('some-unclassified-custom-lift', 55, 10) },
    ]);
    const categories = categoryProgress(snap, 'general');
    const total = categories.reduce((sum, c) => sum + c.exerciseCount, 0);
    expect(total).toBe(0);
  });
});


describe('planned easy weeks (audit F1)', () => {
  // Three climbing sessions, then a deload-week session at 90% load. The
  // deload is the plan working, not the lift declining.
  const snap = build([
    { day: 1, sets: s('bench', 100, 8) },
    { day: 1, sets: s('bench', 105, 8) },
    { day: 1, sets: s('bench', 110, 8) },
    { day: 1, sets: s('bench', 99, 8) },
  ]);
  const deloadFrom = T0 + 3 * 3 * DAY - DAY;
  const phaseOf = (ts: number) => (ts >= deloadFrom ? 'deload' as const : 'accumulation' as const);

  it('never reads a deload-week session as a decline', () => {
    const blind = assessSnapshot(snap, 'strength').get('bench')!;
    const aware = assessSnapshot(snap, 'strength', () => true, phaseOf).get('bench')!;
    expect(blind.status).not.toBe('progressing');
    expect(aware.status).toBe('progressing');
    expect(aware.e1rmChangePct!).toBeGreaterThan(0);
    expect(aware.evidence.join(' ')).toMatch(/easy-week/);
  });

  it('a session in a planned easy week can never be a PR', () => {
    const heavy = build([
      { day: 1, sets: s('bench', 100, 8) },
      { day: 1, sets: s('bench', 120, 8) },
    ]);
    const all = (ts: number) => (ts > T0 ? 'intro' as const : null);
    const points = exercisePointSeries(heavy, () => true, all).get('bench')!;
    expect(points[1].easy).toBe(true);
    expect(points[1].weightPR).toBe(false);
  });
});

describe('rep PRs are judged against sessions before this one (audit M11)', () => {
  it('a first session at a new weight sets no rep PR, whatever its sets do', () => {
    const snap = build([
      { day: 1, sets: [['bench', 100, 8], ['bench', 100, 10], ['bench', 100, 12]] },
    ]);
    const [p] = exercisePointSeries(snap).get('bench')!;
    expect(p.repPR).toBe(false);
    expect(p.prLabels).toEqual([]);
  });

  it('set 2 beating set 1 inside the same session is not a PR', () => {
    const snap = build([
      { day: 1, sets: [['bench', 100, 10], ['bench', 100, 10]] },
      { day: 1, sets: [['bench', 100, 8], ['bench', 100, 9]] },
    ]);
    const pts = exercisePointSeries(snap).get('bench')!;
    expect(pts[1].repPR).toBe(false);
  });

  it('beating last session\'s best at that weight is', () => {
    const snap = build([
      { day: 1, sets: [['bench', 100, 10], ['bench', 100, 10]] },
      { day: 1, sets: [['bench', 100, 11], ['bench', 100, 9]] },
    ]);
    const pts = exercisePointSeries(snap).get('bench')!;
    expect(pts[1].repPR).toBe(true);
  });
});

// Set variations: a trend is read like for like. Moving a lift from
// touch-and-go to paused reps (or to a new grip) drops the numbers for reasons
// that are not weakness, and moving back lifts them for reasons that are not
// a PR. Extension rows (drops, partials) are more set, not a new one, and
// never enter a session's point.
describe('set variations in the progress read', () => {
  type V = { technique?: 'paused' | 'tempo' | 'deficit' | 'drop' | 'rest-pause' | 'partials'; grip?: 'close' | 'wide' };
  function buildV(entries: Array<{ sets: Array<[number, number, V?]> }>, exerciseId = 'flat-barbell-bench-press') {
    const sessions: Session[] = [];
    const setLogs: SetLog[] = [];
    let logId = 1;
    entries.forEach((e, i) => {
      const completedAt = T0 + i * 3 * DAY;
      sessions.push({ id: i + 1, dayId: 1, weekNumber: 1, startedAt: completedAt - 3_600_000, completedAt });
      e.sets.forEach(([weight, reps, v], j) => {
        setLogs.push({ id: logId++, sessionId: i + 1, exerciseId, setNumber: j + 1, weight, reps, order: 0, ...(v ?? {}) });
      });
    });
    return buildSnapshot(sessions, setLogs);
  }
  const flat = (w: number, r: number, v?: V): Array<[number, number, V?]> => [[w, r, v], [w, r, v], [w, r, v]];
  const P: V = { technique: 'paused' };

  it('does not call a lift declining because it switched to paused reps', () => {
    const snap = buildV([
      { sets: flat(200, 8) }, { sets: flat(205, 8) }, { sets: flat(210, 8) },
      { sets: flat(185, 5, P) }, // the same strength, paused — ~12% lower numbers
    ]);
    const p = assessSnapshot(snap, 'strength').get('flat-barbell-bench-press')!;
    expect(p.status).not.toBe('declining');
    expect(p.evidence.some(e => /switched to paused/.test(e))).toBe(true);
  });

  it('judges a paused block against its own paused sessions once there are enough', () => {
    const snap = buildV([
      { sets: flat(210, 8) },
      { sets: flat(185, 5, P) }, { sets: flat(190, 5, P) }, { sets: flat(195, 5, P) },
    ]);
    const p = assessSnapshot(snap, 'strength').get('flat-barbell-bench-press')!;
    expect(p.status).toBe('progressing');
    expect(p.evidence.some(e => /paused sessions only/.test(e))).toBe(true);
  });

  it('switching back from paused to touch-and-go is not a weight PR', () => {
    const snap = buildV([
      { sets: flat(210, 8) },
      { sets: flat(185, 5, P) }, { sets: flat(190, 5, P) },
      { sets: flat(205, 8) }, // lighter than the lift's own touch-and-go best
    ]);
    const points = exercisePointSeries(snap).get('flat-barbell-bench-press')!;
    expect(points[3].weightPR).toBe(false);
  });

  it('a new grip is its own trend too', () => {
    const snap = buildV([
      { sets: flat(150, 10) }, { sets: flat(155, 10) }, { sets: flat(160, 10) },
      { sets: flat(130, 10, { grip: 'wide' }) },
    ], 'lat-pull-down');
    const p = assessSnapshot(snap, 'hypertrophy').get('lat-pull-down')!;
    expect(p.status).not.toBe('declining');
  });

  it('a drop set tacked on one week does not read as lost volume the next', () => {
    const snap = buildV([
      { sets: [...flat(100, 10), [70, 12, { technique: 'drop' }], [50, 12, { technique: 'drop' }]] },
      { sets: flat(100, 10) },
      { sets: flat(100, 10) },
    ], 'cable-fly');
    const points = exercisePointSeries(snap).get('cable-fly')!;
    expect(points[0].sets).toHaveLength(3);
    expect(points[0].tonnage).toBe(points[1].tonnage);
    const p = assessSnapshot(snap, 'hypertrophy').get('cable-fly')!;
    expect(p.status).not.toBe('declining');
  });

  it('a heavy partial is never a weight PR', () => {
    const snap = buildV([
      { sets: flat(200, 5) },
      { sets: [...flat(200, 5), [250, 3, { technique: 'partials' }]] },
    ]);
    const points = exercisePointSeries(snap).get('flat-barbell-bench-press')!;
    expect(points[1].weightPR).toBe(false);
    expect(points[1].maxWeight).toBe(200);
  });
});
