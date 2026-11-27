import Foundation

// Port of src/data/exercises.ts (catalog lookups, difficulty, metadata layers)
// and the pure helpers in src/data/taxonomy.ts. Catalog tables are generated
// into Generated/CatalogData.swift from the TS source.

public enum ExerciseDifficulty: String, Codable, Hashable, Sendable, CaseIterable {
    case beginner, intermediate, advanced
    public var rank: Int { switch self { case .beginner: 0; case .intermediate: 1; case .advanced: 2 } }
}

public struct ExerciseDef: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var primaryMuscle: MuscleGroup?
    public var secondaryMuscles: [MuscleGroup?]
    public var workoutType: MovementPattern?
    public var equipment: Equipment?
    public var weightType: WeightType?
    public var unit: MeasureUnit?

    public init(id: String, name: String, primaryMuscle: MuscleGroup?, secondaryMuscles: [MuscleGroup?],
                workoutType: MovementPattern?, equipment: Equipment?, weightType: WeightType?, unit: MeasureUnit? = nil) {
        self.id = id; self.name = name; self.primaryMuscle = primaryMuscle; self.secondaryMuscles = secondaryMuscles
        self.workoutType = workoutType; self.equipment = equipment; self.weightType = weightType; self.unit = unit
    }

    enum CodingKeys: String, CodingKey { case id, name, primaryMuscle, secondaryMuscles, workoutType, equipment, weightType, unit }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id); try c.encode(name, forKey: .name)
        try c.encode(primaryMuscle, forKey: .primaryMuscle); try c.encode(secondaryMuscles, forKey: .secondaryMuscles)
        try c.encode(workoutType, forKey: .workoutType); try c.encode(equipment, forKey: .equipment)
        try c.encode(weightType, forKey: .weightType); try c.encodeIfPresent(unit, forKey: .unit)
    }
}

public enum Taxonomy {
    public static func regionFor(_ m: MuscleGroup) -> MuscleRegion {
        switch m {
        case .chest: .chest
        case .delts: .shoulders
        case .lats, .upperBack, .lowerBack, .traps: .back
        case .biceps, .triceps, .forearms: .arms
        case .abs, .obliques: .core
        case .quads, .hamstrings, .glutes, .calves, .abductors, .adductors: .legs
        }
    }

    public static func patternCategoryFor(_ p: MovementPattern) -> MovementCategory {
        switch p {
        case .squat, .legPress, .lunge: .squat
        case .hipHinge, .hipThrust: .hinge
        case .horizontalPress, .verticalPress, .dip: .push
        case .row, .pullDown, .pullUp, .pullOver, .facePull: .pull
        case .crunch, .antiRotation, .plank: .core
        case .carry: .carry
        case .jump: .power
        case .curl, .tricepExtension, .fly, .reverseFly, .lateralRaise, .legExtension, .legCurl, .calfRaise,
             .abduction, .shrug, .rotation: .isolation
        }
    }

    public static func unitLabel(_ unit: MeasureUnit, plural: Bool = true) -> String {
        if unit == .seconds { return "sec" }
        return plural ? "reps" : "rep"
    }
}

public enum Catalog {
    public static let exercises: [ExerciseDef] = CatalogData.exercises
    public static let exerciseMap: [String: ExerciseDef] = {
        var m: [String: ExerciseDef] = [:]
        for e in CatalogData.exercises where m[e.id] == nil { m[e.id] = e }
        return m
    }()
    public static let muscleHeads = CatalogData.muscleHeads

    private static let timestampSuffix = try! NSRegularExpression(pattern: "-\\d{10,}$")

    public static func catalogDefFor(_ id: String) -> ExerciseDef? {
        if let d = exerciseMap[id] { return d }
        let range = NSRange(id.startIndex..., in: id)
        let base = timestampSuffix.stringByReplacingMatches(in: id, range: range, withTemplate: "")
        return base != id ? exerciseMap[base] : nil
    }

    public static func difficultyFor(_ id: String) -> ExerciseDifficulty {
        guard let def = catalogDefFor(id) else { return .intermediate }
        return CatalogData.difficulty[def.id] ?? .intermediate
    }

    public static func hasCatalogDifficulty(_ id: String) -> Bool {
        guard let def = catalogDefFor(id) else { return false }
        return CatalogData.difficulty[def.id] != nil
    }

    public static func unitFor(_ id: String) -> MeasureUnit { catalogDefFor(id)?.unit ?? .reps }
    public static func isTimedExercise(_ id: String) -> Bool { unitFor(id) == .seconds }

    public static func prerequisitesFor(_ id: String) -> [String] {
        guard let def = catalogDefFor(id) else { return [] }
        return CatalogData.prerequisites[def.id] ?? []
    }

    public static func headsFor(_ id: String) -> [String] {
        guard let def = catalogDefFor(id) else { return [] }
        return CatalogData.primaryHeads[def.id] ?? []
    }

    // MARK: metadata layers (user override → admin global → catalog)

    static let metaKey = StorageKey.exerciseMeta
    static let globalMetaKey = "liftlog_global_meta"

    private static let legacyMuscles = ["Front Delts": "Delts", "Side Delts": "Delts", "Rear Delts": "Delts"]
    private static let legacyWorkoutTypes = ["Chest Press": "Horizontal Press", "Push Up": "Horizontal Press",
                                             "Overhead Press": "Vertical Press"]
    private static let verticalPressWords = try! NSRegularExpression(
        pattern: "overhead|shoulder-press|military|arnold|push-press|z-press|landmine-press|viking|behind-the-neck")

    private static func legacyPressPlane(_ id: String) -> String {
        if let wt = catalogDefFor(id)?.workoutType, wt == .verticalPress || wt == .horizontalPress { return wt.rawValue }
        let lower = id.lowercased()
        return verticalPressWords.firstMatch(in: lower, range: NSRange(lower.startIndex..., in: lower)) != nil
            ? "Vertical Press" : "Horizontal Press"
    }

    private static func normalize(_ raw: [String: Any], id: String) -> [String: Any] {
        var o = raw
        let keys = ["primaryMuscle", "secondaryMuscle1", "secondaryMuscle2", "secondaryMuscle3"]
        for k in keys {
            if let m = o[k] as? String, !m.isEmpty { o[k] = legacyMuscles[m] ?? m } else { o[k] = NSNull() }
        }
        var seen = Set<String>()
        if let p = o["primaryMuscle"] as? String { seen.insert(p) }
        for k in keys.dropFirst() {
            guard let m = o[k] as? String else { continue }
            if seen.contains(m) { o[k] = NSNull() } else { seen.insert(m) }
        }
        if let wt = o["workoutType"] as? String, !wt.isEmpty {
            o["workoutType"] = wt == "Press" ? legacyPressPlane(id) : (legacyWorkoutTypes[wt] ?? wt)
        }
        if (o["equipment"] as? String) == "Leg Press Machine" { o["equipment"] = "Machine" }
        return o
    }

    static func readMetaMap(_ key: String) -> [String: ExerciseMetaOverride] {
        guard let raw = LiftLogEnv.store.getItem(key), let data = raw.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        var out: [String: ExerciseMetaOverride] = [:]
        for (id, v) in obj {
            guard let dict = v as? [String: Any] else { continue }
            let norm = normalize(dict, id: id)
            guard let d = try? JSONSerialization.data(withJSONObject: norm),
                  let o = try? JSONDecoder().decode(ExerciseMetaOverride.self, from: d) else { continue }
            out[id] = o
        }
        return out
    }

    private static func writeMetaOverrides(_ map: [String: ExerciseMetaOverride]) {
        LiftLogEnv.store.setJSON(map, StorageKey.exerciseMeta)
    }

    public static func saveGlobalExerciseMeta(_ meta: [String: ExerciseMetaOverride]) {
        LiftLogEnv.store.setJSON(meta, globalMetaKey)
    }

    public static func getExerciseMeta(_ id: String) -> ExerciseMetaOverride {
        if let o = readMetaMap(metaKey)[id] { return o }
        if let g = readMetaMap(globalMetaKey)[id] { return g }
        let def = catalogDefFor(id)
        func sec(_ i: Int) -> MuscleGroup? { guard let d = def, i < d.secondaryMuscles.count else { return nil }; return d.secondaryMuscles[i] }
        return ExerciseMetaOverride(primaryMuscle: def?.primaryMuscle, secondaryMuscle1: sec(0), secondaryMuscle2: sec(1),
                                    secondaryMuscle3: sec(2), workoutType: def?.workoutType, equipment: def?.equipment,
                                    weightType: def?.weightType)
    }

    public static func saveExerciseMeta(_ id: String, _ meta: ExerciseMetaOverride, now: Double = LiftLogEnv.now()) {
        var all = readMetaMap(metaKey)
        var m = meta; m.updatedAt = now
        all[id] = m
        writeMetaOverrides(all)
    }

    public static func deleteExerciseMeta(_ id: String) {
        var all = readMetaMap(metaKey)
        guard all[id] != nil else { return }
        all[id] = nil
        writeMetaOverrides(all)
    }

    public static func getAllExerciseMeta() -> [String: ExerciseMetaOverride] { readMetaMap(metaKey) }

    /// Newer `updatedAt` wins per exercise; a stamped local copy beats an older incoming one.
    public static func mergeExerciseMeta(_ incoming: [String: ExerciseMetaOverride]) {
        if incoming.isEmpty { return }
        let local = readMetaMap(metaKey)
        var merged = local
        for (id, inc) in incoming {
            if let loc = local[id], (loc.updatedAt ?? 0) > (inc.updatedAt ?? 0) { continue }
            merged[id] = inc
        }
        writeMetaOverrides(merged)
    }

    public static func clearExerciseMeta() { LiftLogEnv.store.removeItem(metaKey) }
}
