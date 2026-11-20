import { useState } from 'react';
import './charts.css';

export interface ChartPoint {
  label: string;
  value: number;
}

function formatValue(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

// ── Vertical bar chart (CSS) ───────────────────────────────────────────────────

interface BarChartProps {
  data: ChartPoint[];
  /** highlight the bar with the largest value (ignored when highlightIndex is set) */
  highlightMax?: boolean;
  /**
   * Highlight a specific bar instead of the tallest one — e.g. the week the
   * user is training in right now, which is the bar they came to look at.
   */
  highlightIndex?: number;
  /**
   * Make the bars a control: each one is a button, and the caller reads the
   * selected one out beside the chart (there is no hover on a phone, so a tap
   * is how a bar gives up its exact value). The readout replaces the value
   * labels; without onSelect every bar carries its own.
   */
  selectedIndex?: number;
  onSelect?: (index: number) => void;
  /** what a bar says to a screen reader, e.g. "Week of 10/26: 31,475 lbs" */
  describe?: (point: ChartPoint, index: number) => string;
}

export function BarChart({ data, highlightMax = true, highlightIndex, selectedIndex, onSelect, describe }: BarChartProps) {
  const max = Math.max(...data.map(d => d.value), 1);
  const accentIndex = highlightIndex != null
    ? highlightIndex
    : highlightMax && data.length > 0
      ? data.reduce((m, d, i, a) => (d.value > a[m].value ? i : m), 0)
      : -1;
  const interactive = !!onSelect;

  return (
    <div className={`bar-chart${interactive ? ' bar-chart--tap' : ''}`}>
      {data.map((d, i) => {
        const cls = `${i === accentIndex ? ' is-max' : ''}${i === selectedIndex ? ' is-selected' : ''}`;
        const body = (
          <>
            {!interactive && <span className={`bar-value${cls}`}>{formatValue(d.value)}</span>}
            <span className="bar-track">
              <span
                className={`bar-fill${cls}${d.value === 0 ? ' is-empty' : ''}`}
                style={{ height: `${Math.max((d.value / max) * 100, d.value === 0 ? 0 : 2)}%` }}
              />
            </span>
            <span className={`bar-label${cls}`}>{d.label}</span>
          </>
        );
        return interactive ? (
          <button
            type="button"
            className={`bar-col${cls}`}
            key={i}
            aria-pressed={i === selectedIndex}
            aria-label={describe ? describe(d, i) : `${d.label}: ${d.value}`}
            onClick={() => onSelect(i)}
          >
            {body}
          </button>
        ) : (
          <div className="bar-col" key={i}>{body}</div>
        );
      })}
    </div>
  );
}

// ── Line chart (SVG) ────────────────────────────────────────────────────────────

interface LineChartProps {
  data: ChartPoint[];
  unit?: string;
}

/** How many x-axis labels fit across a phone-width chart without colliding. */
const MAX_X_LABELS = 5;

export function LineChart({ data, unit }: LineChartProps) {
  // The point being read out. null = the latest one, which is the number the
  // lifter came for; a touch anywhere on the chart moves it.
  const [picked, setPicked] = useState<number | null>(null);
  if (data.length === 0) return null;

  const W = 320;
  const H = 140;
  const padX = 28;
  const padY = 18;

  const values = data.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  // Pad the value axis by 10% so points aren't flush against the edges
  const lo = min - range * 0.1;
  const hi = max + range * 0.1;
  const span = hi - lo || 1;

  const last = data.length - 1;
  const x = (i: number) =>
    data.length === 1 ? W / 2 : padX + (i / last) * (W - padX * 2);
  const y = (v: number) => padY + (1 - (v - lo) / span) * (H - padY * 2);

  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d.value)}`).join(' ');
  const areaPath = `${linePath} L ${x(last)} ${H - padY} L ${x(0)} ${H - padY} Z`;

  const current = picked !== null && picked <= last ? picked : last;
  const clamp = (i: number) => Math.max(0, Math.min(last, i));
  // Nearest point to the finger — the reader aims at a date, never at a 3px dot.
  const pickAt = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    setPicked(clamp(Math.round(((px - padX) / (W - padX * 2)) * last)));
  };

  // A label under every point collides (and used to push the page wider than
  // the phone) once there are more than a handful: label evenly spaced ones.
  const ticks = data.length <= MAX_X_LABELS
    ? data.map((_, i) => i)
    : Array.from({ length: MAX_X_LABELS }, (_, k) => Math.round((k * last) / (MAX_X_LABELS - 1)));
  const suffix = unit ? ` ${unit}` : '';

  return (
    <div className="line-chart">
      <div className="line-readout" aria-live="polite">
        <span className="line-readout-value">{data[current].value}{suffix}</span>
        <span className="line-readout-label">{data[current].label}{current === last ? ' · latest' : ''}</span>
      </div>
      <div className="line-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="line-svg"
          role="slider"
          tabIndex={0}
          aria-label="Session"
          aria-valuemin={0}
          aria-valuemax={last}
          aria-valuenow={current}
          aria-valuetext={`${data[current].label}: ${data[current].value}${suffix}`}
          onPointerDown={pickAt}
          onPointerMove={e => { if (e.pointerType !== 'mouse' || e.buttons > 0) pickAt(e); }}
          onKeyDown={e => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); setPicked(clamp(current - 1)); }
            if (e.key === 'ArrowRight') { e.preventDefault(); setPicked(clamp(current + 1)); }
          }}
        >
          <path d={areaPath} className="line-area" />
          <line x1={x(current)} x2={x(current)} y1={padY / 2} y2={H - padY} className="line-cursor" />
          <path d={linePath} className="line-stroke" />
          {data.map((d, i) => (
            <circle key={i} cx={x(i)} cy={y(d.value)} r={i === current ? 5 : 3} className={`line-dot${i === current ? ' is-current' : ''}`} />
          ))}
        </svg>
        <div className="line-axis">
          <span className="line-axis-hi">{max}{suffix}</span>
          <span className="line-axis-lo">{min}{suffix}</span>
        </div>
      </div>
      <div className="line-labels">
        {ticks.map(i => (
          <span key={i} className="line-label" style={{ left: `${(x(i) / W) * 100}%` }}>{data[i].label}</span>
        ))}
      </div>
    </div>
  );
}
