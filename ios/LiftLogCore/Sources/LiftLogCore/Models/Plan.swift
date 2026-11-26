// Mirrors src/data/plan.ts, src/data/planStore.ts and the records in
// src/data/strength.ts — the journey document stored under liftlog_plan and
// synced LWW (D1 training_plans).

public enum Goal: String, Codable, CaseIterable, Hashable, Sendable {
    case hypertrophy, strength
    case fatLoss = "fat-loss"
    case athletic, general
    case sportSupport = "sport-support"
}

public enum ExperienceLevel: String, Codable, CaseIterable, Hashable, Sendable { case beginner, intermediate, advanced }

public enum EquipmentAccess: String, Codable, CaseIterable, Hashable, Sendable {
    case fullGym = "full-gym", homeRack = "home-rack", dumbbellsOnly = "dumbbells-only", minimal
}

public enum SportId: String, Codable, CaseIterable, Hashable, Sendable { case triathlon, running }

public enum SportEvent: String, Codable, CaseIterable, Hashable, Sendable {
    case triSprint = "tri-sprint", triOlympic = "tri-olympic", triHalf = "tri-half", triFull = "tri-full"
    case run5k = "run-5k", run10k = "run-10k", runHalf = "run-half", runFull = "run-full"
}

public enum RaceProximity: String, Codable, CaseIterable, Hashable, Sendable { case none, soon, mid, far }

public enum EnduranceLoad: String, Codable, CaseIterable, Hashable, Sendable {
    case low, moderate, high
    case veryHigh = "very-high"
}

public enum Discipline: String, Codable, CaseIterable, Hashable, Sendable { case swim, bike, run, even }

public enum InjuryArea: String, Codable, CaseIterable, Hashable, Sendable {
    case knee, shoulder
    case lowerBack = "lower-back"
    case hip, elbow, wrist
}

public enum PhaseKind: String, Codable, CaseIterable, Hashable, Sendable {
    case intro, recovery, accumulation, intensification, peak, deload, maintenance
    case raceWeek = "race-week"
}

public struct SportContext: Codable, Hashable, Sendable {
    public var sport: SportId
    public var event: SportEvent
    public var proximity: RaceProximity
    public var load: EnduranceLoad
    public var weakLink: Discipline
    public var niggles: [String]
}

public struct TrainingProfile: Codable, Hashable, Sendable {
    public var injuries: String
    public var equipment: EquipmentAccess
    public var daysPerWeek: Int
    public var experience: ExperienceLevel
    public var trainingAgeMonths: Double?
    public var priorityMuscles: [MuscleGroup]
    public var injuryAreas: [InjuryArea]?
    public var sport: SportContext?
    public var updatedAt: Double
}

public struct CoachDecision: Codable, Hashable, Sendable {
    public var key: String
    public var accepted: Bool
    public var at: Double
}

public enum BlockStatus: String, Codable, Hashable, Sendable { case pending, active, completed }
public enum BlockCompletedBy: String, Codable, Hashable, Sendable { case activation, user }

public struct TrainingBlock: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var focus: Goal
    public var startDate: String
    public var phases: [PhaseKind]
    public var openEnded: Bool?
    public var program: [WorkoutDay]
    public var intent: String
    public var progression: String
    public var status: BlockStatus
    public var activatedAt: Double
    public var completedAt: Double?
    public var completedBy: BlockCompletedBy?
    public var replacedBlockId: String?
    public var replacedProgram: [WorkoutDay]?
    public var experience: ExperienceLevel?
    public var retrospective: BlockRetrospective?
    public var coachDecisions: [CoachDecision]?
}

public enum PlanOrigin: String, Codable, Hashable, Sendable { case planned, migrated }
public enum PlanStatus: String, Codable, Hashable, Sendable { case active, completed }

public struct TrainingPlan: Codable, Hashable, Sendable {
    public var id: String
    public var goal: Goal
    public var goalNotes: String?
    public var origin: PlanOrigin
    public var status: PlanStatus
    public var createdAt: Double
    public var completedAt: Double?
    public var blocks: [TrainingBlock]
}

public enum OutcomeStatus: String, Codable, Hashable, Sendable { case progressing, steady, stalled, declining }

public struct ExerciseOutcome: Codable, Hashable, Sendable {
    public var exerciseId: String
    public var name: String
    public var startE1rm: Double
    public var endE1rm: Double
    public var changePct: Double
    public var sessions: Int
    public var status: OutcomeStatus?
    /// absent (older documents) vs explicit null (not comparable) are distinct in TS.
    public var volumeChangePct: Nullable<Double>?
    public var prCount: Int?
}

public enum MuscleStatus: String, Codable, Hashable, Sendable { case low, optimal, high }

public struct MuscleOutcome: Codable, Hashable, Sendable {
    public var muscle: MuscleGroup
    public var weeklySets: Double
    public var status: MuscleStatus
}

public struct RetrospectiveCarryover: Codable, Hashable, Sendable {
    public var keepExerciseIds: [String]
    public var reviewExerciseIds: [String]
    public var underMuscles: [MuscleGroup]
    public var overMuscles: [MuscleGroup]
}

public struct BlockRetrospective: Codable, Hashable, Sendable {
    public var blockId: String
    public var from: Double
    public var to: Double
    public var sessionsCompleted: Int
    public var sessionsPlanned: Int?
    public var adherencePct: Double?
    public var avgSessionMinutes: Double?
    public var strength: [ExerciseOutcome]
    public var muscles: [MuscleOutcome]
    public var summary: [String]
    public var carryover: RetrospectiveCarryover

    enum CodingKeys: String, CodingKey { case blockId, from, to, sessionsCompleted, sessionsPlanned, adherencePct, avgSessionMinutes, strength, muscles, summary, carryover }

    // `number | null` fields are always present in the TS document.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(blockId, forKey: .blockId); try c.encode(from, forKey: .from); try c.encode(to, forKey: .to)
        try c.encode(sessionsCompleted, forKey: .sessionsCompleted)
        try c.encode(sessionsPlanned, forKey: .sessionsPlanned)
        try c.encode(adherencePct, forKey: .adherencePct)
        try c.encode(avgSessionMinutes, forKey: .avgSessionMinutes)
        try c.encode(strength, forKey: .strength); try c.encode(muscles, forKey: .muscles)
        try c.encode(summary, forKey: .summary); try c.encode(carryover, forKey: .carryover)
    }
}

public enum MaxSource: String, Codable, Hashable, Sendable { case tested, estimated }

public struct OneRepMax: Codable, Hashable, Sendable {
    public var exerciseId: String
    public var weight: Double
    public var source: MaxSource
    public var date: String
    public var updatedAt: Double
}

public struct StrengthGoal: Codable, Hashable, Sendable {
    public var exerciseId: String
    public var targetWeight: Double
    public var createdAt: Double
}

public struct StrengthState: Codable, Hashable, Sendable {
    public var maxes: [OneRepMax]
    public var goals: [StrengthGoal]
}

public struct PendingActivation: Codable, Hashable, Sendable {
    public var goal: Goal
    public var goalNotes: String?
    public var block: TrainingBlock
    public var createdAt: Double
}

/// The whole journey document (planStore.ts `PlanState`, liftlog_plan).
public struct PlanState: Codable, Hashable, Sendable {
    public var version: Int
    public var plans: [TrainingPlan]
    public var pendingActivation: PendingActivation?
    public var profile: TrainingProfile?
    public var strength: StrengthState?
    public var updatedAt: Double
}

/// A JSON value that may be explicitly `null` (as opposed to absent): use as
/// `Nullable<T>?` where nil = key absent, `.null` = key present with null.
public enum Nullable<T: Codable & Hashable & Sendable>: Codable, Hashable, Sendable {
    case null
    case value(T)
    public var value: T? { if case .value(let v) = self { return v }; return nil }
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        self = c.decodeNil() ? .null : .value(try c.decode(T.self))
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self { case .null: try c.encodeNil(); case .value(let v): try c.encode(v) }
    }
}

extension KeyedDecodingContainer {
    public func decodeIfPresent<T>(_ type: Nullable<T>.Type, forKey key: Key) throws -> Nullable<T>? {
        guard contains(key) else { return nil }
        return try decode(Nullable<T>.self, forKey: key)
    }
}
