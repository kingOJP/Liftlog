// Mirrors src/db/database.ts (IndexedDB rows), src/data/syncMerge.ts (the
// session sync document) and src/data/draftSession.ts. Timestamps are epoch
// milliseconds; weights are lbs.

public struct Session: Codable, Hashable, Sendable {
    public var id: Int?
    public var guid: String?
    public var dayId: Int
    public var weekNumber: Int
    public var startedAt: Double
    public var completedAt: Double?
    public var updatedAt: Double?
    public var note: String?

    public init(id: Int? = nil, guid: String? = nil, dayId: Int, weekNumber: Int, startedAt: Double,
                completedAt: Double? = nil, updatedAt: Double? = nil, note: String? = nil) {
        self.id = id; self.guid = guid; self.dayId = dayId; self.weekNumber = weekNumber; self.startedAt = startedAt
        self.completedAt = completedAt; self.updatedAt = updatedAt; self.note = note
    }
}

public struct SetLog: Codable, Hashable, Sendable {
    public var id: Int?
    public var sessionId: Int
    public var exerciseId: String
    public var setNumber: Int
    public var weight: Double
    public var reps: Double
    public var order: Int?
    public var warmup: Bool?
    public var repLow: Int?
    public var repHigh: Int?
    public var technique: SetTechnique?
    public var grip: Grip?

    public init(id: Int? = nil, sessionId: Int, exerciseId: String, setNumber: Int, weight: Double, reps: Double,
                order: Int? = nil, warmup: Bool? = nil, repLow: Int? = nil, repHigh: Int? = nil,
                technique: SetTechnique? = nil, grip: Grip? = nil) {
        self.id = id; self.sessionId = sessionId; self.exerciseId = exerciseId; self.setNumber = setNumber
        self.weight = weight; self.reps = reps; self.order = order; self.warmup = warmup; self.repLow = repLow
        self.repHigh = repHigh; self.technique = technique; self.grip = grip
    }

    enum CodingKeys: String, CodingKey { case id, sessionId, exerciseId, setNumber, weight, reps, order, warmup, repLow, repHigh, technique, grip }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(Int.self, forKey: .id)
        sessionId = try c.decode(Int.self, forKey: .sessionId)
        exerciseId = try c.decode(String.self, forKey: .exerciseId)
        setNumber = try c.decode(Int.self, forKey: .setNumber)
        weight = try c.decode(Double.self, forKey: .weight)
        reps = try c.decode(Double.self, forKey: .reps)
        order = try c.decodeIfPresent(Int.self, forKey: .order)
        warmup = try c.decodeIfPresent(Bool.self, forKey: .warmup)
        repLow = try c.decodeWholeIfPresent(forKey: .repLow)
        repHigh = try c.decodeWholeIfPresent(forKey: .repHigh)
        technique = c.decodeLenient(SetTechnique.self, forKey: .technique)
        grip = c.decodeLenient(Grip.self, forKey: .grip)
    }
}

/// One set inside a `SessionDoc` (the set log minus its local ids).
public struct SessionDocSet: Codable, Hashable, Sendable {
    public var exerciseId: String
    public var setNumber: Int
    public var weight: Double
    public var reps: Double
    public var order: Int?
    public var warmup: Bool?
    public var repLow: Int?
    public var repHigh: Int?
    public var technique: SetTechnique?
    public var grip: Grip?

    enum CodingKeys: String, CodingKey { case exerciseId, setNumber, weight, reps, order, warmup, repLow, repHigh, technique, grip }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        exerciseId = try c.decode(String.self, forKey: .exerciseId)
        setNumber = try c.decode(Int.self, forKey: .setNumber)
        weight = try c.decode(Double.self, forKey: .weight)
        reps = try c.decode(Double.self, forKey: .reps)
        order = try c.decodeIfPresent(Int.self, forKey: .order)
        warmup = try c.decodeIfPresent(Bool.self, forKey: .warmup)
        repLow = try c.decodeWholeIfPresent(forKey: .repLow)
        repHigh = try c.decodeWholeIfPresent(forKey: .repHigh)
        technique = c.decodeLenient(SetTechnique.self, forKey: .technique)
        grip = c.decodeLenient(Grip.self, forKey: .grip)
    }
}

/// The atomic session sync document (syncMerge.ts `SessionDoc`), keyed by guid.
public struct SessionDoc: Codable, Hashable, Sendable {
    public var guid: String
    public var dayId: Int
    public var weekNumber: Int
    public var startedAt: Double
    public var completedAt: Double?
    public var updatedAt: Double
    public var note: String?
    public var sets: [SessionDocSet]
}

public enum DraftOrigin: String, Codable, Hashable, Sendable { case program, quick, shared }

public struct DraftSet: Codable, Hashable, Sendable {
    public var weight: Double
    public var reps: Double
    public var warmup: Bool?
    public var technique: SetTechnique?
    public var grip: Grip?
}

/// In-progress workout (liftlog_draft_session).
public struct DraftSession: Codable, Hashable, Sendable {
    public var dayId: Int
    public var startedAt: Double
    public var savedAt: Double
    public var sets: [String: [DraftSet]]
    public var order: [String]?
    public var day: WorkoutDay?
    public var origin: DraftOrigin?
    public var added: [Exercise]?
    public var note: String?
}
