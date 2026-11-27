import XCTest
@testable import LiftLogCore

final class ExperienceParityTests: XCTestCase {
    func testExperienceParity() throws {
        try Parity.run("experience", [
            "inferExperience": { c in Experience.inferExperience(Analytics.buildSnapshot(try c.arg(0), try c.arg(1)), c.now) },
            "experienceSuggestion": { c in
                var profile = PlanMath.defaultTrainingProfile(); profile.experience = try c.arg(2)
                let sessions: [Session]? = try c.arg(0)
                let snap = sessions.map { Analytics.buildSnapshot($0, (try? c.arg(1)) ?? []) }
                let sug = Experience.experienceSuggestion(profile, snap, c.now)
                return obj(["sug": sug.json, "text": sug.map(Experience.experienceSuggestionText).json,
                            "effective": Experience.effectiveExperience(profile, nil)])
            },
        ])
    }
}
