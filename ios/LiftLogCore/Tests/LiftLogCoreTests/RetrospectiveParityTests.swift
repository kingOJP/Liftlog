import XCTest
@testable import LiftLogCore

final class RetrospectiveParityTests: XCTestCase {
    func testRetrospectiveParity() throws {
        try Parity.run("retrospective", [
            "computeBlockRetrospective": { c in
                Retrospective.computeBlockRetrospective(try c.arg(0), Analytics.buildSnapshot(try c.arg(1), try c.arg(2)), now: try c.arg(3))
            },
        ])
    }
}
