// Keep the screen awake while a workout is open.
//
// A phone that dims and locks between sets means unlocking it with chalky
// hands before every log — every dedicated training app holds the screen on.
// The Screen Wake Lock API does it (iOS 16.4+; reliable in installed web apps
// from iOS 18.4). The browser drops the lock whenever the page is hidden, so
// it is re-acquired each time the app comes back to the foreground. Where the
// API is missing this is a no-op.

import { useEffect } from 'react';

interface WakeLockSentinelLike { release(): Promise<void> }
interface WakeLockLike { request(type: 'screen'): Promise<WakeLockSentinelLike> }

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined') return;
    const wakeLock = (navigator as unknown as { wakeLock?: WakeLockLike }).wakeLock;
    if (!wakeLock) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    async function acquire() {
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        const next = await wakeLock!.request('screen');
        if (cancelled) { void next.release().catch(() => {}); return; }
        sentinel = next;
      } catch {
        // Low-power mode or a denied request: the screen simply dims as before.
      }
    }

    function onVisible() {
      if (document.visibilityState === 'visible') void acquire();
    }

    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}
