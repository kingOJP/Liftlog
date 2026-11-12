// The seam between the web app and a native iOS wrapper.
//
// LiftLog ships as a PWA and is meant to be wrapped for the App Store (see
// docs/ios-launch.md). The same build runs in both, so everything that differs
// goes through here and feature-detects at call time:
//
//  - Sign-in. Google refuses OAuth inside an embedded web view, and the system
//    browser's cookies are invisible to the app's web view. In the wrapper the
//    provider page opens in the system browser sheet with `native=1`; the
//    server then returns to the app with a one-time code (worker/auth.ts) that
//    the web view trades for its session at /api/auth/exchange.
//  - Haptics. iOS Safari has no navigator.vibrate; a wrapper has the Taptic
//    Engine.
//
// The wrapper is detected through the Capacitor bridge it injects. Nothing
// here imports Capacitor: on the web the global is absent and every function
// falls back to the browser behaviour.

interface CapacitorPlugin { [method: string]: ((options?: unknown) => Promise<unknown>) | undefined }
interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, CapacitorPlugin | undefined>;
}

function bridge(): CapacitorBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor ?? null;
}

export function isNativeApp(): boolean {
  try { return bridge()?.isNativePlatform?.() === true; } catch { return false; }
}

function plugin(name: string): CapacitorPlugin | null {
  return isNativeApp() ? bridge()?.Plugins?.[name] ?? null : null;
}

/** Lets CSS tell the wrapper apart from a browser tab (see index.css). */
export function markNativeApp(): void {
  if (isNativeApp()) document.documentElement.classList.add('native-app');
}

export type SignInProvider = 'google' | 'apple';

export function signInPath(provider: SignInProvider, native = isNativeApp()): string {
  return `/api/auth/${provider}${native ? '?native=1' : ''}`;
}

/**
 * Start a sign-in. Returns false when the browser should simply follow the
 * link (the web); true when the native wrapper took over.
 */
export function startNativeSignIn(provider: SignInProvider): boolean {
  const browser = plugin('Browser');
  if (!browser?.open) return false;
  const url = new URL(signInPath(provider, true), window.location.origin).toString();
  browser.open({ url, presentationStyle: 'popover' })?.catch(() => { window.location.href = signInPath(provider, false); });
  return true;
}

/**
 * The wrapper re-opens the app at `<scheme>://auth?code=…` when sign-in
 * finishes. Close the browser sheet and trade the code for the session — a
 * top-level navigation, so the cookie is set in the web view itself.
 */
export function listenForNativeSignIn(): void {
  const app = plugin('App');
  if (!app?.addListener) return;
  const addListener = app.addListener as unknown as
    (event: string, cb: (data: { url?: string }) => void) => Promise<unknown>;
  addListener('appUrlOpen', ({ url }) => {
    if (!url) return;
    let parsed: URL;
    try { parsed = new URL(url); } catch { return; }
    if (parsed.host !== 'auth' && !parsed.pathname.replace(/^\/+/, '').startsWith('auth')) return;
    plugin('Browser')?.close?.()?.catch(() => {});
    const code = parsed.searchParams.get('code');
    window.location.href = code
      ? `/api/auth/exchange?code=${encodeURIComponent(code)}`
      : '/?error=auth_failed';
  })?.catch(() => {});
}

export type HapticKind = 'light' | 'success';

/** A short tap (set logged) or a double buzz (rest over). Silent where unsupported. */
export function haptic(kind: HapticKind): void {
  try {
    const haptics = plugin('Haptics');
    if (haptics) {
      if (kind === 'success') haptics.notification?.({ type: 'SUCCESS' })?.catch(() => {});
      else haptics.impact?.({ style: 'LIGHT' })?.catch(() => {});
      return;
    }
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(kind === 'success' ? [120, 60, 120] : 12);
    }
  } catch { /* haptics are never worth an error */ }
}
