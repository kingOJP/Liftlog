// Mirrors src/data/exercises.ts (ExerciseMetaOverride, liftlog_exercise_meta),
// src/data/settings.ts, src/data/syncStatus.ts and the worker push payload
// (worker/sync.ts PushPayload).

public struct ExerciseMetaOverride: Codable, Hashable, Sendable {
    public var primaryMuscle: MuscleGroup?
    public var secondaryMuscle1: MuscleGroup?
    public var secondaryMuscle2: MuscleGroup?
    public var secondaryMuscle3: MuscleGroup?
    public var workoutType: MovementPattern?
    public var equipment: Equipment?
    public var weightType: WeightType?
    public var updatedAt: Double?
    /// A stored bare legacy 'Press' whose plane depends on the exercise id. It
    /// round-trips as "Press" so Catalog.readMetaMap can resolve it by id.
    public var legacyPress = false

    public init(primaryMuscle: MuscleGroup? = nil, secondaryMuscle1: MuscleGroup? = nil, secondaryMuscle2: MuscleGroup? = nil,
                secondaryMuscle3: MuscleGroup? = nil, workoutType: MovementPattern? = nil, equipment: Equipment? = nil,
                weightType: WeightType? = nil, updatedAt: Double? = nil) {
        self.primaryMuscle = primaryMuscle; self.secondaryMuscle1 = secondaryMuscle1; self.secondaryMuscle2 = secondaryMuscle2
        self.secondaryMuscle3 = secondaryMuscle3; self.workoutType = workoutType; self.equipment = equipment
        self.weightType = weightType; self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey { case primaryMuscle, secondaryMuscle1, secondaryMuscle2, secondaryMuscle3, workoutType, equipment, weightType, updatedAt }

    // Legacy taxonomy names are mapped on decode the same way exercises.ts
    // normalizeOverride does (Front Delts → Delts, Chest Press → Horizontal Press,
    // Leg Press Machine → Machine), so an old row keeps its classification.
    // The id-dependent legacy 'Press' plane is resolved by Catalog.readMetaMap.
    static let legacyMuscles = ["Front Delts": "Delts", "Side Delts": "Delts", "Rear Delts": "Delts"]
    static let legacyWorkoutTypes = ["Chest Press": "Horizontal Press", "Push Up": "Horizontal Press",
                                     "Overhead Press": "Vertical Press"]
    static let legacyEquipment = ["Leg Press Machine": "Machine"]

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func mapped<T: RawRepresentable>(_ key: CodingKeys, _ legacy: [String: String]) -> T? where T.RawValue == String {
            guard let raw = try? c.decodeIfPresent(String.self, forKey: key) else { return nil }
            return T(rawValue: legacy[raw] ?? raw)
        }
        primaryMuscle = mapped(.primaryMuscle, Self.legacyMuscles)
        secondaryMuscle1 = mapped(.secondaryMuscle1, Self.legacyMuscles)
        secondaryMuscle2 = mapped(.secondaryMuscle2, Self.legacyMuscles)
        secondaryMuscle3 = mapped(.secondaryMuscle3, Self.legacyMuscles)
        workoutType = mapped(.workoutType, Self.legacyWorkoutTypes)
        legacyPress = workoutType == nil && (try? c.decodeIfPresent(String.self, forKey: .workoutType)) == "Press"
        equipment = mapped(.equipment, Self.legacyEquipment)
        weightType = mapped(.weightType, [:])
        updatedAt = try c.decodeIfPresent(Double.self, forKey: .updatedAt)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(primaryMuscle, forKey: .primaryMuscle)
        try c.encode(secondaryMuscle1, forKey: .secondaryMuscle1)
        try c.encode(secondaryMuscle2, forKey: .secondaryMuscle2)
        try c.encode(secondaryMuscle3, forKey: .secondaryMuscle3)
        if workoutType == nil && legacyPress { try c.encode("Press", forKey: .workoutType) }
        else { try c.encode(workoutType, forKey: .workoutType) }
        try c.encode(equipment, forKey: .equipment)
        try c.encode(weightType, forKey: .weightType)
        try c.encodeIfPresent(updatedAt, forKey: .updatedAt)
    }
}

/// liftlog_settings
public struct Settings: Codable, Hashable, Sendable {
    public var programStart: String?
    public init(programStart: String? = nil) { self.programStart = programStart }
}

public enum UserRole: String, Codable, Hashable, Sendable { case user, admin, tester }

/// liftlog_sync_status
public struct SyncStatus: Codable, Hashable, Sendable {
    public var lastSuccessAt: Double?
    public var lastPullAt: Double?
    public var lastError: String?
    public var lastErrorAt: Double?
    public var hasUnpushed: Bool
    public var authExpired: Bool

    enum CodingKeys: String, CodingKey { case lastSuccessAt, lastPullAt, lastError, lastErrorAt, hasUnpushed, authExpired }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(lastSuccessAt, forKey: .lastSuccessAt); try c.encode(lastPullAt, forKey: .lastPullAt)
        try c.encode(lastError, forKey: .lastError); try c.encode(lastErrorAt, forKey: .lastErrorAt)
        try c.encode(hasUnpushed, forKey: .hasUnpushed); try c.encode(authExpired, forKey: .authExpired)
    }
}
