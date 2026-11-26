import XCTest
@testable import LiftLogCore

final class StoreTests: XCTestCase {
    func testKeyValueRoundTrip() throws {
        let store = try LiftLogStore()
        store.setItem(StorageKey.weightUnit, "kg")
        store.setItem(StorageKey.weightUnit, "lb")
        XCTAssertEqual(store.getItem(StorageKey.weightUnit), "lb")
        let program = [WorkoutDay(id: 1, label: "Day 1", muscleGroups: "Chest", exercises: [Exercise(id: "bench-press", name: "Bench Press", sets: 3, repLow: 5, repHigh: 8)])]
        store.setJSON(program, StorageKey.program)
        XCTAssertEqual(store.getJSON([WorkoutDay].self, StorageKey.program), program)
        store.removeItem(StorageKey.program)
        XCTAssertNil(store.getItem(StorageKey.program))
        XCTAssertEqual(store.allKeys(), [StorageKey.weightUnit])
    }

    func testSessionsAndSetsAreAtomic() throws {
        let store = try LiftLogStore()
        let id = try store.saveSession(Session(guid: "g1", dayId: 1, weekNumber: 2, startedAt: 1000, completedAt: 2000, updatedAt: 2000, note: "n"),
                                       sets: [SetLog(sessionId: 0, exerciseId: "bench-press", setNumber: 1, weight: 185, reps: 8, order: 0, technique: .paused, grip: .close),
                                              SetLog(sessionId: 0, exerciseId: "bench-press", setNumber: 0, weight: 95, reps: 10, warmup: true)])
        XCTAssertEqual(try store.allSessions().first?.guid, "g1")
        let sets = try store.sets(forSession: id)
        XCTAssertEqual(sets.count, 2)
        XCTAssertEqual(sets[0].technique, .paused)
        XCTAssertEqual(sets[1].warmup, true)
        XCTAssertNil(sets[0].warmup)

        try store.replaceSets(sessionId: id, sets: [SetLog(sessionId: id, exerciseId: "squat", setNumber: 1, weight: 225, reps: 5)], updatedAt: 3000)
        XCTAssertEqual(try store.sets(forSession: id).map(\.exerciseId), ["squat"])
        XCTAssertEqual(try store.allSessions().first?.updatedAt, 3000)

        // A duplicate guid aborts the whole save — no orphan sets.
        XCTAssertThrowsError(try store.saveSession(Session(guid: "g1", dayId: 1, weekNumber: 2, startedAt: 1),
                                                   sets: [SetLog(sessionId: 0, exerciseId: "x", setNumber: 1, weight: 1, reps: 1)]))
        XCTAssertEqual(try store.allSetLogs().count, 1)

        try store.deleteSession(id: id)
        XCTAssertTrue(try store.allSessions().isEmpty)
        XCTAssertTrue(try store.allSetLogs().isEmpty)
    }

    func testPersistsToDisk() throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent("liftlog-\(UUID().uuidString).sqlite").path
        defer { try? FileManager.default.removeItem(atPath: path) }
        do { let s = try LiftLogStore(path: path); s.setItem("k", "v") }
        XCTAssertEqual(try LiftLogStore(path: path).getItem("k"), "v")
    }
}

final class JSSemanticsTests: XCTestCase {
    func testRoundAndFormat() {
        XCTAssertEqual(JS.round(-2.5), -2); XCTAssertEqual(JS.round(2.5), 3); XCTAssertEqual(JS.round(0.49999999999999994), 0)
        XCTAssertEqual(JS.toFixed(1.005, 2), "1.00"); XCTAssertEqual(JS.toFixed(2.5, 0), "3"); XCTAssertEqual(JS.toFixed(-0.04, 1), "-0.0")
        XCTAssertEqual(JS.string(84.1), "84.1"); XCTAssertEqual(JS.string(185), "185"); XCTAssertEqual(JS.string(1e-7), "1e-7")
    }

    func testLocalDatesAcrossDST() {
        LiftLogEnv.timeZone = TimeZone(identifier: "America/Chicago")!
        // 2026-03-08 02:30 does not exist in Chicago; JS moves it forward to 03:30.
        let gap = JSDate.make(2026, 2, 8, 2, 30)
        XCTAssertEqual(JSDate.parts(gap).hours, 3)
        // Day overflow normalizes like JS (Mar 32 → Apr 1).
        XCTAssertEqual(JSDate.parts(JSDate.make(2026, 2, 32)).month, 3)
        XCTAssertEqual(JSDate.parts(JSDate.make(2026, 2, 16)).weekday, 1)
    }
}
