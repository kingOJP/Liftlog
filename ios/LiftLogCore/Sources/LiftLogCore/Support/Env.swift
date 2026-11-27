import Foundation

/// Process-wide environment the engines read instead of browser globals:
/// `localStorage` (a key–value store holding the same keys and JSON documents
/// the PWA stores), `Date.now()` and the local time zone.
public enum LiftLogEnv {
    nonisolated(unsafe) public static var store: KeyValueStore = InMemoryKeyValueStore()
    /// Overridable clock (milliseconds since the epoch), like `Date.now()`.
    nonisolated(unsafe) public static var nowProvider: () -> Double = { (Date().timeIntervalSince1970 * 1000).rounded(.down) }
    nonisolated(unsafe) public static var timeZone: TimeZone = .current

    public static func now() -> Double { nowProvider() }
}
