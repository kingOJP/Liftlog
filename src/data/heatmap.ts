// Muscle heatmap data: accumulated training volume per muscle over an
// arbitrary time window, normalized to a weekly rate and mapped onto the
// blue → green → yellow → red recovery gradient. Muscle involvement reuses
// musclesForExercise() (override → master list → name match) — no duplicate
// muscle mapping lives here.

import type { MuscleGroup } from './taxonomy';
import type { TrainingSnapshot } from './analytics';
import type { VolumeTarget } from './analytics';
import {
  DEFAULT_VOLUME_TARGET,
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
// Blue = no recent training → green = inside the goal's weekly-set band →
// yellow = elevated → red = very high / approaching recovery limits. The band
// is passed in rather than fixed, so a sport-support athlete's 6 weekly sets
// reads as "on target" instead of permanently blue.

const HEAT_BLUE   = '#3D6BE8';
const HEAT_GREEN  = '#1D9E75';
const HEAT_YELLOW = '#E8C44A';
const HEAT_RED    = '#E85555';

// Gradient stops in weekly-set space. Green holds across the whole target
// range so "on target" reads as one state, not a spectrum. The two overshoot
// stops scale with the band's width, so a narrower band saturates sooner.
function stopsFor(band: VolumeTarget): Array<[number, string]> {
  const overshoot = Math.max(3, Math.round((band.high - band.low) * 0.6));
  return [
    [0, HEAT_BLUE],
    [band.low, HEAT_GREEN],
    [band.high, HEAT_GREEN],
    [band.high + overshoot, HEAT_YELLOW],
    [band.high + overshoot * 2, HEAT_RED],
  ];
}

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

export function heatColor(weeklyRate: number, band: VolumeTarget = DEFAULT_VOLUME_TARGET): string {
  const stops = stopsFor(band);
  if (weeklyRate <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [prevRate, prevColor] = stops[i - 1];
    const [rate, color] = stops[i];
    if (weeklyRate <= rate) {
      return mix(prevColor, color, (weeklyRate - prevRate) / (rate - prevRate));
    }
  }
  return stops[stops.length - 1][1];
}

export function heatLabel(weeklyRate: number, band: VolumeTarget = DEFAULT_VOLUME_TARGET): string {
  const overshoot = Math.max(3, Math.round((band.high - band.low) * 0.6));
  if (weeklyRate <= 0) return 'No recent training';
  if (weeklyRate < band.low) return 'Below target';
  if (weeklyRate <= band.high) return 'On target';
  if (weeklyRate <= band.high + overshoot) return 'Elevated';
  return 'Very high — watch recovery';
}
