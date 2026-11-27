import Foundation

// Port of src/data/dosage.ts — THE sets × reps resolver.

public struct RepPrescription: Codable, Hashable, Sendable {
    public var sets: Int
    public var repLow: Int?
    public var repHigh: Int?
    public var source: RangeSource?
    public init(sets: Int, repLow: Int? = nil, repHigh: Int? = nil, source: RangeSource? = nil) {
        self.sets = sets; self.repLow = repLow; self.repHigh = repHigh; self.source = source
    }
}

/// A user-typed dose field: JS accepts either a number or a string.
public enum DoseInput: Codable, Hashable, Sendable {
    case number(Double), text(String)
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let d = try? c.decode(Double.self) { self = .number(d) } else { self = .text(try c.decode(String.self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self { case .number(let d): try c.encode(d); case .text(let s): try c.encode(s) }
    }
}

public struct DosageSlot: Codable, Hashable, Sendable {
    public var main: Bool?
    public init(main: Bool? = nil) { self.main = main }
}

public struct DosageHistorySession: Codable, Hashable, Sendable {
    public struct Rep: Codable, Hashable, Sendable { public var reps: Double }
    public var sets: [Rep]
    public init(reps: [Double]) { sets = reps.map(Rep.init) }
}

public enum Dosage {
    static let historySampleSessions = 3
    static let derivedRangeSpread = 2
    public static let minSets = 2
    public static let maxSets = 5

    static func jsNumber(_ v: DoseInput) -> Double {
        switch v {
        case .number(let d): return d
        case .text(let s):
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            if t.isEmpty { return 0 }
            return Double(t) ?? .nan
        }
    }

    public static func parseDose(_ sets: DoseInput, _ repLow: DoseInput, _ repHigh: DoseInput, _ fallback: RepPrescription?) -> RepPrescription {
        func int(_ v: DoseInput) -> Int? {
            let n = jsNumber(v)
            return n.isFinite && n == n.rounded() && n >= 1 ? Int(n) : nil
        }
        let s = int(sets) ?? fallback?.sets ?? 3
        var lo = int(repLow), hi = int(repHigh)
        if lo == nil && hi == nil {
            if let fl = fallback?.repLow, let fh = fallback?.repHigh { return RepPrescription(sets: min(maxSets, s), repLow: fl, repHigh: fh) }
            return RepPrescription(sets: min(maxSets, s))
        }
        lo = lo ?? hi; hi = hi ?? lo
        if lo! > hi! { swap(&lo, &hi) }
        return RepPrescription(sets: min(maxSets, s), repLow: lo, repHigh: hi)
    }

    static let highRepPatterns: Set<MovementPattern> = [.lateralRaise, .calfRaise, .facePull, .reverseFly, .crunch, .abduction, .antiRotation, .rotation]
    static let heavyAxialPatterns: Set<MovementPattern> = [.hipHinge, .squat]

    public static func isHeavyAxial(_ p: ExerciseProfile) -> Bool {
        p.weightType == .barbell && p.workoutType.map(heavyAxialPatterns.contains) == true
    }

    public static func dosage(_ goal: Goal, _ slot: DosageSlot, _ p: ExerciseProfile, _ experience: ExperienceLevel) -> RepPrescription {
        func rx(_ s: Int, _ lo: Int, _ hi: Int) -> RepPrescription { RepPrescription(sets: s, repLow: lo, repHigh: hi) }
        let main = slot.main == true
        if p.unit == .seconds {
            if experience == .beginner { return rx(2, 20, 30) }
            return goal == .sportSupport ? rx(2, 30, 45) : rx(3, 30, 45)
        }
        if let w = p.workoutType, highRepPatterns.contains(w) {
            return experience == .beginner ? rx(2, 12, 20) : rx(3, 12, 20)
        }
        let compound = p.mechanics == .compound
        if goal == .sportSupport && experience != .beginner {
            if p.workoutType == .jump { return rx(3, 4, 6) }
            if main && compound { return rx(4, 4, 6) }
            if compound { return rx(3, 6, 8) }
            return rx(2, 8, 12)
        }
        if experience == .beginner {
            if main && compound { return rx(3, 8, 12) }
            if compound { return rx(2, 8, 12) }
            return rx(2, 10, 15)
        }
        if isHeavyAxial(p) {
            if goal == .strength { return rx(4, 3, 5) }
            if goal == .athletic { return rx(4, 4, 6) }
            return rx(3, 5, 8)
        }
        if main && compound {
            if goal == .strength { return rx(4, 4, 6) }
            if goal == .athletic { return rx(4, 5, 8) }
            if goal == .hypertrophy { return rx(3, 6, 10) }
            return rx(3, 8, 12)
        }
        if compound { return goal == .strength ? rx(3, 6, 10) : rx(3, 8, 12) }
        if goal == .strength { return rx(3, 8, 12) }
        if goal == .hypertrophy { return rx(3, 10, 15) }
        return rx(3, 12, 15)
    }

    static func median(_ values: [Double]) -> Double {
        let sorted = values.jsSorted { $0 - $1 }
        return sorted[sorted.count / 2]
    }

    public static func rangeFromHistory(_ history: [DosageHistorySession]) -> RepPrescription? {
        let recent = Array(history.filter { !$0.sets.isEmpty }.prefix(historySampleSessions))
        if recent.isEmpty { return nil }
        let reps = JS.round(median(recent.flatMap { $0.sets.map(\.reps) }))
        let sets = median(recent.map { Double($0.sets.count) })
        return RepPrescription(sets: min(maxSets, max(minSets, Int(JS.round(sets)))),
                               repLow: Int(max(1, reps - Double(derivedRangeSpread))),
                               repHigh: Int(reps + Double(derivedRangeSpread)), source: .history)
    }

    public static func resolvePrescription(profile: ExerciseProfile, slot: DosageSlot? = nil, goal: Goal?,
                                           experience: ExperienceLevel, history: [DosageHistorySession] = []) -> RepPrescription? {
        if let goal {
            var r = dosage(goal, slot ?? DosageSlot(), profile, experience); r.source = .plan
            return r
        }
        return rangeFromHistory(history)
    }

    public static let strengthPhaseShift: [PhaseKind: Int] = [.intensification: 1, .peak: 2]
    public static let backoffPct: [PhaseKind: Double] = [.peak: 0.85]
    public static let defaultBackoffPct = 0.9

    public static func backoffFactor(_ phase: PhaseKind?) -> Double { phase.flatMap { backoffPct[$0] } ?? defaultBackoffPct }

    public static func strengthMainSlot(_ slot: Exercise, _ goal: Goal?) -> Bool {
        guard goal == .strength, slot.main == true, slot.progression != .manual,
              slot.repLow != nil, let hi = slot.repHigh, hi <= 6 else { return false }
        return slot.rangeSource != .user && slot.rangeSource != .history
    }

    public static func phaseRange(_ slot: Exercise, _ goal: Goal?, _ phase: PhaseKind?) -> (repLow: Int, repHigh: Int)? {
        if !strengthMainSlot(slot, goal) { return nil }
        let shift = phase.flatMap { strengthPhaseShift[$0] } ?? 0
        if shift == 0 { return nil }
        let lo = max(1, slot.repLow! - shift)
        return (lo, max(lo + 1, slot.repHigh! - shift))
    }

    public static func applyPhaseRanges(_ day: WorkoutDay, _ goal: Goal?, _ phase: PhaseKind?) -> WorkoutDay {
        var d = day
        d.exercises = day.exercises.map { ex in
            guard let r = phaseRange(ex, goal, phase) else { return ex }
            var e = ex; e.repLow = r.repLow; e.repHigh = r.repHigh; return e
        }
        return d
    }

    public static func topSetScheme(_ slot: Exercise, _ goal: Goal?, _ experience: ExperienceLevel?, _ weightType: WeightType?) -> Bool {
        strengthMainSlot(slot, goal) && experience != .beginner && weightType != .bodyweight
    }
}
