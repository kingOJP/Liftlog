import Foundation

/// The `localStorage` equivalent: string keys to string values. The iOS app
/// keeps the PWA's keys (liftlog_program, liftlog_plan, …) and stores the same
/// JSON documents under them, so the sync wire format and the engines' reads
/// are shared verbatim between the two clients.
public protocol KeyValueStore: AnyObject {
    func getItem(_ key: String) -> String?
    func setItem(_ key: String, _ value: String)
    func removeItem(_ key: String)
    func allKeys() -> [String]
}

public final class InMemoryKeyValueStore: KeyValueStore {
    private var items: [String: String]
    public init(_ items: [String: String] = [:]) { self.items = items }
    public func getItem(_ key: String) -> String? { items[key] }
    public func setItem(_ key: String, _ value: String) { items[key] = value }
    public func removeItem(_ key: String) { items.removeValue(forKey: key) }
    public func allKeys() -> [String] { Array(items.keys).sorted() }
}

extension KeyValueStore {
    public func getJSON<T: Decodable>(_ type: T.Type, _ key: String) -> T? {
        guard let raw = getItem(key), let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    public func setJSON<T: Encodable>(_ value: T, _ key: String) {
        let enc = JSONEncoder()
        enc.outputFormatting = [.withoutEscapingSlashes]
        if let data = try? enc.encode(value), let s = String(data: data, encoding: .utf8) { setItem(key, s) }
    }
}

/// The PWA's localStorage keys (CLAUDE.md "localStorage keys").
public enum StorageKey {
    public static let program = "liftlog_program"
    public static let exercises = "liftlog_exercises"
    public static let exerciseMeta = "liftlog_exercise_meta"
    public static let settings = "liftlog_settings"
    public static let restSeconds = "liftlog_rest_seconds"
    public static let deletedExercises = "liftlog_deleted_exercises"
    public static let globalMeta = "liftlog_global_meta"
    public static let role = "liftlog_role"
    public static let deletedSessions = "liftlog_deleted_sessions"
    public static let draftSession = "liftlog_draft_session"
    public static let plan = "liftlog_plan"
    public static let dataOwner = "liftlog_data_owner"
    public static let programUpdated = "liftlog_program_updated"
    public static let restoredExercises = "liftlog_restored_exercises"
    public static let exerciseMerges = "liftlog_exercise_merges"
    public static let syncStatus = "liftlog_sync_status"
    public static let syncEtag = "liftlog_sync_etag"
    public static let weightUnit = "liftlog_weight_unit"
    public static let libraryV2 = "liftlog_library_v2"
    public static let libraryV3 = "liftlog_library_v3"
}
