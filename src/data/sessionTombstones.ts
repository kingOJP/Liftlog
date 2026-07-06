// Deleted-session tombstones (session GUIDs), mirroring the deleted-exercise
// tombstones. Under merge-based sync a locally deleted session would otherwise
// resurrect from the server copy on the next pull — recording the deletion and
// syncing it both ways makes deletes durable. Sessions are only ever deleted
// by cleanup (empty "ghost" sessions) or by wiping an exercise's history, but
// the mechanism is general.
//
// Tombstones are user-scoped: they are cleared on account switch.

const KEY = 'liftlog_deleted_sessions';

export function getSessionTombstones(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? JSON.parse(raw) as string[] : []);
  } catch {
    return new Set();
  }
}

export function addSessionTombstones(guids: string[]): void {
  if (guids.length === 0) return;
  const merged = getSessionTombstones();
  for (const g of guids) merged.add(g);
  localStorage.setItem(KEY, JSON.stringify([...merged]));
}

export function clearSessionTombstones(): void {
  localStorage.removeItem(KEY);
}
