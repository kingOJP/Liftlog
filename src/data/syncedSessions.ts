// Which workouts the server is KNOWN to hold.
//
// `hasUnpushed` says "a push is owed"; it cannot say how much is at stake. When
// sync fails for days the question the user needs answered is concrete: how
// many of my workouts exist only on this phone? This is the ledger that
// answers it — session guid → the `updatedAt` the server acknowledged — written
// in exactly two places: after a push the server accepted (everything sent is
// there) and after a pull (everything received is there). A session whose
// current clock is not the acknowledged one is local-only, or edited since.
//
// Device-local, user-scoped (cleared on account switch). A device upgrading to
// this build has an empty ledger, so everything reads as "not confirmed" until
// its first successful sync a few seconds later — the safe direction to be
// wrong in.

import type { Session } from '../db/database';
import { sessionGuid, sessionUpdatedAt } from './syncMerge';

const KEY = 'liftlog_synced_sessions';

type Ledger = Record<string, number>;

function read(): Ledger {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed as Ledger : {};
  } catch {
    return {};
  }
}

function write(ledger: Ledger): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ledger));
  } catch {
    // quota — the ledger only ever makes the warning more precise
  }
}

/** The server acknowledged these sessions at these clocks. */
export function recordSyncedSessions(entries: Array<{ guid: string; updatedAt: number }>): void {
  if (entries.length === 0) return;
  const ledger = read();
  for (const e of entries) {
    if (!(ledger[e.guid] >= e.updatedAt)) ledger[e.guid] = e.updatedAt;
  }
  write(ledger);
}

/** Sessions on this device the server has not acknowledged in their current form. */
export function unbackedSessions(sessions: Session[]): Session[] {
  const ledger = read();
  return sessions.filter(s => !(ledger[sessionGuid(s)] >= sessionUpdatedAt(s)));
}

export function clearSyncedSessions(): void {
  localStorage.removeItem(KEY);
}
