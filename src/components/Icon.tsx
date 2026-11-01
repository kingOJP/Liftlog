// Minimal stroke icon set — one visual language across the app instead of
// emoji, which render differently on every platform. 24×24 grid, 1.75 stroke,
// currentColor, so an icon takes its colour from the text around it.

export type IconName =
  | 'logo' | 'calendar' | 'chart' | 'history' | 'settings' | 'bolt'
  | 'chevron-right' | 'check' | 'plus' | 'dumbbell' | 'clock' | 'trophy'
  | 'target' | 'body';

const PATHS: Record<IconName, React.ReactNode> = {
  logo: <path d="M3 9v6M6.5 6.5v11M17.5 6.5v11M21 9v6M6.5 12h11" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01" strokeWidth="2.4" />
    </>
  ),
  chart: <path d="M5 20V12M10 20V6M15 20v-9M20 20V4" />,
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3 4v4.5h4.5M12 7.5V12l3 2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  bolt: <path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12l1-8z" />,
  'chevron-right': <path d="m9 5.5 6.5 6.5L9 18.5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  dumbbell: <path d="M4.5 9v6M7.5 7v10M16.5 7v10M19.5 9v6M7.5 12h9" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  trophy: <path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20.5h7M9.5 17h5" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" />
    </>
  ),
  body: (
    <>
      <circle cx="12" cy="4.5" r="2" />
      <path d="M6 8.5h12M12 8.5v6M12 14.5l-3 6.5M12 14.5l3 6.5" />
    </>
  ),
};

interface Props {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

export default function Icon({ name, size = 20, className, strokeWidth = 1.75 }: Props) {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
