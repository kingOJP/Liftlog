import { describe, it, expect } from 'vitest';
import { buildSetPlan, calculateRecommendation } from './recommendations';
import type { ExerciseSession, PrescriptionContext } from './recommendations';
import type { Exercise } from './program';

type Slot = Pick<Exercise, 'sets' | 'repLow' | 'repHigh'>;

const exercise = { sets: 3, repLow: 8, repHigh: 12 };

const NOW = new Date(2026, 6, 29, 12).getTime();
const DAY = 86_400_000;
const WEEK = 7 * DAY;

// Sessions are spaced a week apart by default (`weeksAgo` counts back from NOW,
// so index 0 of a newest-first history is `weeksAgo: 1`). Real timestamps mean
// the weekly progression cap is exercised the way it is in the app: a lift
// trained once a week may take one increase a week.
function session(
  sets: Array<[weight: number, reps: number]>,
  weeksAgo = 1,
): ExerciseSession {
  return {
    completedAt: NOW - weeksAgo * WEEK,
    sets: sets.map(([weight, reps]) => ({ weight, reps })),
  };
}

/** Default context: an intermediate on a general goal, evaluated at NOW. */
function advise(
  history: ExerciseSession[],
  ex: Slot = exercise,
  ctx: PrescriptionContext = {},
) {
  return calculateRecommendation(history, ex, { now: NOW, ...ctx });
}

function plan(
  history: ExerciseSession[],
  ex: Slot = exercise,
  ctx: PrescriptionContext = {},
) {
  return buildSetPlan(history, ex, { now: NOW, ...ctx });
}

describe('calculateRecommendation', () => {
  it('returns null with no history', () => {
    expect(advise([], exercise)).toBeNull();
    expect(advise([session([])], exercise)).toBeNull();
  });

  it('recommends an increase when the session rep target is met', () => {
    const rec = advise([session([[100, 12], [100, 12], [100, 13]])]);
    expect(rec).toMatchObject({ weight: 105, direction: 'up', kind: 'increase' });
  });

  it('holds when reps are inside the range (double progression)', () => {
    const rec = advise([session([[100, 10], [100, 9], [100, 8]])]);
    expect(rec).toMatchObject({ weight: 100, direction: 'hold', kind: 'hold' });
    expect(rec!.reason).toContain('36 total');
  });

  it('does not increase when the rep target was hit on an incomplete set count', () => {
    const rec = advise([session([[100, 12], [100, 12]])]);
    expect(rec).toMatchObject({ weight: 100, kind: 'hold' });
    expect(rec!.reason).toContain('all 3 sets');
  });

  it('does not let bonus sets earn a load increase', () => {
    // 5 × 8 at 100 is 40 reps, past the 36-rep target — but the programmed work
    // is 3 sets, and 8/8/8 is the bottom of the range, not the top of it.
    const rec = advise([session([[100, 8], [100, 8], [100, 8], [100, 8], [100, 8]])]);
    expect(rec).toMatchObject({ kind: 'hold', weight: 100 });
  });

  it('ignores warm-up sets when picking the working weight', () => {
    // 60 lb warm-up, then 3 working sets at 100 — the mode wins
    const rec = advise([session([[60, 15], [100, 12], [100, 12], [100, 12]])]);
    expect(rec).toMatchObject({ weight: 105, kind: 'increase' });
  });

  it('never recommends below 5 lbs', () => {
    const rec = advise([session([[5, 4], [5, 4], [5, 4]])]);
    expect(rec!.weight).toBeGreaterThanOrEqual(5);
  });
});

describe('increment sizing — the load–rep relationship', () => {
  // A rep costs roughly 3% of load, so the room between the reps achieved and
  // the bottom of the range is what the lifter can absorb. Tested on a beginner
  // so the weekly rate cap (10%) leaves the sizing visible.
  const beginner: PrescriptionContext = { experience: 'beginner' };

  it('takes a real jump when the lifter has room in the rep range', () => {
    // 3×12 in an 8–12 range: 4 reps of room ≈ 12% of load
    const rec = advise([session([[100, 12], [100, 12], [100, 12]])], exercise, beginner);
    expect(rec).toMatchObject({ kind: 'increase', weight: 110 });
  });

  it('takes the minimum step when the target was only scraped', () => {
    // Same 3×12, but a 10–12 range leaves just 2 reps of room ≈ 6%
    const rec = advise(
      [session([[100, 12], [100, 12], [100, 12]])],
      { sets: 3, repLow: 10, repHigh: 12 },
      beginner,
    );
    expect(rec).toMatchObject({ kind: 'increase', weight: 105 });
  });

  it('microloads light cable/machine work instead of jumping 30%', () => {
    const rec = advise(
      [session([[20, 20], [20, 20], [20, 20]])],
      { sets: 3, repLow: 16, repHigh: 20 },
      { ...beginner, weightType: 'Machine' },
    );
    expect(rec).toMatchObject({ kind: 'increase', weight: 22.5 });
  });

  it('keeps 5 lb jumps on dumbbells — the rack has no half-plates', () => {
    const rec = advise(
      [session([[20, 20], [20, 20], [20, 20]])],
      { sets: 3, repLow: 16, repHigh: 20 },
      { ...beginner, weightType: 'Dumbbell' },
    );
    expect(rec).toMatchObject({ kind: 'increase', weight: 25 });
  });

  it('still jumps when the smallest plate exceeds the weekly allowance', () => {
    // 5% of a 25 lb belt load is 1.25 lbs — less than any plate. The lift must
    // still be able to progress, so the minimum increment goes through.
    const rec = advise([session([[25, 12], [25, 12], [25, 12]])], exercise, { weightType: 'Bodyweight' });
    expect(rec).toMatchObject({ weight: 27.5, kind: 'increase' });
    expect(rec!.targetReps).toBeUndefined();
  });
});

describe('weekly progression rate', () => {
  it('allows one increase per week for an intermediate', () => {
    // Trained Saturday at 100, again Tuesday and beat the target again.
    const history = [
      { completedAt: NOW - 1 * DAY, sets: [[105, 12], [105, 12], [105, 12]] },
      { completedAt: NOW - 4 * DAY, sets: [[100, 12], [100, 12], [100, 12]] },
    ].map(h => ({ completedAt: h.completedAt, sets: h.sets.map(([weight, reps]) => ({ weight, reps })) }));

    const rec = advise(history);
    expect(rec).toMatchObject({ kind: 'hold', weight: 105 });
    expect(rec!.reason).toMatch(/already went up this week/i);
  });

  it('lets a beginner climb twice in the same week (novice linear progression)', () => {
    const history = [
      { completedAt: NOW - 1 * DAY, sets: [[105, 12], [105, 12], [105, 12]] },
      { completedAt: NOW - 4 * DAY, sets: [[100, 12], [100, 12], [100, 12]] },
    ].map(h => ({ completedAt: h.completedAt, sets: h.sets.map(([weight, reps]) => ({ weight, reps })) }));

    const rec = advise(history, exercise, { experience: 'beginner' });
    expect(rec).toMatchObject({ kind: 'increase' });
    expect(rec!.weight).toBeGreaterThan(105);
  });

  it('holds an advanced lifter to a slower climb than an intermediate', () => {
    const history = [session([[400, 12], [400, 12], [400, 12]])];
    expect(advise(history, exercise, { experience: 'advanced' })).toMatchObject({ weight: 410 });
    expect(advise(history, exercise, { experience: 'intermediate' })).toMatchObject({ weight: 420 });
    expect(advise(history, exercise, { experience: 'beginner' })).toMatchObject({ weight: 440 });
  });

  it('holds a returning lifter to the same weekly rate as one who trained through', () => {
    // Nothing in the trailing 7 days. The increase is still earned by that last
    // session, but the cap anchors to it and allows one week's growth — time
    // away doesn't bank increases, and handing the biggest jump to the least
    // recently trained lift is the wrong direction.
    const rec = advise([session([[100, 12], [100, 12], [100, 12]], 3)]);
    expect(rec).toMatchObject({ kind: 'increase', weight: 105 });
  });
});

describe('stall detection', () => {
  it('deloads after 3 sessions with no gain on either lever', () => {
    const history = [
      session([[100, 9], [100, 9], [100, 8]], 1),
      session([[100, 9], [100, 8], [100, 8]], 2),
      session([[100, 9], [100, 9], [100, 8]], 3),
    ];
    expect(advise(history)).toMatchObject({ weight: 90, direction: 'down', kind: 'deload' });
  });

  it('does not deload a lifter who is adding reps at a fixed load', () => {
    // 10/9/8 → 10/10/9 → 10/10/10. The top set never moves, so est. 1RM is flat
    // — but three reps were added at the same weight. That is double
    // progression working exactly as designed, not a plateau.
    const history = [
      session([[100, 10], [100, 10], [100, 10]], 1),
      session([[100, 10], [100, 10], [100, 9]], 2),
      session([[100, 10], [100, 9], [100, 8]], 3),
    ];
    const rec = advise(history);
    expect(rec).toMatchObject({ kind: 'hold', weight: 100 });
  });

  it('does not deload while strength is still climbing at the same weight', () => {
    const history = [
      session([[100, 11], [100, 10], [100, 10]], 1),
      session([[100, 10], [100, 9], [100, 8]], 2),
      session([[100, 9], [100, 8], [100, 8]], 3),
    ];
    expect(advise(history)).toMatchObject({ kind: 'hold', weight: 100 });
  });

  it('ignores meaningless est. 1RM wobble on high-rep work', () => {
    // 1RM formulas are fitted on ~1–10 rep sets. On 3×16–20 the estimate drifts
    // enough that a one-rep shuffle between sets reads as a strength gain and
    // would veto a real plateau. Reps are flat at 51 across all three sessions.
    const highRep = { sets: 3, repLow: 16, repHigh: 20 };
    const history = [
      session([[20, 18], [20, 17], [20, 16]], 1),
      session([[20, 17], [20, 17], [20, 17]], 2),
      session([[20, 17], [20, 17], [20, 17]], 3),
    ];
    expect(advise(history, highRep)).toMatchObject({ kind: 'deload' });
  });

  it('prefers an increase over a deload when the last session beats the target', () => {
    const history = [
      session([[100, 12], [100, 12], [100, 12]], 1),
      session([[100, 12], [100, 11], [100, 10]], 2),
      session([[100, 12], [100, 12], [100, 11]], 3),
    ];
    expect(advise(history)).toMatchObject({ kind: 'increase', weight: 105 });
  });
});

describe('under-range sessions', () => {
  it('does not cut load off a single near miss', () => {
    // Day-to-day strength swings from sleep, food and stress are large. One
    // session at 7/7/8 in an 8–12 range is noise, not a trend.
    const rec = advise([session([[100, 7], [100, 7], [100, 8]])]);
    expect(rec).toMatchObject({ kind: 'hold', weight: 100 });
    expect(rec!.reason).toMatch(/one session isn't a trend/i);
  });

  it('cuts load on a clear miss', () => {
    const rec = advise([session([[100, 6], [100, 6], [100, 5]])]);
    expect(rec).toMatchObject({ weight: 95, direction: 'down', kind: 'decrease' });
  });

  it('cuts load when a second session confirms the first', () => {
    const history = [
      session([[100, 7], [100, 7], [100, 7]], 1),
      session([[100, 7], [100, 7], [100, 8]], 2),
    ];
    const rec = advise(history);
    expect(rec).toMatchObject({ weight: 95, kind: 'decrease' });
    expect(rec!.reason).toMatch(/two sessions/i);
  });
});

describe('goal-aware prescription', () => {
  it('holds the load through a plateau in a deficit instead of deloading', () => {
    // A stall in an energy deficit reflects energy availability, not accumulated
    // fatigue, and the objective is retaining muscle. Cutting the load gives
    // away the stimulus that defends it.
    const history = [
      session([[100, 9], [100, 9], [100, 8]], 1),
      session([[100, 9], [100, 8], [100, 8]], 2),
      session([[100, 9], [100, 9], [100, 8]], 3),
    ];
    const rec = advise(history, exercise, { goal: 'fat-loss' });
    expect(rec).toMatchObject({ kind: 'hold', weight: 100 });
    expect(rec!.reason).toMatch(/deficit/i);

    // Same history on a growth goal still deloads
    expect(advise(history, exercise, { goal: 'hypertrophy' })).toMatchObject({ kind: 'deload' });
  });

  it('needs a confirmed miss before cutting load in a deficit', () => {
    const oneBadSession = [session([[100, 6], [100, 6], [100, 5]])];
    expect(advise(oneBadSession, exercise, { goal: 'fat-loss' })).toMatchObject({ kind: 'hold' });
    expect(advise(oneBadSession, exercise, { goal: 'general' })).toMatchObject({ kind: 'decrease' });
  });

  it('takes the minimum step in a deficit rather than a room-sized jump', () => {
    const history = [session([[100, 12], [100, 12], [100, 12]])];
    const beginner = { experience: 'beginner' } as const;
    expect(advise(history, exercise, { ...beginner, goal: 'fat-loss' })).toMatchObject({ weight: 105 });
    expect(advise(history, exercise, { ...beginner, goal: 'hypertrophy' })).toMatchObject({ weight: 110 });
  });

  it('holds a bodyweight rep standard in a deficit instead of resetting it', () => {
    const history = [
      session([[0, 9], [0, 9], [0, 8]], 1),
      session([[0, 9], [0, 9], [0, 9]], 2),
      session([[0, 10], [0, 9], [0, 8]], 3),
    ];
    expect(advise(history, exercise, { weightType: 'Bodyweight', goal: 'fat-loss' }))
      .toMatchObject({ kind: 'hold' });
    expect(advise(history, exercise, { weightType: 'Bodyweight', goal: 'hypertrophy' }))
      .toMatchObject({ kind: 'deload', targetReps: 8 });
  });
});

describe('calculateRecommendation — bodyweight (rep progression)', () => {
  const bw: PrescriptionContext = { weightType: 'Bodyweight' };

  it('raises the rep goal when every set beats the top of the range', () => {
    const rec = advise([session([[0, 12], [0, 13], [0, 12]])], exercise, bw);
    expect(rec).toMatchObject({ weight: 0, targetReps: 13, direction: 'up', kind: 'increase' });
  });

  it('chases one more rep while inside the range', () => {
    const rec = advise([session([[0, 10], [0, 9], [0, 8]])], exercise, bw);
    expect(rec).toMatchObject({ weight: 0, targetReps: 9, direction: 'hold', kind: 'hold' });
  });

  it('caps the in-range rep goal at the top of the range', () => {
    expect(advise([session([[0, 12], [0, 12], [0, 11]])], exercise, bw)!.targetReps).toBe(12);
  });

  it('resets to the bottom of the range when reps fall under it', () => {
    const rec = advise([session([[0, 6], [0, 6], [0, 5]])], exercise, bw);
    expect(rec).toMatchObject({ targetReps: 8, direction: 'down', kind: 'decrease' });
  });

  it('suggests a rep deload after 3 sessions with no total-rep progress', () => {
    const history = [
      session([[0, 9], [0, 9], [0, 8]], 1),
      session([[0, 9], [0, 9], [0, 9]], 2),
      session([[0, 10], [0, 9], [0, 8]], 3),
    ];
    expect(advise(history, exercise, bw)).toMatchObject({ targetReps: 8, direction: 'down', kind: 'deload' });
  });

  it('does not deload while total reps are still climbing', () => {
    const history = [
      session([[0, 11], [0, 10], [0, 10]], 1),
      session([[0, 10], [0, 9], [0, 9]], 2),
      session([[0, 9], [0, 9], [0, 8]], 3),
    ];
    expect(advise(history, exercise, bw)).toMatchObject({ kind: 'hold', targetReps: 11 });
  });
});

describe('planned phase overrides', () => {
  it('prescribes ~10% off during a scheduled deload week, whatever the trend', () => {
    const rec = advise([session([[100, 12], [100, 12], [100, 12]])], exercise, { phase: 'deload' });
    expect(rec).toMatchObject({ weight: 90, direction: 'down', kind: 'deload' });
    expect(rec!.reason).toMatch(/deload week/i);
  });

  it('treats a recovery week the same way with its own framing', () => {
    const rec = advise([session([[100, 10], [100, 9], [100, 9]])], exercise, { phase: 'recovery' });
    expect(rec).toMatchObject({ weight: 90, kind: 'deload' });
    expect(rec!.reason).toMatch(/recovery week/i);
  });

  it('backs bodyweight work off to the bottom of the rep range', () => {
    const rec = advise([session([[0, 12], [0, 12], [0, 12]])], exercise, {
      weightType: 'Bodyweight', phase: 'deload',
    });
    expect(rec).toMatchObject({ weight: 0, targetReps: 8, kind: 'deload' });
  });

  it('changes nothing during productive phases', () => {
    const rec = advise([session([[100, 12], [100, 12], [100, 12]])], exercise, { phase: 'accumulation' });
    expect(rec).toMatchObject({ weight: 105, kind: 'increase' });
  });
});

describe('re-anchoring a load to a changed rep range', () => {
  // The reported case: a general-hypertrophy block (3 × 10–12) became a
  // triathlon-support block (4 × 4–6). Nothing about the LIFTER changed, but
  // every load in the program was chosen for a rep range nobody is training in
  // any more.
  const sportSquat: Slot = { sets: 4, repLow: 4, repHigh: 6 };
  const squatHistory = [
    session([[185, 9], [185, 9], [185, 8], [205, 7]], 1),
    session([[185, 8], [185, 8], [185, 7], [195, 7]], 2),
  ];

  it('re-anchors a hypertrophy load to a low-rep block from the est. 1RM', () => {
    const rec = advise(squatHistory, sportSquat);
    // Best valid est. 1RM is 205×7 → 253 lbs; a 6-rep load is 253 / 1.2 ≈ 211,
    // shaded 5% because four sets of six is not a 6RM attempt.
    expect(rec).toMatchObject({ weight: 200, direction: 'up', kind: 'reanchor' });
    expect(rec!.reason).toMatch(/est\. 1RM/i);
  });

  it('is not throttled by the weekly rate cap', () => {
    // 5%/week off 185 lbs is 194 — a cap meant to pace PROGRESS, which this is
    // not. Re-expressing the same strength in a new rep range is arithmetic,
    // and rationing it hands the lifter a month of sessions that are too easy.
    for (const experience of ['beginner', 'intermediate', 'advanced'] as const) {
      expect(advise(squatHistory, sportSquat, { experience })).toMatchObject({ weight: 200 });
    }
  });

  it('prescribes the reps the new load actually costs', () => {
    const p = plan(squatHistory, sportSquat);
    expect(p.sets.map(s => s.weight)).toEqual([200, 200, 200, 200]);
    expect(p.sets.map(s => s.targetReps)).toEqual([6, 6, 5, 5]);
    expect(p.goal).toMatch(/estimate from your log/i);
  });

  it('leaves ordinary double progression alone', () => {
    // One rep past the top of the range is the increase rule working, not a
    // mismatched prescription — this must still route through sized increments.
    const rec = advise([session([[100, 13], [100, 13], [100, 13]], 1)]);
    expect(rec!.kind).toBe('increase');
  });

  it('needs a second session before reading a blow-out as a mismatch', () => {
    const flukeThenNormal = [
      session([[100, 15], [100, 15], [100, 14]], 1),
      session([[100, 11], [100, 11], [100, 10]], 2),
    ];
    expect(advise(flukeThenNormal)!.kind).toBe('increase');
  });

  it('falls back to the load–rep model when est. 1RM is out of its valid range', () => {
    // Every set past ~12 reps: Epley's error swamps the signal there, so the
    // 3%-per-rep relationship sets the load instead of a fictional 1RM.
    const highRep = [
      session([[100, 15], [100, 15], [100, 14]], 1),
      session([[100, 15], [100, 14], [100, 14]], 2),
    ];
    const rec = advise(highRep);
    expect(rec).toMatchObject({ kind: 'reanchor', direction: 'up', weight: 105 });
    expect(rec!.reason).not.toMatch(/est\. 1RM/i);
  });

  it('re-anchors downward when a block moves to higher reps', () => {
    const strengthToHypertrophy = [
      session([[225, 5], [225, 5], [225, 4]], 1),
      session([[225, 5], [225, 4], [225, 4]], 2),
    ];
    const rec = advise(strengthToHypertrophy, { sets: 3, repLow: 10, repHigh: 12 });
    expect(rec).toMatchObject({ kind: 'reanchor', direction: 'down' });
    // Capped at one 20% step rather than betting the whole correction on one
    // prediction — the next session re-anchors again from fresh evidence.
    expect(rec!.weight).toBe(180);
  });

  it('never cuts load off a single under-range session', () => {
    // The mirror of the rule above: reps falling short is exactly what an off
    // day looks like, so a downward re-anchor needs a session confirming it.
    const rec = advise([session([[225, 5], [225, 5], [225, 4]], 1)], { sets: 3, repLow: 10, repHigh: 12 });
    expect(rec!.kind).not.toBe('reanchor');
  });

  it('backs an easy week off the re-anchored load, not the stale one', () => {
    // A new block often opens with an intro week. Backing off 20% from a load
    // that was already 15 lbs light for the range is two mistakes compounding.
    const rec = advise(squatHistory, sportSquat, { phase: 'intro' });
    expect(rec).toMatchObject({ weight: 160, kind: 'deload' });
  });
});

describe('extra and heavier sets', () => {
  it('counts a heavier top set toward the programmed set count', () => {
    // 3 sets at the working weight plus a heavier top set IS four sets of work.
    // Judging it as three left the lifter permanently short of the set count
    // the increase rule requires, so the load could never move.
    const rec = advise([session([[100, 12], [100, 12], [100, 12], [110, 10]], 1)], {
      sets: 4, repLow: 8, repHigh: 12,
    });
    expect(rec).toMatchObject({ kind: 'increase' });
  });

  it('does not let a failed extra set drag the session under the range', () => {
    // Three programmed sets in range, then a fourth taken to failure. The extra
    // work is a bonus; it must not read as "reps fell under the range".
    const rec = advise([session([[100, 9], [100, 9], [100, 8], [100, 2]], 1)]);
    expect(rec).toMatchObject({ kind: 'hold', weight: 100 });
  });

  it('still does not let bonus sets earn an increase', () => {
    // The cap at the programmed set count is what keeps the credit honest.
    const rec = advise([session([[100, 8], [100, 8], [100, 8], [100, 8], [100, 8]], 1)]);
    expect(rec).toMatchObject({ kind: 'hold', weight: 100 });
  });

  it('lets a heavier top set call off a deload', () => {
    // Reps flat at the working weight for three sessions, but the lifter has
    // been adding a heavier top set — that is progress, and progress is what a
    // stall verdict is supposed to rule out.
    const history = [
      session([[100, 9], [100, 9], [100, 8], [115, 6]], 1),
      session([[100, 9], [100, 9], [100, 8], [110, 6]], 2),
      session([[100, 9], [100, 9], [100, 8]], 3),
    ];
    expect(advise(history, { sets: 4, repLow: 8, repHigh: 12 })!.kind).not.toBe('deload');
  });
});

describe('exercise-order freshness', () => {
  const at = (pos: number, sets: Array<[number, number]>, weeksAgo: number): ExerciseSession => ({
    completedAt: NOW - weeksAgo * WEEK,
    position: pos,
    sets: sets.map(([weight, reps]) => ({ weight, reps })),
  });

  it('ignores a fatigued late-slot session as the baseline', () => {
    const history = [
      at(3, [[95, 6], [95, 6], [95, 6]], 1),   // newest: fatigued, late slot
      at(0, [[100, 12], [100, 12], [100, 12]], 2),
      at(0, [[100, 11], [100, 11], [100, 11]], 3),
    ];
    const rec = advise(history);
    expect(rec).toMatchObject({ kind: 'increase' });
    expect(rec!.reason).toMatch(/later in your workout/i);
  });

  it('does not read a late-slot dip as an under-range decrease', () => {
    const history = [
      at(3, [[90, 6], [90, 6], [90, 6]], 1),
      at(0, [[100, 10], [100, 10], [100, 10]], 2),
      at(0, [[100, 10], [100, 10], [100, 10]], 3),
    ];
    const rec = advise(history);
    expect(rec!.kind).toBe('hold');
    expect(rec!.reason).toMatch(/later in your workout/i);
  });
});

describe('buildSetPlan', () => {
  it('prescribes one row per programmed set at the recommended load', () => {
    const p = plan([session([[100, 10], [100, 9], [100, 9]])]);
    expect(p.sets).toHaveLength(3);
    expect(p.sets.map(s => s.setNumber)).toEqual([1, 2, 3]);
    expect(p.sets.every(s => s.weight === 100)).toBe(true);
  });

  it("targets descending reps, fitted to the lifter's own drop-off", () => {
    const history = [
      session([[100, 10], [100, 9], [100, 8]], 1),
      session([[100, 10], [100, 9], [100, 8]], 2),
    ];
    // Set 1 chases one more rep than last time; the observed drop-off carries down
    expect(plan(history).sets.map(s => s.targetReps)).toEqual([11, 10, 9]);
  });

  it('falls back to a decay model for sets the lifter has never reached', () => {
    const targets = plan([session([[100, 10]])]).sets.map(s => s.targetReps);
    expect(targets[0]!).toBeGreaterThanOrEqual(targets[1]!);
    expect(targets[1]!).toBeGreaterThanOrEqual(targets[2]!);
  });

  it('never targets outside the programmed rep range', () => {
    for (const s of plan([session([[100, 12], [100, 12], [100, 4]])]).sets) {
      expect(s.targetReps!).toBeGreaterThanOrEqual(exercise.repLow);
      expect(s.targetReps!).toBeLessThanOrEqual(exercise.repHigh);
    }
  });

  it('predicts the reps a load increase actually costs, not a blanket repLow', () => {
    // 3×12 at 100 → 105 (rate-capped). A 5% jump costs ~1.7 reps, not 4.
    const p = plan([session([[100, 12], [100, 12], [100, 12]])]);
    expect(p.rec).toMatchObject({ kind: 'increase', weight: 105 });
    expect(p.sets[0].targetReps).toBe(10);
  });

  it('gives back reps after a deload rather than flooring the targets', () => {
    // Backing 100 → 90 is 10% off, which the load–rep relationship says buys
    // about 3 reps. Prescribing repLow there under-sells the back-off.
    const history = [
      session([[100, 9], [100, 9], [100, 8]], 1),
      session([[100, 9], [100, 8], [100, 8]], 2),
      session([[100, 9], [100, 9], [100, 8]], 3),
    ];
    const p = plan(history);
    expect(p.rec).toMatchObject({ kind: 'deload', weight: 90 });
    expect(p.sets[0].targetReps!).toBeGreaterThan(exercise.repLow);
  });

  it('prescribes rep targets with no weight for a never-trained exercise', () => {
    const p = plan([]);
    expect(p.rec).toBeNull();
    expect(p.sets).toHaveLength(3);
    expect(p.sets.every(s => s.weight === null && s.targetReps === exercise.repLow)).toBe(true);
    expect(p.goal).toMatch(/first time/i);
  });

  it("follows the coach-adjusted set count, not the last session's", () => {
    expect(plan([session([[100, 10], [100, 9]])], { ...exercise, sets: 5 }).sets).toHaveLength(5);
  });

  it('flattens targets during a planned deload week', () => {
    const p = plan([session([[100, 10], [100, 9], [100, 9]])], exercise, { phase: 'deload' });
    expect(p.sets.every(s => s.weight === 90 && s.targetReps === exercise.repLow)).toBe(true);
    expect(p.goal).toMatch(/reserve/i);
  });

  it('prescribes bodyweight work at 0 lbs with rep targets', () => {
    const p = plan([session([[0, 10], [0, 9], [0, 8]])], exercise, { weightType: 'Bodyweight' });
    expect(p.sets.every(s => s.weight === 0)).toBe(true);
    expect(p.sets[0].targetReps!).toBeGreaterThanOrEqual(p.sets[2].targetReps!);
  });
});

describe('week over week — the whole loop', () => {
  /**
   * Run the engine across `weeks` of training against a lifter who does exactly
   * what the plan asks, one session a week. This is the property that matters:
   * the loop as a whole has to climb.
   */
  function run(weeks: number, ex: Slot = exercise, ctx: PrescriptionContext = {}) {
    const start = new Date(2026, 0, 5).getTime();
    let history: ExerciseSession[] = [
      { completedAt: start, position: 0, sets: [8, 8, 8].map(reps => ({ weight: 100, reps })) },
    ];
    const log: { weight: number; kind: string; reps: number[] }[] = [];

    for (let w = 1; w <= weeks; w++) {
      const now = start + w * WEEK;
      const p = buildSetPlan(history, ex, { ...ctx, now });
      const weight = p.sets[0].weight!;
      const reps = p.sets.map(s => s.targetReps!);
      log.push({ weight, kind: p.rec!.kind, reps });
      history = [
        { completedAt: now, position: 0, sets: reps.map(r => ({ weight, reps: r })) },
        ...history,
      ].slice(0, 4);
    }
    return log;
  }

  it('climbs the load steadily for a lifter who hits their targets', () => {
    const log = run(12);
    expect(log[log.length - 1].weight).toBeGreaterThan(100);
    // Never goes backwards, and never manufactures a plateau to deload out of
    for (let i = 1; i < log.length; i++) {
      expect(log[i].weight).toBeGreaterThanOrEqual(log[i - 1].weight);
    }
    expect(log.some(l => l.kind === 'deload' || l.kind === 'decrease')).toBe(false);
  });

  it('never exceeds the weekly rate for any training age', () => {
    // Worth knowing: over a long run the caps barely separate the three levels,
    // because what actually paces load is how fast reps climb, not how big each
    // jump is — a beginner's larger jump costs more reps to rebuild. The cap is
    // a guard rail against over-jumping, not a brake on real progress.
    const caps = { beginner: 1.10, intermediate: 1.05, advanced: 1.025 } as const;
    for (const level of ['beginner', 'intermediate', 'advanced'] as const) {
      const log = run(12, exercise, { experience: level });
      for (let i = 1; i < log.length; i++) {
        // ...or one increment, when the weekly allowance is under one plate
        const ceiling = Math.max(log[i - 1].weight * caps[level], log[i - 1].weight + 5);
        expect(log[i].weight).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  it('defends the load rather than cutting it in a deficit', () => {
    const cut = run(12, exercise, { goal: 'fat-loss' });
    expect(cut.some(l => l.kind === 'deload' || l.kind === 'decrease')).toBe(false);
    expect(cut[cut.length - 1].weight).toBeGreaterThanOrEqual(100);
  });

  it('does not deload a lifter over one bad session', () => {
    // Four weeks of steady rep progress, then a single off day at the bottom
    // of the range. That is noise, not a plateau — repeat the weight.
    const history = [
      session([[135, 8], [135, 8], [135, 8]], 1),   // the off day
      session([[135, 10], [135, 10], [135, 10]], 2),
      session([[135, 9], [135, 9], [135, 9]], 3),
    ];
    expect(advise(history)).toMatchObject({ kind: 'hold', weight: 135 });
  });

  it('does deload once performance has actually regressed', () => {
    const history = [
      session([[135, 8], [135, 8], [135, 8]], 1),
      session([[135, 8], [135, 8], [135, 8]], 2),
      session([[135, 10], [135, 10], [135, 10]], 3),
    ];
    expect(advise(history)).toMatchObject({ kind: 'deload' });
  });

  it('does not walk the weight down step after step after a back-off', () => {
    // First session at the reduced load is still short of the range. It must
    // not be treated as "confirming" the miss that caused the back-off.
    const history = [
      session([[95, 7], [95, 7], [95, 7]], 1),
      session([[100, 6], [100, 6], [100, 6]], 2),
    ];
    const rec = advise(history);
    expect(rec).toMatchObject({ kind: 'hold', weight: 95 });
  });
});

describe('no prescription (ad-hoc work with nothing to dose from)', () => {
  it('holds at the last weight and sets no rep target', () => {
    const rec = advise([session([[135, 10], [135, 9]])], { sets: 3 });
    expect(rec).toMatchObject({ kind: 'hold', weight: 135 });
    expect(rec!.reason).toMatch(/no rep target/i);
  });

  it('lays out the sets with the weight carried forward and no targets', () => {
    const p = plan([session([[135, 10], [135, 9]])], { sets: 3 });
    expect(p.sets).toHaveLength(3);
    expect(p.sets.every(s => s.weight === 135)).toBe(true);
    expect(p.sets.every(s => s.targetReps === null)).toBe(true);
    expect(p.goal).toMatch(/no rep target/i);
  });

  it('shows nothing at all for a movement never trained', () => {
    const p = plan([], { sets: 3 });
    expect(p.rec).toBeNull();
    expect(p.sets.every(s => s.weight === null && s.targetReps === null)).toBe(true);
  });
});

// ── Timed holds ───────────────────────────────────────────────────────────────
// A plank logs at 0 lbs like other bodyweight work, so it already rides the
// rep-progression path. What the unit changes is what the coach SAYS, and that
// the progression is understood as time.
describe('timed exercises progress by seconds', () => {
  const plank = { sets: 3, repLow: 30, repHigh: 45 };
  const held = (...secs: number[][]): ExerciseSession[] =>
    secs.map((s, i) => ({
      completedAt: NOW - i * 3 * DAY,
      sets: s.map(v => ({ weight: 0, reps: v })),
    }));

  it('lengthens the hold once the range is beaten', () => {
    const rec = calculateRecommendation(held([46, 46, 46]), plank, { unit: 'seconds' });
    expect(rec!.kind).toBe('increase');
    expect(rec!.targetReps).toBe(47);
    expect(rec!.weight).toBe(0);
    expect(rec!.reason).toMatch(/holds hit/i);
    expect(rec!.reason).not.toMatch(/\breps\b/);
  });

  it('resets the hold after a stall instead of adding load', () => {
    const rec = calculateRecommendation(held([35, 35, 35], [35, 35, 35], [36, 35, 35]), plank, { unit: 'seconds' });
    expect(rec!.kind).toBe('deload');
    expect(rec!.targetReps).toBe(plank.repLow);
    expect(rec!.reason).toMatch(/bracing/i);
  });

  it('builds back into the range when the holds fall short', () => {
    const rec = calculateRecommendation(held([18, 16, 15]), plank, { unit: 'seconds' });
    expect(rec!.kind).toBe('decrease');
    expect(rec!.reason).toMatch(/Holds fell under 30s/);
  });

  it('chases one more second per set while in range', () => {
    const rec = calculateRecommendation(held([34, 33, 33]), plank, { unit: 'seconds' });
    expect(rec!.kind).toBe('hold');
    expect(rec!.reason).toMatch(/34s\+/);
  });

  it('says the same things in reps when the exercise is not timed', () => {
    const rec = calculateRecommendation(held([46, 46, 46]), plank);
    expect(rec!.reason).toMatch(/\breps\b/);
  });

  it('prescribes a per-set hold, and talks in seconds', () => {
    const plan = buildSetPlan(held([34, 33, 33]), plank, { unit: 'seconds' });
    expect(plan.sets).toHaveLength(3);
    for (const s of plan.sets) {
      expect(s.weight).toBe(0);
      expect(s.targetReps).toBeGreaterThanOrEqual(plank.repLow);
    }
    expect(plan.goal).toMatch(/total seconds/);
  });

  it('backs the hold off in an easy week', () => {
    const plan = buildSetPlan(held([40, 40, 40]), plank, { unit: 'seconds', phase: 'deload' });
    expect(plan.sets.every(s => s.targetReps === plank.repLow)).toBe(true);
    expect(plan.goal).toMatch(/Hold each set/);
  });

  it('does not compound across consecutive intro weeks', () => {
    // A novice gets two intro weeks, and they sit at the front of a block. If
    // week 2 backed off from week 1 it would land at 64% and the introduction
    // would get *easier* as it went — the opposite of easing in.
    const loaded = { sets: 3, repLow: 8, repHigh: 12 };
    const before: ExerciseSession[] = [
      { completedAt: NOW - 3 * DAY, sets: [100, 100, 100].map(w => ({ weight: w, reps: 10 })) },
    ];
    const week1 = calculateRecommendation(before, loaded, { phase: 'intro' })!;
    expect(week1.weight).toBeGreaterThan(70);
    expect(week1.weight).toBeLessThan(90);

    const afterWeek1: ExerciseSession[] = [
      { completedAt: NOW, sets: [week1.weight, week1.weight, week1.weight].map(w => ({ weight: w, reps: 8 })) },
      ...before,
    ];
    const week2 = calculateRecommendation(afterWeek1, loaded, { phase: 'intro' })!;
    expect(week2.weight).toBe(week1.weight);
  });

  it('still backs a deload off from where the lifter currently is', () => {
    // The intro rule must not leak: a deload after hard weeks is relative to
    // the last session, not to the heaviest thing in the window.
    const loaded = { sets: 3, repLow: 8, repHigh: 12 };
    const history: ExerciseSession[] = [
      { completedAt: NOW, sets: [100, 100, 100].map(w => ({ weight: w, reps: 10 })) },
      { completedAt: NOW - 3 * DAY, sets: [130, 130, 130].map(w => ({ weight: w, reps: 10 })) },
    ];
    const rec = calculateRecommendation(history, loaded, { phase: 'deload' })!;
    expect(rec.weight).toBeLessThan(100);
  });

  it('backs off harder in an intro week than in a deload', () => {
    const loaded = { sets: 3, repLow: 8, repHigh: 12 };
    const history: ExerciseSession[] = [
      { completedAt: NOW, sets: [{ weight: 100, reps: 10 }, { weight: 100, reps: 10 }, { weight: 100, reps: 10 }] },
    ];
    const intro = calculateRecommendation(history, loaded, { phase: 'intro' })!;
    const deload = calculateRecommendation(history, loaded, { phase: 'deload' })!;
    expect(intro.weight).toBeLessThan(deload.weight);
    expect(intro.reason).toMatch(/Intro week/i);
  });
});

// ── Time away ────────────────────────────────────────────────────────────────
// Missed *reps* are covered thoroughly above. Missed *sessions* are a separate
// axis: the engine reads the last N sessions of an exercise regardless of when
// they happened, so the calendar has to be handled deliberately.
describe('a lifter coming back from time off', () => {
  const ex = { sets: 3, repLow: 8, repHigh: 12 };
  const at = (daysAgo: number, weight: number, reps: number): ExerciseSession => ({
    completedAt: NOW - daysAgo * DAY,
    sets: [reps, reps, reps].map(r => ({ weight, reps: r })),
  });

  it('applies the weekly rate cap across a layoff', () => {
    // At 400 lbs the per-week allowances are wider than the minimum increment,
    // so the training-age rates are actually visible. These are the same
    // numbers the lifter who trained through gets — the layoff neither earns a
    // bigger jump nor forfeits the increase.
    const maxed = [at(21, 400, 12)];
    for (const [experience, expected] of [['advanced', 410], ['intermediate', 420]] as const) {
      expect(calculateRecommendation(maxed, ex, { now: NOW, experience }), experience)
        .toMatchObject({ kind: 'increase', weight: expected });
    }
  });

  it('never blocks the smallest increment the gym stocks, layoff or not', () => {
    // 2.5% of 100 lbs is under any plate. A lift must still be able to move.
    expect(calculateRecommendation([at(21, 100, 12)], ex, { now: NOW, experience: 'advanced' }))
      .toMatchObject({ kind: 'increase', weight: 105 });
  });

  it('is no more generous to the absent lifter than to the consistent one', () => {
    const consistent = [at(3, 100, 12), at(7, 100, 12)];
    const layoff = [at(21, 100, 12), at(25, 100, 12)];
    const a = calculateRecommendation(consistent, ex, { now: NOW, experience: 'intermediate' })!;
    const b = calculateRecommendation(layoff, ex, { now: NOW, experience: 'intermediate' })!;
    expect(b.weight).toBeLessThanOrEqual(a.weight);
  });

  it('does not stall a lifter who was progressing before the break', () => {
    const climbing = [at(21, 100, 12), at(28, 95, 12), at(35, 90, 12)];
    expect(calculateRecommendation(climbing, ex, { now: NOW })!.kind).toBe('increase');
  });

  it('does not read infrequent training as a plateau', () => {
    // Three sessions across ten weeks at the same load. There is no accumulated
    // fatigue to shed here — cutting the load would treat absence as if it were
    // over-reaching.
    const sporadic = [at(5, 100, 10), at(30, 100, 10), at(70, 100, 10)];
    const rec = calculateRecommendation(sporadic, ex, { now: NOW })!;
    expect(rec.kind).toBe('hold');
    expect(rec.weight).toBe(100);
    expect(rec.reason).toMatch(/been away/i);
  });

  it('still calls a real plateau when the sessions are close together', () => {
    // Identical performances, compressed into a fortnight — that IS a stall.
    const dense = [at(2, 100, 10), at(6, 100, 10), at(10, 100, 10)];
    expect(calculateRecommendation(dense, ex, { now: NOW })!.kind).toBe('deload');
  });

  it('applies the same calendar guard to bodyweight and timed work', () => {
    const bw = (daysAgo: number, reps: number): ExerciseSession => ({
      completedAt: NOW - daysAgo * DAY,
      sets: [reps, reps, reps].map(r => ({ weight: 0, reps: r })),
    });
    const ctx = { now: NOW, weightType: 'Bodyweight' } as const;
    expect(calculateRecommendation([bw(2, 10), bw(6, 10), bw(10, 10)], ex, ctx)!.kind).toBe('deload');
    const sparse = calculateRecommendation([bw(5, 10), bw(30, 10), bw(70, 10)], ex, ctx)!;
    expect(sparse.kind).toBe('hold');
    expect(sparse.reason).toMatch(/been away/i);
  });
});
