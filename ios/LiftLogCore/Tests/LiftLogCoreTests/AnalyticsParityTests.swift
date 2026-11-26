import XCTest
@testable import LiftLogCore

private func ids<K: CustomStringConvertible>(_ m: [K: [SetLog]]) -> [String: [Int?]] {
    Dictionary(uniqueKeysWithValues: m.map { ($0.key.description, $0.value.map(\.id)) })
}
private func keyed<V>(_ m: [MuscleGroup: V]) -> [String: V] { Dictionary(uniqueKeysWithValues: m.map { ($0.key.rawValue, $0.value) }) }

final class AnalyticsParityTests: XCTestCase {
    func testAnalyticsParity() throws {
        func snap(_ c: ParityCase) throws -> TrainingSnapshot { Analytics.buildSnapshot(try c.arg(0), try c.arg(1)) }
        func include(_ c: ParityCase) throws -> (Session) -> Bool {
            let since: Double? = try c.arg(2)
            return { s in since.map { Analytics.sessionTimestamp(s) >= $0 } ?? true }
        }
        try Parity.run("analytics", [
            "volumeTargetFor": { c in Analytics.volumeTargetFor(try c.arg(0), try c.arg(1)) },
            "buildSnapshot": { c in
                let s = try snap(c)
                return obj(["sessions": s.sessions.map(\.id), "working": ids(s.setsBySession), "all": ids(s.allSetsBySession)])
            },
            "sessionTime": { c in
                let s: Session = try c.arg(0)
                return obj(["ts": Analytics.sessionTimestamp(s), "week": Analytics.sessionWeekStart(s), "dur": Analytics.sessionDurationMs(s).json])
            },
            "avgDurationByDay": { c in Dictionary(uniqueKeysWithValues: Analytics.avgDurationByDay(try snap(c)).map { (String($0.key), $0.value) }) },
            "epley1RM": { c in Analytics.epley1RM(try c.arg(0), try c.arg(1)) },
            "e1rmSeries": { c in Analytics.e1rmSeries(try snap(c)) },
            "normalizeName": { c in Analytics.normalizeName(try c.arg(0)) },
            "identity": { c in
                let id: String = try c.arg(0)
                let r = Analytics.resolveExerciseIdentity(id)
                return obj(["identity": Self.identityJSON(r), "muscles": Analytics.musclesForExercise(id),
                            "primary": Analytics.primaryMuscleFor(id).json, "pattern": Analytics.movementPatternFor(id).json])
            },
            "identityNamed": { c in Self.identityJSON(Analytics.resolveExerciseIdentity(try c.arg(0), try c.arg(1))) },
            "musclesForSet": { c in Analytics.musclesForSet(try c.arg(0), try c.arg(1)) },
            "musclesForSlot": { c in Analytics.musclesForSlot(try c.arg(0)) },
            "muscleSetTotals": { c in
                let t = Analytics.muscleSetTotals(try snap(c), include: try include(c))
                return obj(["totals": keyed(t.totals), "unmappedSets": t.unmappedSets, "unmapped": t.unmappedExerciseIds.sorted()])
            },
            "headSetTotals": { c in
                let t = Analytics.headSetTotals(try snap(c), include: try include(c))
                return obj(["byHead": t.byHead, "unspecified": keyed(t.unspecified)])
            },
        ])
    }

    private static func identityJSON(_ r: ResolvedIdentity) -> [String: AnyEncodable] {
        obj(["primaryMuscle": r.primaryMuscle.json, "secondaryMuscles": r.secondaryMuscles, "workoutType": r.workoutType.json,
             "equipment": r.equipment.json, "weightType": r.weightType.json])
    }
}
