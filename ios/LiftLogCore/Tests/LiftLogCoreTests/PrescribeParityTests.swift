import XCTest
@testable import LiftLogCore

final class PrescribeParityTests: XCTestCase {
    func testPrescribeParity() throws {
        var history: TrainingSnapshot? = nil
        func opts(_ c: ParityCase) throws -> PrescribeOptions {
            let g: String? = try c.arg(3)
            let goal: Goal?? = g == "unset" ? .none : .some(g.flatMap(Goal.init(rawValue:)))
            let hist: Bool = try c.arg(5)
            return PrescribeOptions(name: try c.arg(1), slot: try c.arg(2),
                                    snapshot: hist ? history : nil,
                                    goal: goal, experience: try c.arg(4))
        }
        try Parity.run("prescribe", [
            "history": { c in
                let s: [Session] = try c.arg(0), l: [SetLog] = try c.arg(1)
                history = Analytics.buildSnapshot(s, l)
                return s.count + l.count
            },
            "planStore": { c in
                obj(["planned": PlanStore.getPlannedGoal().json, "training": PlanStore.getTrainingGoal(),
                     "profile": PlanStore.getProfileOrDefault(), "phase": PlanStore.getActivePhase(c.now).json,
                     "content": PlanStore.planStateHasContent(PlanStore.getPlanState())])
            },
            "prescribeFor": { c in Prescribe.prescribeFor(try c.arg(0), try opts(c)).json },
            "slotFor": { c in Prescribe.slotFor(try c.arg(0), try c.arg(1), try opts(c)) },
        ])
    }
}
