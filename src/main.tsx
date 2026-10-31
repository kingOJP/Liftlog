import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { listenForServiceWorkerUpdates } from './data/appUpdate.ts'

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
