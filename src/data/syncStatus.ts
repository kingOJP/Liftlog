// Sync status — the one place that knows whether this device's data is
// actually reaching the server.
//
// pushSync/pullSync (sync.ts) report every outcome here; the UI subscribes
// (components/useSyncStatus.ts → useSyncExternalStore) and surfaces problems:
// a dashboard banner when sync is failing and a status line in Settings.
// Before this existed, a failed push died in console.error and the user found
// out on their next device switch — as a missing week of workouts.
//
// The store is deliberately tiny and pure-ish (module state + localStorage for
// the last-success timestamp) so the transition rules are unit-testable
// without touching fetch or React.

export type SyncState = 'ok' | 'offline' | 'auth' | 'error';

export interface SyncStatus {
  state: SyncState;
  /** ms timestamp of the last successful push or pull on this device */
  lastSyncAt: number | null;
  /**
   * true while local changes may not have reached the server (the most recent
   * push failed). Drives the automatic retry in App's background tick — and
   * keeps a later successful *pull* from masking a failing push.
   */
  pushPending: boolean;
}

// Device-local, user-scoped (cleared on account switch): when this device
// last successfully talked to the server, surviving reloads so "last backed
// up 3 days ago" is meaningful after reopening the app.
const LAST_SYNC_KEY = 'liftlog_last_sync';

function readStoredLastSync(): number | null {
  const raw = Number(localStorage.getItem(LAST_SYNC_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

let status: SyncStatus = {
  state: 'ok',
  lastSyncAt: readStoredLastSync(),
  pushPending: false,
};

const listeners = new Set<() => void>();

/** Stable snapshot — the object is replaced (never mutated) on each report. */
export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setStatus(next: SyncStatus): void {
  if (
    next.state === status.state &&
    next.lastSyncAt === status.lastSyncAt &&
    next.pushPending === status.pushPending
  ) {
    return; // nothing changed — don't re-render subscribers
  }
  status = next;
  for (const l of listeners) l();
}

export function reportSyncSuccess(kind: 'push' | 'pull', now = Date.now()): void {
  localStorage.setItem(LAST_SYNC_KEY, String(now));
  const pushPending = kind === 'push' ? false : status.pushPending;
  setStatus({
    // A pull succeeding while a push is still unconfirmed isn't "all good" —
    // the local changes haven't reached the server yet.
    state: pushPending ? status.state : 'ok',
    lastSyncAt: now,
    pushPending,
  });
}

export function reportSyncFailure(kind: 'push' | 'pull', state: Exclude<SyncState, 'ok'>): void {
  setStatus({
    state,
    lastSyncAt: status.lastSyncAt,
    pushPending: kind === 'push' ? true : status.pushPending,
  });
}

/** Account switch: the timestamp belongs to the previous account's data. */
export function clearSyncStatus(): void {
  localStorage.removeItem(LAST_SYNC_KEY);
  setStatus({ state: 'ok', lastSyncAt: null, pushPending: false });
}

/** "just now", "5m ago", "3h ago", "2d ago" — for the status line. */
export function formatSyncAge(ts: number, now = Date.now()): string {
  const mins = Math.floor((now - ts) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
