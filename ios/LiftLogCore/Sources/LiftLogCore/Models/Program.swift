// Mirrors src/data/program.ts. The prescription (sets × reps, technique, grip)
// lives on the program slot; library exercises carry identity only.

public enum RangeSource: String, Codable, Hashable, Sendable { case plan, user, history }
public enum ProgressionMode: String, Codable, Hashable, Sendable { case coach, manual }

/// A program slot (`Exercise` in program.ts).
public struct Exercise: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var sets: Int
    public var repLow: Int?
    public var repHigh: Int?
    public var main: Bool?
    public var rangeSource: RangeSource?
    public var progression: ProgressionMode?
    public var technique: SetTechnique?
    public var grip: Grip?
    public var archived: Bool?

    public init(id: String, name: String, sets: Int, repLow: Int? = nil, repHigh: Int? = nil, main: Bool? = nil,
                rangeSource: RangeSource? = nil, progression: ProgressionMode? = nil, technique: SetTechnique? = nil,
                grip: Grip? = nil, archived: Bool? = nil) {
        self.id = id; self.name = name; self.sets = sets; self.repLow = repLow; self.repHigh = repHigh; self.main = main
        self.rangeSource = rangeSource; self.progression = progression; self.technique = technique; self.grip = grip
        self.archived = archived
    }

    enum CodingKeys: String, CodingKey { case id, name, sets, repLow, repHigh, main, rangeSource, progression, technique, grip, archived }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        sets = try c.decodeWhole(forKey: .sets)
        repLow = try c.decodeWholeIfPresent(forKey: .repLow)
        repHigh = try c.decodeWholeIfPresent(forKey: .repHigh)
        main = try c.decodeIfPresent(Bool.self, forKey: .main)
        rangeSource = c.decodeLenient(RangeSource.self, forKey: .rangeSource)
        progression = c.decodeLenient(ProgressionMode.self, forKey: .progression)
        technique = c.decodeLenient(SetTechnique.self, forKey: .technique)
        grip = c.decodeLenient(Grip.self, forKey: .grip)
        archived = try c.decodeIfPresent(Bool.self, forKey: .archived)
    }
}

/// `LibraryExercise` (liftlog_exercises). `sets/repLow/repHigh` are
/// wire-compatibility only — older clients still send them.
public struct LibraryExercise: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var archived: Bool?
    public var updatedAt: Double?
    public var sets: Int?
    public var repLow: Int?
    public var repHigh: Int?

    public init(id: String, name: String, archived: Bool? = nil, updatedAt: Double? = nil) {
        self.id = id; self.name = name; self.archived = archived; self.updatedAt = updatedAt
    }
}

/// `WorkoutDay` (liftlog_program is `WorkoutDay[]`).
public struct WorkoutDay: Codable, Hashable, Sendable {
    public var id: Int
    public var label: String
    public var muscleGroups: String
    public var exercises: [Exercise]
    public var phases: [PhaseKind]?

    public init(id: Int, label: String, muscleGroups: String, exercises: [Exercise], phases: [PhaseKind]? = nil) {
        self.id = id; self.label = label; self.muscleGroups = muscleGroups; self.exercises = exercises; self.phases = phases
    }
}

extension LibraryExercise {
    enum CodingKeys: String, CodingKey { case id, name, archived, updatedAt, sets, repLow, repHigh }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        archived = try c.decodeIfPresent(Bool.self, forKey: .archived)
        updatedAt = try c.decodeIfPresent(Double.self, forKey: .updatedAt)
        sets = try c.decodeWholeIfPresent(forKey: .sets)
        repLow = try c.decodeWholeIfPresent(forKey: .repLow)
        repHigh = try c.decodeWholeIfPresent(forKey: .repHigh)
    }
}
