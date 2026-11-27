import Foundation

// Port of src/data/progression.ts — the goal- and experience-aware progress score.

public struct SignalWeights: Codable, Hashable, Sendable { public var e1rm, volume, prs: Double }
public struct FullMarks: Codable, Hashable, Sendable { public var e1rmPct, volumePct, prEvents: Double }
public struct ProgressSignals: Codable, Hashable, Sendable {
    public var e1rmChangePct: Double?
    public var volumeChangePct: Double?
    public var prEvents: Double
    public init(e1rmChangePct: Double?, volumeChangePct: Double?, prEvents: Double) {
        self.e1rmChangePct = e1rmChangePct; self.volumeChangePct = volumeChangePct; self.prEvents = prEvents
    }
}

public enum Progression {
    public static let goalSignalWeights: [Goal: SignalWeights] = [
        .strength: .init(e1rm: 0.55, volume: 0.20, prs: 0.25),
        .hypertrophy: .init(e1rm: 0.30, volume: 0.40, prs: 0.30),
        .fatLoss: .init(e1rm: 0.30, volume: 0.50, prs: 0.20),
        .athletic: .init(e1rm: 0.45, volume: 0.30, prs: 0.25),
        .general: .init(e1rm: 0.34, volume: 0.33, prs: 0.33),
        .sportSupport: .init(e1rm: 0.50, volume: 0.15, prs: 0.35),
    ]
    public static let fullMarks = FullMarks(e1rmPct: 5, volumePct: 10, prEvents: 2)
    static let experienceScale: [ExperienceLevel: Double] = [.beginner: 2, .intermediate: 1, .advanced: 0.5]

    public static func fullMarksFor(_ experience: ExperienceLevel?) -> FullMarks {
        let scale = experience.map { experienceScale[$0]! } ?? 1
        return FullMarks(e1rmPct: fullMarks.e1rmPct * scale, volumePct: fullMarks.volumePct * scale, prEvents: fullMarks.prEvents)
    }

    public static let noiseFloorPct = 3.0
    public static func deadband(_ pct: Double?, _ floor: Double = noiseFloorPct) -> Double? {
        guard let pct else { return nil }
        return abs(pct) < floor ? 0 : pct
    }
    public static func pctChange(_ from: Double, _ to: Double) -> Double? { from <= 0 ? nil : ((to - from) / from) * 100 }

    public static let progressScore = 0.22
    public static let declineScore = -0.22
    public static let stallScore = 0.1

    static func clamp(_ x: Double, _ lo: Double, _ hi: Double) -> Double { Swift.min(hi, Swift.max(lo, x)) }
    static func holdingCounts(_ g: Goal) -> Bool { g == .fatLoss || g == .sportSupport }

    public static func compositeScore(_ s: ProgressSignals, _ goal: Goal, _ experience: ExperienceLevel? = nil) -> Double {
        let w = goalSignalWeights[goal]!, marks = fullMarksFor(experience)
        var e1rm = s.e1rmChangePct.map { clamp($0 / marks.e1rmPct, -1, 1) }
        if holdingCounts(goal), let p = s.e1rmChangePct, abs(p) <= 2 { e1rm = Swift.max(e1rm ?? 0, 0.35) }
        let volume = s.volumeChangePct.map { clamp($0 / marks.volumePct, -1, 1) }
        let pr = clamp(s.prEvents / marks.prEvents, 0, 1)
        var score = 0.0, sum = 0.0
        if let e1rm { score += e1rm * w.e1rm; sum += w.e1rm }
        if let volume { score += volume * w.volume; sum += w.volume }
        score += pr * w.prs; sum += w.prs
        return sum > 0 ? score / sum : 0
    }

    public static func stallWindowFor(_ experience: ExperienceLevel = .intermediate) -> Int { experience == .advanced ? 6 : 3 }
    public static func holdsInsteadOfDeload(_ goal: Goal, _ experience: ExperienceLevel? = nil) -> Bool {
        holdingCounts(goal) || experience == .beginner
    }
}
