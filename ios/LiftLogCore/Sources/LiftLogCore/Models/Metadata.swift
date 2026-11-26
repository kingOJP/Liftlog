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

    public init(primaryMuscle: MuscleGroup? = nil, secondaryMuscle1: MuscleGroup? = nil, secondaryMuscle2: MuscleGroup? = nil,
                secondaryMuscle3: MuscleGroup? = nil, workoutType: MovementPattern? = nil, equipment: Equipment? = nil,
                weightType: WeightType? = nil, updatedAt: Double? = nil) {
        self.primaryMuscle = primaryMuscle; self.secondaryMuscle1 = secondaryMuscle1; self.secondaryMuscle2 = secondaryMuscle2
        self.secondaryMuscle3 = secondaryMuscle3; self.workoutType = workoutType; self.equipment = equipment
        self.weightType = weightType; self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey { case primaryMuscle, secondaryMuscle1, secondaryMuscle2, secondaryMuscle3, workoutType, equipment, weightType, updatedAt }

    // Unknown/legacy taxonomy strings decode as null here; the TS reader
    // normalizes legacy names (exercises.ts LEGACY_MUSCLES) — the engine port
    // applies the same normalization on read.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        primaryMuscle = c.decodeLenient(MuscleGroup.self, forKey: .primaryMuscle)
        secondaryMuscle1 = c.decodeLenient(MuscleGroup.self, forKey: .secondaryMuscle1)
        secondaryMuscle2 = c.decodeLenient(MuscleGroup.self, forKey: .secondaryMuscle2)
        secondaryMuscle3 = c.decodeLenient(MuscleGroup.self, forKey: .secondaryMuscle3)
        workoutType = c.decodeLenient(MovementPattern.self, forKey: .workoutType)
        equipment = c.decodeLenient(Equipment.self, forKey: .equipment)
        weightType = c.decodeLenient(WeightType.self, forKey: .weightType)
        updatedAt = try c.decodeIfPresent(Double.self, forKey: .updatedAt)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(primaryMuscle, forKey: .primaryMuscle)
        try c.encode(secondaryMuscle1, forKey: .secondaryMuscle1)
        try c.encode(secondaryMuscle2, forKey: .secondaryMuscle2)
        try c.encode(secondaryMuscle3, forKey: .secondaryMuscle3)
        try c.encode(workoutType, forKey: .workoutType)
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
