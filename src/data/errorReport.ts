// Crash reports from the field.
//
// A phone has no console anyone can read. Uncaught errors, unhandled promise
// rejections and render crashes (the ErrorBoundary) are posted to
// /api/client-error, which writes them to the worker log. Deliberately small:
// a handful of reports per app launch, no breadcrumbs, no user content — the
// message, the stack, the build, and which screen was open.

import { APP_VERSION, BUILD_ID } from './appInfo';

const MAX_REPORTS_PER_LAUNCH = 5;
let sent = 0;
const seen = new Set<string>();
let currentScreen = 'startup';

/** The shell tells us which screen is showing so a report can say where. */
export function setReportScreen(screen: string): void {
  currentScreen = screen;
}

export function reportError(kind: 'error' | 'rejection' | 'render', error: unknown): void {
  try {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    const key = `${kind}:${message}`;
    if (sent >= MAX_REPORTS_PER_LAUNCH || seen.has(key)) return;
    seen.add(key);
    sent += 1;
    const body = JSON.stringify({
      kind,
      message: message.slice(0, 500),
      stack: stack?.slice(0, 4000),
      screen: currentScreen,
      version: `${APP_VERSION} (${BUILD_ID})`,
    });
    // keepalive: the report must survive the reload the crash screen offers.
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => {});
  } catch { /* reporting must never throw */ }
}

export function installErrorReporting(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', e => {
    // Resource load failures arrive here too, with no error object — skip them.
    if (e.error) reportError('error', e.error);
  });
  window.addEventListener('unhandledrejection', e => reportError('rejection', e.reason));
}
