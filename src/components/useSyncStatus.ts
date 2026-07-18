import { useSyncExternalStore } from 'react';
import { getSyncStatus, subscribeSyncStatus } from '../data/syncStatus';
import type { SyncStatus } from '../data/syncStatus';

// Live view of the sync-status store (data/syncStatus.ts). getSyncStatus
// returns a stable snapshot object that is only replaced when something
// actually changed, so subscribers re-render exactly when the status does.
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
}
