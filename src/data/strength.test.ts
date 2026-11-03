import { describe, it, expect } from 'vitest';
import { buildSnapshot } from './analytics';
import type { Session, SetLog } from '../db/database';
import {
  bestLoggedMax, currentMax, e1rmSeriesFor, goalProgress, loadBandFor,
  pctOfMaxForReps, percentBandFor, programLoadsFor, projectBlock, strengthTrend,
  supportingFrequency, supportingDays, techniqueRead, variationsFor, whatItTakes,
  EXPECTED_WEEKLY_GAIN_PCT, FREQUENCY_RATE_SCALE, VARIATIONS,
} from './strength';
import { EXERCISE_MAP, difficultyFor } from './exercises';
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

describe('goalProgress', () => {
  it('is the share of the way from the starting max to the target', () => {
    expect(goalProgress(200, 250, 300)).toBe(0.5);
    expect(goalProgress(200, 320, 300)).toBe(1);
    expect(goalProgress(200, 190, 300)).toBe(0);
    expect(goalProgress(300, 300, 300)).toBe(1);
  });
});

describe('variations — the big lifts\' training partners', () => {
  it('every catalogued variation is a real catalog exercise that trains the same primary muscle', () => {
    for (const [lift, variations] of Object.entries(VARIATIONS)) {
      expect(EXERCISE_MAP.has(lift), lift).toBe(true);
      expect(variations.length).toBeGreaterThan(0);
      for (const v of variations) {
        expect(EXERCISE_MAP.has(v.id), `${lift} → ${v.id}`).toBe(true);
        expect(v.id).not.toBe(lift);
        expect(v.why.length).toBeGreaterThan(20);
      }
    }
  });

  it('keeps the paused/deficit variations gated like the lifts they vary', () => {
    for (const id of ['paused-back-squat', 'paused-deadlift', 'deficit-deadlift', 'front-squat']) {
      expect(difficultyFor(id), id).toBe('advanced');
    }
  });

  it('counts a program\'s weekly frequency on a lift through its variations', () => {
    const day = (id: number, ids: string[]) => ({
      id, label: `Day ${id}`, muscleGroups: '', exercises: ids.map(x => ({ id: x, name: x, sets: 3 })),
    });
    const program = [day(1, ['barbell-back-squat', 'leg-press']), day(2, ['paused-back-squat']), day(3, ['front-squat', 'barbell-back-squat']), day(4, ['leg-press'])];
    expect(supportingFrequency(program, 'barbell-back-squat')).toBe(3);
    expect(supportingDays(program, 'barbell-back-squat').map(d => d.ids)).toEqual([
      ['barbell-back-squat'], ['paused-back-squat'], ['front-squat', 'barbell-back-squat'],
    ]);
    expect(supportingFrequency(program, 'leg-press')).toBe(2);
    expect(variationsFor('leg-press')).toEqual([]);
  });

  it('says what it takes without needing a number', () => {
    const w = whatItTakes('barbell-back-squat', 'the squat');
    expect(w.frequency).toMatch(/2–3 times a week/);
    expect(w.variations.map(v => v.id)).toContain('paused-back-squat');
    expect(whatItTakes('leg-press').variationsNote).toMatch(/No catalogued variation/);
  });
});

describe('techniqueRead — rep strength versus heavy strength', () => {
  const stored = (weight: number, source: 'tested' | 'estimated' = 'tested') =>
    ({ exerciseId: 'squat', weight, source, date: '2026-06-01', updatedAt: NOW - WEEK });

  it('is null with nothing logged for the lift', () => {
    expect(techniqueRead(history('squat', []), 'squat', null, NOW)).toBeNull();
  });

  it('calls out the positions when 5–8-rep work implies far more than the heavy evidence', () => {
    // 275 × 6 ≈ 330 by Epley; the tested max is 290 — a 14% gap
    const snap = history('squat', [{ weeksAgo: 1, sets: [[275, 6], [275, 6]] }]);
    const read = techniqueRead(snap, 'squat', stored(290), NOW)!;
    expect(read.kind).toBe('technique');
    expect(read.heavyBasis).toBe('tested');
    expect(read.gapPct!).toBeGreaterThan(8);
    expect(read.detail).toMatch(/275 × 6/);
    expect(read.suggestions.length).toBeGreaterThan(0);
  });

  it('reads heavy evidence off the log when there is no tested max', () => {
    // a logged 295 × 1 (e1RM ≈ 305) against 270 × 8 (≈ 342) → technique, basis log
    const snap = history('squat', [
      { weeksAgo: 1, sets: [[270, 8]] },
      { weeksAgo: 3, sets: [[295, 1]] },
    ]);
    const read = techniqueRead(snap, 'squat', null, NOW)!;
    expect(read.kind).toBe('technique');
    expect(read.heavyBasis).toBe('log');
  });

  it('uses lift-specific work when the catalog knows the lift', () => {
    const snap = history('barbell-back-squat', [{ weeksAgo: 1, sets: [[275, 6]] }]);
    const read = techniqueRead(snap, 'barbell-back-squat', { ...stored(290), exerciseId: 'barbell-back-squat' }, NOW)!;
    expect(read.suggestions[0]).toMatch(/Paused squats/);
  });

  it('calls a thin rep base when the single runs past what rep work implies', () => {
    // tested 340 vs 250 × 6 ≈ 300 → heavy is 13% ahead
    const snap = history('squat', [{ weeksAgo: 1, sets: [[250, 6]] }]);
    const read = techniqueRead(snap, 'squat', stored(340), NOW)!;
    expect(read.kind).toBe('volume');
    expect(read.suggestions[0]).toMatch(/70–80%/);
  });

  it('finds no leak when the two agree within a few percent', () => {
    // 275 × 6 ≈ 330, tested 320 → 3%
    const snap = history('squat', [{ weeksAgo: 1, sets: [[275, 6]] }]);
    expect(techniqueRead(snap, 'squat', stored(320), NOW)!.kind).toBe('balanced');
  });

  it('asks for a heavy triple when nothing heavy exists to check the estimate against', () => {
    const snap = history('squat', [{ weeksAgo: 1, sets: [[275, 6]] }]);
    const read = techniqueRead(snap, 'squat', stored(320, 'estimated'), NOW)!;
    expect(read.kind).toBe('no-heavy'); // an *estimated* stored max is not heavy evidence
    expect(read.suggestions[0]).toMatch(/heavy triple/);
  });

  it('ignores evidence older than the window — strength today, not last year', () => {
    const snap = history('squat', [
      { weeksAgo: 1, sets: [[275, 6]] },
      { weeksAgo: 40, sets: [[350, 1]] },
    ]);
    expect(techniqueRead(snap, 'squat', null, NOW)!.kind).toBe('no-heavy');
  });

  it('says so when the window holds nothing in either zone', () => {
    // 12-rep sets are valid e1RM evidence but neither rep-strength (4–8) nor heavy (≤3)
    const snap = history('squat', [{ weeksAgo: 1, sets: [[135, 12]] }]);
    expect(techniqueRead(snap, 'squat', null, NOW)!.kind).toBe('insufficient');
  });
});

describe('projectBlock — what a block is built to deliver', () => {
  const base = { current: 300, weeks: 6, frequency: 2, experience: 'intermediate' as const, goal: 'strength' as const, trend: null };

  it('gives a range around a central estimate, rounded to plates', () => {
    const p = projectBlock(base);
    expect(p.low).toBeLessThan(p.mid);
    expect(p.mid).toBeLessThan(p.high);
    expect(p.mid).toBeGreaterThan(300);
    for (const v of [p.low, p.mid, p.high]) expect(v % 5).toBe(0);
    expect(p.basis).toBe('expected');
    expect(p.ratePctPerWeek).toBeCloseTo(EXPECTED_WEEKLY_GAIN_PCT.intermediate * 1.15, 5);
  });

  it('reads the lifter\'s own pace ahead of the training-age table', () => {
    const own = projectBlock({ ...base, trend: { ratePctPerWeek: 0.9, points: 5, spanWeeks: 6 } });
    expect(own.basis).toBe('observed');
    expect(own.mid).toBeGreaterThan(projectBlock(base).mid);
    // ...but clamps a fortnight of fireworks to twice the typical rate
    const wild = projectBlock({ ...base, trend: { ratePctPerWeek: 6, points: 4, spanWeeks: 4 } });
    expect(wild.ratePctPerWeek).toBeCloseTo(EXPECTED_WEEKLY_GAIN_PCT.intermediate * 2 * 1.15, 5);
  });

  it('tempers a flat trend instead of promising the old pace', () => {
    const p = projectBlock({ ...base, trend: { ratePctPerWeek: -0.3, points: 5, spanWeeks: 6 } });
    expect(p.basis).toBe('tempered');
    expect(p.notes[0]).toMatch(/flat/);
  });

  it('scales with frequency and says so at once a week', () => {
    const long = { ...base, current: 400, weeks: 8 };
    const once = projectBlock({ ...long, frequency: 1 });
    const thrice = projectBlock({ ...long, frequency: 3 });
    expect(once.mid).toBeLessThan(projectBlock(long).mid);
    expect(thrice.mid).toBeGreaterThan(projectBlock(long).mid);
    expect(once.notes.some(n => /second day/.test(n))).toBe(true);
    expect(FREQUENCY_RATE_SCALE[2]).toBe(1);
  });

  it('frames a target against the range rather than dating it', () => {
    expect(projectBlock({ ...base, target: 290 }).target).toEqual({ weight: 290, verdict: 'reached' });
    const inside = projectBlock({ ...base, target: 310 });
    expect(inside.target!.verdict).toBe('inside');
    const beyond = projectBlock({ ...base, target: 400 });
    expect(beyond.target!.verdict).toBe('beyond');
    expect(beyond.notes.some(n => /blocks/.test(n))).toBe(true);
    expect(JSON.stringify(beyond)).not.toMatch(/etaTs|weeksFast/);
  });

  it('expects the low end in a deficit or a sport block', () => {
    expect(projectBlock({ ...base, goal: 'fat-loss' }).mid).toBeLessThan(projectBlock(base).mid);
    expect(projectBlock({ ...base, goal: 'sport-support' }).notes.some(n => /sport/.test(n))).toBe(true);
  });
});
