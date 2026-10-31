// A promise chain that serializes pull, push and purge.
//
// Before this, the 60 s background tick, the window-focus handler, the
// startup sequence and the post-workout push could all run at once: a pull
// adopting the server's program while a push was still building its payload
// from the old one, or a purge reading IndexedDB between two writes of the
// same workout. None of them coordinated. Every sync entry point now runs
// through `syncLock.run()`, so at most one of them touches local state at a
// time and each sees the previous one's result.
//
// Errors propagate to the caller that queued the work and never break the
// chain for the next caller.

export interface SyncLock {
  run<T>(task: () => Promise<T>): Promise<T>;
  /** true while a task holds the lock (for tests and status displays) */
  readonly busy: boolean;
}

export function createSyncLock(): SyncLock {
  // `tail` never rejects: a failed task settles it as resolved so that nobody
  // has to handle the chain's own rejection (an unhandled one surfaces as a
  // page error even though the caller that queued the task already caught it).
  let tail: Promise<void> = Promise.resolve();
  let depth = 0;
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const next = tail.then(async () => {
        depth += 1;
        try { return await task(); } finally { depth -= 1; }
      });
      tail = next.then(() => undefined, () => undefined);
      return next;
    },
    get busy() {
      return depth > 0;
    },
  };
}

/** The app-wide lock every sync entry point shares. */
export const syncLock = createSyncLock();
