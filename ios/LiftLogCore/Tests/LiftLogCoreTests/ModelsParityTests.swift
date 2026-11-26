import XCTest
@testable import LiftLogCore

/// Every storage/sync document the PWA writes must decode into the Swift
/// models and re-encode to the same JSON.
final class ModelsParityTests: XCTestCase {
    func roundTrip<T: Codable>(_ type: T.Type) -> (ParityCase) throws -> any Encodable {
        { c in try c.arg(0, T.self) }
    }

    func testModelsRoundTrip() throws {
        try Parity.run("models", [
            "WorkoutDay[]": roundTrip([WorkoutDay].self),
            "LibraryExercise[]": roundTrip([LibraryExercise].self),
            "Session": roundTrip(Session.self),
            "SetLog[]": roundTrip([SetLog].self),
            "SessionDoc": roundTrip(SessionDoc.self),
            "DraftSession": roundTrip(DraftSession.self),
            "PlanState": roundTrip(PlanState.self),
            "Record<string, ExerciseMetaOverride>": roundTrip([String: ExerciseMetaOverride].self),
            "Settings": roundTrip(Settings.self),
            "SyncStatus": roundTrip(SyncStatus.self),
        ])
    }

    /// Explicit nulls must survive (diff treats absent == null, so check raw).
    func testExplicitNullsAreEncoded() throws {
        let meta = ExerciseMetaOverride(primaryMuscle: .chest)
        let s = String(data: try JSONEncoder().encode(meta), encoding: .utf8)!
        XCTAssertTrue(s.contains("\"secondaryMuscle1\":null"))
        XCTAssertFalse(s.contains("updatedAt"))
    }

    func testUnknownTechniqueIsDropped() throws {
        let json = #"{"sessionId":1,"exerciseId":"x","setNumber":1,"weight":100,"reps":5,"technique":"cluster","grip":"wide"}"#
        let log = try JSONDecoder().decode(SetLog.self, from: Data(json.utf8))
        XCTAssertNil(log.technique)
        XCTAssertEqual(log.grip, .wide)
    }
}
