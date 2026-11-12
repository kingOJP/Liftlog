import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { listenForServiceWorkerUpdates } from './data/appUpdate.ts'
import { installErrorReporting } from './data/errorReport.ts'
import { listenForNativeSignIn, markNativeApp } from './data/native.ts'

installErrorReporting();
// Inside the native wrapper, sign-in finishes with the app being re-opened by URL.
listenForNativeSignIn();
markNativeApp();

// Ask the browser not to evict this origin's storage under pressure. Workouts
// sync, but a draft or an unpushed session lives only here; Safari in
// particular clears script-writable storage for sites it considers idle.
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// iOS PWAs don't get background SW updates — force a check every time
// the app comes to the foreground (home screen tap, app switcher return, etc.)
// When a check finds a new build and it takes over, the shell offers a reload
// (data/appUpdate.ts) instead of running stale code against a newer worker.
if ('serviceWorker' in navigator) {
  listenForServiceWorkerUpdates();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      navigator.serviceWorker.getRegistration().then(reg => reg?.update());
    }
  });
}
