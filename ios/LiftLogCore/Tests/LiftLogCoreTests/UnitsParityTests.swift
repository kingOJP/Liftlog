import XCTest
@testable import LiftLogCore

final class UnitsParityTests: XCTestCase {
    func testUnitsParity() throws {
        try Parity.run("units", [
            "toDisplay": { c in Units.toDisplay(try c.arg(0), try c.arg(1, WeightUnit.self)) },
            "fromDisplay": { c in Units.fromDisplay(try c.arg(0), try c.arg(1, WeightUnit.self)) },
            "fmtWeight": { c in Units.fmtWeight(try c.arg(0), try c.arg(1, WeightUnit.self)) },
            "unitLabelFor": { c in Units.unitLabelFor(try c.arg(0, WeightUnit.self)) },
            "storedUnit": { _ in ["unit": Units.getWeightUnit().rawValue, "w": Units.fmtWeight(185.5)] },
        ])
    }
}
