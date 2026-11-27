import XCTest
@testable import LiftLogCore

private struct CtxJSON: Decodable {
    var weightType: WeightType?, phase: PhaseKind?, goal: Goal?, experience: ExperienceLevel?, unit: MeasureUnit?
    var oneRepMax: OneRepMaxInput?, scheme: SetScheme?, easyPast: Bool?
    func ctx(_ now: Double) -> PrescriptionContext {
        PrescriptionContext(weightType: weightType, phase: phase, goal: goal, experience: experience, unit: unit, oneRepMax: oneRepMax,
                            now: now, phaseOf: easyPast == true ? { _ in .intro } : nil, scheme: scheme)
    }
}

final class RecommendationsParityTests: XCTestCase {
    func testRecommendationsParity() throws {
        try Parity.run("recommendations", [
            "calculateRecommendation": { c in
                Recommendations.calculateRecommendation(try c.arg(0), try c.arg(1), (try c.arg(2) as CtxJSON).ctx(c.now)).json
            },
            "buildSetPlan": { c in Recommendations.buildSetPlan(try c.arg(0), try c.arg(1), (try c.arg(2) as CtxJSON).ctx(c.now)) },
            "needsRegression": { c in Recommendations.needsRegression(try c.arg(0), try c.arg(1)) },
            "incrementFor": { c in Recommendations.incrementFor(try c.arg(0), try c.arg(1)) },
            "loadFromMax": { c in Recommendations.loadFromMax(try c.arg(0), try c.arg(1), try c.arg(2)) },
            "historyDepthFor": { c in Recommendations.historyDepthFor(try c.arg(0)) },
        ])
    }
}
