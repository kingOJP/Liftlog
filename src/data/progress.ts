// Multi-signal progress assessment — THE definition of "making progress".
//
// e1RM alone is a raw-strength proxy: blind to volume progress, blind to rep
// PRs (the step-forward events of double progression), and blind to context —
// benching 4th instead of 1st tanks your numbers without you getting weaker.
// This module assesses each exercise the way a coach reviews a training log:
//
//   - e1RM trend        (best Epley estimate per session)
//   - volume-load trend (tonnage = Σ weight × reps; total reps for bodyweight)
//   - PR events         (weight PRs and rep PRs, detected against all-time bests)
//   - exercise order    (sessions trained much later in the workout than usual
//                        are excluded as trend endpoints — fatigue, not weakness)
//
// The signals are blended with goal-dependent weights: chasing strength makes
// e1RM dominant; hypertrophy and fat loss lean on volume (and in a deficit,
// merely *holding* strength is scored as a win). Every consumer of "trend" —
// insights, the deload trigger, retrospectives, the planner, substitution —
// reads from here, so the whole app agrees on what progress means.
//
// Pure functions of a TrainingSnapshot, like every other engine in data/.

import type { Session, SetLog } from '../db/database';
import type { TrainingSnapshot } from './analytics';
import { epley1RM, sessionTimestamp } from './analytics';
import { getExerciseName } from './programStore';
import type { Goal } from './plan';

// ── Tunables ──────────────────────────────────────────────────────────────────

export const TREND_WINDOW_SESSIONS = 4;  // sessions the trend is judged over
export const MIN_TREND_SESSIONS = 3;     // fewer than this → "building a baseline"
const POSITION_SHIFT_SLOTS = 2;          // this many slots later than usual = not fresh
const FULL_MARKS_E1RM_PCT = 5;           // +5% e1RM across the window = full score
const FULL_MARKS_VOLUME_PCT = 10;        // +10% tonnage across the window = full score
const FULL_MARKS_PR_EVENTS = 2;          // 2 PR events in the window = full score
const PROGRESS_SCORE = 0.22;             // composite score bands
const DECLINE_SCORE = -0.22;

export type ProgressStatus = 'progressing' | 'steady' | 'stalled' | 'declining';

export const STATUS_INFO: Record<ProgressStatus, { label: string }> = {
  progressing: { label: 'Progressing' },
  steady:      { label: 'Steady' },
  stalled:     { label: 'Stalled' },
  declining:   { label: 'Declining' },
};

// Signal weights per goal — the coach's judgement of what matters most.
// strength: moving more weight IS the goal. hypertrophy: volume and rep PRs
// drive growth. fat-loss: defending volume/strength in a deficit is winning
// (holding e1RM scores positive, see below). athletic/general: balanced.
const GOAL_WEIGHTS: Record<Goal, { e1rm: number; volume: number; prs: number }> = {
  strength:    { e1rm: 0.55, volume: 0.20, prs: 0.25 },
  hypertrophy: { e1rm: 0.30, volume: 0.40, prs: 0.30 },
  'fat-loss':  { e1rm: 0.30, volume: 0.50, prs: 0.20 },
  athletic:    { e1rm: 0.45, volume: 0.30, prs: 0.25 },
  general:     { e1rm: 0.34, volume: 0.33, prs: 0.33 },
};

// ── Per-session, per-exercise datapoints ──────────────────────────────────────

export interface ExercisePoint {
  ts: number;
  sessionId: number;
  bestE1rm: number;       // 0 when everything was logged at 0 lbs
  tonnage: number;        // Σ weight × reps
  totalReps: number;
  maxWeight: number;
  /** 0-based slot of this exercise within the workout, null when unknown */
  position: number | null;
  weightPR: boolean;      // beat the all-time heaviest load
  repPR: boolean;         // beat the all-time best reps at a weight lifted before
  prLabels: string[];     // human-readable PR descriptions for this session
}

// Position of each exercise within a session: explicit `order` when the logs
// carry it (new builds), else derived from set-log insertion order (ids), which
// preserves the order sets were logged in for historical sessions.
export function sessionExercisePositions(logs: SetLog[]): Map<string, number> {
  const firstSeen = new Map<string, number>();
  for (const log of logs) {
    const key = log.exerciseId;
    const rank = log.order ?? (log.id != null ? log.id + 1_000_000 : Number.MAX_SAFE_INTEGER);
    const prev = firstSeen.get(key);
    if (prev == null || rank < prev) firstSeen.set(key, rank);
  }
  const ordered = [...firstSeen.entries()].sort((a, b) => a[1] - b[1]);
  return new Map(ordered.map(([id], i) => [id, i]));
}

/** sessionId → (exerciseId → 0-based position within that workout) */
export function snapshotPositions(snapshot: TrainingSnapshot): Map<number, Map<string, number>> {
  const out = new Map<number, Map<string, number>>();
  for (const [sessionId, logs] of snapshot.setsBySession) {
    out.set(sessionId, sessionExercisePositions(logs));
  }
  return out;
}

// Chronological (oldest-first) datapoint series per exercise, with PR events
// detected against running all-time bests.
export function exercisePointSeries(
  snapshot: TrainingSnapshot,
  include: (s: Session) => boolean = () => true,
): Map<string, ExercisePoint[]> {
  const positions = snapshotPositions(snapshot);

  // Oldest-first so PR detection scans forward through time
  const chronological = [...snapshot.sessions]
    .sort((a, b) => sessionTimestamp(a) - sessionTimestamp(b));

  const series = new Map<string, ExercisePoint[]>();
  const bestWeight = new Map<string, number>();                 // all-time heaviest
  const bestRepsAtWeight = new Map<string, Map<number, number>>(); // weight → best reps

  for (const session of chronological) {
    if (!include(session)) continue;
    const logs = snapshot.setsBySession.get(session.id!) ?? [];
    if (logs.length === 0) continue;
    const ts = sessionTimestamp(session);
    const posMap = positions.get(session.id!);

    const byExercise = new Map<string, SetLog[]>();
    for (const log of logs) {
      const arr = byExercise.get(log.exerciseId);
      if (arr) arr.push(log);
      else byExercise.set(log.exerciseId, [log]);
    }

    for (const [exerciseId, sets] of byExercise) {
      let bestE1rm = 0, tonnage = 0, totalReps = 0, maxWeight = 0;
      for (const s of sets) {
        bestE1rm = Math.max(bestE1rm, epley1RM(s.weight, s.reps));
        tonnage += s.weight * s.reps;
        totalReps += s.reps;
        maxWeight = Math.max(maxWeight, s.weight);
      }

      const prLabels: string[] = [];
      const prevBestWeight = bestWeight.get(exerciseId);
      const weightPR = prevBestWeight != null && maxWeight > prevBestWeight;
      if (weightPR) prLabels.push(`Weight PR — ${maxWeight} lbs`);
      bestWeight.set(exerciseId, Math.max(prevBestWeight ?? 0, maxWeight));

      // Rep PR: more reps than ever before at a weight you've lifted before
      let repPR = false;
      const repMap = bestRepsAtWeight.get(exerciseId) ?? new Map<number, number>();
      for (const s of sets) {
        const prev = repMap.get(s.weight);
        if (prev != null && s.reps > prev) {
          repPR = true;
          prLabels.push(s.weight > 0
            ? `Rep PR — ${s.reps} × ${s.weight} lbs`
            : `Rep PR — ${s.reps} bodyweight reps`);
        }
        repMap.set(s.weight, Math.max(prev ?? 0, s.reps));
      }
      bestRepsAtWeight.set(exerciseId, repMap);

      const point: ExercisePoint = {
        ts,
        sessionId: session.id!,
        bestE1rm,
        tonnage,
        totalReps,
        maxWeight,
        position: posMap?.get(exerciseId) ?? null,
        weightPR,
        repPR,
        prLabels: [...new Set(prLabels)].slice(0, 2),
      };
      const arr = series.get(exerciseId);
      if (arr) arr.push(point);
      else series.set(exerciseId, [point]);
    }
  }
  return series;
}

// ── Assessment ────────────────────────────────────────────────────────────────

export interface ExerciseProgress {
  exerciseId: string;
  name: string;
  status: ProgressStatus;
  /** −1 … +1 composite of the goal-weighted signals */
  score: number;
  /** sessions inside the trend window */
  sessions: number;
  totalSessions: number;
  lastTs: number;
  e1rmChangePct: number | null;    // null for pure-bodyweight work
  volumeChangePct: number | null;  // tonnage (total reps for bodyweight)
  weightPRs: number;               // PR events inside the window
  repPRs: number;
  /** latest session was trained ≥2 slots later than usual — excluded from trend endpoints */
  positionShifted: boolean;
  /** human-readable signal breakdown, most important first */
  evidence: string[];
  /** PR events inside the window, newest first (for the PR timeline) */
  recentPRs: { ts: number; label: string }[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function pct(from: number, to: number): number | null {
  if (from <= 0) return null;
  return ((to - from) / from) * 100;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function assessExercise(
  exerciseId: string,
  points: ExercisePoint[],
  goal: Goal,
  name = getExerciseName(exerciseId),
  windowSize = TREND_WINDOW_SESSIONS, // Infinity → judge the whole series (block retros)
): ExerciseProgress {
  const window = Number.isFinite(windowSize) ? points.slice(-windowSize) : [...points];
  const last = window[window.length - 1];

  // Freshness context: was the latest session trained much later in the
  // workout than this exercise usually is? If so its lower numbers are
  // expected — drop it from the trend endpoints instead of reading weakness.
  const typicalPos = median(points.slice(0, -1).map(p => p.position).filter((p): p is number => p != null));
  const positionShifted =
    last?.position != null && typicalPos != null &&
    last.position >= typicalPos + POSITION_SHIFT_SLOTS;

  const trendWindow = positionShifted && window.length > 1 ? window.slice(0, -1) : window;
  const first = trendWindow[0];
  const end = trendWindow[trendWindow.length - 1];

  // Bodyweight-at-0 work has no meaningful e1RM or tonnage — total reps is the
  // volume signal, and rep PRs carry the progression story.
  const bodyweight = points.every(p => p.maxWeight === 0);
  const e1rmChangePct = bodyweight || !first || !end ? null : pct(first.bestE1rm, end.bestE1rm);
  const volumeChangePct = !first || !end ? null
    : bodyweight ? pct(first.totalReps, end.totalReps) : pct(first.tonnage, end.tonnage);

  const weightPRs = window.filter(p => p.weightPR).length;
  const repPRs = window.filter(p => p.repPR).length;
  const recentPRs = window
    .flatMap(p => p.prLabels.map(label => ({ ts: p.ts, label })))
    .sort((a, b) => b.ts - a.ts);

  // ── Composite score ──
  const weights = GOAL_WEIGHTS[goal];

  let e1rmComponent = e1rmChangePct == null ? null : clamp(e1rmChangePct / FULL_MARKS_E1RM_PCT, -1, 1);
  // In a deficit, holding strength is a win — flat e1RM scores mildly positive.
  if (goal === 'fat-loss' && e1rmChangePct != null && Math.abs(e1rmChangePct) <= 2) {
    e1rmComponent = Math.max(e1rmComponent ?? 0, 0.35);
  }
  const volumeComponent = volumeChangePct == null ? null : clamp(volumeChangePct / FULL_MARKS_VOLUME_PCT, -1, 1);
  const prComponent = clamp((weightPRs + repPRs) / FULL_MARKS_PR_EVENTS, 0, 1);

  // Redistribute the weight of missing signals (e.g. no e1RM for bodyweight)
  let score = 0, weightSum = 0;
  if (e1rmComponent != null) { score += e1rmComponent * weights.e1rm; weightSum += weights.e1rm; }
  if (volumeComponent != null) { score += volumeComponent * weights.volume; weightSum += weights.volume; }
  score += prComponent * weights.prs; weightSum += weights.prs;
  score = weightSum > 0 ? score / weightSum : 0;

  // ── Status ──
  let status: ProgressStatus;
  if (points.length < MIN_TREND_SESSIONS) {
    status = 'steady'; // still building a baseline — no verdict yet
  } else if (score >= PROGRESS_SCORE) {
    status = 'progressing';
  } else if (score <= DECLINE_SCORE) {
    status = 'declining';
  } else if (weightPRs + repPRs > 0 || score > 0.1) {
    status = 'steady';
  } else {
    status = 'stalled';
  }

  // ── Evidence ──
  const evidence: string[] = [];
  const fmt = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  if (weightPRs + repPRs > 0) {
    evidence.push(recentPRs[0].label + (weightPRs + repPRs > 1 ? ` (+${weightPRs + repPRs - 1} more PR${weightPRs + repPRs > 2 ? 's' : ''})` : ''));
  }
  if (e1rmChangePct != null) {
    evidence.push(`est. 1RM ${fmt(e1rmChangePct)} over ${trendWindow.length} sessions`);
  }
  if (volumeChangePct != null) {
    evidence.push(`${bodyweight ? 'total reps' : 'volume load'} ${fmt(volumeChangePct)}`);
  }
  if (goal === 'fat-loss' && e1rmChangePct != null && Math.abs(e1rmChangePct) <= 2 && e1rmChangePct > -2) {
    evidence.push('holding strength in a deficit — that\'s a win');
  }
  if (positionShifted) {
    evidence.push(`trained later in the workout than usual last time — that session isn't counted against you`);
  }
  if (points.length < MIN_TREND_SESSIONS) {
    evidence.push('still building a baseline — log a few more sessions for a verdict');
  }

  return {
    exerciseId,
    name,
    status,
    score: Math.round(score * 100) / 100,
    sessions: window.length,
    totalSessions: points.length,
    lastTs: last?.ts ?? 0,
    e1rmChangePct: e1rmChangePct == null ? null : Math.round(e1rmChangePct * 10) / 10,
    volumeChangePct: volumeChangePct == null ? null : Math.round(volumeChangePct * 10) / 10,
    weightPRs,
    repPRs,
    positionShifted,
    evidence,
    recentPRs,
  };
}

/**
 * Assess every exercise in the snapshot (≥2 sessions of data). The single
 * source of truth for progressing/stalled/declining across the app.
 */
export function assessSnapshot(
  snapshot: TrainingSnapshot,
  goal: Goal,
  include: (s: Session) => boolean = () => true,
): Map<string, ExerciseProgress> {
  const out = new Map<string, ExerciseProgress>();
  for (const [exerciseId, points] of exercisePointSeries(snapshot, include)) {
    if (points.length < 2) continue;
    out.set(exerciseId, assessExercise(exerciseId, points, goal));
  }
  return out;
}

/** Convenience sets for engines that only need direction (planner, substitution). */
export function progressDirections(assessments: Map<string, ExerciseProgress>): {
  up: Set<string>; down: Set<string>; stalled: Set<string>;
} {
  const up = new Set<string>(), down = new Set<string>(), stalled = new Set<string>();
  for (const [id, a] of assessments) {
    if (a.status === 'progressing') up.add(id);
    else if (a.status === 'declining') down.add(id);
    else if (a.status === 'stalled') stalled.add(id);
  }
  return { up, down, stalled };
}
