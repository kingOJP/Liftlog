import { useEffect, useState, useSyncExternalStore } from 'react';
import Icon from './Icon';
import type { IconName } from './Icon';
import { signInPath, startNativeSignIn } from '../data/native';
import type { SignInProvider } from '../data/native';
import './LoginView.css';

// Whether Sign in with Apple is configured on the server. Remembered between
// launches so the button doesn't pop in after the screen has painted.
const APPLE_KEY = 'liftlog_apple_signin';

function useAppleAvailable(): boolean {
  const [available, setAvailable] = useState(() => {
    try { return localStorage.getItem(APPLE_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/providers')
      .then(res => (res.ok ? res.json() : null))
      .then((providers: { apple?: boolean } | null) => {
        if (cancelled || !providers) return;
        const apple = providers.apple === true;
        setAvailable(apple);
        try { localStorage.setItem(APPLE_KEY, apple ? '1' : '0'); } catch { /* private mode */ }
      })
      .catch(() => { /* offline: keep what we knew */ });
    return () => { cancelled = true; };
  }, []);
  return available;
}

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

const FEATURES: Array<{ icon: IconName; label: string }> = [
  { icon: 'calendar', label: 'Personalized training plans' },
  { icon: 'chart', label: 'Smart weight recommendations' },
  { icon: 'bolt', label: 'Track progress & hit goals' },
];

export default function LoginView({ error }: { error?: string }) {
  const appleAvailable = useAppleAvailable();
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

  // On the web the link is simply followed. Inside the native wrapper the
  // provider page has to open in the system browser instead (data/native.ts).
  function handleSignIn(provider: SignInProvider) {
    return (e: React.MouseEvent) => {
      if (startNativeSignIn(provider)) e.preventDefault();
    };
  }

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

          {!online && (
            <p className="login-offline" role="status">
              You're offline. Connect to the internet to sign in — after that, LiftLog works without a connection.
            </p>
          )}

          {appleAvailable && (
            <a href={signInPath('apple')} className="apple-btn" onClick={handleSignIn('apple')}>
              <svg className="apple-logo" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path fill="currentColor" d="M17.05 12.54c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.01-3.76-2.04-1.6-.16-3.12.94-3.93.94-.81 0-2.06-.92-3.39-.89-1.74.03-3.35 1.01-4.25 2.57-1.81 3.14-.46 7.79 1.3 10.34.86 1.25 1.89 2.65 3.24 2.6 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.39.81 1.4-.02 2.29-1.27 3.14-2.53.99-1.45 1.4-2.85 1.42-2.93-.03-.01-2.72-1.04-2.74-4.12zM14.46 4.9c.72-.87 1.2-2.08 1.07-3.28-1.03.04-2.28.69-3.02 1.55-.66.77-1.24 2-1.09 3.18 1.15.09 2.32-.58 3.04-1.45z"/>
              </svg>
              Continue with Apple
            </a>
          )}

          <a href={signInPath('google')} className="google-btn" onClick={handleSignIn('google')}>
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
          <p className="login-legal">
            By continuing you agree to the <a href="/terms">Terms of Use</a> and{' '}
            <a href="/privacy">Privacy Policy</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
