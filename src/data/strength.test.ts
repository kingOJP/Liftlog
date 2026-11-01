import { describe, it, expect } from 'vitest';
import { buildSnapshot } from './analytics';
import type { Session, SetLog } from '../db/database';
import {
  bestLoggedMax, currentMax, e1rmSeriesFor, etaLabel, goalProgress, loadBandFor,
  pctOfMaxForReps, percentBandFor, programLoadsFor, projectGoal, strengthTrend,
  EXPECTED_WEEKLY_GAIN_PCT,
} from './strength';
import type { OneRepMax } from './strength';

const NOW = new Date('2026-07-01T12:00:00').getTime();
const DAY = 86_400_000;
const WEEK = 7 * DAY;

// A history of one exercise: each entry is a session `weeksAgo` with the given sets.
function history(exerciseId: string, entries: { weeksAgo: number; sets: [number, number][] }[]) {
  const sessions: Session[] = [];
  const setLogs: SetLog[] = [];
  entries.forEach((e, i) => {
    const completedAt = NOW - e.weeksAgo * WEEK;
    sessions.push({ id: i + 1, dayId: 1, weekNumber: 1, startedAt: completedAt - 3_600_000, completedAt });
    e.sets.forEach(([weight, reps], s) => {
      setLogs.push({ id: i * 10 + s, sessionId: i + 1, exerciseId, setNumber: s + 1, weight, reps });
    });
  });
  return buildSnapshot(sessions, setLogs);
}

describe('%1RM math', () => {
  it('matches the standard rep-max table within a couple of points', () => {
    expect(Math.round(pctOfMaxForReps(1) * 100)).toBe(97);
    expect(Math.round(pctOfMaxForReps(5) * 100)).toBe(86);
    expect(Math.round(pctOfMaxForReps(10) * 100)).toBe(75);
    expect(Math.round(pctOfMaxForReps(12) * 100)).toBe(71);
  });

  it('turns a rep range into a shaded percent band, lighter end first', () => {
    const band = percentBandFor({ repLow: 8, repHigh: 12 })!;
    expect(band.low).toBeLessThan(band.high);
    expect(band.low).toBe(68);   // 71% × 0.95
    expect(band.high).toBe(75);  // 79% × 0.95
  });

  it('has no band for an unprescribed slot', () => {
    expect(percentBandFor({})).toBeNull();
    expect(loadBandFor(300, {})).toBeNull();
  });

  it('prescribes a working load snapped down to what the equipment loads in', () => {
    // 300 lb 1RM, 8–12 → 300/1.4 × 0.95 = 203.6 → barbell increment 5 → 200
    const band = loadBandFor(300, { repLow: 8, repHigh: 12 }, 'Barbell')!;
    expect(band.working).toBe(200);
    expect(band.pct.low).toBe(68);
    // and a dumbbell rack can't do 2.5s at light loads
    const db = loadBandFor(60, { repLow: 8, repHigh: 12 }, 'Dumbbell')!;
    expect(db.working % 5).toBe(0);
  });

  it('lists every slot in the program that carries the lift, with its loads', () => {
    const program = [
      { id: 1, label: 'Day 1', muscleGroups: 'Legs', exercises: [{ id: 'squat', name: 'Squat', sets: 4, repLow: 4, repHigh: 6 }] },
      { id: 2, label: 'Day 2', muscleGroups: 'Legs', exercises: [{ id: 'squat', name: 'Squat', sets: 3, repLow: 8, repHigh: 12 }, { id: 'rdl', name: 'RDL', sets: 3 }] },
    ];
    const rows = programLoadsFor('squat', 300, program, 'Barbell');
    expect(rows).toHaveLength(2);
    expect(rows[0].band!.working).toBeGreaterThan(rows[1].band!.working);
    expect(programLoadsFor('rdl', 300, program)[0].band).toBeNull();
  });
});

describe('log-derived evidence', () => {
  it('reads the best valid estimate and ignores high-rep sets', () => {
    const snap = history('bench', [
      { weeksAgo: 1, sets: [[185, 8], [185, 7]] },
      { weeksAgo: 2, sets: [[135, 20]] }, // 135 × 20 would be a 225 "e1RM" — not valid
    ]);
    const best = bestLoggedMax(snap, 'bench')!;
    expect(best.weight).toBe(185);
    expect(best.reps).toBe(8);
    expect(Math.round(best.e1rm)).toBe(234);
  });

  it('returns null with nothing logged for the lift', () => {
    expect(bestLoggedMax(history('bench', []), 'bench')).toBeNull();
    expect(strengthTrend(history('bench', []), 'bench', NOW)).toBeNull();
  });

  it('fits a weekly rate from the recent sessions', () => {
    // +5 lbs a week at 8 reps: 185 → 200 across four weeks
    const snap = history('bench', [
      { weeksAgo: 1, sets: [[200, 8]] },
      { weeksAgo: 2, sets: [[195, 8]] },
      { weeksAgo: 3, sets: [[190, 8]] },
      { weeksAgo: 4, sets: [[185, 8]] },
    ]);
    expect(e1rmSeriesFor(snap, 'bench')).toHaveLength(4);
    const trend = strengthTrend(snap, 'bench', NOW)!;
    expect(trend.points).toBe(4);
    // 5 lbs/week at 8 reps is ~6.3 e1RM lbs/week on a ~253 e1RM ≈ 2.5% a week
    expect(trend.ratePctPerWeek).toBeGreaterThan(2.3);
    expect(trend.ratePctPerWeek).toBeLessThan(2.7);
  });

  it('refuses to call two sessions a trend', () => {
    const snap = history('bench', [
      { weeksAgo: 1, sets: [[200, 8]] },
      { weeksAgo: 4, sets: [[185, 8]] },
    ]);
    expect(strengthTrend(snap, 'bench', NOW)).toBeNull();
  });

  it('ignores sessions outside the trend window', () => {
    const snap = history('bench', [
      { weeksAgo: 1, sets: [[200, 8]] },
      { weeksAgo: 2, sets: [[200, 8]] },
      { weeksAgo: 30, sets: [[100, 8]] }, // ancient — would fake a huge slope
    ]);
    expect(strengthTrend(snap, 'bench', NOW)).toBeNull();
  });
});

describe('currentMax — what the app believes the max is', () => {
  const stored: OneRepMax = { exerciseId: 'bench', weight: 245, source: 'tested', date: '2026-06-01', updatedAt: NOW - 4 * WEEK };

  it('stands by a tested max over a lower log estimate', () => {
    const logged = { e1rm: 230, weight: 185, reps: 7, ts: NOW - WEEK };
    expect(currentMax(stored, logged)).toMatchObject({ value: 245, basis: 'tested', logExceedsStored: false });
  });

  it('flags a higher estimate logged since the test as the current best', () => {
    const logged = { e1rm: 258, weight: 205, reps: 8, ts: NOW - WEEK };
    expect(currentMax(stored, logged)).toMatchObject({ value: 258, basis: 'log', logExceedsStored: true });
  });

  it('does not let an OLDER log estimate outrank a fresh test', () => {
    const logged = { e1rm: 258, weight: 205, reps: 8, ts: NOW - 8 * WEEK };
    expect(currentMax(stored, logged)).toMatchObject({ value: 245, basis: 'tested' });
  });

  it('falls back to the log when nothing is stored', () => {
    expect(currentMax(null, { e1rm: 233.4, weight: 185, reps: 8, ts: NOW })).toMatchObject({ value: 233, basis: 'log' });
    expect(currentMax(null, null)).toBeNull();
  });
});

describe('projectGoal', () => {
  const base = { current: 250, target: 300, experience: 'intermediate' as const, goal: 'strength' as const, trend: null, now: NOW };

  it('uses the expected rate for the training age when there is no trend', () => {
    const p = projectGoal(base);
    expect(p.basis).toBe('expected');
    expect(p.ratePctPerWeek).toBeCloseTo(EXPECTED_WEEKLY_GAIN_PCT.intermediate * 1.15, 5);
    // 20% gain at ~0.63%/week ≈ 29 weeks
    expect(p.weeks).toBeGreaterThan(25);
    expect(p.weeks).toBeLessThan(35);
    expect(p.weeksFast!).toBeLessThan(p.weeks!);
    expect(p.weeksSlow!).toBeGreaterThan(p.weeks!);
    expect(p.etaTs).toBe(NOW + p.weeks! * WEEK);
  });

  it('gives a beginner a much shorter timeline than an advanced lifter', () => {
    const b = projectGoal({ ...base, experience: 'beginner' });
    const a = projectGoal({ ...base, experience: 'advanced' });
    expect(b.weeks!).toBeLessThan(a.weeks ?? Infinity);
    // 20% at 0.18 × 1.15 ≈ 0.2%/week is ~90 weeks — inside the horizon, barely
    expect(a.feasibility).toBe('long-shot');
  });

  it('reads the lifter\'s own pace when it has one, within plausible bounds', () => {
    const fast = projectGoal({ ...base, trend: { ratePctPerWeek: 5, points: 4, spanWeeks: 4 } });
    expect(fast.basis).toBe('observed');
    // clamped to 2× the expected rate (then the goal scale)
    expect(fast.ratePctPerWeek).toBeCloseTo(EXPECTED_WEEKLY_GAIN_PCT.intermediate * 2 * 1.15, 5);
    expect(fast.notes[0]).toMatch(/faster than most/);

    const modest = projectGoal({ ...base, trend: { ratePctPerWeek: 0.8, points: 4, spanWeeks: 5 } });
    expect(modest.ratePctPerWeek).toBeCloseTo(0.8 * 1.15, 5);
  });

  it('tempers the estimate on a flat trend instead of promising nothing', () => {
    const p = projectGoal({ ...base, trend: { ratePctPerWeek: -0.2, points: 5, spanWeeks: 6 } });
    expect(p.basis).toBe('tempered');
    expect(p.ratePctPerWeek).toBeCloseTo(EXPECTED_WEEKLY_GAIN_PCT.intermediate * 0.5 * 1.15, 5);
    expect(p.notes[0]).toMatch(/flat/);
  });

  it('says a deficit is not when strength PRs happen', () => {
    const p = projectGoal({ ...base, goal: 'fat-loss' });
    expect(p.ratePctPerWeek).toBeLessThan(projectGoal(base).ratePctPerWeek);
    expect(p.notes.some(n => /fat-loss/.test(n))).toBe(true);
  });

  it('calls a reached goal reached and a tiny gap within reach', () => {
    expect(projectGoal({ ...base, target: 250 }).feasibility).toBe('reached');
    expect(projectGoal({ ...base, target: 240 }).weeks).toBe(0);
    expect(projectGoal({ ...base, target: 255 }).feasibility).toBe('close');
  });

  it('refuses to put a date on something past the horizon', () => {
    const p = projectGoal({ ...base, current: 100, target: 400, experience: 'advanced' });
    expect(p.weeks).toBeNull();
    expect(p.etaTs).toBeNull();
    expect(p.feasibility).toBe('long-shot');
    expect(etaLabel(p)).toMatch(/more than two years/);
  });

  it('cannot project without a current max', () => {
    const p = projectGoal({ ...base, current: 0 });
    expect(p.weeks).toBeNull();
    expect(p.notes[0]).toMatch(/Enter a current 1RM/);
  });

  it('formats the ETA with its band', () => {
    const p = projectGoal(base);
    expect(etaLabel(p)).toMatch(/^~\d+ weeks \(\d+–\d+\)$/);
  });
});

describe('goalProgress', () => {
  it('is the share of the way from the starting max to the target', () => {
    expect(goalProgress(200, 250, 300)).toBe(0.5);
    expect(goalProgress(200, 320, 300)).toBe(1);
    expect(goalProgress(200, 190, 300)).toBe(0);
    expect(goalProgress(300, 300, 300)).toBe(1);
  });
});
