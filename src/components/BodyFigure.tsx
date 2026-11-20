import { useId } from 'react';
import type { MuscleGroup } from '../data/taxonomy';
import { BACK_FIGURE, FRONT_FIGURE, FIGURE_HEIGHT, FIGURE_WIDTH } from './bodyFigureData';
import './BodyFigure.css';

interface Props {
  view: 'front' | 'back';
  /** fill for a muscle's regions — the heat colour */
  colorFor: (muscle: MuscleGroup) => string;
  /** what a region says to a screen reader, e.g. "12 sets a week" */
  describe?: (muscle: MuscleGroup) => string;
  selected?: MuscleGroup | null;
  /** omit for a static illustration; pass to make every muscle a control */
  onSelect?: (muscle: MuscleGroup) => void;
}

// The data holds the figure's left half; the right is the same path flipped
// about the centre line.
const MIRROR = `matrix(-1 0 0 1 ${FIGURE_WIDTH} 0)`;

function Halves({ d, whole, ...rest }: { d: string; whole?: boolean } & React.SVGProps<SVGPathElement>) {
  return (
    <>
      <path d={d} {...rest} />
      {!whole && <path d={d} transform={MIRROR} {...rest} />}
    </>
  );
}

/**
 * One anatomical figure: the traced silhouette with its shading, and a region
 * per muscle group filled by the caller. Each muscle is ONE control however
 * many shapes it has (six for the abs), so it is one tab stop and one label.
 */
export default function BodyFigure({ view, colorFor, describe, selected = null, onSelect }: Props) {
  const fig = view === 'front' ? FRONT_FIGURE : BACK_FIGURE;
  const sheen = `${useId()}sheen`;
  const interactive = !!onSelect;

  return (
    <svg
      className={`body-figure${selected ? ' has-selection' : ''}`}
      viewBox={`0 0 ${FIGURE_WIDTH} ${FIGURE_HEIGHT}`}
      role={interactive ? 'group' : 'img'}
      aria-label={`${view === 'front' ? 'Front' : 'Back'} of the body, muscles shaded by training volume`}
    >
      <defs>
        {/* Top-lit sheen laid over every muscle, sized to each shape's own box */}
        <linearGradient id={sheen} x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.2" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.22" />
        </linearGradient>
      </defs>

      <g aria-hidden="true">
        <Halves d={fig.body} className="bf-base" />
        <Halves d={fig.tones[0]} className="bf-mid" />
        <Halves d={fig.tones[1]} className="bf-rim" />
      </g>

      {fig.regions.map(region => {
        const m = region.muscle;
        const isSelected = selected === m;
        const control = interactive ? {
          role: 'button' as const,
          tabIndex: 0,
          'aria-label': describe ? `${m}: ${describe(m)}` : m,
          'aria-pressed': isSelected,
          onClick: () => onSelect(m),
          onKeyDown: (e: React.KeyboardEvent<SVGGElement>) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(m); }
          },
        } : { 'aria-hidden': true as const };
        return (
          <g
            key={m}
            className={`bf-region${interactive ? ' bf-region--tap' : ''}${isSelected ? ' is-selected' : ''}`}
            fill={colorFor(m)}
            {...control}
          >
            {region.paths.map((d, i) => <Halves key={i} d={d} whole={region.whole} className="bf-shape" />)}
            {region.paths.map((d, i) => <Halves key={`s${i}`} d={d} whole={region.whole} className="bf-sheen" fill={`url(#${sheen})`} />)}
          </g>
        );
      })}
    </svg>
  );
}
