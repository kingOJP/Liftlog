import Foundation

// Port of src/data/progress.ts.

public enum Progress {
    /// exerciseId → 0-based position within the workout. Prefers the stored
    /// `order`, else set-log insertion order (ids).
    public static func sessionExercisePositions(_ logs: [SetLog]) -> [String: Int] {
        var order: [String] = [], rank: [String: Double] = [:]
        for log in logs {
            let r = log.order.map(Double.init) ?? (log.id.map { Double($0) + 1_000_000 } ?? 9_007_199_254_740_991)
            if let prev = rank[log.exerciseId] { if r < prev { rank[log.exerciseId] = r } } else { order.append(log.exerciseId); rank[log.exerciseId] = r }
        }
        let sorted = order.jsSorted { rank[$0]! - rank[$1]! }
        return Dictionary(uniqueKeysWithValues: sorted.enumerated().map { ($1, $0) })
    }

    public static func snapshotPositions(_ snap: TrainingSnapshot) -> [Int: [String: Int]] {
        snap.setsBySession.mapValues(sessionExercisePositions)
    }
}
