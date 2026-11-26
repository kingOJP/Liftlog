import XCTest
@testable import LiftLogCore

final class ProgressParityTests: XCTestCase {
    func testProgressParity() throws {
        try Parity.run("progress", [
            "exercisePointSeries": { c in
                let plans: [TrainingPlan]? = try c.arg(2)
                return Progress.exercisePointSeries(Analytics.buildSnapshot(try c.arg(0), try c.arg(1)), phaseOf: plans.map(PlanMath.phaseResolverFor))
            },
            "assessExercise": { c in
                Progress.assessExercise(try c.arg(0), try c.arg(1), try c.arg(2), name: "Name", windowSize: try c.arg(3))
            },
            "assessSnapshot": { c in
                let a = Progress.assessSnapshot(Analytics.buildSnapshot(try c.arg(0), try c.arg(1)), try c.arg(2),
                                                phaseOf: PlanMath.phaseResolverFor(try c.arg(3)))
                let d = Progress.progressDirections(a)
                return obj(["a": a, "up": d.up.sorted(), "down": d.down.sorted(), "stalled": d.stalled.sorted()])
            },
            "categoryProgress": { c in Progress.categoryProgress(Analytics.buildSnapshot(try c.arg(0), try c.arg(1)), try c.arg(2)) },
        ])
    }
}
