import './Segmented.css';

interface Option<T extends string> {
  id: T;
  label: string;
}

interface Props<T extends string> {
  options: ReadonlyArray<Option<T>>;
  value: T;
  onChange: (id: T) => void;
  /** what the control chooses, for screen readers */
  label: string;
  /**
   * `tabs` switches the content below it (solid accent thumb, tab semantics);
   * `filter` narrows what a card shows (tinted thumb, toggle semantics).
   */
  variant?: 'tabs' | 'filter';
  /** id prefix so a tab can name the panel it controls: `${idBase}-tab-x` / `${idBase}-panel-x` */
  idBase?: string;
}

/**
 * The pill-shaped segmented control: equal segments and one thumb that slides
 * to the chosen one, the way the native iOS control does.
 */
export default function Segmented<T extends string>({ options, value, onChange, label, variant = 'filter', idBase }: Props<T>) {
  const index = Math.max(0, options.findIndex(o => o.id === value));
  const tabs = variant === 'tabs';
  return (
    <div
      className={`seg seg--${variant}`}
      role={tabs ? 'tablist' : 'group'}
      aria-label={label}
      style={{ '--seg-count': options.length, '--seg-index': index } as React.CSSProperties}
    >
      {options.map(o => {
        const active = o.id === value;
        const a11y = tabs
          ? {
              role: 'tab' as const,
              'aria-selected': active,
              id: idBase ? `${idBase}-tab-${o.id}` : undefined,
              'aria-controls': idBase ? `${idBase}-panel-${o.id}` : undefined,
            }
          : { 'aria-pressed': active };
        return (
          <button
            key={o.id}
            type="button"
            className={`seg-btn${active ? ' is-active' : ''}`}
            onClick={() => onChange(o.id)}
            {...a11y}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
