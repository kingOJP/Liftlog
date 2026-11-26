import XCTest
@testable import LiftLogCore

final class SubstitutionParityTests: XCTestCase {
    func testSubstitutionParity() throws {
        try Parity.run("substitution", [
            "candidateProfiles": { _ in Substitution.candidateProfiles() },
            "suggestReplacements": { c in
                let s: [Session]? = try c.arg(2), l: [SetLog]? = try c.arg(3)
                let snap = s.flatMap { s in l.map { Analytics.buildSnapshot(s, $0) } }
                return Substitution.suggestReplacements(try c.arg(0), try c.arg(1), snap, limit: try c.arg(6),
                                                        goal: try c.arg(4), regression: try c.arg(5))
            },
        ])
    }
}
