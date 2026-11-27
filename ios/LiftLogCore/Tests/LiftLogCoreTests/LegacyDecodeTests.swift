import XCTest
@testable import LiftLogCore

/// Legacy PWA data may hold fractional counts (history-derived rep ranges were
/// a median). They round to whole numbers; the document must still decode.
final class LegacyDecodeTests: XCTestCase {
    func testFractionalDoseKeepsTheProgram() throws {
        let json = #"[{"id":1,"label":"A","muscleGroups":"Legs","exercises":[{"id":"leg-press","name":"Leg Press","sets":3,"repLow":4.5,"repHigh":8.5},{"id":"seated-leg-curl","name":"Seated Leg Curl","sets":2.6}]}]"#
        let days = try JSONDecoder().decode([WorkoutDay].self, from: Data(json.utf8))
        XCTAssertEqual(days[0].exercises.count, 2)
        XCTAssertEqual(days[0].exercises[0].repLow, 5)
        XCTAssertEqual(days[0].exercises[0].repHigh, 9)
        XCTAssertEqual(days[0].exercises[1].sets, 3)
    }

    func testFractionalRangeMemoryKeepsTheSet() throws {
        let log = try JSONDecoder().decode(SetLog.self, from: Data(#"{"sessionId":1,"exerciseId":"x","setNumber":1,"weight":100,"reps":8,"repLow":4.5,"repHigh":8.5}"#.utf8))
        XCTAssertEqual(log.repLow, 5)
        XCTAssertEqual(log.repHigh, 9)
        let lib = try JSONDecoder().decode([LibraryExercise].self, from: Data(#"[{"id":"x","name":"X","sets":3,"repLow":6.5,"repHigh":10}]"#.utf8))
        XCTAssertEqual(lib[0].repLow, 7)
    }

    func testMissingSetsStillFails() {
        XCTAssertThrowsError(try JSONDecoder().decode(Exercise.self, from: Data(#"{"id":"x","name":"X"}"#.utf8)))
    }
}
