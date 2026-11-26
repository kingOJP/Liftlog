import XCTest
@testable import LiftLogCore

private struct ProjectionCase: Encodable { var p: GoalProjection; var eta: String }

final class StrengthParityTests: XCTestCase {
    private static func snap(_ c: ParityCase) throws -> TrainingSnapshot { Analytics.buildSnapshot(try c.arg(0), try c.arg(1)) }
    func testStrengthParity() throws {
        try Parity.run("strength", [
            "pctOfMaxForReps": { c in Strength.pctOfMaxForReps(try c.arg(0)) },
            "pctOfMax": { c in Strength.pctOfMax(try c.arg(0), try c.arg(1)) },
            "percentBandFor": { c in Strength.percentBandFor(try c.arg(0)).json },
            "loadBandFor": { c in Strength.loadBandFor(try c.arg(0), try c.arg(1), try c.arg(2)).json },
            "programLoadsFor": { c in Strength.programLoadsFor(try c.arg(0), try c.arg(1), try c.arg(2), try c.arg(3)) },
            "bestLoggedMax": { c in Strength.bestLoggedMax(try Self.snap(c), try c.arg(2)).json },
            "e1rmSeriesFor": { c in Strength.e1rmSeriesFor(try Self.snap(c), try c.arg(2)) },
            "strengthTrend": { c in Strength.strengthTrend(try Self.snap(c), try c.arg(2), now: try c.arg(3)).json },
            "currentMax": { c in Strength.currentMax(try c.arg(0), try c.arg(1)).json },
            "projectGoal": { c in let p = Strength.projectGoal(try c.arg(0)); return ProjectionCase(p: p, eta: Strength.etaLabel(p)) },
            "goalProgress": { c in Strength.goalProgress(try c.arg(0), try c.arg(1), try c.arg(2)) },
        ])
    }
}
