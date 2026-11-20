import type { MuscleGroup } from '../data/taxonomy';
import type { VolumeTarget } from '../data/analytics';
import { HEAT_LEGEND_GRADIENT, HEAT_PRESETS, heatColor } from '../data/heatmap';
import type { HeatRange, HeatmapData } from '../data/heatmap';
import BodyFigure from './BodyFigure';
import Segmented from './Segmented';
import './MuscleHeatmap.css';

// ── Range control ─────────────────────────────────────────────────────────────

interface RangeProps {
  range: HeatRange;
  onChange: (range: HeatRange) => void;
  /** today, as a date-input value — a range can't end in the future */
  maxDate: string;
}

/** The segmented timeframe pill, plus two date fields when it is on Custom. */
export function HeatRangeControl({ range, onChange, maxDate }: RangeProps) {
  return (
    <>
      <Segmented
        label="Time range"
        options={HEAT_PRESETS}
        value={range.preset}
        onChange={preset => onChange({ ...range, preset })}
      />
      {range.preset === 'custom' && (
        <div className="hm-custom-range">
          <input
            type="date"
            aria-label="From"
            value={range.customFrom}
            max={maxDate}
            onChange={e => e.target.value && onChange({ ...range, customFrom: e.target.value })}
          />
          <span className="hm-range-sep">to</span>
          <input
            type="date"
            aria-label="To"
            value={range.customTo}
            max={maxDate}
            onChange={e => e.target.value && onChange({ ...range, customTo: e.target.value })}
          />
        </div>
      )}
    </>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

/** The scale as a bar — the figure is colour-only, so the key is not optional. */
export function HeatLegend({ band }: { band: VolumeTarget }) {
  return (
    <div className="hm-legend">
      <div className="hm-legend-bar" style={{ backgroundImage: HEAT_LEGEND_GRADIENT }} />
      <div className="hm-legend-labels">
        <span>None</span>
        <span>Low</span>
        <span>On target</span>
        <span>High</span>
      </div>
      <p className="hm-legend-note">
        On target is {band.low}–{band.high} sets a week per muscle for your goal.
      </p>
    </div>
  );
}

// ── Compact card body ─────────────────────────────────────────────────────────

interface Props extends RangeProps {
  heat: HeatmapData;
  band: VolumeTarget;
  onOpenDetails: () => void;
}

/**
 * The heatmap as it sits on the Metrics page: both figures at a glance and a
 * key. At this size a forearm is a few pixels wide, so the figures are one
 * button that opens the detail sheet rather than a field of tiny targets.
 */
export default function MuscleHeatmap({ heat, band, range, onChange, maxDate, onOpenDetails }: Props) {
  const colorFor = (m: MuscleGroup) => heatColor(heat.byMuscle.get(m)?.weeklyRate ?? 0, band);
  const swatches: Array<{ label: string; rate: number }> = [
    { label: 'High', rate: band.high * 3 },
    { label: 'On target', rate: band.low },
    { label: 'Low', rate: band.low / 2 },
    { label: 'None', rate: 0 },
  ];

  return (
    <div className="muscle-heatmap">
      <HeatRangeControl range={range} onChange={onChange} maxDate={maxDate} />
      <div className="hm-compact">
        <button
          type="button"
          className="hm-figures hm-figures--button"
          onClick={onOpenDetails}
          aria-label="Open the heatmap details: every muscle's weekly sets"
        >
          <BodyFigure view="front" colorFor={colorFor} />
          <BodyFigure view="back" colorFor={colorFor} />
        </button>
        <ul className="hm-key" aria-label="Colour key">
          {swatches.map(s => (
            <li key={s.label}>
              <span className="hm-key-dot" style={{ background: heatColor(s.rate, band) }} />
              {s.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
