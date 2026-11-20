import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MuscleGroup } from '../data/taxonomy';
import { MUSCLE_GROUPS } from '../data/taxonomy';
import type { VolumeTarget } from '../data/analytics';
import { BODY_HALF_LABEL, heatColor, heatLabel, presetCopy, splitInsight } from '../data/heatmap';
import type { HeatRange, HeatmapData } from '../data/heatmap';
import BodyFigure from './BodyFigure';
import { HeatLegend, HeatRangeControl } from './MuscleHeatmap';
import Icon from './Icon';
import { useDialog } from './useDialog';
import './InstructionSheet.css';
import './ExerciseHistorySheet.css';
import './HeatmapSheet.css';

interface Props {
  heat: HeatmapData;
  /** the window of equal length before this one — what the insight compares against */
  prevHeat: HeatmapData | null;
  band: VolumeTarget;
  range: HeatRange;
  onChange: (range: HeatRange) => void;
  maxDate: string;
  onClose: () => void;
}

function formatSets(sets: number): string {
  const r = Math.round(sets * 2) / 2;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function listMuscles(muscles: MuscleGroup[]): string {
  const names = muscles.map(m => m.toLowerCase());
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/**
 * The heatmap in full: both figures large enough to tap, the scale, every
 * muscle's weekly sets against the goal's band, and a one-line read of where
 * the volume went. Opened from the compact card on Metrics.
 */
export default function HeatmapSheet({ heat, prevHeat, band, range, onChange, maxDate, onClose }: Props) {
  const dialogRef = useDialog<HTMLDivElement>(onClose);
  const [selected, setSelected] = useState<MuscleGroup | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const copy = presetCopy(range.preset);
  const rate = (m: MuscleGroup) => heat.byMuscle.get(m)?.weeklyRate ?? 0;
  const colorFor = (m: MuscleGroup) => heatColor(rate(m), band);
  const toggle = (m: MuscleGroup) => setSelected(sel => (sel === m ? null : m));

  const trained = MUSCLE_GROUPS
    .filter(m => (heat.byMuscle.get(m)?.sets ?? 0) > 0)
    .sort((a, b) => rate(b) - rate(a));
  const untrained = MUSCLE_GROUPS.filter(m => !trained.includes(m));
  // The meters share one scale: wide enough for the busiest muscle, and never
  // so tight that the band's ceiling sits at the very end of the track.
  const scaleMax = Math.max(band.high * 1.25, ...trained.map(rate));
  const pctOf = (sets: number) => `${Math.min(100, (sets / scaleMax) * 100)}%`;

  const insight = splitInsight(heat, prevHeat);

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet sheet--tall hm-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="heatmap-sheet-title"
        ref={dialogRef}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <div className="sheet-title-group">
            <h2 id="heatmap-sheet-title" className="sheet-title">Training Heatmap</h2>
            <span className="sheet-meta">Where your training volume is landing — per muscle, per week.</span>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>

        <div className="sheet-body hm-sheet-body">
          <HeatRangeControl range={range} onChange={onChange} maxDate={maxDate} />

          <div className="hm-figures hm-figures--large">
            <figure className="hm-figure">
              <BodyFigure view="front" colorFor={colorFor} describe={m => `${formatSets(rate(m))} sets a week`} selected={selected} onSelect={toggle} />
              <figcaption>Front</figcaption>
            </figure>
            <figure className="hm-figure">
              <BodyFigure view="back" colorFor={colorFor} describe={m => `${formatSets(rate(m))} sets a week`} selected={selected} onSelect={toggle} />
              <figcaption>Back</figcaption>
            </figure>
          </div>

          <div className="hm-detail" aria-live="polite">
            {selected ? (
              <>
                <span className="hm-detail-muscle">
                  <span className="hm-dot" style={{ background: colorFor(selected) }} />
                  {selected}
                  <span className="hm-detail-status">{heatLabel(rate(selected), band)}</span>
                </span>
                <span className="hm-detail-stats">
                  {formatSets(heat.byMuscle.get(selected)?.sets ?? 0)} sets over {copy.phrase} · {formatSets(rate(selected))} a week
                </span>
              </>
            ) : (
              <span className="hm-detail-hint">Tap a muscle for its numbers</span>
            )}
          </div>

          <HeatLegend band={band} />

          <section className="hm-groups" aria-labelledby="heatmap-groups-title">
            <h3 id="heatmap-groups-title" className="hm-groups-title">
              <Icon name="chart" size={18} className="hm-groups-icon" />
              Muscle groups
              <span className="hm-groups-unit">sets / week</span>
            </h3>
            {trained.length === 0 ? (
              <p className="hm-empty">No sets logged in {copy.phrase}.</p>
            ) : (
              <ul className="hm-rows">
                {trained.map(m => (
                  <li key={m}>
                    <button
                      type="button"
                      className={`hm-row${selected === m ? ' is-selected' : ''}`}
                      aria-pressed={selected === m}
                      aria-label={`${m}: ${formatSets(rate(m))} sets a week, ${heatLabel(rate(m), band)}`}
                      onClick={() => toggle(m)}
                    >
                      <span className="hm-row-head">
                        <span className="hm-dot" style={{ background: colorFor(m) }} />
                        <span className="hm-row-name">{m}</span>
                        <span className="hm-row-value">{formatSets(rate(m))}</span>
                      </span>
                      <span className="hm-meter" aria-hidden="true">
                        <span className="hm-meter-band" style={{ left: pctOf(band.low), width: `calc(${pctOf(band.high)} - ${pctOf(band.low)})` }} />
                        <span className="hm-meter-fill" style={{ width: pctOf(rate(m)), background: colorFor(m) }} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {trained.length > 0 && (
              <p className="hm-groups-note">
                The lighter stretch of each bar is your {band.low}–{band.high} target.
                {untrained.length > 0 && ` Nothing logged for ${listMuscles(untrained)}.`}
              </p>
            )}
          </section>

          {insight && (
            <aside className="hm-insight">
              <span className="hm-insight-head"><Icon name="bulb" size={18} /> Training insight</span>
              <p>
                Your {BODY_HALF_LABEL[insight.half]} took <strong>~{insight.pct}%</strong> of your training
                volume over {copy.phrase}
                {insight.deltaPts === null ? '.' : insight.deltaPts === 0
                  ? `, the same share as ${copy.priorPhrase}.`
                  : <>, <strong>{insight.deltaPts > 0 ? 'up' : 'down'} {Math.abs(insight.deltaPts)} point{Math.abs(insight.deltaPts) !== 1 ? 's' : ''}</strong> on {copy.priorPhrase}.</>}
              </p>
              {insight.untrained.length > 0 && (
                <p>
                  No work for your {listMuscles(insight.untrained.slice(0, 3))} this time — trained in {copy.priorPhrase}.
                </p>
              )}
            </aside>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
