// "A new version is ready."
//
// The service worker is registered with registerType: 'autoUpdate', which
// installs and activates a new build as soon as the browser finds it — but
// nothing told the running page, so a resident iOS PWA kept executing stale
// JS against a newer worker for days, and a client/server contract change
// surfaced as sync quietly failing (audit M15). The browser signals the
// takeover with `controllerchange`; this module turns that into a flag the
// shell renders as a reload toast (never over an open workout — App decides
// when to show it).

let ready = false;
const listeners = new Set<() => void>();

export function getUpdateReady(): boolean {
  return ready;
}

export function subscribeUpdateReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Flip the flag (exposed for tests and for a manual trigger). */
export function markUpdateReady(): void {
  if (ready) return;
  ready = true;
  for (const l of listeners) l();
}

/**
 * Start listening. A page that had no controller when it loaded (the very
 * first visit) gets one when the first service worker claims it — that is an
 * install, not an update, so only a *change* of controller counts.
 */
export function listenForServiceWorkerUpdates(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  let hadController = navigator.serviceWorker.controller != null;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) markUpdateReady();
    hadController = true;
  });
}
