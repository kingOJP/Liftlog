import Foundation

// Port of src/data/recommendations.ts.

public struct LoggedSet: Codable, Hashable, Sendable {
    public var weight: Double
    public var reps: Double
    public var repLow: Int?
    public var repHigh: Int?
    public init(weight: Double, reps: Double, repLow: Int? = nil, repHigh: Int? = nil) {
        self.weight = weight; self.reps = reps; self.repLow = repLow; self.repHigh = repHigh
    }
}

public struct ExerciseSession: Codable, Hashable, Sendable {
    public var completedAt: Double
    public var sets: [LoggedSet]
    public var position: Int?
    public init(completedAt: Double, sets: [LoggedSet], position: Int? = nil) {
        self.completedAt = completedAt; self.sets = sets; self.position = position
    }
}
