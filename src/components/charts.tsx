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
  /** highlight the bar with the largest value */
  highlightMax?: boolean;
}

export function BarChart({ data, highlightMax = true }: BarChartProps) {
  const max = Math.max(...data.map(d => d.value), 1);
  const maxIndex = highlightMax ? data.reduce((m, d, i, a) => (d.value > a[m].value ? i : m), 0) : -1;

  return (
    <div className="bar-chart">
      {data.map((d, i) => (
        <div className="bar-col" key={i}>
          <span className="bar-value">{formatValue(d.value)}</span>
          <div className="bar-track">
            <div
              className={`bar-fill${i === maxIndex ? ' is-max' : ''}`}
              style={{ height: `${(d.value / max) * 100}%` }}
            />
          </div>
          <span className="bar-label">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Line chart (SVG) ────────────────────────────────────────────────────────────

interface LineChartProps {
  data: ChartPoint[];
  unit?: string;
}

export function LineChart({ data, unit }: LineChartProps) {
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

  const x = (i: number) =>
    data.length === 1 ? W / 2 : padX + (i / (data.length - 1)) * (W - padX * 2);
  const y = (v: number) => padY + (1 - (v - lo) / span) * (H - padY * 2);

  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d.value)}`).join(' ');
  const areaPath = `${linePath} L ${x(data.length - 1)} ${H - padY} L ${x(0)} ${H - padY} Z`;

  return (
    <div className="line-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="line-svg">
        <path d={areaPath} className="line-area" />
        <path d={linePath} className="line-stroke" />
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.value)} r={3} className="line-dot" />
        ))}
      </svg>
      <div className="line-axis">
        <span className="line-axis-hi">{max}{unit ? ` ${unit}` : ''}</span>
        <span className="line-axis-lo">{min}{unit ? ` ${unit}` : ''}</span>
      </div>
      <div className="line-labels">
        {data.map((d, i) => (
          <span key={i} className="line-label">{d.label}</span>
        ))}
      </div>
    </div>
  );
}
