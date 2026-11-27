import Foundation

/// draftSession.ts: the in-progress workout, written to the local store on
/// EVERY set change (SQLite commits synchronously, so an app kill loses
/// nothing) and cleared only when the workout is finished or discarded. The
/// slot is protected: a draft holding logged sets is never silently replaced.
public enum DraftStore {
    /// A draft older than this is a workout that was abandoned, not interrupted.
    public static let maxAgeMs: Double = 12 * 3_600_000

    public static func save(_ draft: DraftSession, store: KeyValueStore = LiftLogEnv.store) {
        store.setJSON(draft, StorageKey.draftSession)
    }

    public static func clear(store: KeyValueStore = LiftLogEnv.store) { store.removeItem(StorageKey.draftSession) }

    static func read(_ now: Double, _ store: KeyValueStore) -> DraftSession? {
        guard let d = store.getJSON(DraftSession.self, StorageKey.draftSession), now - d.savedAt <= maxAgeMs else { return nil }
        return d
    }

    public static func hasSets(_ d: DraftSession?) -> Bool { d?.sets.values.contains { !$0.isEmpty } ?? false }

    public static func resumable(dayId: Int, now: Double = LiftLogEnv.now(), store: KeyValueStore = LiftLogEnv.store) -> DraftSession? {
        guard let d = read(now, store), d.dayId == dayId else { return nil }
        return d
    }

    public static func unfinished(now: Double = LiftLogEnv.now(), store: KeyValueStore = LiftLogEnv.store) -> DraftSession? {
        let d = read(now, store)
        return hasSets(d) ? d : nil
    }

    /// A draft with logged sets for a DIFFERENT day: opening that day must ask first.
    public static func conflicting(dayId: Int, now: Double = LiftLogEnv.now(), store: KeyValueStore = LiftLogEnv.store) -> DraftSession? {
        guard let d = unfinished(now: now, store: store), d.dayId != dayId else { return nil }
        return d
    }
}
