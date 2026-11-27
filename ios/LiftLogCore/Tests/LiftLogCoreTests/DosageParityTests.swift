import XCTest
@testable import LiftLogCore

final class DosageParityTests: XCTestCase {
    func testDosageParity() throws {
        try Parity.run("dosage", [
            "profileFor": { c in Substitution.profileFor(try c.arg(0), try c.arg(1)) },
            "isHeavyAxial": { c in Dosage.isHeavyAxial(try c.arg(0)) },
            "dosage": { c in Dosage.dosage(try c.arg(0), try c.arg(1), try c.arg(2), try c.arg(3)) },
            "parseDose": { c in Dosage.parseDose(try c.arg(0), try c.arg(1), try c.arg(2), try c.arg(3)) },
            "rangeFromHistory": { c in Dosage.rangeFromHistory(try c.arg(0)).json },
            "resolvePrescription": { c in
                Dosage.resolvePrescription(profile: try c.arg(0), goal: try c.arg(1), experience: .intermediate, history: try c.arg(2)).json
            },
            "backoffFactor": { c in Dosage.backoffFactor(try c.arg(0)) },
            "strengthMainSlot": { c in Dosage.strengthMainSlot(try c.arg(0), try c.arg(1)) },
            "phaseRange": { c in
                Dosage.phaseRange(try c.arg(0), try c.arg(1), try c.arg(2)).map { obj(["repLow": $0.repLow, "repHigh": $0.repHigh]) }.json
            },
            "topSetScheme": { c in Dosage.topSetScheme(try c.arg(0), try c.arg(1), try c.arg(2), try c.arg(3)) },
            "applyPhaseRanges": { c in Dosage.applyPhaseRanges(try c.arg(0), try c.arg(1), try c.arg(2)) },
        ])
    }
}
