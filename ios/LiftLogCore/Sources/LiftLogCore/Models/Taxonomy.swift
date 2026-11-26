// Mirrors src/data/taxonomy.ts. Raw values are the exact strings stored in
// localStorage / D1 and sent over the sync wire; case order matches the TS
// `*_LIST` constants (several engines iterate them in that order).

public enum MuscleGroup: String, Codable, CaseIterable, Hashable, Sendable {
    case abductors = "Abductors", abs = "Abs", adductors = "Adductors", biceps = "Biceps", calves = "Calves"
    case chest = "Chest", delts = "Delts", forearms = "Forearms", glutes = "Glutes", hamstrings = "Hamstrings"
    case lats = "Lats", lowerBack = "Lower Back", obliques = "Obliques", quads = "Quads", traps = "Traps"
    case triceps = "Triceps", upperBack = "Upper Back"
}

public enum MuscleRegion: String, Codable, CaseIterable, Hashable, Sendable {
    case arms = "Arms", back = "Back", chest = "Chest", core = "Core", legs = "Legs", shoulders = "Shoulders"
}

public enum MovementPattern: String, Codable, CaseIterable, Hashable, Sendable {
    case abduction = "Abduction", antiRotation = "Anti-Rotation", calfRaise = "Calf Raise", carry = "Carry"
    case crunch = "Crunch", curl = "Curl", dip = "Dip", facePull = "Face Pull", fly = "Fly", hipHinge = "Hip Hinge"
    case hipThrust = "Hip Thrust", horizontalPress = "Horizontal Press", jump = "Jump", lateralRaise = "Lateral Raise"
    case legCurl = "Leg Curl", legExtension = "Leg Extension", legPress = "Leg Press", lunge = "Lunge", plank = "Plank"
    case pullDown = "Pull Down", pullOver = "Pull Over", pullUp = "Pull Up", reverseFly = "Reverse Fly"
    case rotation = "Rotation", row = "Row", shrug = "Shrug", squat = "Squat", tricepExtension = "Tricep Extension"
    case verticalPress = "Vertical Press"
}

public enum MovementCategory: String, Codable, CaseIterable, Hashable, Sendable {
    case carry = "Carry", core = "Core", hinge = "Hinge", isolation = "Isolation", power = "Power"
    case pull = "Pull", push = "Push", squat = "Squat"
}

public enum MeasureUnit: String, Codable, CaseIterable, Hashable, Sendable {
    case reps, seconds
}

public enum Equipment: String, Codable, CaseIterable, Hashable, Sendable {
    case bench = "Bench", cableMachine = "Cable Machine", dipStation = "Dip Station", machine = "Machine"
    case none = "None", pullUpBar = "Pull Up Bar", smithMachine = "Smith Machine", squatRack = "Squat Rack"
}

public enum WeightType: String, Codable, CaseIterable, Hashable, Sendable {
    case barbell = "Barbell", bodyweight = "Bodyweight", dumbbell = "Dumbbell", ezBar = "EZ Bar"
    case kettlebell = "Kettlebell", machine = "Machine", resistanceBand = "Resistance Band"
}

// src/data/variations.ts vocabulary.
public enum SetTechnique: String, Codable, CaseIterable, Hashable, Sendable {
    case paused, tempo, deficit, drop
    case restPause = "rest-pause"
    case partials
}

public enum Grip: String, Codable, CaseIterable, Hashable, Sendable {
    case close, wide, neutral, underhand, overhand, mixed
}

public struct SetVariation: Codable, Hashable, Sendable {
    public var technique: SetTechnique?
    public var grip: Grip?
    public init(technique: SetTechnique? = nil, grip: Grip? = nil) { self.technique = technique; self.grip = grip }
}

extension KeyedDecodingContainer {
    /// Unknown enum strings decode as absent — the TS client drops technique/grip
    /// values it doesn't recognize instead of rejecting the whole document.
    func decodeLenient<T: RawRepresentable & Decodable>(_ type: T.Type, forKey key: Key) -> T? where T.RawValue == String {
        guard let raw = try? decodeIfPresent(String.self, forKey: key) else { return nil }
        return T(rawValue: raw)
    }
}
