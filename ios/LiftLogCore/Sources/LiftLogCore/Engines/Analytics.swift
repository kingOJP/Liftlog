import Foundation

// Port of src/data/analytics.ts — the shared analytical core: training
// snapshot, durations, e1RM series, exercise identity and muscle-set totals.

public struct VolumeTarget: Codable, Hashable, Sendable {
    public var low: Double
    public var high: Double
    public init(low: Double, high: Double) { self.low = low; self.high = high }
}

public struct TrainingSnapshot: Sendable {
    /// Completed sessions, newest first.
    public var sessions: [Session]
    /// sessionId → working set logs (warm-ups excluded). THE analytical input.
    public var setsBySession: [Int: [SetLog]]
    /// sessionId → every logged set, including warm-ups. Display only.
    public var allSetsBySession: [Int: [SetLog]]
}

public struct E1rmPoint: Codable, Hashable, Sendable { public var ts: Double; public var value: Double }

public struct ResolvedIdentity: Hashable, Sendable {
    public var primaryMuscle: MuscleGroup?
    public var secondaryMuscles: [MuscleGroup?]
    public var workoutType: MovementPattern?
    public var equipment: Equipment?
    public var weightType: WeightType?
}

public struct MuscleSetTotals: Sendable {
    public var totals: [MuscleGroup: Double]
    public var unmappedSets: Int
    public var unmappedExerciseIds: Set<String>
    /// Muscles in first-credited order — TS Map insertion order, for tie-stable sorts.
    public var order: [MuscleGroup] = []
}

public struct MuscleHeadTotals: Sendable {
    public var byHead: [String: Double]
    public var unspecified: [MuscleGroup: Double]
}

public enum Analytics {
    public static let secondarySetWeight = 0.5
    public static let setsTargetLow = 10.0
    public static let setsTargetHigh = 20.0
    public static let defaultVolumeTarget = VolumeTarget(low: setsTargetLow, high: setsTargetHigh)
    public static let beginnerVolumeTarget = VolumeTarget(low: 6, high: 12)

    public static func volumeTargetFor(_ goal: Goal?, _ experience: ExperienceLevel? = nil) -> VolumeTarget {
        if goal == .sportSupport { return VolumeTarget(low: 4, high: 10) }
        if experience == .beginner { return beginnerVolumeTarget }
        return defaultVolumeTarget
    }

    public static func buildSnapshot(_ sessions: [Session], _ setLogs: [SetLog]) -> TrainingSnapshot {
        let completed = sessions.filter { $0.completedAt != nil }
            .jsSorted { ($1.completedAt ?? 0) - ($0.completedAt ?? 0) }
        var working: [Int: [SetLog]] = [:], all: [Int: [SetLog]] = [:]
        for log in setLogs {
            all[log.sessionId, default: []].append(log)
            if log.warmup == true { continue }
            working[log.sessionId, default: []].append(log)
        }
        return TrainingSnapshot(sessions: completed, setsBySession: working, allSetsBySession: all)
    }

    public static func sessionTimestamp(_ s: Session) -> Double { s.completedAt ?? s.startedAt }
    public static func sessionWeekStart(_ s: Session) -> Double { ProgramMath.startOfWeek(sessionTimestamp(s)) }

    static let minValidDurationMs = 10.0 * 60_000
    static let maxValidDurationMs = 4.0 * 3_600_000
    static let durationSampleSessions = 8

    public static func sessionDurationMs(_ s: Session) -> Double? {
        guard let c = s.completedAt else { return nil }
        let d = c - s.startedAt
        return d >= minValidDurationMs && d <= maxValidDurationMs ? d : nil
    }

    public static func avgDurationByDay(_ snap: TrainingSnapshot) -> [Int: Double] {
        var byDay: [Int: [Double]] = [:]
        for s in snap.sessions {
            guard let d = sessionDurationMs(s) else { continue }
            var arr = byDay[s.dayId] ?? []
            if arr.count < durationSampleSessions { arr.append(d); byDay[s.dayId] = arr }
        }
        return byDay.mapValues { ds in ds.reduce(0, +) / Double(ds.count) }
    }

    public static func epley1RM(_ weight: Double, _ reps: Double) -> Double { weight * (1 + reps / 30) }

    public static func e1rmSeries(_ snap: TrainingSnapshot) -> [String: [E1rmPoint]] {
        var series: [String: [E1rmPoint]] = [:]
        for session in snap.sessions {
            let logs = snap.setsBySession[session.id ?? -1] ?? []
            if logs.isEmpty { continue }
            let ts = sessionTimestamp(session)
            var best: [String: Double] = [:]
            for s in logs where Variations.countsForStrength(s.technique) {
                let e = epley1RM(s.weight, s.reps)
                if e > (best[s.exerciseId] ?? 0) { best[s.exerciseId] = e }
            }
            for (id, v) in best { series[id, default: []].append(E1rmPoint(ts: ts, value: v)) }
        }
        return series.mapValues { $0.jsSorted { $0.ts - $1.ts } }
    }

    /// Exercise ids in the order `e1rmSeries`'s TS Map inserts them: first
    /// session (in snapshot order) where a strength-counting set beats 0.
    public static func e1rmSeriesOrder(_ snap: TrainingSnapshot) -> [String] {
        var order: [String] = [], seen = Set<String>()
        for session in snap.sessions {
            for s in snap.setsBySession[session.id ?? -1] ?? [] where Variations.countsForStrength(s.technique) {
                if epley1RM(s.weight, s.reps) > 0, seen.insert(s.exerciseId).inserted { order.append(s.exerciseId) }
            }
        }
        return order
    }

    public static func normalizeName(_ name: String) -> String {
        name.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static let nameToDef: [String: ExerciseDef] = {
        var m: [String: ExerciseDef] = [:]
        for d in Catalog.exercises { m[normalizeName(d.name)] = d }
        return m
    }()

    public static func resolveExerciseIdentity(_ id: String, _ fallbackName: String? = nil) -> ResolvedIdentity {
        let meta = Catalog.getExerciseMeta(id)
        var out = ResolvedIdentity(primaryMuscle: meta.primaryMuscle,
                                   secondaryMuscles: [meta.secondaryMuscle1, meta.secondaryMuscle2, meta.secondaryMuscle3],
                                   workoutType: meta.workoutType, equipment: meta.equipment, weightType: meta.weightType)
        if out.primaryMuscle == nil && Catalog.exerciseMap[id] == nil {
            let name = fallbackName ?? ProgramStore.getExerciseLibrary().first(where: { $0.id == id })?.name
            if let name, let def = nameToDef[normalizeName(name)] {
                out.primaryMuscle = def.primaryMuscle
                out.secondaryMuscles = def.secondaryMuscles
                out.workoutType = out.workoutType ?? def.workoutType
                out.equipment = out.equipment ?? def.equipment
                out.weightType = out.weightType ?? def.weightType
            }
        }
        return out
    }

    static func baseInvolvement(_ r: ResolvedIdentity) -> [Involvement] {
        var out: [Involvement] = []
        if let p = r.primaryMuscle { out.append(Involvement(muscle: p, weight: 1)) }
        for case let s? in r.secondaryMuscles { out.append(Involvement(muscle: s, weight: secondarySetWeight)) }
        return out
    }

    public static func musclesForExercise(_ id: String) -> [Involvement] { baseInvolvement(resolveExerciseIdentity(id)) }
    public static func primaryMuscleFor(_ id: String) -> MuscleGroup? { musclesForExercise(id).first { $0.weight == 1 }?.muscle }

    public static func musclesForSet(_ id: String, _ variation: SetVariation?) -> [Involvement] {
        let identity = resolveExerciseIdentity(id)
        return Variations.adjustInvolvement(baseInvolvement(identity), identity.workoutType, variation)
    }
    public static func musclesForSlot(_ slot: Exercise) -> [Involvement] {
        musclesForSet(slot.id, SetVariation(technique: slot.technique, grip: slot.grip))
    }
    public static func movementPatternFor(_ id: String) -> MovementPattern? { resolveExerciseIdentity(id).workoutType }

    public static func muscleSetTotals(_ snap: TrainingSnapshot, include: (Session) -> Bool = { _ in true }) -> MuscleSetTotals {
        var totals: [MuscleGroup: Double] = [:]
        var unmapped = 0, unmappedIds = Set<String>()
        var order: [MuscleGroup] = []
        var cache: [String: [Involvement]] = [:]
        for session in snap.sessions where include(session) {
            for log in snap.setsBySession[session.id ?? -1] ?? [] {
                let variation = SetVariation(technique: log.technique, grip: log.grip)
                let key = "\(log.exerciseId)|\(Variations.variationKey(variation))"
                let involvement = cache[key] ?? musclesForSet(log.exerciseId, variation)
                cache[key] = involvement
                if !involvement.contains(where: { $0.weight == 1 }) {
                    unmapped += 1; unmappedIds.insert(log.exerciseId); continue
                }
                let credit = Variations.setCredit(log.technique)
                for m in involvement {
                    if totals[m.muscle] == nil { order.append(m.muscle) }
                    totals[m.muscle, default: 0] += m.weight * credit
                }
            }
        }
        return MuscleSetTotals(totals: totals, unmappedSets: unmapped, unmappedExerciseIds: unmappedIds, order: order)
    }

    public static func headSetTotals(_ snap: TrainingSnapshot, include: (Session) -> Bool = { _ in true }) -> MuscleHeadTotals {
        var byHead: [String: Double] = [:], unspecified: [MuscleGroup: Double] = [:]
        var resolved: [String: (MuscleGroup?, [String])] = [:]
        for session in snap.sessions where include(session) {
            for log in snap.setsBySession[session.id ?? -1] ?? [] {
                let r = resolved[log.exerciseId] ?? (primaryMuscleFor(log.exerciseId), Catalog.headsFor(log.exerciseId))
                resolved[log.exerciseId] = r
                guard let primary = r.0 else { continue }
                let credit = Variations.setCredit(log.technique)
                if r.1.isEmpty { unspecified[primary, default: 0] += credit; continue }
                for head in r.1 { byHead["\(primary.rawValue)::\(head)", default: 0] += credit }
            }
        }
        return MuscleHeadTotals(byHead: byHead, unspecified: unspecified)
    }
}
