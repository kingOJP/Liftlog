import Icon from './Icon';
import type { IconName } from './Icon';
import './LoginView.css';

const FEATURES: Array<{ icon: IconName; label: string }> = [
  { icon: 'calendar', label: 'Personalized training plans' },
  { icon: 'chart', label: 'Smart weight recommendations' },
  { icon: 'bolt', label: 'Track progress & hit goals' },
];

export default function LoginView({ error }: { error?: string }) {
  return (
    <div className="login-view">
      {/* Gym backdrop drawn in CSS + SVG rather than a photo: nothing to
          license or download, and it renders offline from the PWA cache. */}
      <div className="login-backdrop" aria-hidden="true">
        <svg className="login-plate" viewBox="0 0 320 320">
          <defs>
            <radialGradient id="plate-face" cx="38%" cy="32%" r="75%">
              <stop offset="0%" stopColor="#383843" />
              <stop offset="60%" stopColor="#18181f" />
              <stop offset="100%" stopColor="#0b0b0f" />
            </radialGradient>
            <linearGradient id="plate-bar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3a3a44" />
              <stop offset="50%" stopColor="#1c1c22" />
              <stop offset="100%" stopColor="#0e0e12" />
            </linearGradient>
          </defs>
          <rect x="0" y="146" width="320" height="28" rx="6" fill="url(#plate-bar)" />
          <circle cx="190" cy="160" r="150" fill="url(#plate-face)" />
          <circle cx="190" cy="160" r="150" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2" />
          <circle cx="190" cy="160" r="112" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="10" />
          <circle cx="190" cy="160" r="34" fill="#101015" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
          <circle cx="190" cy="160" r="16" fill="#08080b" />
        </svg>
      </div>

      <div className="login-content">
        <div className="login-brand">
          <Icon name="logo" size={34} strokeWidth={2.6} className="login-brand-mark" />
          <span>LiftLog</span>
        </div>

        <div className="login-hero">
          <h1 className="login-headline">
            Train smarter.
            <span className="login-headline-accent">Get stronger.</span>
          </h1>
          <p className="login-tagline">
            A data-driven strength coach in your pocket — plan, train, and progress
            with confidence.
          </p>
        </div>

        <ul className="login-features">
          {FEATURES.map(f => (
            <li key={f.label} className="login-feature">
              <Icon name={f.icon} size={24} strokeWidth={1.5} />
              <span>{f.label}</span>
            </li>
          ))}
        </ul>

        <div className="login-actions">
          {error && (
            <p className="login-error" role="alert">Sign-in failed. Please try again.</p>
          )}

          <a href="/api/auth/google" className="google-btn">
            <svg className="google-logo" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </a>

          <p className="login-footnote">
            New here? Signing in creates your account — your training syncs across devices.
          </p>
        </div>
      </div>
    </div>
  );
}
