import { useMemo, useState } from 'react';
import type { MuscleGroup } from '../data/taxonomy';
import type { TrainingSnapshot } from '../data/analytics';
import { computeMuscleHeat, heatColor, heatLabel, presetWindow } from '../data/heatmap';
import type { HeatPreset } from '../data/heatmap';
import './MuscleHeatmap.css';

interface Props {
  snapshot: TrainingSnapshot;
}

const PRESETS: Array<{ id: HeatPreset; label: string }> = [
  { id: '7d',     label: '7 Days' },
  { id: '30d',    label: '30 Days' },
  { id: 'meso',   label: 'Mesocycle' },
  { id: 'custom', label: 'Custom' },
];

function toDateInput(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateInput(value: string, endOfDay = false): number {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0).getTime();
}

export default function MuscleHeatmap({ snapshot }: Props) {
  const [preset, setPreset] = useState<HeatPreset>('30d');
  const [customFrom, setCustomFrom] = useState(() => toDateInput(Date.now() - 30 * 86_400_000));
  const [customTo, setCustomTo] = useState(() => toDateInput(Date.now()));
  const [maxDate] = useState(() => toDateInput(Date.now()));
  const [selected, setSelected] = useState<MuscleGroup | null>(null);

  const window = useMemo(() => {
    if (preset === 'custom') {
      const from = fromDateInput(customFrom);
      const to = fromDateInput(customTo, true);
      return to > from ? { from, to } : { from: to, to: from };
    }
    return presetWindow(preset);
  }, [preset, customFrom, customTo]);

  const heat = useMemo(
    () => computeMuscleHeat(snapshot, window.from, window.to),
    [snapshot, window],
  );

  const rate = (m: MuscleGroup) => heat.byMuscle.get(m)?.weeklyRate ?? 0;
  const region = (m: MuscleGroup) => ({
    fill: heatColor(rate(m)),
    className: `hm-region${selected === m ? ' hm-selected' : ''}`,
    onClick: () => setSelected(sel => (sel === m ? null : m)),
  });

  const selectedHeat = selected ? heat.byMuscle.get(selected) : null;

  return (
    <div className="muscle-heatmap">
      <div className="hm-presets">
        {PRESETS.map(p => (
          <button
            key={p.id}
            className={`hm-preset${preset === p.id ? ' active' : ''}`}
            onClick={() => setPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className="hm-custom-range">
          <input type="date" value={customFrom} max={customTo} onChange={e => setCustomFrom(e.target.value)} />
          <span className="hm-range-sep">to</span>
          <input type="date" value={customTo} min={customFrom} max={maxDate} onChange={e => setCustomTo(e.target.value)} />
        </div>
      )}

      <div className="hm-figures">
        {/* ── Front ── */}
        <div className="hm-figure">
          <svg viewBox="0 0 200 400" role="img" aria-label="Front muscle heatmap">
            {/* body backdrop */}
            <g className="hm-body">
              <circle cx="100" cy="26" r="17" />
              <rect x="91" y="41" width="18" height="13" rx="4" />
              <path d="M58,58 C70,52 130,52 142,58 L136,158 C136,166 120,172 100,172 C80,172 64,166 64,158 Z" />
              <path d="M66,170 L134,170 L126,204 L74,204 Z" />
              <circle cx="37" cy="192" r="7" />
              <circle cx="163" cy="192" r="7" />
              <ellipse cx="84" cy="382" rx="11" ry="6" />
              <ellipse cx="116" cy="382" rx="11" ry="6" />
            </g>
            {/* traps (front slope) */}
            <path d="M110,50 L140,63 L110,67 Z" {...region('Traps')} />
            <path d="M90,50 L60,63 L90,67 Z" {...region('Traps')} />
            {/* delts */}
            <ellipse cx="146" cy="76" rx="13" ry="12" {...region('Delts')} />
            <ellipse cx="54" cy="76" rx="13" ry="12" {...region('Delts')} />
            {/* chest */}
            <path d="M102,66 C124,66 136,76 134,92 C132,104 116,110 102,108 Z" {...region('Chest')} />
            <path d="M98,66 C76,66 64,76 66,92 C68,104 84,110 98,108 Z" {...region('Chest')} />
            {/* biceps */}
            <ellipse cx="152" cy="112" rx="10" ry="17" {...region('Biceps')} />
            <ellipse cx="48" cy="112" rx="10" ry="17" {...region('Biceps')} />
            {/* forearms */}
            <ellipse cx="158" cy="155" rx="8" ry="22" {...region('Forearms')} />
            <ellipse cx="42" cy="155" rx="8" ry="22" {...region('Forearms')} />
            {/* abs */}
            <rect x="84" y="112" width="32" height="54" rx="10" {...region('Abs')} />
            {/* quads */}
            <ellipse cx="82" cy="242" rx="16" ry="44" {...region('Quads')} />
            <ellipse cx="118" cy="242" rx="16" ry="44" {...region('Quads')} />
            {/* calves */}
            <ellipse cx="83" cy="330" rx="10" ry="30" {...region('Calves')} />
            <ellipse cx="117" cy="330" rx="10" ry="30" {...region('Calves')} />
          </svg>
          <span className="hm-figure-label">Front</span>
        </div>

        {/* ── Back ── */}
        <div className="hm-figure">
          <svg viewBox="0 0 200 400" role="img" aria-label="Back muscle heatmap">
            <g className="hm-body">
              <circle cx="100" cy="26" r="17" />
              <rect x="91" y="41" width="18" height="13" rx="4" />
              <path d="M58,58 C70,52 130,52 142,58 L136,158 C136,166 120,172 100,172 C80,172 64,166 64,158 Z" />
              <circle cx="37" cy="192" r="7" />
              <circle cx="163" cy="192" r="7" />
              <ellipse cx="84" cy="382" rx="11" ry="6" />
              <ellipse cx="116" cy="382" rx="11" ry="6" />
            </g>
            {/* traps */}
            <path d="M100,48 L128,64 L100,88 L72,64 Z" {...region('Traps')} />
            {/* rear delts */}
            <ellipse cx="146" cy="76" rx="13" ry="12" {...region('Delts')} />
            <ellipse cx="54" cy="76" rx="13" ry="12" {...region('Delts')} />
            {/* upper back */}
            <rect x="80" y="88" width="40" height="24" rx="8" {...region('Upper Back')} />
            {/* lats */}
            <path d="M122,90 C134,97 137,116 129,134 C123,147 110,153 104,155 L104,114 C112,109 118,100 122,90 Z" {...region('Lats')} />
            <path d="M78,90 C66,97 63,116 71,134 C77,147 90,153 96,155 L96,114 C88,109 82,100 78,90 Z" {...region('Lats')} />
            {/* triceps */}
            <ellipse cx="152" cy="112" rx="10" ry="17" {...region('Triceps')} />
            <ellipse cx="48" cy="112" rx="10" ry="17" {...region('Triceps')} />
            {/* forearms */}
            <ellipse cx="158" cy="155" rx="8" ry="22" {...region('Forearms')} />
            <ellipse cx="42" cy="155" rx="8" ry="22" {...region('Forearms')} />
            {/* lower back */}
            <rect x="87" y="148" width="26" height="20" rx="6" {...region('Lower Back')} />
            {/* glutes */}
            <ellipse cx="85" cy="188" rx="17" ry="17" {...region('Glutes')} />
            <ellipse cx="115" cy="188" rx="17" ry="17" {...region('Glutes')} />
            {/* hamstrings */}
            <ellipse cx="82" cy="254" rx="15" ry="40" {...region('Hamstrings')} />
            <ellipse cx="118" cy="254" rx="15" ry="40" {...region('Hamstrings')} />
            {/* calves */}
            <ellipse cx="83" cy="332" rx="11" ry="30" {...region('Calves')} />
            <ellipse cx="117" cy="332" rx="11" ry="30" {...region('Calves')} />
          </svg>
          <span className="hm-figure-label">Back</span>
        </div>
      </div>

      <div className="hm-detail">
        {selected ? (
          <>
            <span className="hm-detail-muscle">
              <span className="hm-detail-dot" style={{ background: heatColor(rate(selected)) }} />
              {selected}
            </span>
            <span className="hm-detail-stats">
              {formatSets(selectedHeat?.sets ?? 0)} sets in this window
              {' · '}{formatSets(rate(selected))}/week — {heatLabel(rate(selected))}
            </span>
          </>
        ) : (
          <span className="hm-detail-hint">Tap a muscle for details</span>
        )}
      </div>

      <div className="hm-legend">
        <div className="hm-legend-bar" />
        <div className="hm-legend-labels">
          <span>None</span>
          <span>On target</span>
          <span>Elevated</span>
          <span>High</span>
        </div>
      </div>
    </div>
  );
}

function formatSets(sets: number): string {
  const r = Math.round(sets * 2) / 2;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
