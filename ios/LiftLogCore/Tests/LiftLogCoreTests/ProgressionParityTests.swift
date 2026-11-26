import XCTest
@testable import LiftLogCore

final class ProgressionParityTests: XCTestCase {
    func testProgressionParity() throws {
        try Parity.run("progression", [
            "weights": { _ in Dictionary(uniqueKeysWithValues: Progression.goalSignalWeights.map { ($0.key.rawValue, $0.value) }) },
            "fullMarksFor": { c in Progression.fullMarksFor(try c.arg(0)) },
            "deadband": { c in Progression.deadband(try c.arg(0), try c.arg(1)).json },
            "pctChange": { c in Progression.pctChange(try c.arg(0), try c.arg(1)).json },
            "compositeScore": { c in Progression.compositeScore(try c.arg(0), try c.arg(1), try c.arg(2)) },
            "stallWindowFor": { c in Progression.stallWindowFor(try c.arg(0)) },
            "holdsInsteadOfDeload": { c in Progression.holdsInsteadOfDeload(try c.arg(0), try c.arg(1)) },
        ])
    }
}
