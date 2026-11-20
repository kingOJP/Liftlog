// Muscle heatmap data: accumulated training volume per muscle over an
// arbitrary time window, normalized to a weekly rate and mapped onto the
// slate → blue → indigo → violet gradient. Muscle involvement reuses
// musclesForExercise() (override → master list → name match) — no duplicate
// muscle mapping lives here.

import type { MuscleGroup } from './taxonomy';
import { regionFor } from './taxonomy';
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

// ── The range a heatmap (and the stats beside it) is read over ────────────────

export interface HeatRange {
  preset: HeatPreset;
  /** local calendar dates, `yyyy-mm-dd` — only read when preset is 'custom' */
  customFrom: string;
  customTo: string;
}

/** Every way the UI names a range, in one place so the controls, the stat
 *  tiles and the insight sentence can't describe the same window differently. */
export const HEAT_PRESETS: Array<{
  id: HeatPreset;
  /** segmented control */
  label: string;
  /** dropdown, and the label of a "volume in this range" stat */
  menu: string;
  /** mid-sentence: "…over the last 30 days" */
  phrase: string;
  /** the window it is compared against, mid-sentence */
  priorPhrase: string;
  /** the same comparison as a stat label */
  vsLabel: string;
}> = [
  { id: '7d',     label: '7 Days',    menu: 'Last 7 days',    phrase: 'the last 7 days',  priorPhrase: 'the 7 days before',               vsLabel: 'vs prior 7 days' },
  { id: '30d',    label: '30 Days',   menu: 'Last 30 days',   phrase: 'the last 30 days', priorPhrase: 'the 30 days before',              vsLabel: 'vs prior 30 days' },
  { id: 'meso',   label: 'Mesocycle', menu: 'This mesocycle', phrase: 'this mesocycle',   priorPhrase: 'the same stretch before it',      vsLabel: 'vs prior stretch' },
  { id: 'custom', label: 'Custom',    menu: 'Custom range',   phrase: 'this range',       priorPhrase: 'the same-length range before it', vsLabel: 'vs prior range' },
];

export function presetCopy(preset: HeatPreset) {
  return HEAT_PRESETS.find(p => p.id === preset)!;
}

/** A timestamp as the `yyyy-mm-dd` an `<input type="date">` holds (local time). */
export function dateInputValue(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateInput(value: string, endOfDay: boolean): number {
  const [y, m, d] = value.split('-').map(Number);
  return endOfDay
    ? new Date(y, m - 1, d, 23, 59, 59).getTime()
    : new Date(y, m - 1, d).getTime();
}

export function defaultHeatRange(now = Date.now()): HeatRange {
  return { preset: '30d', customFrom: dateInputValue(now - 30 * DAY_MS), customTo: dateInputValue(now) };
}

/**
 * The time window a range stands for. A custom range covers both of its days
 * in full, and reads the same whichever way round the dates were entered.
 */
export function rangeWindow(range: HeatRange, now = Date.now()): { from: number; to: number } {
  if (range.preset !== 'custom') return presetWindow(range.preset, now);
  // yyyy-mm-dd sorts chronologically as text
  const [first, last] = range.customFrom <= range.customTo
    ? [range.customFrom, range.customTo]
    : [range.customTo, range.customFrom];
  return { from: fromDateInput(first, false), to: fromDateInput(last, true) };
}

/**
 * The window of the same length immediately before `w` — what a range is
 * compared against ("up 6 points on the 30 days before").
 */
export function previousWindow(w: { from: number; to: number }): { from: number; to: number } {
  return { from: w.from - (w.to - w.from), to: w.from };
}

// ── Where the volume went ─────────────────────────────────────────────────────
// The split between lower body, upper body and core, as a share of all the
// muscle-sets in a window. Region membership is the taxonomy's (regionFor), so
// "lower body" here is exactly the muscles the pickers call Legs.

export type BodyHalf = 'lower' | 'upper' | 'core';

export const BODY_HALF_LABEL: Record<BodyHalf, string> = {
  lower: 'lower body',
  upper: 'upper body',
  core: 'core',
};

export function bodyHalfFor(muscle: MuscleGroup): BodyHalf {
  const region = regionFor(muscle);
  return region === 'Legs' ? 'lower' : region === 'Core' ? 'core' : 'upper';
}

/** Share (0–1) of a window's muscle-sets per body half; null when it holds none. */
export function volumeSplit(heat: HeatmapData): Record<BodyHalf, number> | null {
  const sets: Record<BodyHalf, number> = { lower: 0, upper: 0, core: 0 };
  let total = 0;
  for (const [muscle, h] of heat.byMuscle) {
    sets[bodyHalfFor(muscle)] += h.sets;
    total += h.sets;
  }
  if (total <= 0) return null;
  return { lower: sets.lower / total, upper: sets.upper / total, core: sets.core / total };
}

export interface SplitInsight {
  /** the half that took the most volume in the window */
  half: BodyHalf;
  /** its share of the window's volume, whole percent */
  pct: number;
  /** change in that share against the previous window, in percentage points;
   *  null when the previous window has nothing to compare with */
  deltaPts: number | null;
  /** muscles trained in the previous window that this one skipped entirely,
   *  most-trained first */
  untrained: MuscleGroup[];
}

/**
 * The one-line read of a heatmap window: which half of the body the volume
 * went to, and whether that is more or less than the window before. Pure —
 * the sentence is the component's job.
 */
export function splitInsight(
  current: HeatmapData,
  previous: HeatmapData | null,
): SplitInsight | null {
  const now = volumeSplit(current);
  if (!now) return null;
  const half: BodyHalf = now.lower >= now.upper ? 'lower' : 'upper';
  const before = previous ? volumeSplit(previous) : null;
  const untrained = previous
    ? [...previous.byMuscle]
        .filter(([m, h]) => h.sets > 0 && (current.byMuscle.get(m)?.sets ?? 0) <= 0)
        .sort((a, b) => b[1].sets - a[1].sets)
        .map(([m]) => m)
    : [];
  return {
    half,
    pct: Math.round(now[half] * 100),
    deltaPts: before ? Math.round(now[half] * 100) - Math.round(before[half] * 100) : null,
    untrained,
  };
}

// ── Color scale ───────────────────────────────────────────────────────────────
// Slate = no recent training → blue = inside the goal's weekly-set band →
// indigo = elevated → violet = very high / approaching recovery limits. One
// cool family on purpose: high volume is a thing to watch, not an error, so it
// shouldn't shout in alarm-red. The band is passed in rather than fixed, so a
// sport-support athlete's 6 weekly sets reads as "on target" instead of slate.

const HEAT_NONE     = '#2E3754';
const HEAT_TARGET   = '#3897F0';
const HEAT_ELEVATED = '#5D5DFA';
const HEAT_HIGH     = '#835EFB';

/**
 * The legend bar, built from the same colours the regions are filled with so
 * the two can never drift: slate, a blend through "low", the on-target blue
 * held across a plateau (it is one state, not a spectrum), then the overshoot.
 */
export const HEAT_LEGEND_GRADIENT =
  `linear-gradient(90deg, ${HEAT_NONE} 0%, ${HEAT_TARGET} 50%, ${HEAT_TARGET} 72%, ${HEAT_ELEVATED} 88%, ${HEAT_HIGH} 100%)`;

// Gradient stops in weekly-set space. Blue holds across the whole target
// range so "on target" reads as one state, not a spectrum. The two overshoot
// stops scale with the band's width, so a narrower band saturates sooner.
function stopsFor(band: VolumeTarget): Array<[number, string]> {
  const overshoot = Math.max(3, Math.round((band.high - band.low) * 0.6));
  return [
    [0, HEAT_NONE],
    [band.low, HEAT_TARGET],
    [band.high, HEAT_TARGET],
    [band.high + overshoot, HEAT_ELEVATED],
    [band.high + overshoot * 2, HEAT_HIGH],
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
