import Foundation

// Port of src/data/experience.ts — training-age inference (nudge only).

public struct ExperienceInference: Codable, Hashable, Sendable {
    public var level: ExperienceLevel
    public var sessions: Int
    public var weeks: Double
    public var masteredAdvanced: Int
    public var rationale: String
}

public struct ExperienceSuggestion: Codable, Hashable, Sendable {
    public var from: ExperienceLevel
    public var to: ExperienceLevel
    public var rationale: String
}

public enum Experience {
    static let weekMs = 7 * 86_400_000.0
    static let consistentSessions = 3
    public static let intermediateWeeks = 26.0, intermediateSessions = 40
    public static let advancedWeeks = 78.0, advancedSessions = 120
    static let advancedMasteryWeeks = 52.0, advancedMasterySessions = 80
    public static let rank: [ExperienceLevel: Int] = [.beginner: 0, .intermediate: 1, .advanced: 2]
    static let difficultyRank: [ExerciseDifficulty: Int] = [.beginner: 0, .intermediate: 1, .advanced: 2]

    public static func inferExperience(_ snap: TrainingSnapshot, _ now: Double = LiftLogEnv.now()) -> ExperienceInference {
        let sessions = snap.sessions.count
        if sessions == 0 { return ExperienceInference(level: .beginner, sessions: 0, weeks: 0, masteredAdvanced: 0, rationale: "No training logged yet.") }
        let earliest = snap.sessions.map(Analytics.sessionTimestamp).min()!
        let weeks = Swift.max(1, JS.round((now - earliest) / weekMs))
        var mastered = 0
        for (id, points) in Progress.exercisePointSeries(snap) {
            if points.count < consistentSessions || !Catalog.hasCatalogDifficulty(id) { continue }
            if difficultyRank[Catalog.difficultyFor(id)]! >= 2 { mastered += 1 }
        }
        var level = ExperienceLevel.beginner
        var rationale = "Still building a base — early days."
        let months = JS.string(JS.round(weeks / 4.33))
        if weeks >= intermediateWeeks && sessions >= intermediateSessions {
            level = .intermediate
            rationale = "You've trained consistently for \(months) months across \(sessions) sessions — that's intermediate territory."
        }
        if (weeks >= advancedWeeks && sessions >= advancedSessions)
            || (mastered >= 3 && weeks >= advancedMasteryWeeks && sessions >= advancedMasterySessions) {
            level = .advanced
            rationale = mastered >= 3
                ? "You've been consistently handling \(mastered) advanced lifts across \(months) months and \(sessions) sessions — an advanced training history."
                : "\(JS.string(JS.round(weeks / 52))) year\(weeks >= 104 ? "s" : "") of training and \(sessions) logged sessions — an advanced base."
        }
        return ExperienceInference(level: level, sessions: sessions, weeks: weeks, masteredAdvanced: mastered, rationale: rationale)
    }

    public static func effectiveExperience(_ profile: TrainingProfile, _ snap: TrainingSnapshot?) -> ExperienceLevel { profile.experience }

    public static func experienceSuggestion(_ profile: TrainingProfile, _ snap: TrainingSnapshot?, _ now: Double = LiftLogEnv.now()) -> ExperienceSuggestion? {
        guard let snap else { return nil }
        let inf = inferExperience(snap, now)
        if rank[inf.level]! <= rank[profile.experience]! { return nil }
        return ExperienceSuggestion(from: profile.experience, to: inf.level, rationale: inf.rationale)
    }

    public static func experienceSuggestionText(_ s: ExperienceSuggestion) -> String {
        "\(s.rationale) Update your profile from \(PlanMath.experienceLabel(s.from)) to \(PlanMath.experienceLabel(s.to))?"
    }
}
