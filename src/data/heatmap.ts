// Muscle heatmap data: accumulated training volume per muscle over an
// arbitrary time window, normalized to a weekly rate and mapped onto the
// blue → green → yellow → red recovery gradient. Muscle involvement reuses
// musclesForExercise() (override → master list → name match) — no duplicate
// muscle mapping lives here.

import type { MuscleGroup } from './taxonomy';
import type { TrainingSnapshot } from './analytics';
import {
  SETS_TARGET_LOW,
  SETS_TARGET_HIGH,
  muscleSetTotals,
  sessionTimestamp,
} from './analytics';
import { getProgramStart } from './settings';

const DAY_MS = 86_400_000;
export const MESOCYCLE_DAYS = 28;

export interface MuscleHeat {
  sets: number;        // fractional hard sets in the window
  weeklyRate: number;  // sets normalized to a per-week rate
}

export interface HeatmapData {
  byMuscle: Map<MuscleGroup, MuscleHeat>;
  weeks: number;       // window length in weeks (rate divisor)
}

export function computeMuscleHeat(
  snapshot: TrainingSnapshot,
  fromTs: number,
  toTs: number,
): HeatmapData {
  const weeks = Math.max((toTs - fromTs) / (7 * DAY_MS), 1 / 7);
  const { totals } = muscleSetTotals(snapshot, s => {
    const ts = sessionTimestamp(s);
    return ts >= fromTs && ts <= toTs;
  });
  const byMuscle = new Map<MuscleGroup, MuscleHeat>(
    [...totals].map(([muscle, sets]) => [muscle, { sets, weeklyRate: sets / weeks }]),
  );
  return { byMuscle, weeks };
}

// ── Time windows ──────────────────────────────────────────────────────────────

export type HeatPreset = '7d' | '30d' | 'meso' | 'custom';

// The current 4-week block anchored to the configurable program start date.
// If the start date is in the future, fall back to the trailing 28 days.
export function mesocycleWindow(now = Date.now()): { from: number; to: number } {
  const start = getProgramStart().getTime();
  const cycleMs = MESOCYCLE_DAYS * DAY_MS;
  if (now < start) return { from: now - cycleMs, to: now };
  const from = start + Math.floor((now - start) / cycleMs) * cycleMs;
  return { from, to: now };
}

export function presetWindow(preset: Exclude<HeatPreset, 'custom'>, now = Date.now()): { from: number; to: number } {
  switch (preset) {
    case '7d':  return { from: now - 7 * DAY_MS, to: now };
    case '30d': return { from: now - 30 * DAY_MS, to: now };
    case 'meso': return mesocycleWindow(now);
  }
}

// ── Color scale ───────────────────────────────────────────────────────────────
// Blue = no recent training → green = within the 10–20 set target →
// yellow = elevated → red = very high / approaching recovery limits.

const HEAT_BLUE   = '#3D6BE8';
const HEAT_GREEN  = '#1D9E75';
const HEAT_YELLOW = '#E8C44A';
const HEAT_RED    = '#E85555';

// Gradient stops in weekly-set space. Green holds across the whole target
// range so "on target" reads as one state, not a spectrum.
const STOPS: Array<[number, string]> = [
  [0, HEAT_BLUE],
  [SETS_TARGET_LOW, HEAT_GREEN],
  [SETS_TARGET_HIGH, HEAT_GREEN],
  [SETS_TARGET_HIGH + 6, HEAT_YELLOW],
  [SETS_TARGET_HIGH + 12, HEAT_RED],
];

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${c(r1, r2)}, ${c(g1, g2)}, ${c(b1, b2)})`;
}

export function heatColor(weeklyRate: number): string {
  if (weeklyRate <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    const [prevRate, prevColor] = STOPS[i - 1];
    const [rate, color] = STOPS[i];
    if (weeklyRate <= rate) {
      return mix(prevColor, color, (weeklyRate - prevRate) / (rate - prevRate));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export function heatLabel(weeklyRate: number): string {
  if (weeklyRate <= 0) return 'No recent training';
  if (weeklyRate < SETS_TARGET_LOW) return 'Below target';
  if (weeklyRate <= SETS_TARGET_HIGH) return 'On target';
  if (weeklyRate <= SETS_TARGET_HIGH + 6) return 'Elevated';
  return 'Very high — watch recovery';
}
