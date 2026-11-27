import XCTest
@testable import LiftLogCore

final class SyncParityTests: XCTestCase {
    struct PlanMergeJSON: Encodable { var doc: PlanState; var changed: Bool; var clock: Double }

    func testSyncParity() throws {
        try Parity.run("sync", [
            "planSessionMerge": { c in
                SyncMerge.planSessionMerge(local: try c.arg(0), incoming: try c.arg(1), tombstones: Set(try c.arg(2, [String].self)))
            },
            "mergePlanDocs": { c in
                let incoming: PlanState = try c.arg(1)
                let r = SyncMerge.mergePlanDocs(current: try c.arg(0), incoming: incoming)
                return PlanMergeJSON(doc: r.doc, changed: r.changed, clock: SyncMerge.planDocClock(incoming))
            },
        ])
    }
}
