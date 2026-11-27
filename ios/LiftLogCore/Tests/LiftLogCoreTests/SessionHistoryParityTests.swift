import XCTest
@testable import LiftLogCore

final class SessionHistoryParityTests: XCTestCase {
    func testSessionHistoryParity() throws {
        try Parity.run("sessionHistory", [
            "snapshotPositions": { c in
                let snap = Analytics.buildSnapshot(try c.arg(0), try c.arg(1))
                return Dictionary(uniqueKeysWithValues: Progress.snapshotPositions(snap).map { (String($0.key), $0.value) })
            },
            "sessionExercisePositions": { c in Progress.sessionExercisePositions(try c.arg(0)) },
            "expectedVariation": { c in
                let sessions: [Session]? = try c.arg(1)
                let snap = sessions.map { Analytics.buildSnapshot($0, (try? c.arg(2)) ?? []) }
                return SessionHistory.expectedVariation(try c.arg(0), snap)
            },
            "exerciseHistory": { c in
                let snap = Analytics.buildSnapshot(try c.arg(0), try c.arg(1))
                let h = SessionHistory.exerciseHistory(snap, try c.arg(2), try c.arg(3), Progress.snapshotPositions(snap), try c.arg(4))
                return obj(["history": h.history, "borrowed": h.borrowed])
            },
        ])
    }
}
