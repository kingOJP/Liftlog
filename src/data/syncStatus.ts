// Sync visibility.
//
// Pull and push used to fail silently: a 401 returned as if nothing happened,
// every caller swallowed errors, and a workout whose post-Finish push failed
// (offline, or the worker rejecting the payload) sat on the device until the
// PWA was next cold-started — on iOS, possibly days — where an account switch
// would then wipe it. This module is the small amount of state needed to make
// that visible and self-healing:
//
//   • `hasUnpushed` is set the moment a push begins and cleared only when one
//     succeeds. Every local mutation already triggers a push, so a failed one
//     leaves the flag up and the background tick retries it.
//   • `authExpired` is set on a 401 from either direction so the UI can offer
//     a re-sign-in instead of looking synced while uploading nothing.
//   • `lastSuccessAt` / `lastError` feed the Settings line and the Dashboard
//     badge.
//
// Device-local (not synced — it describes this device's relationship to the
// server). Subscribers are notified synchronously on every change so React
// views can `useSyncExternalStore` it.

export interface SyncStatus {
  lastSuccessAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  hasUnpushed: boolean;
  authExpired: boolean;
}

const KEY = 'liftlog_sync_status';

const DEFAULT: SyncStatus = {
  lastSuccessAt: null, lastError: null, lastErrorAt: null, hasUnpushed: false, authExpired: false,
};

let cached: SyncStatus | null = null;
const listeners = new Set<() => void>();

function load(): SyncStatus {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    cached = raw ? { ...DEFAULT, ...(JSON.parse(raw) as Partial<SyncStatus>) } : { ...DEFAULT };
  } catch {
    cached = { ...DEFAULT };
  }
  return cached;
}

function write(next: SyncStatus): void {
  cached = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // quota or private mode — the in-memory copy still drives the UI
  }
  for (const l of listeners) l();
}

export function getSyncStatus(): SyncStatus {
  return load();
}

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A push is starting — until it succeeds, this device has unpushed data. */
export function markPushStarted(): void {
  const s = load();
  if (!s.hasUnpushed) write({ ...s, hasUnpushed: true });
}

export function markPushSucceeded(now = Date.now()): void {
  write({ ...load(), hasUnpushed: false, authExpired: false, lastSuccessAt: now, lastError: null, lastErrorAt: null });
}

export function markPullSucceeded(now = Date.now()): void {
  write({ ...load(), authExpired: false, lastSuccessAt: now, lastError: null, lastErrorAt: null });
}

export function markSyncFailed(error: unknown, now = Date.now()): void {
  const message = error instanceof Error ? error.message : String(error);
  write({ ...load(), lastError: message, lastErrorAt: now });
}

export function markAuthExpired(now = Date.now()): void {
  write({ ...load(), authExpired: true, lastError: 'Signed out — sign in again to keep syncing', lastErrorAt: now });
}

export function clearSyncStatus(): void {
  write({ ...DEFAULT });
}

/** Human line for Settings: "Synced 3 min ago", "Never synced", or the error. */
export function describeSyncStatus(s: SyncStatus = load(), now = Date.now()): string {
  if (s.authExpired) return 'Signed out — sign in again to keep syncing';
  if (s.lastError && (s.lastSuccessAt == null || (s.lastErrorAt ?? 0) > s.lastSuccessAt)) {
    return `Sync failing — ${s.lastError}`;
  }
  if (s.lastSuccessAt == null) return 'Not synced yet';
  const ago = Math.max(0, now - s.lastSuccessAt);
  const mins = Math.round(ago / 60_000);
  const when = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago`
    : mins < 24 * 60 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / (24 * 60))} d ago`;
  return s.hasUnpushed ? `Last synced ${when} — changes waiting to upload` : `Synced ${when}`;
}
